// src/lib/roles/rules.ts
// Who a user is, as every access check reads it: the one definition of each.
// gates.ts turns them into answers for pages, Server Actions and API routes.
// No server-only import: client components read the same rules to decide what
// to show, and the server checks again.

/** The fields of a user (better-auth's, plus this app's) that access depends on. */
export interface AccessUser {
  role?: string | null
  approved?: boolean | null
  limitedAccess?: boolean | null
}

type MaybeUser = AccessUser | null | undefined

/**
 * An admin: better-auth's role. ADMIN_USER_EMAILS grants it to verified
 * addresses and takes it back (adminRoleSync.ts); nothing else does.
 */
export const isAdminUser = (user: MaybeUser): boolean => user?.role === 'admin'

/** Waiting for an admin's approval. Only an explicit false counts: a user without the field is approved. */
export const isAwaitingApproval = (user: MaybeUser): boolean => user?.approved === false

/** Held to limited access: no playback, and no titles in the credits lists. */
export const hasLimitedAccess = (user: MaybeUser): boolean => user?.limitedAccess === true
