/**
 * Post-sync cleanup orchestrator (replaces checkAvailabilityAcrossAllServers).
 *
 * Replaces the legacy 15-Map / per-orphan `deleteOne` pipeline (and the
 * worker_threads isolate that wrapped it) with bulk MongoDB operations:
 *   - Four projection-only `find()` calls to enumerate current DB state
 *   - One in-memory pass over `allFileServers` + `fieldAvailability` to
 *     compute orphan id arrays per collection
 *   - One `deleteMany()` per collection (split across $in shards for cascades)
 *   - Two `updateMany()` calls in WatchHistory validation
 *
 * Total wall time is dominated by MongoDB roundtrips (~hundreds of ms);
 * the in-memory predicate pass is sub-100ms even at 16k entities. There
 * is no longer a justification for off-thread execution.
 *
 * The legacy cleanup functions in videoAvailability.js are preserved as
 * @deprecated reference for predicate-equivalence review.
 */

import { trace } from '@opentelemetry/api'
import clientPromise from '@src/lib/mongodb'
import { createLogger, logError } from '@src/lib/logger'
import { migratePlaybackStatusIfNeeded } from '../watchHistory/migrate'
import { validateWatchHistoryAgainstDatabase } from './watchHistoryValidation'
import { getCurrentSyncRunId } from './syncContext'

// Module-scoped lock — fail-fast on concurrent invocations within one process.
// Multi-process deployments later: swap for a Redis lock.
let inFlight = false

const tracer = trace.getTracer('flatsync.post-sync-cleanup')

const EMPTY_RESULT = Object.freeze({
  removed: { movies: [], tvShows: [], tvSeasons: [], tvEpisodes: [] },
  errors: { movies: [], tvShows: [], tvSeasons: [], tvEpisodes: [] },
  cache: null,
  watchHistoryValidation: null,
  migration: null,
})

/**
 * Marker-based cleanup orchestrator. Same return shape as the legacy
 * checkAvailabilityAcrossAllServers so sync.js / SSE subscribers don't change.
 *
 * Phase 2 of the marker rollout uses `syncRunId` markers (pre-tagged at the
 * start of the orchestration by `preTagSyncRunId`) as the deletion criterion.
 * Anything missing the current `syncRunId` is, by construction, orphan.
 *
 * @param {Object} allFileServers - { [serverId]: { movies, tv, ... } }. Used
 *   only for the top-level "no-server-data" safety guard — the cleanup
 *   predicate itself is the marker, not in-memory file-server state.
 * @param {Object} [_fieldAvailability] - Vestigial. Pre-marker cleanup used
 *   this for the per-record predicate. Kept in the signature for callers that
 *   still pass it; ignored by the marker-based path.
 * @param {Object} [options]
 * @param {string} [options.syncRunId] - The orchestration's syncRunId. The
 *   marker-based path requires this; if absent the cleanup is skipped.
 * @returns {Promise<Object>} { removed, errors, cache, watchHistoryValidation, migration }
 */
// eslint-disable-next-line no-unused-vars
export async function runPostSyncCleanup(allFileServers, _fieldAvailability, options = {}) {
  const log = createLogger('FlatSync.PostSyncCleanup')
  const { syncRunId } = options

  if (inFlight) {
    log.warn('runPostSyncCleanup already in progress; skipping concurrent invocation')
    return null
  }
  inFlight = true

  return tracer.startActiveSpan('flatsync.post-sync.cleanup', async (span) => {
    try {
      // ─── Safety guard: don't mass-delete on transient connectivity loss ──────
      const serverCount = Object.keys(allFileServers || {}).length
      const totalServerMovies = Object.values(allFileServers || {})
        .reduce((n, fs) => n + (fs?.movies ? Object.keys(fs.movies).length : 0), 0)
      const totalServerShows = Object.values(allFileServers || {})
        .reduce((n, fs) => n + (fs?.tv ? Object.keys(fs.tv).length : 0), 0)

      if (serverCount === 0 || (totalServerMovies === 0 && totalServerShows === 0)) {
        log.warn(
          { serverCount, totalServerMovies, totalServerShows },
          'Skipping post-sync cleanup — no file-server data; refusing to mass-delete'
        )
        span.setAttribute('cleanup.skipped', 'no_server_data')
        return { ...EMPTY_RESULT, removed: { ...EMPTY_RESULT.removed } }
      }

      span.setAttributes({
        'cleanup.server_count': serverCount,
        'cleanup.server_movies': totalServerMovies,
        'cleanup.server_shows': totalServerShows,
      })

      // ─── Race guard: a newer sync orchestration may have started while we ──
      // were sitting in the post-`__sync_complete__` background queue. If so,
      // its pre-tag step has already (or will shortly) overwrite the markers
      // on records that should be kept — proceeding here would treat them as
      // orphans. Defer to the newer orchestration's eventual cleanup instead.
      if (syncRunId) {
        const activeRunId = getCurrentSyncRunId()
        if (activeRunId && activeRunId !== syncRunId) {
          log.warn(
            { ourRunId: syncRunId, activeRunId },
            'A newer sync orchestration is in progress; deferring cleanup to that run'
          )
          span.setAttribute('cleanup.skipped', 'newer_sync_active')
          return { ...EMPTY_RESULT, removed: { ...EMPTY_RESULT.removed } }
        }
      }

      const client = await clientPromise
      const db = client.db('Media')
      const startedAt = Date.now()

      // ─── Marker-based cleanup (Phase 2 of marker rollout) ──────────────────
      // Pre-tag (preTagSyncRunId.js) ran at the start of the orchestration,
      // stamping every record currently present on a file server with the
      // active syncRunId. Any record whose syncRunId does not match is, by
      // construction, an orphan: it was not on any server at pre-tag time and
      // was not freshly inserted during the per-server sync.
      //
      // Without a syncRunId the cleanup has no defensible deletion criterion;
      // bail out rather than guess.
      if (!syncRunId) {
        log.warn('runPostSyncCleanup invoked without a syncRunId — skipping deletes')
        span.setAttribute('cleanup.skipped', 'no_sync_run_id')
        return { ...EMPTY_RESULT, removed: { ...EMPTY_RESULT.removed } }
      }

      // ─── Phase A: Find orphan docs (indexed scan, projection-only) ──────────
      // The query plans as IXSCAN on `sync_run_id_index` and returns only
      // records that need deleting (typically 0–N orphans, not 16k records).
      const orphanFilter = { syncRunId: { $ne: syncRunId } }
      const [movieOrphans, showOrphans, seasonOrphans, episodeOrphans] = await Promise.all([
        db.collection('FlatMovies')
          .find(orphanFilter, { projection: { _id: 1, title: 1, originalTitle: 1, syncRunId: 1 } })
          .toArray(),
        db.collection('FlatTVShows')
          .find(orphanFilter, { projection: { _id: 1, title: 1, originalTitle: 1, syncRunId: 1 } })
          .toArray(),
        db.collection('FlatSeasons')
          .find(orphanFilter, { projection: { _id: 1, showTitle: 1, seasonNumber: 1, syncRunId: 1 } })
          .toArray(),
        db.collection('FlatEpisodes')
          .find(orphanFilter, {
            projection: { _id: 1, showTitle: 1, seasonNumber: 1, episodeNumber: 1, syncRunId: 1 },
          }).toArray(),
      ])

      // ─── Phase B: Pre-tag-failure safety check ──────────────────────────────
      // If an entire collection's records are "orphan", the pre-tag for that
      // collection must have failed (since every record present on a server
      // gets tagged). Refuse to delete in that case — the next cycle will
      // catch real orphans once pre-tag succeeds.
      const totals = await Promise.all([
        db.collection('FlatMovies').estimatedDocumentCount(),
        db.collection('FlatTVShows').estimatedDocumentCount(),
        db.collection('FlatSeasons').estimatedDocumentCount(),
        db.collection('FlatEpisodes').estimatedDocumentCount(),
      ])
      const collectionsForGuard = [
        { name: 'FlatMovies',   orphanCount: movieOrphans.length,   total: totals[0] },
        { name: 'FlatTVShows',  orphanCount: showOrphans.length,    total: totals[1] },
        { name: 'FlatSeasons',  orphanCount: seasonOrphans.length,  total: totals[2] },
        { name: 'FlatEpisodes', orphanCount: episodeOrphans.length, total: totals[3] },
      ]
      for (const c of collectionsForGuard) {
        if (c.total > 0 && c.orphanCount === c.total) {
          log.error(
            { collection: c.name, total: c.total, orphans: c.orphanCount, syncRunId },
            'All records in collection lack the current syncRunId — pre-tag must have failed; refusing cleanup'
          )
          span.setAttribute('cleanup.skipped', 'pre_tag_failure_suspected')
          return { ...EMPTY_RESULT, removed: { ...EMPTY_RESULT.removed } }
        }
      }

      // ─── Phase C: Marker-coverage observability ─────────────────────────────
      // Phase 1 diagnostic, kept here so SigNoz dashboards remain useful and
      // we can spot Phase 2 regressions (e.g., orphans growing unexpectedly).
      log.info(
        {
          syncRunId,
          movies:   { orphans: movieOrphans.length,   total: totals[0] },
          shows:    { orphans: showOrphans.length,    total: totals[1] },
          seasons:  { orphans: seasonOrphans.length,  total: totals[2] },
          episodes: { orphans: episodeOrphans.length, total: totals[3] },
        },
        'Marker-based cleanup: orphan tally'
      )

      // ─── Phase D: Build legacy-shape `removed` arrays from orphan docs ──────
      // Same return shape as before so the cache invalidator and any SSE
      // subscribers don't need to change.
      const removed = {
        movies:    movieOrphans.map((m) => m.title),
        tvShows:   showOrphans.map((s) => s.title),
        tvSeasons: seasonOrphans.map((sn) => `${sn.showTitle} Season ${sn.seasonNumber}`),
        tvEpisodes: episodeOrphans.map((e) => `${e.showTitle} S${e.seasonNumber}E${e.episodeNumber}`),
      }

      // ─── Phase E: Issue four parallel marker-based deleteMany calls ─────────
      // Each plans as a single IXSCAN on `sync_run_id_index`. No more in-memory
      // predicate iteration over 16k records, no $in arrays, no cascades —
      // every collection is filtered independently by its own marker.
      await Promise.all([
        db.collection('FlatMovies').deleteMany(orphanFilter),
        db.collection('FlatTVShows').deleteMany(orphanFilter),
        db.collection('FlatSeasons').deleteMany(orphanFilter),
        db.collection('FlatEpisodes').deleteMany(orphanFilter),
      ])

      const elapsedMs = Date.now() - startedAt
      log.info(
        {
          durationMs: elapsedMs,
          movies: removed.movies.length,
          tvShows: removed.tvShows.length,
          tvSeasons: removed.tvSeasons.length,
          tvEpisodes: removed.tvEpisodes.length,
        },
        'Marker-based cleanup complete'
      )

      // ─── Phase 6: Cache invalidation (unchanged from legacy semantics) ──────
      let cacheResults = null
      if (
        removed.movies.length || removed.tvShows.length
        || removed.tvSeasons.length || removed.tvEpisodes.length
      ) {
        cacheResults = await clearCacheEntries(removed)
      }

      // ─── Phase 7: WatchHistory migration (unchanged) ────────────────────────
      const migrationStartedAt = Date.now()
      try {
        await migratePlaybackStatusIfNeeded()
      } catch (error) {
        log.warn({ error: error.message }, 'WatchHistory migration encountered an issue, but cleanup continues')
      }
      const migrationDurationSec = parseFloat(((Date.now() - migrationStartedAt) / 1000).toFixed(2))

      // ─── Phase 8: WatchHistory validation (rewritten in watchHistoryValidation.js) ──
      const validationResults = await validateWatchHistoryAgainstDatabase()

      span.setAttributes({
        'cleanup.removed.movies': removed.movies.length,
        'cleanup.removed.tv_shows': removed.tvShows.length,
        'cleanup.removed.tv_seasons': removed.tvSeasons.length,
        'cleanup.removed.tv_episodes': removed.tvEpisodes.length,
        'cleanup.duration_ms': elapsedMs,
      })

      return {
        removed,
        errors: { movies: [], tvShows: [], tvSeasons: [], tvEpisodes: [] },
        cache: cacheResults,
        watchHistoryValidation: validationResults,
        migration: { durationSec: migrationDurationSec },
      }
    } catch (error) {
      logError(log, error, { context: 'post_sync_cleanup' })
      span.recordException(error)
      throw error
    } finally {
      inFlight = false
      span.end()
    }
  })
}

// ─── Deprecated predicate helpers (kept for review) ──────────────────────────
//
// Phase 2 of the marker-based cleanup rollout (2026-05-09) replaced the
// in-memory predicate phase with four `deleteMany({ syncRunId: { $ne } })`
// calls. The compute*Deletes / computeMarkerCoverage helpers below were the
// in-memory predicates Phase 2 superseded. They're preserved here so
// reviewers can diff the marker-based query against the original predicate
// logic for parity confirmation, and so a fast revert path exists if the
// marker pattern needs to be unwound.
//
// Each function now throws on call to surface forgotten callers loudly. The
// real bodies live in block comments below the throws.

/** @deprecated Replaced 2026-05-09 by the inline `Marker-based cleanup: orphan tally` log in runPostSyncCleanup. */
function computeMarkerCoverage(/* docs, currentSyncRunId */) {
  throw new Error('computeMarkerCoverage is deprecated; cleanup now reports orphan counts directly.')
  /* LEGACY BODY (kept for review):
   *
   * const tally = (arr) => {
   *   let current = 0, prior = 0, missing = 0
   *   for (const d of arr) {
   *     if (d.syncRunId === undefined || d.syncRunId === null) missing++
   *     else if (d.syncRunId === currentSyncRunId) current++
   *     else prior++
   *   }
   *   return { current, prior, missing, total: arr.length }
   * }
   * return {
   *   movies: tally(docs.movies),
   *   shows: tally(docs.shows),
   *   seasons: tally(docs.seasons),
   *   episodes: tally(docs.episodes),
   * }
   */
}

/** @deprecated Replaced 2026-05-09 by `deleteMany({ syncRunId: { $ne: currentRunId } })` on FlatMovies. */
function computeMovieDeletes(/* movieDocs, serverMovieTitles, fieldAvailability */) {
  throw new Error('computeMovieDeletes is deprecated; cleanup uses syncRunId markers now.')
  /* LEGACY BODY (verified parity with videoAvailability.js:21-103):
   *
   * Movie delete predicate:
   *   delete iff
   *     (!found && (responsible missing OR empty))
   *     OR
   *     (found && responsible exists && responsible.length === 0)
   *
   * const ids = []
   * for (const m of movieDocs) {
   *   const found = serverMovieTitles.has(m.title)
   *     || (m.originalTitle && serverMovieTitles.has(m.originalTitle))
   *   const responsible = fieldAvailability?.movies?.[m.title]?.['urls.mp4']
   *   const del = !found
   *     ? (!responsible || responsible.length === 0)
   *     : (Array.isArray(responsible) && responsible.length === 0)
   *   if (del) ids.push(m._id)
   * }
   * return ids
   */
}

/** @deprecated Replaced 2026-05-09 by `deleteMany({ syncRunId: { $ne: currentRunId } })` on FlatTVShows. */
function computeShowDeletes(/* showDocs, serverShowTitles, showsWithValidVideoURLsByTitle, serversWithShowByTitle, fieldAvailability */) {
  throw new Error('computeShowDeletes is deprecated; cleanup uses syncRunId markers now.')
  /* LEGACY BODY (verified parity with videoAvailability.js:114-247):
   *
   * TV show delete predicate:
   *   delete iff (!titleMatch || !hasValid)
   *   then UNDO delete if fieldAvailability rescue applies (any responsible
   *   server in the show-level field paths matches a server with this show).
   *
   * NOTE on byTitle vs byOriginalTitle parity gap:
   *   `fieldAvailability.tv` is keyed by file-server originalTitle, but legacy
   *   code looks up using `show.title` (DB title). Preserved here for parity.
   *
   * const ids = []
   * for (const s of showDocs) {
   *   const titleMatch = serverShowTitles.has(s.title)
   *     || (s.originalTitle && serverShowTitles.has(s.originalTitle))
   *   const hasValid = showsWithValidVideoURLsByTitle.has(s.title)
   *     || (s.originalTitle && showsWithValidVideoURLsByTitle.has(s.originalTitle))
   *   let del = !titleMatch || !hasValid
   *   if (titleMatch && fieldAvailability?.tv?.[s.title]) {
   *     const serversWithShow = serversWithShowByTitle.get(s.title)
   *       ?? (s.originalTitle ? serversWithShowByTitle.get(s.originalTitle) : null)
   *       ?? []
   *     const showLevelFields = Object.keys(fieldAvailability.tv[s.title])
   *       .filter((p) => !p.includes('seasons.') && !p.includes('episodes.'))
   *     if (showLevelFields.length > 0) {
   *       const isResponsibleForAnyField = showLevelFields.some((fp) => {
   *         const arr = fieldAvailability.tv[s.title][fp] || []
   *         return arr.length === 0 || serversWithShow.some((sid) => arr.includes(sid))
   *       })
   *       if (!isResponsibleForAnyField && serversWithShow.length > 0) del = false
   *     }
   *   }
   *   if (del) ids.push(s._id)
   * }
   * return ids
   */
}

/** @deprecated Replaced 2026-05-09 by `deleteMany({ syncRunId: { $ne: currentRunId } })` on FlatSeasons. */
function computeSeasonDeletes(/* seasonDocs, serverSeasonKeys, fieldAvailability, showIdsDeletedSet, showIdToOriginalTitle, showIdToTitle */) {
  throw new Error('computeSeasonDeletes is deprecated; cleanup uses syncRunId markers now.')
  /* LEGACY BODY (verified parity with videoAvailability.js:257-385):
   *
   * Skips seasons whose show is already cascading.
   *
   * const ids = []
   * for (const sn of seasonDocs) {
   *   if (showIdsDeletedSet.has(sn.showId.toString())) continue
   *   const origTitle = showIdToOriginalTitle.get(sn.showId.toString()) ?? sn.showTitle
   *   const found = serverSeasonKeys.has(`${origTitle}|${sn.seasonNumber}`)
   *   let del = !found
   *   if (found) {
   *     const showTitleForFA = showIdToTitle.get(sn.showId.toString()) ?? sn.showTitle
   *     const fa = fieldAvailability?.tv?.[showTitleForFA]
   *     if (fa) {
   *       const path = `seasons.Season ${sn.seasonNumber}`
   *       const seasonFields = Object.keys(fa).filter((p) => p.startsWith(path))
   *       if (seasonFields.length > 0) {
   *         const isResponsible = seasonFields.some((fp) => (fa[fp] || []).length === 0)
   *         if (isResponsible) del = false
   *       }
   *     }
   *   }
   *   if (del) ids.push(sn._id)
   * }
   * return ids
   */
}

/** @deprecated Replaced 2026-05-09 by `deleteMany({ syncRunId: { $ne: currentRunId } })` on FlatEpisodes. */
function computeEpisodeDeletes(/* episodeDocs, serverEpisodeKeys, fieldAvailability, showIdsDeletedSet, seasonIdsDeletedSet, showIdToOriginalTitle, showIdToTitle */) {
  throw new Error('computeEpisodeDeletes is deprecated; cleanup uses syncRunId markers now.')
  /* LEGACY BODY (verified parity with videoAvailability.js:395-534):
   *
   * Skips episodes whose show or season is already cascading.
   *
   * const ids = []
   * for (const e of episodeDocs) {
   *   if (showIdsDeletedSet.has(e.showId.toString())) continue
   *   if (seasonIdsDeletedSet.has(e.seasonId.toString())) continue
   *   const origTitle = showIdToOriginalTitle.get(e.showId.toString()) ?? e.showTitle
   *   const found = serverEpisodeKeys.has(`${origTitle}|${e.seasonNumber}|${e.episodeNumber}`)
   *   let del = !found
   *   if (found) {
   *     const showTitleForFA = showIdToTitle.get(e.showId.toString()) ?? e.showTitle
   *     const fa = fieldAvailability?.tv?.[showTitleForFA]
   *     if (fa) {
   *       const epPath = `seasons.Season ${e.seasonNumber}.episodes.S${
   *         String(e.seasonNumber).padStart(2, '0')
   *       }E${String(e.episodeNumber).padStart(2, '0')}`
   *       const epFields = Object.keys(fa).filter((p) => p.startsWith(epPath))
   *       if (epFields.length > 0) {
   *         const isResponsible = epFields.some((fp) => (fa[fp] || []).length === 0)
   *         if (isResponsible) del = false
   *       }
   *     }
   *   }
   *   if (del) ids.push(e._id)
   * }
   * return ids
   */
}

// ─── Cache invalidation (lifted from videoAvailability.js, unchanged) ─────────
// Preserved here so videoAvailability.js's `clearCacheEntries` can be marked
// @deprecated alongside the rest. Behavior is byte-for-byte identical.

async function clearCacheEntries(removedContent) {
  const log = createLogger('FlatSync.PostSyncCleanup.Cache')
  const { getRedisClient } = await import('@src/lib/redisClient')
  const redisClient = await getRedisClient()
  if (!redisClient) {
    log.info('Redis not configured. Skipping cache clearing.')
    return { cleared: 0, errors: 0 }
  }

  const results = { cleared: 0, errors: 0, details: [] }

  const dropPattern = async (pattern) => {
    const keys = await redisClient.keys(pattern)
    if (keys.length > 0) {
      await redisClient.del(keys)
      results.cleared += keys.length
    }
  }

  try {
    for (const movieTitle of removedContent.movies) {
      try {
        await dropPattern(`movie:${movieTitle}*`)
        await dropPattern(`metadata:movie:${movieTitle}*`)
        await dropPattern(`blurhash:movie:${movieTitle}*`)
        await dropPattern(`poster:movie:${movieTitle}*`)
        await dropPattern(`backdrop:movie:${movieTitle}*`)
      } catch (error) {
        logError(log, error, { movieTitle, context: 'clear_cache_movie' })
        results.errors++
      }
    }

    for (const showTitle of removedContent.tvShows) {
      try {
        await dropPattern(`tv:${showTitle}*`)
        await dropPattern(`metadata:tv:${showTitle}*`)
        await dropPattern(`blurhash:tv:${showTitle}*`)
        await dropPattern(`poster:tv:${showTitle}*`)
        await dropPattern(`backdrop:tv:${showTitle}*`)
        await dropPattern(`season:${showTitle}*`)
        await dropPattern(`episode:${showTitle}*`)
      } catch (error) {
        logError(log, error, { showTitle, context: 'clear_cache_tv_show' })
        results.errors++
      }
    }

    for (const seasonTitle of removedContent.tvSeasons || []) {
      try {
        const m = seasonTitle.match(/^(.+) Season (\d+)$/)
        if (!m) continue
        const [, showTitle, seasonNumber] = m
        await dropPattern(`season:${showTitle}:${seasonNumber}*`)
        await dropPattern(`metadata:season:${showTitle}:${seasonNumber}*`)
        await dropPattern(`blurhash:season:${showTitle}:${seasonNumber}*`)
        await dropPattern(`poster:season:${showTitle}:${seasonNumber}*`)
      } catch (error) {
        logError(log, error, { seasonTitle, context: 'clear_cache_season' })
        results.errors++
      }
    }

    for (const episodeTitle of removedContent.tvEpisodes || []) {
      try {
        const m = episodeTitle.match(/^(.+) S(\d+)E(\d+)$/)
        if (!m) continue
        const [, showTitle, seasonNumber, episodeNumber] = m
        await dropPattern(`episode:${showTitle}:${seasonNumber}:${episodeNumber}*`)
        await dropPattern(`metadata:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`)
        await dropPattern(`blurhash:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`)
        await dropPattern(`thumbnail:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`)
      } catch (error) {
        logError(log, error, { episodeTitle, context: 'clear_cache_episode' })
        results.errors++
      }
    }

    log.info({ cleared: results.cleared, errors: results.errors }, 'Cache clearing complete')
    return results
  } catch (error) {
    logError(log, error, { context: 'cache_clearing' })
    return { cleared: 0, errors: 1, details: [error.message] }
  }
}
