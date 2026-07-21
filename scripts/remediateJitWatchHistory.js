/**
 * One-off remediation: re-key WatchHistory rows whose videoId is a
 * JIT-transcoder stream URL (/stream/<base64>/master.m3u8 or manifest.mpd)
 * onto the canonical transport-invariant normalizedVideoId.
 *
 * Context: before videoIdentity.js gained canonicalizeStreamPathname, rows
 * written during JIT playback were keyed on hash(/stream/... pathname) while
 * FlatMovies/FlatEpisodes carried hash(source pathname), so post-sync
 * validation flipped them isValid:false and they dropped out of
 * continue-watching, resume, view counts, etc.
 *
 * Behavior:
 *  - DRY RUN by default — prints every decision, writes nothing.
 *  - `--apply` to execute.
 *  - Only rows whose videoId matches the JIT URL shape are candidates; the
 *    shared production hash implementation (src/utils/videoIdentity.js) is
 *    the sole decision authority — this script contains no hash logic.
 *  - Unique index {userId, normalizedVideoId}: when the canonical key is
 *    already taken by another row for the same user, the row with the latest
 *    lastUpdated wins (missing lastUpdated = epoch 0; tie keeps the
 *    already-canonical row) and the loser is deleted. Delete-first ordering
 *    keeps a crash mid-merge safe: only the policy-deleted loser is gone and
 *    the JIT row stays selectable for a clean re-run.
 *  - Never touches isValid (sync validation is the single authority),
 *    videoId, or playbackTime.
 *
 * Usage:
 *   node scripts/remediateJitWatchHistory.js            # dry run
 *   node scripts/remediateJitWatchHistory.js --apply    # execute
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

// Matches the videoId shape the canonicalizer acts on. Deliberately broad
// (any host) — generateNormalizedVideoId is the actual decision authority:
// rows whose id it does not change are reported as `unchanged`.
const JIT_VIDEO_ID_REGEX = '\\/stream\\/[A-Za-z0-9+/_-]+={0,2}\\/(master\\.m3u8|manifest\\.mpd)$'

function logAction(action, details) {
  console.log(JSON.stringify({ action: APPLY ? action : `would-${action}`, ...details }))
}

/** Latest lastUpdated wins; missing = epoch 0; tie keeps the already-canonical row. */
function jitRowWins(jitRow, canonicalRow) {
  const jitTime = jitRow.lastUpdated ? new Date(jitRow.lastUpdated).getTime() : 0
  const canonicalTime = canonicalRow.lastUpdated ? new Date(canonicalRow.lastUpdated).getTime() : 0
  return jitTime > canonicalTime
}

async function mergeOrRekey(collection, row, newNid, counts) {
  const existing = await collection.findOne({ userId: row.userId, normalizedVideoId: newNid })

  if (!existing) {
    logAction('rekey', {
      _id: row._id.toString(),
      userId: row.userId?.toString?.() ?? String(row.userId),
      oldNid: row.normalizedVideoId,
      newNid,
    })
    if (APPLY) {
      await collection.updateOne({ _id: row._id }, { $set: { normalizedVideoId: newNid } })
    }
    counts.rekeyed++
    return
  }

  const keepJit = jitRowWins(row, existing)
  logAction(keepJit ? 'merge-keep-jit' : 'merge-keep-existing', {
    _id: row._id.toString(),
    userId: row.userId?.toString?.() ?? String(row.userId),
    oldNid: row.normalizedVideoId,
    newNid,
    loserId: (keepJit ? existing._id : row._id).toString(),
    jitLastUpdated: row.lastUpdated ?? null,
    existingLastUpdated: existing.lastUpdated ?? null,
  })
  if (APPLY) {
    if (keepJit) {
      // Delete first (unique index), then re-key the surviving JIT row.
      await collection.deleteOne({ _id: existing._id })
      await collection.updateOne({ _id: row._id }, { $set: { normalizedVideoId: newNid } })
    } else {
      await collection.deleteOne({ _id: row._id })
    }
  }
  counts.merged++
}

async function main() {
  console.log(
    APPLY
      ? '⚠️  APPLY MODE — writes enabled\n'
      : '🔍 DRY RUN — no writes (pass --apply to execute)\n'
  )

  const client = new MongoClient(MONGODB_URI)
  const counts = { scanned: 0, unchanged: 0, rekeyed: 0, merged: 0, errors: 0 }

  try {
    await client.connect()
    const collection = client.db(MEDIA_DB_NAME).collection('WatchHistory')

    const cursor = collection.find(
      { videoId: { $regex: JIT_VIDEO_ID_REGEX } },
      { projection: { userId: 1, videoId: 1, normalizedVideoId: 1, lastUpdated: 1 } }
    )

    for await (const row of cursor) {
      counts.scanned++
      try {
        const newNid = generateNormalizedVideoId(row.videoId)

        if (!newNid || newNid.startsWith('fallback_')) {
          logAction('error', {
            _id: row._id.toString(),
            reason: 'hash produced empty/fallback id',
            videoId: row.videoId,
          })
          counts.errors++
          continue
        }

        if (newNid === row.normalizedVideoId) {
          counts.unchanged++
          continue
        }

        try {
          await mergeOrRekey(collection, row, newNid, counts)
        } catch (err) {
          if (err && err.code === 11000) {
            // Race with a live playback heartbeat upserting the canonical
            // key between findOne and updateOne — re-apply the policy once.
            await mergeOrRekey(collection, row, newNid, counts)
          } else {
            throw err
          }
        }
      } catch (err) {
        logAction('error', { _id: row._id.toString(), reason: err.message })
        counts.errors++
      }
    }

    console.log('\nSummary:', JSON.stringify(counts))
    if (!APPLY && (counts.rekeyed || counts.merged)) {
      console.log('\nRe-run with --apply to execute the actions above.')
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
