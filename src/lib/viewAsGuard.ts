// src/lib/viewAsGuard.ts
// "View as" sessions only read. An admin who views the app as a user holds a
// session better-auth opened for that user (impersonatedBy: the admin's id),
// and anything it wrote would land on that user's account. The proxy
// (src/proxy.ts) runs this for every request before any route, page or Server
// Action sees it, so this is the one place those writes are refused: each
// handler keeps its own access check and needs nothing more.
//
// The answer comes from the session itself, looked up the way every route
// looks it up. Never from a marker the browser could drop or forge: the
// admin_session cookie better-auth sets alongside is only how Stop finds the
// admin's own session again.
//
// Only requests that may write pay for the lookup: a method other than GET or
// HEAD, or one of the few GETs that write, and only when they carry a session
// (a session cookie or a Bearer token). Everything else passes untouched.
//
// The admin can turn writes on (the bar's switch, VIEW_AS_WRITES_SWITCH),
// to act as the user: fix their watchlist, mark something watched. The
// setting is on the session (viewAsWrites), so it comes with the lookup this
// already makes and ends with the session. With it on, the user's app-data
// writes pass, Server Actions among them, and each one is logged; what could
// change the account itself or hand the session on stays refused
// (isAlwaysRefused).
import { isImpersonating, isViewAsWritesOn } from '@src/lib/roles/rules'

/** What a refused API request gets, as JSON with status 403. */
export const VIEW_AS_REFUSAL = {
  error: 'IMPERSONATING',
  message: 'Read-only while viewing as another user.',
} as const

/** The way out: with the switch below, the only writes a read-only view-as session may still make. */
export const VIEW_AS_EXITS: readonly string[] = ['/api/auth/admin/stop-impersonating', '/api/auth/sign-out']

/**
 * POSTs that only read, so the view shows what the user would see. Each was
 * read through to make sure it writes nothing: search, a title's details for
 * the backdrops (MovieLayout, TVLayout), and the watchlist search's "is this
 * in the library" lookup. A route lands here only after the same check; the
 * guard test pins this list.
 */
export const READ_ONLY_POSTS: readonly string[] = [
  '/api/authenticated/media',
  '/api/authenticated/media/in-library',
  '/api/authenticated/search',
]

/**
 * GETs that write, or hand the session to another client, refused like any
 * write:
 * - /api/auth/device claims a TV's pending sign-in code for the signed-in user
 * - /api/auth/account-info refreshes the user's OAuth tokens and stores them
 * - /api/auth/mobile-redirect gives the session token to the TV app, where,
 *   as a Bearer token without the dont_remember cookie, it would be refreshed
 *   past its hour
 */
export const WRITING_GETS: readonly string[] = ['/api/auth/device', '/api/auth/account-info', '/api/auth/mobile-redirect']

/**
 * The bar's switch (src/app/api/authenticated/view-as/writes): a plain POST
 * that turns writes on or off. It passes while read-only, or writes could
 * never be turned on; the endpoint makes its own checks.
 */
export const VIEW_AS_WRITES_SWITCH = '/api/authenticated/view-as/writes'

/**
 * Refused even with writes on, besides WRITING_GETS: better-auth's own
 * endpoints (all but the way out), which change the account, its sign-ins
 * and sessions, approve a device, or hand the session to another client (a TV
 * approved while viewing as would get an ordinary 30-day session as the user,
 * not a view-as one); and this app's own account endpoints (a deletion
 * request).
 */
export const ALWAYS_REFUSED_PREFIXES: readonly string[] = ['/api/auth/', '/api/authenticated/account/']

/** The request as the guard reads it. */
export interface GuardedRequest {
  method: string
  pathname: string
  headers: Headers
}

/** A session lookup: better-auth's getSession, for the headers the route will see. */
export type SessionLookup = (headers: Headers) => Promise<unknown>

/** A view-as session, as far as the guard reads it. */
export interface ViewAsSession {
  session?: { impersonatedBy?: string | null; viewAsWrites?: boolean | null } | null
  user?: { id?: unknown } | null
}

/** What the proxy is told along the way. */
export interface GuardHooks {
  /** The lookup threw; the write was refused (503). */
  onLookupError?: (error: unknown) => void
  /** A view-as session's write was let through because writes are on. */
  onWriteLetThrough?: (request: GuardedRequest, session: ViewAsSession) => void
}

/**
 * Decoded, lower case, no repeated or trailing slashes, so a list entry also
 * matches the spellings a router would route to it. A path that isn't valid
 * percent-encoding is matched as it came.
 */
function normalized(pathname: string) {
  let path = pathname
  try {
    path = decodeURIComponent(pathname)
  } catch {
    // not valid percent-encoding
  }
  return path.toLowerCase().replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1')
}

const EXITS = new Set(VIEW_AS_EXITS)
const READ_ONLY = new Set(READ_ONLY_POSTS)
const WRITING = new Set(WRITING_GETS)

/** A Server Action call: a POST with the Next-Action header. */
export const isServerAction = (request: GuardedRequest): boolean =>
  request.method.toUpperCase() === 'POST' && request.headers.has('next-action')

/**
 * Whether the request may write, and so is checked. A Server Action is always
 * checked, whatever page it posts to; READ_ONLY_POSTS and the switch are plain
 * API POSTs.
 */
export function mayWrite(request: GuardedRequest): boolean {
  const method = request.method.toUpperCase()
  const path = normalized(request.pathname)
  if (method === 'GET' || method === 'HEAD') return WRITING.has(path)
  if (EXITS.has(path)) return false
  if (method === 'POST' && !isServerAction(request) && (READ_ONLY.has(path) || path === VIEW_AS_WRITES_SWITCH)) return false
  return true
}

/** A write a view-as session may never make, writes on or not. */
export function isAlwaysRefused(request: GuardedRequest): boolean {
  const path = normalized(request.pathname)
  return WRITING.has(path) || path === '/api/auth' || ALWAYS_REFUSED_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/**
 * Whether the request carries a session: a better-auth session cookie (any
 * prefix; the __Secure- form too) or a Bearer token. A request without one
 * has no session to be viewing as.
 */
export function carriesSession(headers: Headers): boolean {
  if (headers.get('authorization')?.slice(0, 7).toLowerCase() === 'bearer ') return true
  const cookie = headers.get('cookie')
  if (!cookie) return false
  return cookie.split(';').some((pair) => {
    const eq = pair.indexOf('=')
    return (eq === -1 ? pair : pair.slice(0, eq)).trim().endsWith('.session_token')
  })
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })

/**
 * A Server Action's client reads a refusal's text as the thrown Error's
 * message, and only from a response whose type is exactly text/plain (no
 * charset); anything else becomes "An unexpected response was received".
 */
const actionRefusal = (status: number, message: string) =>
  new Response(message, { status, headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } })

/** The 403 for a write made while viewing as someone. */
export function viewAsRefusal(request: GuardedRequest): Response {
  return isServerAction(request) ? actionRefusal(403, VIEW_AS_REFUSAL.message) : json(403, { ...VIEW_AS_REFUSAL })
}

const LOOKUP_FAILED = {
  error: 'SESSION_CHECK_FAILED',
  message: 'Could not check the session. Try again.',
} as const

/**
 * The refusal for a write made with a view-as session, or null to let the
 * request through. A lookup that fails refuses the write (503) rather than
 * guess: the route would have looked the same session up next. With writes
 * on, a write passes unless it is always refused, and the proxy is told.
 */
export async function refuseViewAsWrite(
  request: GuardedRequest,
  lookup: SessionLookup,
  hooks: GuardHooks = {},
): Promise<Response | null> {
  if (!mayWrite(request) || !carriesSession(request.headers)) return null
  let session: ViewAsSession | null
  try {
    session = (await lookup(request.headers)) as ViewAsSession | null
  } catch (error) {
    hooks.onLookupError?.(error)
    return isServerAction(request) ? actionRefusal(503, LOOKUP_FAILED.message) : json(503, { ...LOOKUP_FAILED })
  }
  if (!isImpersonating(session)) return null
  if (isViewAsWritesOn(session) && !isAlwaysRefused(request)) {
    hooks.onWriteLetThrough?.(request, session as ViewAsSession)
    return null
  }
  return viewAsRefusal(request)
}
