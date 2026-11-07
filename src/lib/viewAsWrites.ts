// src/lib/viewAsWrites.ts
// Where the "View as" bar's switch keeps its setting: on the view-as session
// itself (viewAsWrites, a session field better-auth knows: authUserFields.ts),
// so the guard reads it from the session lookup it already makes, and it ends
// with the session (Stop, sign-out, the hour). Never a cookie or client state.
//
// Written through better-auth's own session update, which writes Mongo (the
// record) and rewrites the session's Redis entry when there is one (better-auth
// 1.7.15; the guard test reads its dist). That leaves one gap: a request that
// missed Redis and read the old setting from Mongo just before could copy it
// into Redis just after (rememberSession), and with writes just turned off, the
// guard would read "on" for up to the cache's lifetime. forgetUserSessions()
// closes it, as for every other write to a user's sessions: it drops the
// user's cached sessions and leaves the tombstone that refuses such a late
// copy (authSessionStore.ts). The user's other sessions just read Mongo once.
import 'server-only'
import { auth } from '@src/lib/auth'
import { forgetUserSessions } from '@src/lib/authSessionStore'

/**
 * Turns writes on or off for the view-as session with this token, the
 * user's. Resolves false when the session is gone (stopped or expired).
 *
 * The cached copies are dropped even when the update fails: better-auth
 * rewrites the Redis entry before it writes Mongo, so a failed Mongo write
 * would otherwise leave Redis saying what Mongo, and the bar, don't.
 */
export async function setViewAsWrites(token: string, userId: string, enabled: boolean): Promise<boolean> {
  const { internalAdapter } = await auth.$context
  try {
    return Boolean(await internalAdapter.updateSession(token, { viewAsWrites: enabled }))
  } finally {
    await forgetUserSessions(userId)
  }
}
