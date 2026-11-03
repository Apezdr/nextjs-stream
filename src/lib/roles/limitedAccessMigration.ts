// src/lib/roles/limitedAccessMigration.ts
// The old `limitedAccess` user flag, moved onto a role as the server starts
// (instrumentation.ts). Held in check by library scopes now (libraryScope.ts):
// each flagged user is given a "Preview" role carrying an empty scope, so they
// see no title until an admin picks some on it, and the flag is removed from
// every user. Idempotent: a second run finds no flag and changes nothing.
//
// No server-only import, and none of store.ts (which has one): this runs from
// instrumentation, outside any React render.
import clientPromise from '@src/lib/mongodb'
import { userQueries } from '@src/lib/userQueries'
import { createLogger } from '@src/lib/logger'
import { runStartupTaskOnce, type Schedule } from '@src/lib/startupTask'
import { EMPTY_SCOPE } from './libraryScope'

const log = createLogger('Auth.LimitedAccessMigration')

/** Marks the role this migration made, so a rename by an admin doesn't make it make another. */
const MIGRATED_FROM = 'limitedAccess'
const ROLE_NAMES = ['Preview', 'Preview (limited access)']
const ROLE_DESCRIPTION = 'Sees only the titles picked here. Given to every account that had limited access.'

const rolesCollection = async () => (await clientPromise).db('Media').collection('Roles')

/** The migration's role, made the first time it's needed. A name an admin already took moves to the next. */
async function previewRoleId(): Promise<{ id: string; created: boolean }> {
  const roles = await rolesCollection()
  const existing = await roles.findOne({ migratedFrom: MIGRATED_FROM }, { projection: { _id: 1 } })
  if (existing) return { id: existing._id.toString(), created: false }

  for (const name of ROLE_NAMES) {
    const taken = await roles.findOne({ name }, { collation: { locale: 'en', strength: 2 }, projection: { _id: 1 } })
    if (taken) continue
    const now = new Date()
    const result = await roles.insertOne({
      name,
      description: ROLE_DESCRIPTION,
      grants: {},
      scope: { ...EMPTY_SCOPE, titles: [] },
      migratedFrom: MIGRATED_FROM,
      createdAt: now,
      updatedAt: now,
    })
    return { id: result.insertedId.toString(), created: true }
  }
  throw new Error(`Roles named ${ROLE_NAMES.join(' and ')} both exist; rename one so limited-access users can be moved.`)
}

/**
 * @removeAtVersion 2026.10.0 limitedAccess-to-Preview-role migration for user databases from before library scopes; delete this file, its call in instrumentation.ts and its tests.
 */
export async function migrateLimitedAccess() {
  const users = userQueries.collection()
  let moved = 0
  let roleCreated = false
  if ((await users.countDocuments({ limitedAccess: true }, { limit: 1 })) > 0) {
    const role = await previewRoleId()
    roleCreated = role.created
    // One write per user: the role is added and the flag removed together
    const result = await users.updateMany({ limitedAccess: true }, [
      { $set: { roles: { $setUnion: [{ $ifNull: ['$roles', []] }, [role.id]] } } },
      { $unset: 'limitedAccess' },
    ])
    moved = result.modifiedCount
  }
  // Everyone else's flag (false, or anything not true) goes too
  const cleared = (await users.updateMany({ limitedAccess: { $exists: true } }, { $unset: { limitedAccess: '' } }))
    .modifiedCount

  const result = { moved, cleared, roleCreated }
  if (moved || cleared || roleCreated) log.info(result, 'limitedAccess moved onto the Preview role')
  return result
}

const STARTED = Symbol.for('nextjs_stream.limitedAccessMigrationStarted')

/**
 * @removeAtVersion 2026.10.0 Startup runner of the limitedAccess migration; goes with migrateLimitedAccess.
 */
export function migrateLimitedAccessOnce(run: () => Promise<unknown> = migrateLimitedAccess, schedule?: Schedule): void {
  runStartupTaskOnce(
    STARTED,
    run,
    (error, retryInMs) =>
      log.error({ error: (error as Error)?.message, retryInMs }, 'Moving limitedAccess users onto the Preview role failed'),
    schedule
  )
}
