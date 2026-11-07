// src/lib/viewAsSession.ts
// A "View as" session keeps the hour it was opened with
// (impersonationSessionDuration in auth.ts). better-auth refreshes a session
// on a lookup once it is older than updateAge, moving its expiry out to the
// full 30 days, unless the request carries the dont_remember cookie.
// impersonate-user sets that cookie, so the browser's requests never refresh
// it; a Bearer request carries no cookies, and one lookup with the view-as
// token as a Bearer turned the hour into 30 days (seen on local dev).
// This keeps any refresh from moving a view-as session's expiry later.

/** The session better-auth's lookup found, as its endpoint left it on the context. */
interface HookContext {
  context?: {
    session?: { session?: { impersonatedBy?: string | null; expiresAt?: Date | string | null } | null } | null
  } | null
}

/**
 * better-auth's session update.before hook: the same update, with the expiry
 * held at the view-as session's own when it would move later. Any other
 * update, and any other session's, passes unchanged (undefined).
 *
 * The session being refreshed is the one get-session found and left on
 * ctx.context.session (better-auth 1.7.15: getSession sets it before
 * updateSession; the guard test reads its dist).
 */
export function holdViewAsExpiry(data: { expiresAt?: Date | string | null }, ctx: HookContext | null | undefined) {
  const current = ctx?.context?.session?.session
  if (!current?.impersonatedBy || !current.expiresAt || !data?.expiresAt) return undefined
  const held = new Date(current.expiresAt)
  if (!(new Date(data.expiresAt).getTime() > held.getTime())) return undefined
  return { data: { ...data, expiresAt: held } }
}
