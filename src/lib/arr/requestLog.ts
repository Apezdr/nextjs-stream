// src/lib/arr/requestLog.ts
// Who did what with Radarr and Sonarr: every add, search and grab, admins'
// included. It's the audit trail, and it says which titles a user requested,
// which is what a request grant lets them search and pick for afterwards.
import 'server-only'
import clientPromise from '@src/lib/mongodb'
import { createLogger } from '@src/lib/logger'
import type { ArrService, TitleRef } from './types'

const log = createLogger('ArrRequestLog')

export type ArrActivityKind = 'add' | 'search' | 'grab'

const logCollection = async () => (await clientPromise).db('Media').collection('ArrRequests')

let indexesEnsured = false
async function ensureIndexes(collection: Awaited<ReturnType<typeof logCollection>>) {
  if (indexesEnsured) return
  await Promise.all([
    collection.createIndex({ userId: 1, mediaType: 1, tmdbId: 1, kind: 1 }, { name: 'requested_by' }),
    collection.createIndex({ at: -1 }, { name: 'newest_first' }),
  ])
  indexesEnsured = true
}

export interface ArrActivity {
  kind: ArrActivityKind
  actor: { userId: string; userName: string }
  ref: TitleRef
  service: ArrService
  /** What was chosen: profile, scope, mode, release title. */
  detail?: Record<string, unknown>
}

/** Records one action. Never fails it: by now the action has happened. */
export async function logArrActivity({ kind, actor, ref, service, detail = {} }: ArrActivity): Promise<void> {
  try {
    const collection = await logCollection()
    await ensureIndexes(collection)
    await collection.insertOne({
      kind,
      userId: actor.userId,
      userName: actor.userName,
      service,
      mediaType: ref.mediaType,
      tmdbId: ref.tmdbId,
      at: new Date(),
      detail,
    })
  } catch (error) {
    log.error({ err: error, kind, service, tmdbId: ref.tmdbId }, 'Could not log Radarr/Sonarr activity')
  }
}

/** Whether this user added the title to Radarr or Sonarr themselves. */
export async function requestedBy(userId: string, ref: TitleRef): Promise<boolean> {
  const collection = await logCollection()
  const entry = await collection.findOne(
    { userId, mediaType: ref.mediaType, tmdbId: ref.tmdbId, kind: 'add' },
    { projection: { _id: 1 } }
  )
  return entry !== null
}
