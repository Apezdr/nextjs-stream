// src/lib/roles/rules.ts
// Who a user is, as every access check reads it: the one definition of each.
// gates.ts turns them into answers for pages, Server Actions and API routes.
// No server-only import: client components read the same rules to decide what
// to show, and the server checks again.

/** The fields of a user (better-auth's, plus this app's) that access depends on. */
export interface AccessUser {
  role?: string | null
  approved?: boolean | null
}

type MaybeUser = AccessUser | null | undefined

/**
 * An admin: better-auth's role. ADMIN_USER_EMAILS grants it to verified
 * addresses and takes it back (adminRoleSync.ts); nothing else does.
 */
export const isAdminUser = (user: MaybeUser): boolean => user?.role === 'admin'

/** Waiting for an admin's approval. Only an explicit false counts: a user without the field is approved. */
export const isAwaitingApproval = (user: MaybeUser): boolean => user?.approved === false

/** A session as better-auth returns it, as far as "View as" reads it. */
interface MaybeImpersonatedSession {
  session?: { impersonatedBy?: string | null; viewAsWrites?: boolean | null } | null
}

/**
 * An admin is viewing the app as this session's user ("View as"): better-auth's
 * admin plugin opened the session with impersonatedBy set to the admin's id.
 * Such a session only reads, unless the admin turns writes on; the proxy
 * refuses its writes (viewAsGuard.ts).
 */
export const isImpersonating = (session: MaybeImpersonatedSession | null | undefined): boolean =>
  Boolean(session?.session?.impersonatedBy)

/**
 * A view-as session whose admin turned writes on (the bar's switch): its
 * writes to the user's app data land on the user's account. Read from the
 * session itself, where only the switch's endpoint sets it (viewAsWrites.ts).
 */
export const isViewAsWritesOn = (session: MaybeImpersonatedSession | null | undefined): boolean =>
  isImpersonating(session) && session?.session?.viewAsWrites === true

/**
 * Whether the Users page offers "View as" for a user: anyone but the viewer
 * and admins, whom better-auth refuses to impersonate. A pending user is
 * offered, to see what a pending account sees.
 */
export const canViewAs = (viewerId: unknown, target: (AccessUser & { id?: unknown }) | null | undefined): boolean =>
  Boolean(target?.id) && String(target?.id) !== String(viewerId ?? '') && !isAdminUser(target)

// Which titles a user sees is their library scope, from their roles:
// libraryScope.ts and libraryAccess.ts.
