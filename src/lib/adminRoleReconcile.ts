import { userQueries } from '@src/lib/userQueries'
import { createLogger } from '@src/lib/logger'
import { adminEmailsFromEnv } from '@src/lib/adminRoleSync'

/**
 * Every user's role brought in line with ADMIN_USER_EMAILS, by the rules in
 * adminRoleSync.ts, as the server starts (instrumentation.ts). The sign-in
 * sync alone left an address taken off the list an admin for as long as its
 * session kept rolling. Idempotent: a second run changes nothing. Changing the
 * list needs a restart anyway, since it is read at startup.
 */

const log = createLogger('Auth.AdminRoles')

export async function reconcileAdminRoles(adminEmails: Set<string> = adminEmailsFromEnv()) {
  if (adminEmails.size === 0) {
    log.warn('ADMIN_USER_EMAILS is empty: no admin roles reconciled, and nobody demoted')
    return { promoted: 0, demoted: 0 }
  }
  const listed = [...adminEmails]
  // better-auth stores emails lowercased, so an entry with capitals matches no
  // account it created (only a NextAuth-migrated one kept its original case)
  const withCapitals = listed.filter((email) => email !== email.toLowerCase()).length
  if (withCapitals > 0) {
    log.warn({ entries: withCapitals }, 'ADMIN_USER_EMAILS has entries with capitals, which better-auth accounts never match')
  }
  const users = userQueries.collection()

  // A listed address the provider verified (better-auth's boolean, or a
  // migrated account's Date); $nin [null, false] also skips a missing field
  const promoted = await users.updateMany(
    {
      email: { $in: listed },
      emailVerified: { $nin: [null, false] },
      $or: [{ role: { $ne: 'admin' } }, { approved: { $ne: true } }],
    },
    { $set: { role: 'admin', approved: true } }
  )
  const demoted = await users.updateMany({ role: 'admin', email: { $nin: listed } }, { $set: { role: 'user' } })

  const result = { promoted: promoted.modifiedCount, demoted: demoted.modifiedCount }
  if (result.promoted || result.demoted) log.info(result, 'Admin roles reconciled with ADMIN_USER_EMAILS')
  return result
}

const STARTED = Symbol.for('nextjs_stream.adminRoleReconcileStarted')
const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 5 * 60_000

/**
 * Once per process (register() can run again in development), retried with
 * backoff until a run succeeds: Mongo can still be starting when the server
 * does. Never throws.
 */
export function reconcileAdminRolesOnce(
  run: () => Promise<unknown> = reconcileAdminRoles,
  schedule: (retry: () => void, ms: number) => void = (retry, ms) => {
    // Never what keeps the process alive
    setTimeout(retry, ms).unref?.()
  }
): void {
  const store = globalThis as typeof globalThis & { [STARTED]?: boolean }
  if (store[STARTED]) return
  store[STARTED] = true

  const attempt = (delayMs: number) => {
    run().catch((error) => {
      log.error({ error: error?.message, retryInMs: delayMs }, 'Reconciling admin roles with ADMIN_USER_EMAILS failed')
      schedule(() => attempt(Math.min(delayMs * 2, MAX_RETRY_MS)), delayMs)
    })
  }
  attempt(FIRST_RETRY_MS)
}
