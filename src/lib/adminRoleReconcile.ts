import { userQueries } from '@src/lib/userQueries'
import { createLogger } from '@src/lib/logger'
import { adminEmailsFromEnv } from '@src/lib/adminRoleSync'
import { runStartupTaskOnce, type Schedule } from '@src/lib/startupTask'

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

/** Once per process, retried until it succeeds (startupTask.ts). Never throws. */
export function reconcileAdminRolesOnce(run: () => Promise<unknown> = reconcileAdminRoles, schedule?: Schedule): void {
  runStartupTaskOnce(
    STARTED,
    run,
    (error, retryInMs) =>
      log.error({ error: (error as Error)?.message, retryInMs }, 'Reconciling admin roles with ADMIN_USER_EMAILS failed'),
    schedule
  )
}
