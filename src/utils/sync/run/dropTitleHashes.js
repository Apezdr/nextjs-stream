/**
 * Removes the file server's title hashes (`syncHash`, `contentHash`) from
 * every Flat* document, once per database.
 *
 * The sync stamped them on documents (shows took both from the
 * /api/metadata-hashes/tv list; movies, and earlier episodes and seasons,
 * took `syncHash`) long after anything stopped reading them: the skip decision
 * reads `syncGates` (core/syncGate). Nothing writes them any more, so the
 * values left are stale, and this clears them.
 *
 * What it leaves alone, and why:
 *
 *  - `syncGates`. A server's gate says the document is what that server's
 *    last complete pass left. A pass neither reads these two fields nor
 *    writes them now, and changesDocument has always ignored them
 *    (GATE_BOOKKEEPING_FIELDS), so removing them makes no gate untrue: the
 *    next pass would write exactly what it would have written before. An
 *    out-of-band write normally reopens the gates so that pass re-syncs the
 *    title; reopening them here would buy a full reprocess of the library
 *    (every metadata fetch, every title) and change nothing, and it would
 *    also hold every sync tick open (run/tickSkip counts open gates) until
 *    that reprocess finished.
 *  - `syncRunId` and `updatedAt`. Post-sync cleanup decides deletes on them
 *    (run/orphanFilter); a migration that moved either could protect an
 *    orphan from deletion or expose a live document to it. The tick skip also
 *    counts documents by `syncRunId`.
 *
 * Bounded: the documents that still carry either field are read by `_id` in
 * batches of BATCH_SIZE, and each batch is one updateMany. Safe to repeat: a
 * document that no longer has either field is not matched. Runs once per
 * database (migrations/runOnce), from the run's own jobs after post-sync
 * cleanup (run/postSync runAfterSyncJobs), holding the orchestration lock.
 */

import { runMigrationOnce } from '@src/utils/migrations/runOnce'

/** The migration's flag in app_config.migrations. */
export const DROP_TITLE_HASHES_MIGRATION = 'flat-drop-syncHash-contentHash'

const BATCH_SIZE = 500
const COLLECTIONS = ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']

/**
 * Remove both fields from every document of the four collections that has
 * either. Idempotent.
 *
 * @param {import('mongodb').Db} db - The media database
 * @returns {Promise<Object<string, number>>} Documents changed, per collection
 */
export async function dropTitleHashes(db) {
  const changed = {}
  for (const name of COLLECTIONS) {
    const collection = db.collection(name)
    let ids = []
    let count = 0
    const flush = async () => {
      if (ids.length === 0) return
      const result = await collection.updateMany({ _id: { $in: ids } }, { $unset: { syncHash: '', contentHash: '' } })
      count += result?.modifiedCount ?? 0
      ids = []
    }
    const cursor = collection
      .find({ $or: [{ syncHash: { $exists: true } }, { contentHash: { $exists: true } }] }, { projection: { _id: 1 } })
      .batchSize(BATCH_SIZE)
    for await (const doc of cursor) {
      ids.push(doc._id)
      if (ids.length >= BATCH_SIZE) await flush()
    }
    await flush()
    changed[name] = count
  }
  return changed
}

/**
 * dropTitleHashes, once per database. Throws when it fails (no flag is
 * written, so the next run tries again).
 *
 * @param {import('mongodb').MongoClient} client
 * @returns {Promise<{applied: boolean, result?: Object}>}
 */
export function dropTitleHashesOnce(client) {
  return runMigrationOnce(client, DROP_TITLE_HASHES_MIGRATION, () => dropTitleHashes(client.db('Media')))
}
