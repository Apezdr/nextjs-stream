// src/lib/playbackUser.ts
// A playback save lands on the account its page was rendered for, or nowhere.
//
// A browser's playback write goes out with whatever session cookie the
// browser holds when it leaves, which need not be the session its page was
// rendered for. Pressing "View as" Stop with a player open puts the admin's
// cookie back and leaves the page; the player's final keepalive save goes on
// unload with the admin's cookie, and the viewed user's position landed in the
// admin's history. Signing in as someone else in another tab did the same.
//
// So every playback write from the browser names the user its page was
// rendered for (PLAYBACK_USER_HEADER), and the route refuses a cookie write
// whose session is someone else's (409 USER_MISMATCH), or that names nobody
// (400 PLAYBACK_USER_REQUIRED: the contract is enforced, never assumed). A
// Bearer client (the TV and desktop apps) is exempt: its token is the
// identity, and can't change under a request.
//
// The "View as" guard runs first, in the proxy: a read-only view-as session's
// write never gets here; with writes on, its page was rendered for the viewed
// user, whose session it is, so the two match; after Stop the admin's cookie
// doesn't, and the write is refused.
//
// No server-only import: the browser's writers build the header from here.

/** The header a browser playback write names its page's user in. */
export const PLAYBACK_USER_HEADER = 'X-Playback-User'

/** What a write from another account's page gets, with status 409. */
export const PLAYBACK_USER_MISMATCH = {
  error: 'USER_MISMATCH',
  message: 'This page was opened for another account. Reload it.',
} as const

/** What a cookie write that names no user gets, with status 400. */
export const PLAYBACK_USER_REQUIRED = {
  error: 'PLAYBACK_USER_REQUIRED',
  message: 'A playback save names the user its page was opened for. Reload the page.',
} as const

/**
 * The headers of a browser playback write: JSON, and the user its page was
 * rendered for. A page rendered for no one names no one, and its writes are
 * refused.
 */
export function playbackWriteHeaders(userId: unknown): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (userId !== null && userId !== undefined && String(userId) !== '') headers[PLAYBACK_USER_HEADER] = String(userId)
  return headers
}

/** A request authenticated by a Bearer token, which is its identity. */
export const isBearerRequest = (headers: Headers): boolean =>
  headers.get('authorization')?.slice(0, 7).toLowerCase() === 'bearer '

/** The one pino method used. */
export interface PlaybackUserLog {
  warn(fields: Record<string, unknown>, message: string): void
}

const json = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// A tab left open across a deploy runs the old code, whose saves name no one:
// each is refused, about once a second while it plays, until the page reloads.
// One warning per user a minute says so without flooding the log.
export const MISSING_USER_WARN_EVERY_MS = 60_000
const lastMissingUserWarn = new Map<string, number>()

function warnsAgain(userId: string, now: number) {
  const last = lastMissingUserWarn.get(userId)
  if (last !== undefined && now - last < MISSING_USER_WARN_EVERY_MS) return false
  // Bounded: a flood of users can't grow it
  if (lastMissingUserWarn.size >= 10_000) lastMissingUserWarn.clear()
  lastMissingUserWarn.set(userId, now)
  return true
}

/**
 * For a playback write route, after its gate: the refusal for a cookie write
 * from another account's page (or one that names none), or null to go on.
 * Logged with both ids, never an email; one that names no one at most once a
 * minute per user.
 */
export function refusePlaybackUserMismatch(
  request: { headers: Headers; url?: string },
  sessionUserId: unknown,
  log?: PlaybackUserLog
): Response | null {
  if (isBearerRequest(request.headers)) return null
  const expectedUserId = request.headers.get(PLAYBACK_USER_HEADER)?.trim() || null
  const userId = sessionUserId === null || sessionUserId === undefined ? '' : String(sessionUserId)
  const path = request.url ? new URL(request.url).pathname : null
  if (!expectedUserId) {
    if (log && warnsAgain(userId, Date.now())) log.warn({ userId, path }, 'Playback write refused: it names no user')
    return json(400, { ...PLAYBACK_USER_REQUIRED })
  }
  if (expectedUserId !== userId) {
    log?.warn({ userId, expectedUserId, path }, 'Playback write refused: its page was opened for another account')
    return json(409, { ...PLAYBACK_USER_MISMATCH })
  }
  return null
}
