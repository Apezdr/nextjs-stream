import 'server-only'
import { createHash } from 'node:crypto'
import type { Attributes } from '@opentelemetry/api'
import { activeServerSpan } from '@src/lib/telemetrySpans'

/**
 * Who made a request, recorded on the request's SERVER span (the one with
 * http.route and the status; see telemetrySpans.ts) so a trace, and every log
 * line, which carries its trace_id, leads back to the caller:
 *
 * - nextjs_stream.caller.type        'user' | 'webhook' | 'api-key'
 * - user.id                          a signed-in user's id (never the email or name)
 * - nextjs_stream.caller.credential  which configured key matched: its env
 *                                    name (WEBHOOK_ID_2, MEDIA_ACTIVITY_API_KEY),
 *                                    never its value
 * - nextjs_stream.caller.fingerprint that key's fingerprint (see below)
 * - nextjs_stream.caller.server      the file server a webhook key belongs to
 *
 * The media processor records the same attributes on its server spans, so one
 * webhook key reads the same in both services' traces. With OpenTelemetry off
 * there is no span and nothing is recorded.
 */

/**
 * A credential's fingerprint: the first 8 hex digits of its SHA-256. Tells two
 * keys apart without revealing one. The media processor's log redaction
 * (lib/webhookIdRedaction.mjs) prints the same digest.
 */
export function credentialFingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 8)}`
}

function record(attributes: Attributes) {
  activeServerSpan()?.setAttributes(attributes)
}

/** A signed-in user made this request. */
export function recordUserCaller(userId: string | null | undefined): void {
  if (!userId) return
  record({ 'nextjs_stream.caller.type': 'user', 'user.id': String(userId) })
}

type AuthSession = { session?: { expiresAt?: Date | string }; user?: { id?: string } } | null | undefined

/**
 * The caller of a request better-auth answered itself (/api/auth/*: the session
 * check, device approve and deny, a sign-in; not sign-out, which never loads
 * the session it ends), from its after hook's context:
 * the unexpired session the request carried, else the one a sign-in just made.
 * Never the endpoint's result, which can be another user (an admin's
 * impersonate-user or create-user).
 */
export function recordAuthHandlerCaller(context: { session?: AuthSession; newSession?: AuthSession }): void {
  const carried = context.session
  const expiresAt = carried?.session?.expiresAt
  const live = carried?.user?.id && expiresAt && new Date(expiresAt) > new Date() ? carried : null
  recordUserCaller((live ?? context.newSession)?.user?.id)
}

/**
 * A configured key authenticated this request: a webhook ID or another API key.
 * `credential` names the setting it matched (WEBHOOK_ID_2); the key itself is
 * only ever recorded as its fingerprint.
 */
export function recordKeyCaller(
  type: 'webhook' | 'api-key',
  key: string,
  credential: string,
  server?: string | null,
): void {
  const attributes: Attributes = {
    'nextjs_stream.caller.type': type,
    'nextjs_stream.caller.credential': credential,
    'nextjs_stream.caller.fingerprint': credentialFingerprint(key),
  }
  if (server) attributes['nextjs_stream.caller.server'] = server
  record(attributes)
}
