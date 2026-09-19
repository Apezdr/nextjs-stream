/**
 * One-off remediation: re-derive `normalizedVideoId` on Flat* documents whose
 * stored value no longer matches their own `videoURL`, and carry any watch
 * history that was stranded on the stale key forward with them.
 *
 * Context: MovieContentStrategy derived a movie's `normalizedVideoId` from the
 * URL the SYNCING SERVER reported, not from the URL the write actually leaves
 * in the document. On a title present on two file servers, the server that
 * loses the `videoURL` priority check still reached that step, so its pass
 * re-keyed the document to its own path shape — permanently, since sync order
 * is stable. `WatchHistory.normalizedVideoId` is a hash of the URL the client
 * was served, so the catalog and the history ended up on different keys and
 * every join for that title failed: no resume position, no Continue Watching.
 * Observed on three movies multi-homed across a plain server and one with
 * `prefixPath: '/media'`.
 *
 * The code fix (sync/core/videoIdentityWrite.ts) makes any sync pass repair
 * the document. This script exists to do it now, without waiting for a deploy
 * plus a full sync, and to handle the half sync cannot: watch-history rows
 * left on the stale key.
 *
 * Behavior:
 *  - DRY RUN by default — prints every decision, writes nothing.
 *  - `--apply` to execute.
 *  - The shared production hash (src/utils/videoIdentity.js) is the sole
 *    decision authority; this script contains no hash logic.
 *  - A document is a candidate only when it HAS a videoURL and its stored id
 *    disagrees with that URL. Documents without a videoURL are left alone.
 *  - Watch history: a row on the stale key moves to the corrected key. Under
 *    the unique {userId, normalizedVideoId} index, a row already sitting on
 *    the corrected key wins unless the stale row is newer (missing
 *    lastUpdated = epoch 0; ties keep the already-correct row) — the same
 *    policy as remediateJitWatchHistory.js. Delete-first ordering keeps a
 *    crash mid-merge safe.
 *  - Never touches isValid (sync validation is the single authority),
 *    playbackTime, or videoId. A moved row keeps the videoId it was written
 *    with: it is the historical record of what was actually played.
 *
 * Usage:
 *   node scripts/repairDriftedVideoIds.js            # dry run
 *   node scripts/repairDriftedVideoIds.js --apply    # execute
 */

const { MongoClient } = require('mongodb')
const path = require('path')

// Load .env.local
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
} catch {
  // dotenv may not be installed; ensure env vars are set manually
}

const { generateNormalizedVideoId } = require('../src/utils/videoIdentity')

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is required.')
  process.exit(1)
}

const MEDIA_DB_NAME = process.env.MONGODB_DB || 'Media'
const APPLY = process.argv.includes('--apply')

const COLLECTIONS = ['FlatMovies', 'FlatEpisodes']

function logAction(action, details) {
  console.log(JSON.stringify({ action: APPLY ? action : `would-${action}`, ...details }))
}

/** Latest lastUpdated wins; missing = epoch 0; tie keeps the already-correct row. */
function staleRowWins(staleRow, correctRow) {
  const staleTime = staleRow.lastUpdated ? new Date(staleRow.lastUpdated).getTime() : 0
  const correctTime = correctRow.lastUpdated ? new Date(correctRow.lastUpdated).getTime() : 0
  return staleTime > correctTime
}

async function moveHistoryRows(history, staleNid, correctNid, label, counts) {
  const rows = await history
    .find(
      { normalizedVideoId: staleNid },
      { projection: { userId: 1, normalizedVideoId: 1, lastUpdated: 1, playbackTime: 1 } }
    )
    .toArray()

  for (const row of rows) {
    const existing = await history.findOne({
      userId: row.userId,
      normalizedVideoId: correctNid,
    })

    if (!existing) {
      logAction('rekey-history', {
        title: label,
        _id: row._id.toString(),
        userId: row.userId?.toString?.() ?? String(row.userId),
        oldNid: staleNid,
        newNid: correctNid,
        playbackTime: row.playbackTime ?? null,
      })
      if (APPLY) {
        await history.updateOne({ _id: row._id }, { $set: { normalizedVideoId: correctNid } })
      }
      counts.rekeyed++
      continue
    }

    const keepStale = staleRowWins(row, existing)
    logAction(keepStale ? 'merge-keep-stale' : 'merge-keep-existing', {
      title: label,
      _id: row._id.toString(),
      userId: row.userId?.toString?.() ?? String(row.userId),
      oldNid: staleNid,
      newNid: correctNid,
      loserId: (keepStale ? existing._id : row._id).toString(),
      staleLastUpdated: row.lastUpdated ?? null,
      existingLastUpdated: existing.lastUpdated ?? null,
    })
    if (APPLY) {
      if (keepStale) {
        // Delete first (unique index), then move the surviving stale row.
        await history.deleteOne({ _id: existing._id })
        await history.updateOne({ _id: row._id }, { $set: { normalizedVideoId: correctNid } })
      } else {
        await history.deleteOne({ _id: row._id })
      }
    }
    counts.merged++
  }
}

async function main() {
  console.log(
    APPLY
      ? '⚠️  APPLY MODE — writes enabled\n'
      : '🔍 DRY RUN — no writes (pass --apply to execute)\n'
  )

  const client = new MongoClient(MONGODB_URI)
  const counts = { scanned: 0, drifted: 0, repaired: 0, rekeyed: 0, merged: 0, errors: 0 }

  try {
    await client.connect()
    const db = client.db(MEDIA_DB_NAME)
    const history = db.collection('WatchHistory')

    for (const name of COLLECTIONS) {
      const collection = db.collection(name)
      const cursor = collection.find(
        { videoURL: { $exists: true, $ne: null } },
        {
          projection: {
            videoURL: 1,
            normalizedVideoId: 1,
            title: 1,
            showTitle: 1,
            seasonNumber: 1,
            episodeNumber: 1,
          },
        }
      )

      for await (const doc of cursor) {
        counts.scanned++

        const correctNid = generateNormalizedVideoId(doc.videoURL)
        if (!correctNid || correctNid.startsWith('fallback_')) {
          logAction('error', {
            _id: doc._id.toString(),
            reason: 'hash produced empty/fallback id',
            videoURL: doc.videoURL,
          })
          counts.errors++
          continue
        }
        if (correctNid === doc.normalizedVideoId) continue

        counts.drifted++
        const label =
          doc.seasonNumber != null
            ? `${doc.showTitle || doc.title} S${doc.seasonNumber}E${doc.episodeNumber}`
            : doc.title

        logAction('repair-document', {
          collection: name,
          title: label,
          _id: doc._id.toString(),
          oldNid: doc.normalizedVideoId ?? null,
          newNid: correctNid,
          videoURL: doc.videoURL,
        })
        if (APPLY) {
          await collection.updateOne(
            { _id: doc._id },
            { $set: { normalizedVideoId: correctNid } }
          )
        }
        counts.repaired++

        // Only a real previous key can have history on it.
        if (doc.normalizedVideoId) {
          await moveHistoryRows(history, doc.normalizedVideoId, correctNid, label, counts)
        }
      }
    }

    console.log('\n' + JSON.stringify({ mode: APPLY ? 'apply' : 'dry-run', ...counts }, null, 2))
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
