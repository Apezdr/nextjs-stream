// src/lib/roles/gates.ts
// Every access check a page, Server Action or API route makes. A gate is one
// rule (rules.ts) with the answer each kind of caller gets when it refuses:
// - route():  for a Route Handler, the user or the Response to return:
//             `const user = await approvedGate.route(); if (user instanceof Response) return user`
// - page():   for a page or layout, the user; anyone else is redirected
// - action(): for a Server Action, the user; anyone else is redirected, or the
//             action throws. Each exported 'use server' function is its own
//             POST endpoint, so every action checks its caller: the gate of the
//             page that renders it doesn't cover it
// - check():  the user or null, for code that answers a refusal its own way
// page() and action() redirect by throwing, so call them outside any try/catch.
// Who holds the admin role is decided in adminRoleSync.ts; the gates only read it.
import 'server-only'
import { redirect } from 'next/navigation'
import { getSession } from '@src/lib/cachedAuth'
import { recordKeyCaller } from '@src/lib/requestCaller'
import { validateWebhookId } from '@src/utils/webhookServer'
import { isAdminUser, isAwaitingApproval, type AccessUser } from './rules'

/** A signed-in user as better-auth's session returns it. */
export type SessionUser = AccessUser & { id: string; [field: string]: any }

/** Why a gate turned someone away. */
type Refusal = 'signed-out' | 'approval-pending' | 'not-admin'

export interface Gate {
  route(): Promise<SessionUser | Response>
  /** callbackUrl: where sign-in sends a signed-out visitor back to. */
  page(callbackUrl?: string): Promise<SessionUser>
  action(callbackUrl?: string): Promise<SessionUser>
  check(): Promise<SessionUser | null>
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// What an API route answers. The web, TV and desktop apps read these bodies
// (the code most of all), so keep them as they are.
const ROUTE_REFUSALS: Record<Refusal, () => Response> = {
  'signed-out': () =>
    jsonResponse(401, { success: false, error: 'Unauthorized', message: 'You must be signed in.', code: 'AUTH_REQUIRED' }),
  'approval-pending': () =>
    jsonResponse(403, {
      success: false,
      error: 'Unauthorized',
      message: 'Account approval required.',
      code: 'APPROVAL_PENDING',
    }),
  'not-admin': () => jsonResponse(401, { success: false, error: 'Unauthorized', message: 'Admin access required.' }),
}

/** Where a page sends someone it turns away. */
function redirectAway(refusal: Refusal, callbackUrl?: string): never {
  if (refusal === 'signed-out') {
    redirect(callbackUrl ? `/auth/signin?callbackUrl=${encodeURIComponent(callbackUrl)}` : '/auth/signin')
  }
  if (refusal === 'approval-pending') redirect('/auth/error?error=APPROVAL_PENDING')
  redirect('/', 'replace')
}

/**
 * A Server Action sends a signed-out or pending caller where its page would
 * (redirect() works in an action: the client navigates). One asking for more
 * than the caller holds throws, so a caller that ignores the result can't fall
 * through to the mutation.
 */
function refuseAction(refusal: Refusal, callbackUrl?: string): never {
  if (refusal === 'signed-out' || refusal === 'approval-pending') redirectAway(refusal, callbackUrl)
  throw new Error('Admin access required.')
}

/** A gate from its rule: why the user (null when signed out) is refused, or null to let them in. */
function defineGate(refuse: (user: SessionUser | null) => Refusal | null): Gate {
  async function decide() {
    const session = await getSession()
    const user: SessionUser | null = session?.user ?? null
    return { user, refusal: refuse(user) }
  }
  return {
    async route() {
      const { user, refusal } = await decide()
      return refusal ? ROUTE_REFUSALS[refusal]() : (user as SessionUser)
    },
    async page(callbackUrl) {
      const { user, refusal } = await decide()
      if (refusal) redirectAway(refusal, callbackUrl)
      return user as SessionUser
    },
    async action(callbackUrl) {
      const { user, refusal } = await decide()
      if (refusal) refuseAction(refusal, callbackUrl)
      return user as SessionUser
    },
    async check() {
      const { user, refusal } = await decide()
      return refusal ? null : user
    },
  }
}

/** Signed in, nothing more. */
export const signedInGate = defineGate((user) => (user ? null : 'signed-out'))

/** Signed in and approved: what the media pages and nearly every API route need. */
export const approvedGate = defineGate((user) => {
  if (!user) return 'signed-out'
  return isAwaitingApproval(user) ? 'approval-pending' : null
})

/** An admin. Signed out counts as not an admin: admin routes have always answered both alike. */
export const adminGate = defineGate((user) => (isAdminUser(user) ? null : 'not-admin'))

/** A request a file server may send with its webhook ID. */
interface WebhookRequest {
  headers?: Headers | null
  query?: { webhookId?: string }
  /** Set when the webhook ID is valid: the server it belongs to. */
  webhookServerId?: string | null
}

const webhookIdOf = (req: WebhookRequest): string | null =>
  req.headers?.get('X-Webhook-ID') || req.query?.webhookId || null

/** True when the request carries a valid webhook ID; req.webhookServerId then names its server. */
export async function isValidWebhook(req: WebhookRequest): Promise<boolean> {
  const webhookId = webhookIdOf(req)
  if (!webhookId) return false
  const result = await validateWebhookId(webhookId)
  // A match always names its setting (WEBHOOK_ID, WEBHOOK_ID_2, ...)
  if (!result.isValid || !result.credential) return false
  req.webhookServerId = result.serverId
  recordKeyCaller('webhook', webhookId, result.credential, result.serverId)
  return true
}

/**
 * For a route that file servers call with their webhook ID and admins with a
 * session: true for a valid ID (req.webhookServerId names the server), a 401 for
 * a wrong one, and without one the admin gate's answer.
 */
export async function adminOrWebhook(req: WebhookRequest): Promise<true | SessionUser | Response> {
  if (!webhookIdOf(req)) return adminGate.route()
  if (await isValidWebhook(req)) return true
  return jsonResponse(401, { success: false, message: 'Invalid webhook identifier.' })
}
