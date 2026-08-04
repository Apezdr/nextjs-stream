/**
 * P5 identity-cutover backfill: stamp `mediaId` (durable content identity)
 * onto existing WatchHistory rows, rehome quality-swap orphans, merge
 * duplicates, and — as an explicit final step — create the partial unique
 * index that locks the invariant in.
 *
 * ORDERED STEPS (each gated on the previous):
 *  1. map        — join rows to catalog docs by normalizedVideoId and $set
 *                  mediaId (the common case).
 *  2. rehome     — rows whose nid matches NO catalog doc (quality-swap
 *                  orphans: the file was replaced, the old hash points at
 *                  nothing) are mapped by their videoId's folder →
 *                  FlatMovies.originalTitle → that movie's mediaId. TV
 *                  orphans are logged and skipped (episode identity needs
 *                  the show+coordinate; folder alone is ambiguous).
 *  3. merge      — per (userId, mediaId) duplicate groups (e.g. an orphaned
 *                  old-file row + the current file's row now sharing one
 *                  identity): latest lastUpdated wins, losers deleted.
 *                  Never touches isValid — sync validation is the sole
 *                  authority and will judge the survivor by its mediaId arm.
 *  4. --create-index — verify zero duplicate (userId, mediaId) groups, then
 *                  create { userId: 1, mediaId: 1 } UNIQUE with
 *                  partialFilterExpression { mediaId: { $exists: true } }.
 *                  Partial is mandatory: rows without mediaId all "share"
 *                  a missing key, and a plain unique index would collide
 *                  them. Retries the merge+create loop on a race with live
 *                  heartbeats (max 3 attempts).
 *
 * DRY-RUN BY DEFAULT. `--apply` executes steps 1-3; `--create-index`
 * additionally runs step 4 (implies --apply must have converged — it
 * re-verifies rather than trusting).
 *
 * Usage:
 *   node scripts/backfillWatchHistoryMediaId.js                  # dry run
 *   node scripts/backfillWatchHistoryMediaId.js --apply          # steps 1-3
 *   node scripts/backfillWatchHistoryMediaId.js --apply --create-index
 */

const { MongoClient } = require('mongodb')
const path = require('path')

try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') })
} catch {
  // dotenv may not be installed; ensure env vars are set manually
}

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('ERROR: MONGODB_URI environment variable is required.')
  process.exit(1)
}

const MEDIA_DB_NAME = process.env.MONGODB_DB || 'Media'
const APPLY = process.argv.includes('--apply')
const CREATE_INDEX = process.argv.includes('--create-index')

function logAction(action, details) {
  console.log(JSON.stringify({ action: APPLY ? action : `would-${action}`, ...details }))
}

/** Extract the /movies/<folder>/ segment from a videoId (direct or JIT-canonical form). */
function movieFolderFromVideoId(videoId) {
  try {
    // JIT manifest URLs canonicalize via the shared impl; for folder
    // extraction the DIRECT pathname is enough — JIT rows were already
    // re-keyed to canonical nids by the earlier remediation, so an orphan's
    // videoId here is overwhelmingly a direct URL to a replaced file.
    const pathname = new URL(videoId).pathname
    const match = /^\/movies\/([^/]+)\//.exec(pathname)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

async function mergeDuplicates(collection, counts) {
  // DURABLE ids only. Legacy rows carry the client-sent hex _id in the same
  // field — and for TV that is the SHOW _id, shared by every episode row of
  // the show. Grouping on those would "merge" (delete!) a user's entire
  // per-episode history down to one row per show. The dry run of the first
  // version of this script proposed exactly that (2905 deletions); this
  // filter is what stands between the merge policy and that outcome.
  const dupGroups = await collection
    .aggregate([
      { $match: { mediaId: /^mid:/ } },
      { $group: { _id: { userId: '$userId', mediaId: '$mediaId' }, rows: { $push: { id: '$_id', lastUpdated: '$lastUpdated', playbackTime: '$playbackTime' } }, c: { $sum: 1 } } },
      { $match: { c: { $gt: 1 } } },
    ])
    .toArray()

  for (const group of dupGroups) {
    const sorted = [...group.rows].sort(
      (a, b) => new Date(b.lastUpdated || 0) - new Date(a.lastUpdated || 0)
    )
    const winner = sorted[0]
    const losers = sorted.slice(1)
    for (const loser of losers) {
      logAction('merge-delete', {
        _id: String(loser.id),
        userId: String(group._id.userId),
        mediaId: group._id.mediaId,
        loserLastUpdated: loser.lastUpdated ?? null,
        winnerId: String(winner.id),
        winnerLastUpdated: winner.lastUpdated ?? null,
      })
      if (APPLY) await collection.deleteOne({ _id: loser.id })
      counts.merged++
    }
  }
  return dupGroups.length
}

async function main() {
  console.log(
    APPLY
      ? `⚠️  APPLY MODE — writes enabled${CREATE_INDEX ? ' (+ index creation)' : ''}\n`
      : '🔍 DRY RUN — no writes (pass --apply to execute)\n'
  )

  const client = new MongoClient(MONGODB_URI)
  const counts = { scanned: 0, mapped: 0, rehomed: 0, orphanTv: 0, orphanUnknown: 0, merged: 0, errors: 0 }

  try {
    await client.connect()
    const db = client.db(MEDIA_DB_NAME)
    const wh = db.collection('WatchHistory')

    // Step 1+2 prep: catalog lookup maps
    const nidToMediaId = new Map()
    const folderToMediaId = new Map()
    const proj = { projection: { normalizedVideoId: 1, mediaId: 1, originalTitle: 1 } }
    for await (const d of db.collection('FlatMovies').find({ mediaId: { $exists: true } }, proj)) {
      if (d.normalizedVideoId) nidToMediaId.set(d.normalizedVideoId, d.mediaId)
      if (d.originalTitle) folderToMediaId.set(d.originalTitle, d.mediaId)
    }
    for await (const d of db.collection('FlatEpisodes').find({ mediaId: { $exists: true } }, { projection: { normalizedVideoId: 1, mediaId: 1 } })) {
      if (d.normalizedVideoId) nidToMediaId.set(d.normalizedVideoId, d.mediaId)
    }
    console.log(`catalog: ${nidToMediaId.size} nid mappings, ${folderToMediaId.size} movie folders\n`)

    // Steps 1+2: stamp rows lacking a DURABLE id. `$not: /^mid:/` covers
    // both a missing field and the legacy client-sent hex _id living in the
    // same field (which gets overwritten with the durable identity).
    const cursor = wh.find(
      { mediaId: { $not: /^mid:/ } },
      { projection: { userId: 1, videoId: 1, normalizedVideoId: 1, lastUpdated: 1, mediaType: 1 } }
    )
    for await (const row of cursor) {
      counts.scanned++
      try {
        let mediaId = nidToMediaId.get(row.normalizedVideoId) ?? null
        let action = 'map'

        if (!mediaId && row.videoId) {
          // Orphan: nid matches nothing — the file was replaced. Movies
          // rehome by folder; TV is ambiguous → log + skip.
          const folder = movieFolderFromVideoId(row.videoId)
          if (folder && folderToMediaId.has(folder)) {
            mediaId = folderToMediaId.get(folder)
            action = 'rehome'
          } else if (/\/tv\//.test(row.videoId)) {
            logAction('orphan-tv-skip', { _id: String(row._id), videoId: row.videoId })
            counts.orphanTv++
            continue
          } else {
            logAction('orphan-unmapped', { _id: String(row._id), videoId: row.videoId })
            counts.orphanUnknown++
            continue
          }
        }
        if (!mediaId) {
          counts.orphanUnknown++
          continue
        }

        logAction(action, {
          _id: String(row._id),
          userId: String(row.userId),
          nid: row.normalizedVideoId,
          mediaId,
        })
        if (APPLY) await wh.updateOne({ _id: row._id }, { $set: { mediaId } })
        counts[action === 'map' ? 'mapped' : 'rehomed']++
      } catch (err) {
        logAction('error', { _id: String(row._id), reason: err.message })
        counts.errors++
      }
    }

    // Step 3: merge duplicates per (userId, mediaId)
    await mergeDuplicates(wh, counts)

    console.log('\nSummary:', JSON.stringify(counts))

    // Step 4: the invariant lock
    if (CREATE_INDEX && APPLY) {
      for (let attempt = 1; attempt <= 3; attempt++) {
        const remaining = await mergeDuplicates(wh, counts)
        if (remaining > 0 && attempt > 1) {
          console.log(`race: ${remaining} new duplicate group(s) merged on attempt ${attempt}`)
        }
        try {
          await wh.createIndex(
            { userId: 1, mediaId: 1 },
            {
              unique: true,
              // Durable 'mid:'-prefixed ids ONLY. Partial filters don't
              // support regex; the string range [ 'mid:', 'mid;' ) covers
              // exactly the prefix. A bare $exists would also index legacy
              // hex values — where TV rows share the show _id and would
              // collide instantly.
              partialFilterExpression: { mediaId: { $gt: 'mid:', $lt: 'mid;' } },
              name: 'userId_mediaId_unique',
            }
          )
          console.log('✅ userId_mediaId_unique created')
          break
        } catch (err) {
          if (err?.code === 11000 && attempt < 3) {
            console.log('index build raced a live heartbeat duplicate — re-merging and retrying')
            continue
          }
          throw err
        }
      }
    } else if (CREATE_INDEX) {
      console.log('\n--create-index requires --apply; skipped.')
    }

    if (counts.errors > 0) process.exitCode = 1
  } finally {
    await client.close()
  }
}

main().catch((err) => {
  console.error('FATAL:', err)
  process.exit(1)
})
