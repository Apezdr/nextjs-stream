// src/lib/roles/limitedAccessMigration.ts
// The old `limitedAccess` user flag, moved onto a role as the server starts
// (instrumentation.ts). Held in check by library scopes now (libraryScope.ts):
// each flagged user is given a "Preview" role carrying an empty scope, so they
// see no title until an admin picks some on it, and the flag is removed from
// every user. Idempotent: a second run finds no flag and changes nothing. It
// can't get stuck either: the role is found by its fixed id or marker, made
// under the first free name, and a user's roles are repaired as they're set.
//
// No server-only import, and none of store.ts (which has one): this runs from
// instrumentation, outside any React render.
import { ObjectId } from 'mongodb'
import clientPromise from '@src/lib/mongodb'
import { userQueries } from '@src/lib/userQueries'
import { createLogger } from '@src/lib/logger'
import { runStartupTaskOnce, type Schedule } from '@src/lib/startupTask'
import { EMPTY_SCOPE } from './libraryScope'

const log = createLogger('Auth.LimitedAccessMigration')

/**
 * The role this migration makes, under one fixed id and a marker, so every run
 * (and two processes racing) lands on the same role, and an admin renaming it
 * doesn't make the next run make another.
 */
export const PREVIEW_ROLE_ID = new ObjectId('5c0fe55c0fe55c0fe55c0fe5')
const MIGRATED_FROM = 'limitedAccess'
const ROLE_DESCRIPTION = 'Sees only the titles picked here. Given to every account that had limited access.'

/** Names to try in order, an admin having perhaps used the first ones; then one holding the role's own id. */
const NAMES_TO_TRY = 50
function nameAt(attempt: number): string {
  if (attempt === 0) return 'Preview'
  if (attempt === 1) return 'Preview (limited access)'
  if (attempt < NAMES_TO_TRY) return `Preview (limited access) ${attempt}`
  return `Preview (limited access) ${PREVIEW_ROLE_ID.toHexString()}`
}

const rolesCollection = async () => (await clientPromise).db('Media').collection('Roles')
const isDuplicate = (error: unknown) => (error as { code?: number })?.code === 11000

/** The migration's role, made the first time it's needed under the first free name. */
async function previewRoleId(): Promise<{ id: string; created: boolean }> {
  const roles = await rolesCollection()
  const find = () =>
    roles.findOne({ $or: [{ _id: PREVIEW_ROLE_ID }, { migratedFrom: MIGRATED_FROM }] }, { projection: { _id: 1 } })
  const existing = await find()
  if (existing) return { id: existing._id.toString(), created: false }

  for (let attempt = 0; attempt <= NAMES_TO_TRY; attempt++) {
    const name = nameAt(attempt)
    const taken = await roles.findOne({ name }, { collation: { locale: 'en', strength: 2 }, projection: { _id: 1 } })
    if (taken) continue
    const now = new Date()
    try {
      await roles.insertOne({
        _id: PREVIEW_ROLE_ID,
        name,
        description: ROLE_DESCRIPTION,
        grants: {},
        scope: { ...EMPTY_SCOPE, titles: [] },
        migratedFrom: MIGRATED_FROM,
        createdAt: now,
        updatedAt: now,
      })
      return { id: PREVIEW_ROLE_ID.toHexString(), created: true }
    } catch (error) {
      if (!isDuplicate(error)) throw error
      // Another process made the role first, or took this name meanwhile
      const made = await find()
      if (made) return { id: made._id.toString(), created: false }
    }
  }
  // Every name, the last one holding the role's own id, was taken: only the
  // role itself can hold that one, so it is there
  const made = await find()
  if (made) return { id: made._id.toString(), created: false }
  throw new Error('The Preview role could neither be found nor made.')
}

/**
 * A user's roles as an array of role ids, whatever was stored: an array keeps
 * its string ids, a lone string becomes one, anything else (missing, null, an
 * object) none; then the Preview role joins them. As an update pipeline
 * expression, so each user takes one write.
 */
export const rolesWithPreview = (roleId: string) => ({
  $setUnion: [
    {
      $filter: {
        input: {
          $cond: [
            { $isArray: '$roles' },
            '$roles',
            { $cond: [{ $eq: [{ $type: '$roles' }, 'string'] }, ['$roles'], []] },
          ],
        },
        cond: { $eq: [{ $type: '$$this' }, 'string'] },
      },
    },
    [roleId],
  ],
})

/**
 * @removeAtVersion 2026.10.0 limitedAccess-to-Preview-role migration for user databases from before library scopes; delete this file, its call in instrumentation.ts and its tests.
 */
export async function migrateLimitedAccess() {
  const users = userQueries.collection()
  let moved = 0
  let roleCreated = false
  const flagged = (await users.countDocuments({ limitedAccess: true }, { limit: 1 })) > 0
  if (!flagged) {
    // A user handed the role by id (scripts/migrate-to-better-auth.js) needs it to exist
    const holder = (await users.countDocuments({ roles: PREVIEW_ROLE_ID.toHexString() }, { limit: 1 })) > 0
    if (holder) roleCreated = (await previewRoleId()).created
  }
  if (flagged) {
    const role = await previewRoleId()
    roleCreated = role.created
    // One write per user: the role is added and the flag removed together
    const result = await userQueries.updateMany({ limitedAccess: true }, [
      { $set: { roles: rolesWithPreview(role.id) } },
      { $unset: 'limitedAccess' },
    ])
    moved = result.modifiedCount
  }
  // Everyone else's flag (false, or anything not true) goes too
  const cleared = (await userQueries.updateMany({ limitedAccess: { $exists: true } }, { $unset: { limitedAccess: '' } }))
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
