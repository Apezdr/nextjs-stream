/**
 * The record of the last complete sync pass, in `app_config.syncInfo` (the
 * document `lastSyncTime` lives beside). Kept apart from sync/database so the
 * admin delete actions can forget it without loading the sync's helpers.
 */

import clientPromise from '@src/lib/mongodb'

/**
 * `app_config.syncInfo` document a sync tick reads to decide whether it can be
 * skipped (sync/tickSkip.js). It is in one of two states:
 *
 *   - `state: 'running'` with a `syncRunId`: that pass started and has not
 *     recorded itself complete — it is still writing, or it did not complete;
 *   - `state: 'complete'`: what the last complete pass applied — each server's
 *     TV and movie payload ETags, the gate version, server set and process it
 *     ran under, its syncRunId and how many documents carried that id.
 *
 * Only a complete record lets a tick skip. No document means nothing is on
 * record either: the next tick fetches in full.
 */
const APPLIED_PAYLOADS_ID = 'appliedPayloads'

const syncInfo = (client) => client.db('app_config').collection('syncInfo')

/**
 * @param {Object} client - MongoDB client
 * @returns {Promise<Object|null>} The stored record, or null when there is none
 */
export async function getAppliedPayloads(client) {
  return syncInfo(client).findOne({ _id: APPLIED_PAYLOADS_ID })
}

/**
 * Replace whatever is recorded with the running marker of a pass that is
 * starting. Throws on failure: the caller decides.
 * @param {Object} client - MongoDB client
 * @param {string} syncRunId
 */
export async function markPassRunning(client, syncRunId) {
  await syncInfo(client).replaceOne(
    { _id: APPLIED_PAYLOADS_ID },
    { _id: APPLIED_PAYLOADS_ID, state: 'running', syncRunId, startedAt: new Date() },
    { upsert: true }
  )
}

/**
 * Record what a complete pass applied — only in place of that same pass's
 * running marker (compare-and-set, no upsert). The marker is gone when a Flat*
 * document was deleted outside the sync while the pass ran
 * (forgetAppliedPayloads): the pass may have counted the database after the
 * delete, and must not be trusted. Throws on failure: the caller decides.
 *
 * @param {Object} client - MongoDB client
 * @param {string} syncRunId - The pass that is recording itself
 * @param {Object} record - { servers, gateVersion, serversFingerprint, bootId, documentCounts }
 * @returns {Promise<boolean>} Whether the record was written
 */
export async function setAppliedPayloads(client, syncRunId, record) {
  const result = await syncInfo(client).replaceOne(
    { _id: APPLIED_PAYLOADS_ID, state: 'running', syncRunId },
    { _id: APPLIED_PAYLOADS_ID, ...record, state: 'complete', syncRunId, recordedAt: new Date() }
  )
  return result?.matchedCount === 1
}

/**
 * Forget the last complete pass, and the marker of a pass that is running, so
 * no tick is skipped until a pass that starts after this completes. Every
 * Flat* delete outside the sync calls it AFTER deleting: a skipped tick never
 * puts a document back, and a pass that recorded itself before the delete
 * counted a document that is gone. Never throws.
 *
 * @param {Object} [client] - MongoDB client (default: the shared one)
 */
export async function forgetAppliedPayloads(client) {
  try {
    await syncInfo(client ?? (await clientPromise)).deleteOne({ _id: APPLIED_PAYLOADS_ID })
  } catch (error) {
    console.error(`[SYNC] Could not forget the last complete pass: ${error.message}`)
  }
}
