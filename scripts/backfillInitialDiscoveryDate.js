/**
 * Backfill `initialDiscoveryDate` — the library-add date "Recently Added"
 * ranks on — onto catalog documents that predate the field, and create the
 * indexes the rail's new sort needs.
 *
 * WHY. The rail used to rank on `mediaLastModified` (the video file's mtime),
 * which is not an add date: a quality upgrade bumps it on a title that has been
 * here for months, and a download that preserves its original mtime arrives
 * already years old. The sync now seeds `initialDiscoveryDate` once on every
 * new movie, show, season and episode (src/utils/sync/core/discovery.ts). This
 * script covers what the sync cannot: documents that already exist AND are
 * converged, which the hash early-skip never rebuilds.
 *
 * WHAT IT WRITES. For each of FlatMovies, FlatTVShows, FlatSeasons and
 * FlatEpisodes, on documents where the field is MISSING only:
 *
 *     initialDiscoveryDate   = createdAt   (the best record of arrival we hold)
 *     initialDiscoveryServer = 'backfill'  (a sentinel, not a server id)
 *
 * A document with no `createdAt` is REPORTED and left alone — guessing "now"
 * would put an old title at the top of the rail, which is the exact bug this
 * exists to fix. The sync heals such a document on its next rebuild.
 *
 * SAFE AGAINST POST-SYNC CLEANUP. The update is a pipeline `$set` of exactly
 * those two fields. It touches neither `syncRunId` nor `updatedAt`, which are
 * the only fields cleanup reads, so it cannot make a live document look like an
 * orphan — and it never moves a date that is already set, so it is safe to run
 * while a sync is in flight and safe to run twice.
 *
 * ORDER. Indexes first, then the fill: the rail's sort is index-backed from the
 * moment the new code serves traffic, and rows that are not yet filled simply
 * sort by mtime (yesterday's behaviour) until the fill reaches them.
 *
 * DRY-RUN BY DEFAULT.
 *
 * Usage:
 *   node scripts/backfillInitialDiscoveryDate.js            # report only
 *   node scripts/backfillInitialDiscoveryDate.js --apply    # indexes + fill
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

const COLLECTIONS = ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']

// Must match MovieRepository / EpisodeRepository createIndexes() and
// flatSync/initializeDatabase.js — same keys, same name.
const INDEXES = [
  {
    collection: 'FlatMovies',
    key: { initialDiscoveryDate: -1, mediaLastModified: -1 },
    name: 'recently_added_index',
  },
  {
    collection: 'FlatEpisodes',
    key: { initialDiscoveryDate: -1, mediaLastModified: -1, showId: 1 },
    name: 'recently_added_index',
  },
]

const MISSING = { initialDiscoveryDate: { $exists: false } }
const FILLABLE = { ...MISSING, createdAt: { $type: 'date' } }
const UNFILLABLE = { ...MISSING, createdAt: { $not: { $type: 'date' } } }

async function main() {
  const client = new MongoClient(MONGODB_URI)
  await client.connect()
  const db = client.db(MEDIA_DB_NAME)

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — database "${MEDIA_DB_NAME}"\n`)

  try {
    for (const { collection, key, name } of INDEXES) {
      const existing = await db.collection(collection).indexes()
      const present = existing.some((index) => index.name === name)
      if (present) {
        console.log(`index   ${collection}.${name}: already present`)
      } else if (APPLY) {
        await db.collection(collection).createIndex(key, { name })
        console.log(`index   ${collection}.${name}: created ${JSON.stringify(key)}`)
      } else {
        console.log(`index   ${collection}.${name}: WOULD create ${JSON.stringify(key)}`)
      }
    }
    console.log('')

    let unfillableTotal = 0
    for (const name of COLLECTIONS) {
      const collection = db.collection(name)
      const [total, fillable, unfillable] = await Promise.all([
        // Exact, not estimatedDocumentCount(): the estimate reads collection
        // metadata, which was observed badly stale in production (43 for a
        // collection holding 834) and made this report misleading.
        collection.countDocuments({}),
        collection.countDocuments(FILLABLE),
        collection.countDocuments(UNFILLABLE),
      ])
      unfillableTotal += unfillable

      let written = 0
      if (APPLY && fillable > 0) {
        const result = await collection.updateMany(FILLABLE, [
          { $set: { initialDiscoveryDate: '$createdAt', initialDiscoveryServer: 'backfill' } },
        ])
        written = result.modifiedCount
      }

      console.log(
        `fill    ${name}: ${total} docs, ${fillable} missing the date` +
          (APPLY ? `, ${written} filled from createdAt` : ' (would fill from createdAt)') +
          (unfillable > 0 ? `, ${unfillable} SKIPPED — no createdAt to fill from` : '')
      )

      if (unfillable > 0) {
        const samples = await collection
          .find(UNFILLABLE, { projection: { title: 1, originalTitle: 1, showTitle: 1, seasonNumber: 1, episodeNumber: 1 } })
          .limit(5)
          .toArray()
        for (const doc of samples) {
          console.log(`          e.g. ${JSON.stringify(doc)}`)
        }
      }
    }

    console.log('')
    if (APPLY) {
      for (const name of COLLECTIONS) {
        const remaining = await db.collection(name).countDocuments(MISSING)
        console.log(`verify  ${name}: ${remaining} still missing the date`)
      }
    } else {
      console.log('Nothing written. Re-run with --apply to create the indexes and fill the dates.')
    }
    if (unfillableTotal > 0) {
      console.log(
        `\n${unfillableTotal} document(s) have no createdAt and were left alone on purpose; ` +
          'the sync dates them on their next rebuild.'
      )
    }
  } finally {
    await client.close()
  }
}

main().catch((error) => {
  console.error('Backfill failed:', error)
  process.exit(1)
})
