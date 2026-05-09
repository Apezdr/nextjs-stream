/**
 * Pre-tag every Flat* record currently present on at least one file server
 * with the active `syncRunId`. Runs at the start of an orchestration so that
 * by the time post-sync cleanup runs (after all servers finish), every record
 * still backed by a server carries the current marker — anything left without
 * it is an orphan.
 *
 * Why this exists:
 *   The sync pipeline's per-write marker injection (see syncContext.js) only
 *   fires on writes that the sync logic actually performs — and both
 *   architectures short-circuit when nothing has changed (smartUpsert's
 *   no-diff fast path; the old-arch helpers only get called when there is a
 *   value to write). In steady-state cycles where most records are unchanged,
 *   the per-write injection alone leaves coverage at 0%, which Phase 1 of the
 *   marker rollout confirmed in production.
 *
 *   Pre-tagging closes that gap with a small number of indexed bulk writes:
 *     - FlatMovies: one updateMany keyed by originalTitle
 *     - FlatTVShows: one updateMany keyed by originalTitle
 *     - FlatSeasons: one bulkWrite keyed by (showId, seasonNumber)
 *     - FlatEpisodes: one bulkWrite keyed by (showId, seasonNumber, episodeNumber)
 *
 * Cost is dominated by MongoDB I/O wait (sub-second total at our current
 * ~16k-entity scale). The in-memory portion — walking file-server data once
 * to build the bulk-op arrays — is sub-100ms and reuses iteration we already
 * do during sync.
 */

import { createLogger, logError } from '@src/lib/logger'
import clientPromise from '@src/lib/mongodb'

/**
 * @param {Object} allFileServers - { [serverId]: { movies, tv, ... } }
 * @param {string} syncRunId - The orchestration's syncRunId (already-set in syncContext).
 * @returns {Promise<Object|null>} Per-collection tag counts, or null on failure / no syncRunId.
 */
export async function preTagSyncRunId(allFileServers, syncRunId) {
  const log = createLogger('FlatSync.PreTag')
  if (!syncRunId) {
    log.warn('preTagSyncRunId called without a syncRunId — skipping')
    return null
  }

  const client = await clientPromise
  const db = client.db('Media')
  const startedAt = Date.now()

  // ─── Build server-side identifier sets in one pass ──────────────────────
  const movieTitles = new Set()
  const showOriginalTitles = new Set()
  const seasonNeeds = []   // { origTitle, seasonNumber }
  const episodeNeeds = []  // { origTitle, seasonNumber, episodeNumber }

  for (const fs of Object.values(allFileServers || {})) {
    if (fs?.movies) {
      for (const t of Object.keys(fs.movies)) movieTitles.add(t)
    }
    if (!fs?.tv) continue
    for (const [origTitle, showData] of Object.entries(fs.tv)) {
      showOriginalTitles.add(origTitle)
      if (!showData?.seasons) continue
      for (const [seasonKey, seasonData] of Object.entries(showData.seasons)) {
        const sm = seasonKey.match(/Season (\d+)/)
        if (!sm) continue
        const seasonNumber = parseInt(sm[1], 10)
        seasonNeeds.push({ origTitle, seasonNumber })
        if (!seasonData?.episodes) continue
        for (const epKey of Object.keys(seasonData.episodes)) {
          const em = epKey.match(/E(\d+)$/i)
          if (!em) continue
          episodeNeeds.push({ origTitle, seasonNumber, episodeNumber: parseInt(em[1], 10) })
        }
      }
    }
  }

  const movieArr = [...movieTitles]
  const showArr = [...showOriginalTitles]

  if (movieArr.length === 0 && showArr.length === 0) {
    log.info({ syncRunId }, 'preTagSyncRunId: no server data, skipping')
    return { moviesTagged: 0, showsTagged: 0, seasonsTagged: 0, episodesTagged: 0 }
  }

  // ─── Resolve show originalTitle → _id for season/episode keying ─────────
  const showsOnServer = showArr.length
    ? await db.collection('FlatTVShows').find(
        { originalTitle: { $in: showArr } },
        { projection: { _id: 1, originalTitle: 1 } }
      ).toArray()
    : []
  const titleToShowId = new Map(showsOnServer.map((s) => [s.originalTitle, s._id]))

  // ─── Execute pre-tag — bulk writes chunked to keep heap working set small ─
  // Movies + shows use updateMany which is server-side O(N) — no client array
  // to chunk. Seasons + episodes go through bulkWrite, where the entire ops
  // array AND the response object live in old_space until the call resolves
  // (~5s for 7k episode ops at the original full-payload size).
  //
  // To minimize the live working set, ops are built INCREMENTALLY inside the
  // chunking loop — at any moment only ~CHUNK_SIZE op objects exist plus the
  // bulkWrite response for the in-flight batch. The dedup Sets persist across
  // chunks (small — just hashed string keys, ~50 bytes per entry).
  try {
    const moviesPromise = movieArr.length
      ? db.collection('FlatMovies').updateMany(
          { originalTitle: { $in: movieArr } },
          { $set: { syncRunId } }
        )
      : Promise.resolve({ modifiedCount: 0 })

    const showsPromise = showArr.length
      ? db.collection('FlatTVShows').updateMany(
          { originalTitle: { $in: showArr } },
          { $set: { syncRunId } }
        )
      : Promise.resolve({ modifiedCount: 0 })

    /**
     * Stream `needs` entries through `buildOp(need)`, deduping with `dedupKey`,
     * and execute bulkWrites in batches of `chunkSize`. Each batch's ops
     * array is local to the loop iteration so it becomes GC-eligible the
     * moment the bulkWrite resolves.
     */
    const streamChunkedBulkWrite = async (
      collectionName,
      needs,
      buildOp,
      dedupKey,
      chunkSize = 1000
    ) => {
      if (!needs.length) return { modified: 0, opsCount: 0 }
      const seen = new Set()
      let opsCount = 0
      let modified = 0
      let batch = []
      for (const need of needs) {
        const op = buildOp(need)
        if (!op) continue
        const key = dedupKey(need)
        if (seen.has(key)) continue
        seen.add(key)
        batch.push(op)
        if (batch.length >= chunkSize) {
          const r = await db.collection(collectionName).bulkWrite(batch, { ordered: false })
          modified += r.modifiedCount ?? 0
          opsCount += batch.length
          batch = [] // release this chunk's ops to GC
        }
      }
      if (batch.length > 0) {
        const r = await db.collection(collectionName).bulkWrite(batch, { ordered: false })
        modified += r.modifiedCount ?? 0
        opsCount += batch.length
      }
      return { modified, opsCount }
    }

    const seasonBuilder = ({ origTitle, seasonNumber }) => {
      const showId = titleToShowId.get(origTitle)
      if (!showId) return null
      return {
        updateOne: {
          filter: { showId, seasonNumber },
          update: { $set: { syncRunId } },
        },
      }
    }
    const seasonKey = ({ origTitle, seasonNumber }) => {
      const showId = titleToShowId.get(origTitle)
      return showId ? `${showId.toString()}|${seasonNumber}` : null
    }

    const episodeBuilder = ({ origTitle, seasonNumber, episodeNumber }) => {
      const showId = titleToShowId.get(origTitle)
      if (!showId) return null
      return {
        updateOne: {
          filter: { showId, seasonNumber, episodeNumber },
          update: { $set: { syncRunId } },
        },
      }
    }
    const episodeKey = ({ origTitle, seasonNumber, episodeNumber }) => {
      const showId = titleToShowId.get(origTitle)
      return showId ? `${showId.toString()}|${seasonNumber}|${episodeNumber}` : null
    }

    const [movieResult, showResult, seasonStats, episodeStats] = await Promise.all([
      moviesPromise,
      showsPromise,
      streamChunkedBulkWrite('FlatSeasons', seasonNeeds, seasonBuilder, seasonKey, 1000),
      streamChunkedBulkWrite('FlatEpisodes', episodeNeeds, episodeBuilder, episodeKey, 1000),
    ])

    const result = {
      moviesTagged: movieResult.modifiedCount ?? 0,
      showsTagged: showResult.modifiedCount ?? 0,
      seasonsTagged: seasonStats.modified,
      episodesTagged: episodeStats.modified,
      seasonOps: seasonStats.opsCount,
      episodeOps: episodeStats.opsCount,
      durationMs: Date.now() - startedAt,
    }

    log.info({ syncRunId, ...result }, 'Pre-tagged Flat* records with current syncRunId')

    return result
  } catch (error) {
    logError(log, error, { syncRunId, context: 'pre_tag_failed' })
    return null
  }
}
