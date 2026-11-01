/**
 * ADMIN_USER_EMAILS decides who is an admin, both ways. A new account takes its
 * role from it as it is created (auth.ts databaseHooks), every social sign-in
 * syncs an existing one (auth.ts hooks.after), and each server start syncs
 * every user (adminRoleReconcile.ts), so an address taken off the list stops
 * being an admin even for someone who never signs in again (sessions roll for
 * 30 days):
 *
 * - a listed address the provider verified becomes an admin, and approved
 * - an admin whose address is not listed becomes a user
 * - a listed address the provider never verified changes nothing either way:
 *   a Discord account can carry an unverified copy of someone's address
 * - an empty list demotes nobody: that is a missing or misread setting, not
 *   "no admins"
 *
 * Addresses compare exactly (trimmed), as every other ADMIN_USER_EMAILS check
 * does (config.js adminUserEmails and the admin pages).
 */

/** The admin emails from ADMIN_USER_EMAILS (comma-separated), trimmed. */
export function adminEmailsFromEnv(raw: string | undefined = process.env.ADMIN_USER_EMAILS): Set<string> {
  return new Set(
    (raw || '')
      .split(',')
      .map((email) => email.trim())
      .filter(Boolean)
  )
}

export function isAdminEmail(email: string | null | undefined, adminEmails: Set<string>): boolean {
  return Boolean(email) && adminEmails.has(String(email))
}

/**
 * The better-auth endpoints that sign a user in through a social provider.
 * The hook context reports an endpoint's route pattern, not the request path,
 * so the OAuth callback is '/callback/:id' whatever the provider; the role
 * sync matched '/callback/social', which never occurs, and so never ran.
 * '/sign-in/social' signs in directly when the client sends an id token.
 */
export const SOCIAL_SIGN_IN_PATHS: ReadonlySet<string> = new Set(['/sign-in/social', '/callback/:id'])

type SignedInUser = {
  email?: string | null
  role?: string | null
  approved?: boolean | null
  // better-auth stores a boolean; accounts migrated from NextAuth hold a Date or null
  emailVerified?: boolean | Date | null
}

export type AdminRoleUpdate = { role?: 'admin' | 'user'; approved?: true }

/**
 * The fields to write so the user's role matches ADMIN_USER_EMAILS, or null
 * when it already does (or the rules above say to leave it).
 */
export function adminRoleUpdate(user: SignedInUser, adminEmails: Set<string>): AdminRoleUpdate | null {
  if (!isAdminEmail(user.email, adminEmails)) {
    if (adminEmails.size === 0 || user.role !== 'admin') return null
    return { role: 'user' }
  }
  if (!user.emailVerified) return null

  const update: AdminRoleUpdate = {}
  if (user.role !== 'admin') update.role = 'admin'
  if (user.approved !== true) update.approved = true
  return Object.keys(update).length > 0 ? update : null
}

/** The role a new account gets: admin only for a listed address its provider verified. */
export function roleForNewUser(user: SignedInUser, adminEmails: Set<string>): 'admin' | 'user' {
  return isAdminEmail(user.email, adminEmails) && user.emailVerified ? 'admin' : 'user'
}

/**
 * Whether to refuse creating an account for this sign-up: a listed address the
 * provider didn't verify. Created as a plain user, it would still hold the
 * address, and once the real owner signs in with a provider that verifies it,
 * better-auth links that account to this user and marks the user verified, so
 * the next sync makes it an admin, with the first provider's account still
 * signing in to it.
 */
export function refusesNewUser(user: SignedInUser, adminEmails: Set<string>): boolean {
  return isAdminEmail(user.email, adminEmails) && !user.emailVerified
}

/** The error code a refused sign-up reaches /auth/error with (better-auth joins the message with _). */
export const UNVERIFIED_ADMIN_EMAIL = 'unverified admin email'
