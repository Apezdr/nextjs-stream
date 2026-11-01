import { SpanKind, trace, type Attributes, type Context, type Span } from '@opentelemetry/api'

/**
 * Span processors registered by src/instrumentation.ts, and the lookup
 * requestCaller.ts reads. No server-only import: the instrumentation hook
 * loads this too.
 */

type StartedSpan = Span & { attributes: Attributes; name: string; kind?: SpanKind }

const noopLifecycle = {
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
}

// Query parameters that carry a credential, compared lowercased with - _ .
// removed: apikey matches apiKey, api_key and api-key. code and user_code are
// the one-time codes of the social sign-in callback and the device flow; the
// rest are the names src/lib/httpHelper.js redacts in log lines, and signed
// cloud URLs' signatures.
const CREDENTIAL_PARAMS = new Set([
  'apikey',
  'key',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'xplextoken',
  'jwt',
  'webhookid',
  'auth',
  'secret',
  'clientsecret',
  'password',
  'passwd',
  'code',
  'usercode',
  'sig',
  'signature',
  'xamzsignature',
  'xamzcredential',
  'xamzsecuritytoken',
  'xgoogsignature',
  'awsaccesskeyid',
])

// The span attributes that hold a URL: Next's request target, the client
// URL @vercel/otel records (and resource.name, the same URL without its
// query), the HTTP conventions' url.*, and next.span_name, the span name Next
// copies as a span starts. url.query has no leading '?'.
const URL_ATTRIBUTES = ['http.target', 'http.url', 'url.full', 'url.path', 'url.query', 'resource.name', 'next.span_name']

// Linear on any input, as both run on every request's URL: neither class can
// cross the separator that starts the next match, and the scheme is bounded
// (an unbounded one backtracks over a long run like a.a.a.a://).
const QUERY_PARAM = /([?&;])([^=&#?;\s]+)=([^&#?;\s]*)/g
const USERINFO = /(\b[a-z][a-z0-9+.-]{0,30}:\/\/)[^\s/@:]+:[^\s/@]*@/gi
// A Discord webhook's token is the last path segment, not a parameter
const DISCORD_WEBHOOK_TOKEN = /(\/api\/webhooks\/\d+\/)[\w-]+/g

function isCredentialParam(name: string): boolean {
  let decoded = name
  try {
    decoded = decodeURIComponent(name)
  } catch {
    // a malformed escape is compared as sent
  }
  return CREDENTIAL_PARAMS.has(decoded.toLowerCase().replace(/[-_.]/g, ''))
}

/**
 * A URL, or text holding one, with every credential in it replaced by
 * REDACTED: credential query parameters' values, a user:password, a Discord
 * webhook token. Everything else is kept.
 */
export function redactUrlCredentials(text: string): string {
  let result = text
  if (result.includes('=')) {
    result = result.replace(QUERY_PARAM, (match, separator: string, name: string, value: string) =>
      value && isCredentialParam(name) ? `${separator}${name}=REDACTED` : match
    )
  }
  if (result.includes('@')) result = result.replace(USERINFO, '$1REDACTED@')
  if (result.includes('/api/webhooks/')) result = result.replace(DISCORD_WEBHOOK_TOKEN, '$1REDACTED')
  return result
}

/**
 * Keeps credentials sent in a URL out of the trace store. Next records the
 * request URL as it arrived (http.target, query included) on its server span,
 * and @vercel/otel's client spans, fetch and node:http/https alike (so axios
 * and got too), carry the full URL in http.url and in the span name. Each is
 * set as the span starts, so this rewrites them before anything is exported.
 * The forward-auth check (/api/authz/verify) arrives with the gated app's
 * query, ?apikey= included, about 14k times a day.
 */
export const credentialQueryProcessor = {
  onStart(span: StartedSpan) {
    for (const key of URL_ATTRIBUTES) {
      const value = span.attributes[key]
      if (typeof value !== 'string') continue
      const redacted = key === 'url.query' ? redactUrlCredentials(`?${value}`).slice(1) : redactUrlCredentials(value)
      if (redacted !== value) span.setAttribute(key, redacted)
    }
    const redactedName = redactUrlCredentials(span.name)
    if (redactedName !== span.name) span.updateName(redactedName)
  },
  ...noopLifecycle,
}

// Each span's request SERVER span. On globalThis: Next loads the
// instrumentation hook and each route bundle as separate module graphs, so a
// module-level map would not be the one the routes read. A WeakMap needs no
// cleanup: an entry goes with its span.
const SERVER_SPAN_OF = Symbol.for('nextjs_stream.otel.serverSpanOf')

function serverSpanOf(): WeakMap<Span, Span> {
  const store = globalThis as typeof globalThis & { [SERVER_SPAN_OF]?: WeakMap<Span, Span> }
  return (store[SERVER_SPAN_OF] ??= new WeakMap())
}

/**
 * Maps every span to the SERVER span of the request it runs in. User code runs
 * inside one of Next's child spans ('executing api route (app) ...', 'render
 * route (app) ...'); the SERVER span is the one that ends up with http.route
 * and the status, the one the processor's caller attributes go on too. Keyed
 * on kind: Next names the span and sets http.route only as it ends. The proxy
 * pass is a separate SERVER span that ends before a route runs, and the trace's
 * root, so a caller is never on a root span here.
 */
export const serverSpanProcessor = {
  onStart(span: StartedSpan, parentContext: Context) {
    const map = serverSpanOf()
    if (span.kind === SpanKind.SERVER) {
      map.set(span, span)
      return
    }
    const parent = trace.getSpan(parentContext)
    const server = parent && map.get(parent)
    if (server) map.set(span, server)
  },
  ...noopLifecycle,
}

/** The active request's SERVER span, or the active span when there is none (or no SDK). */
export function activeServerSpan(): Span | undefined {
  const active = trace.getActiveSpan()
  return active && (serverSpanOf().get(active) ?? active)
}
