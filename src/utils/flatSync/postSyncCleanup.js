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
import { getCurrentSyncRunId, getSyncLockHolder } from './syncContext'
import { isCollectionFullyCovered } from './preTagSyncRunId'

// Module-scoped lock — fail-fast on concurrent invocations within one process.
// Multi-process deployments later: swap for a Redis lock.
let inFlight = false

const tracer = trace.getTracer('flatsync.post-sync-cleanup')

// Circuit breaker: refuse to delete a collection whose orphan set is an
// implausibly large fraction of the collection (defense-in-depth behind the
// per-collection pre-tag coverage gate). Default 0.5 = "something is very wrong"
// — catastrophic deletes are blocked while normal prunes pass untouched. Lower
// it (e.g. 0.2) for stricter protection, or raise it to deliberately allow a
// one-time bulk removal. Env-tunable via SYNC_MAX_ORPHAN_FRACTION.
const MAX_ORPHAN_FRACTION = (() => {
  const p = Number(process.env.SYNC_MAX_ORPHAN_FRACTION)
  return Number.isFinite(p) && p >= 0 ? p : 0.5
})()

// FK-orphan detection (D1): the marker-based orphan tally below counts by syncRunId
// staleness only and is blind to referential breaks — episodes/seasons whose `showId`
// no longer points at any `FlatTVShows._id` (e.g. a show re-inserted with a new _id,
// leaving its children dangling). This $lookup check surfaces those counts in the
// tally so SigNoz can alarm on them. Two index-backed checks per run (DISTINCT_SCAN
// + point lookups, ~tens of ms); disable with SYNC_FK_ORPHAN_CHECK=false if ever needed.
const FK_ORPHAN_CHECK_ENABLED = process.env.SYNC_FK_ORPHAN_CHECK !== 'false'

/**
 * Count docs in `collectionName` whose `showId` resolves to no `FlatTVShows._id`
 * (referential orphans — children dangling off a missing show).
 *
 * Fully index-backed, no collection scan:
 *   1. `distinct('showId')` → DISTINCT_SCAN on the `showId_1` index (index-only,
 *      ~hundreds of values, zero docs examined).
 *   2. resolve which of those shows still exist (foreign `_id` index).
 *   3. `countDocuments({ showId: { $in: <missing> } })` → IXSCAN on `showId_1`.
 * Short-circuits before step 3 when there are no children or no orphans, so the
 * healthy path is two indexed reads.
 *
 * Replaces a single `$lookup` aggregation that COLLSCANned the whole collection
 * and ran one foreign lookup PER document (~1s on FlatEpisodes in production).
 * Semantics are unchanged: the count includes child docs with a null/absent
 * `showId` (distinct returns null for them; null matches no show, so they remain
 * in the orphan set and `{ $in: [null, …] }` counts them).
 */
async function countFkOrphans(db, collectionName) {
  const showIds = await db.collection(collectionName).distinct('showId')
  if (showIds.length === 0) return 0

  const existing = await db
    .collection('FlatTVShows')
    .find({ _id: { $in: showIds } }, { projection: { _id: 1 } })
    .toArray()
  const existingIds = new Set(existing.map((s) => String(s._id)))

  const orphanShowIds = showIds.filter((id) => !existingIds.has(String(id)))
  if (orphanShowIds.length === 0) return 0

  return db.collection(collectionName).countDocuments({ showId: { $in: orphanShowIds } })
}

/**
 * Cascade-delete the seasons/episodes of shows that were just deleted, keyed on the
 * precise deleted show `_id`s (NOT the marker). This runs even when the children's own
 * marker coverage was incomplete this run, so a show delete can never leave orphaned
 * children behind — and it can never touch a live show's children. Bounded by the same
 * lock re-assert and the show-collection MAX_ORPHAN_FRACTION breaker that already gated
 * the show delete; no separate fraction knob (a refused cascade would re-create orphans).
 */
async function cascadeDeleteChildrenOfShows(db, showIds) {
  const CHUNK = 500
  let seasons = 0
  let episodes = 0
  for (let i = 0; i < showIds.length; i += CHUNK) {
    const chunk = showIds.slice(i, i + CHUNK)
    const [se, ep] = await Promise.all([
      db.collection('FlatSeasons').deleteMany({ showId: { $in: chunk } }),
      db.collection('FlatEpisodes').deleteMany({ showId: { $in: chunk } }),
    ])
    seasons += se.deletedCount ?? 0
    episodes += ep.deletedCount ?? 0
  }
  return { seasons, episodes }
}

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
  const { syncRunId, preTagCoverage, runStartedAt } = options

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

      // ─── Coverage gate (fail-closed) ────────────────────────────────────────
      // A collection may be cleaned ONLY when pre-tag PROVED it stamped every
      // server-present record this run (complete && needsSeen===opsBuilt===
      // opsCommitted). Without that proof we skip — never guess. This is the
      // heart of the episode add/delete fix: when pre-tag's episode bulkWrite
      // throws partway (transient Mongo connection drop), episode coverage is
      // incomplete ⇒ episode deletes are skipped ⇒ the un-stamped records
      // survive instead of being reaped and re-created on the next run.
      if (!preTagCoverage) {
        log.error({ syncRunId }, 'No pre-tag coverage supplied to cleanup — refusing all deletes (fail-closed)')
        span.setAttribute('cleanup.skipped', 'no_coverage_contract')
        return { ...EMPTY_RESULT, removed: { ...EMPTY_RESULT.removed } }
      }
      if (preTagCoverage.skipped) {
        log.info({ syncRunId }, 'Pre-tag reported no server data — nothing to clean')
        return { ...EMPTY_RESULT, removed: { ...EMPTY_RESULT.removed } }
      }
      const cov = preTagCoverage.coverage || {}
      const deleteEligible = {
        movies: isCollectionFullyCovered(cov.movies),
        tvShows: isCollectionFullyCovered(cov.shows),
        tvSeasons: isCollectionFullyCovered(cov.seasons),
        tvEpisodes: isCollectionFullyCovered(cov.episodes),
      }
      if (!deleteEligible.movies || !deleteEligible.tvShows || !deleteEligible.tvSeasons || !deleteEligible.tvEpisodes) {
        log.error(
          { syncRunId, deleteEligible },
          'Pre-tag coverage incomplete for one or more collections — skipping their deletes this run'
        )
        span.setAttribute('cleanup.coverage_incomplete', true)
      }

      // ─── Phase A: Find orphan docs (indexed scan, projection-only) ──────────
      // The query plans as IXSCAN on `sync_run_id_index` and returns only
      // records that need deleting (typically 0–N orphans, not 16k records).
      //
      // `manualEntry: { $ne: true }` spares admin-created entries from deletion.
      // Manually-built records (added via the /admin/media UI) are not present
      // on any file server, so pre-tag never stamps them with the current
      // syncRunId — without this exclusion every sync would treat them as
      // orphans and delete them. `$ne: true` (rather than $exists) protects only
      // docs explicitly flagged `manualEntry === true`, leaving normal records
      // (flag absent/false) subject to the standard marker-based predicate.
      //
      // This filter feeds BOTH the find() enumeration below and the deleteMany()
      // calls in Phase E, so the predicate stays identical for find and delete.
      // The Phase B `orphanCount === total` guard remains conservative: excluding
      // manual entries can only shrink orphanCount relative to the
      // estimatedDocumentCount total, so it never deletes more than before.
      // R2 backstop: never delete a doc that was WRITTEN during this run. A
      // genuine orphan was not touched this run, so its updatedAt predates the
      // orchestration start; anything written this run (even if its marker was
      // somehow missed) has updatedAt >= runStart and is excluded here. Docs
      // missing an updatedAt field (legacy) are conservatively left alone.
      const runStart = runStartedAt ? new Date(runStartedAt) : null
      const orphanFilter = {
        syncRunId: { $ne: syncRunId },
        manualEntry: { $ne: true },
        ...(runStart ? { updatedAt: { $lt: runStart } } : {}),
      }
      const [movieOrphans, showOrphans, seasonOrphans, episodeOrphans] = await Promise.all([
        deleteEligible.movies
          ? db.collection('FlatMovies')
              .find(orphanFilter, { projection: { _id: 1, title: 1, originalTitle: 1, syncRunId: 1 } })
              .toArray()
          : Promise.resolve([]),
        deleteEligible.tvShows
          ? db.collection('FlatTVShows')
              .find(orphanFilter, { projection: { _id: 1, title: 1, originalTitle: 1, syncRunId: 1 } })
              .toArray()
          : Promise.resolve([]),
        deleteEligible.tvSeasons
          ? db.collection('FlatSeasons')
              .find(orphanFilter, { projection: { _id: 1, showTitle: 1, seasonNumber: 1, syncRunId: 1 } })
              .toArray()
          : Promise.resolve([]),
        deleteEligible.tvEpisodes
          ? db.collection('FlatEpisodes')
              .find(orphanFilter, {
                projection: { _id: 1, showTitle: 1, seasonNumber: 1, episodeNumber: 1, syncRunId: 1 },
              }).toArray()
          : Promise.resolve([]),
      ])

      // ─── Phase B: Orphan-fraction circuit breaker (per-collection demote) ───
      // Defense-in-depth behind the coverage gate: if a collection's orphan set
      // is an implausibly large fraction of the collection, refuse to delete THAT
      // collection this run (demote it) and log loudly — rather than aborting all
      // four. A genuine bulk prune can exceed the threshold; raise
      // SYNC_MAX_ORPHAN_FRACTION to allow it deliberately. estimatedDocumentCount
      // lags slightly but is fine for a ratio test. Already-ineligible collections
      // were not enumerated (orphanCount 0), so they never trip here.
      const totals = await Promise.all([
        db.collection('FlatMovies').estimatedDocumentCount(),
        db.collection('FlatTVShows').estimatedDocumentCount(),
        db.collection('FlatSeasons').estimatedDocumentCount(),
        db.collection('FlatEpisodes').estimatedDocumentCount(),
      ])
      const fractionGuard = [
        { key: 'movies',     name: 'FlatMovies',   orphanCount: movieOrphans.length,   total: totals[0] },
        { key: 'tvShows',    name: 'FlatTVShows',  orphanCount: showOrphans.length,    total: totals[1] },
        { key: 'tvSeasons',  name: 'FlatSeasons',  orphanCount: seasonOrphans.length,  total: totals[2] },
        { key: 'tvEpisodes', name: 'FlatEpisodes', orphanCount: episodeOrphans.length, total: totals[3] },
      ]
      for (const c of fractionGuard) {
        if (!deleteEligible[c.key]) continue
        if (c.total > 0 && c.orphanCount / c.total > MAX_ORPHAN_FRACTION) {
          const fraction = c.orphanCount / c.total
          log.error(
            { collection: c.name, total: c.total, orphans: c.orphanCount, fraction, threshold: MAX_ORPHAN_FRACTION, syncRunId },
            'Orphan fraction exceeds circuit-breaker threshold — refusing deletes for this collection (raise SYNC_MAX_ORPHAN_FRACTION to override)'
          )
          span.setAttribute(`cleanup.breaker_tripped.${c.key}`, fraction)
          deleteEligible[c.key] = false
        }
      }

      // ─── Phase C: Marker-coverage observability ─────────────────────────────
      // Phase 1 diagnostic, kept here so SigNoz dashboards remain useful and
      // we can spot Phase 2 regressions (e.g., orphans growing unexpectedly).
      // fkOrphans counts referential breaks the marker tally is blind to — a
      // non-zero value means children point at a missing FlatTVShows._id.
      let fkOrphans = null
      if (FK_ORPHAN_CHECK_ENABLED) {
        try {
          const [fkEpisodes, fkSeasons] = await Promise.all([
            countFkOrphans(db, 'FlatEpisodes'),
            countFkOrphans(db, 'FlatSeasons'),
          ])
          fkOrphans = { episodes: fkEpisodes, seasons: fkSeasons }
          span.setAttribute('cleanup.fk_orphans.episodes', fkEpisodes)
          span.setAttribute('cleanup.fk_orphans.seasons', fkSeasons)
        } catch (error) {
          log.warn({ error: error.message }, 'FK-orphan check failed (non-fatal)')
        }
      }
      log.info(
        {
          syncRunId,
          movies:   { orphans: movieOrphans.length,   total: totals[0] },
          shows:    { orphans: showOrphans.length,    total: totals[1] },
          seasons:  { orphans: seasonOrphans.length,  total: totals[2] },
          episodes: { orphans: episodeOrphans.length, total: totals[3] },
          ...(fkOrphans ? { fkOrphans } : {}),
        },
        'Marker-based cleanup: orphan tally'
      )

      // ─── Phase D: Build legacy-shape `removed` arrays from orphan docs ──────
      // Same return shape as before so the cache invalidator and any SSE
      // subscribers don't need to change.
      // Gated on the final deleteEligible (post-coverage-gate AND post-breaker):
      // a collection we won't delete from must not appear in `removed`, or the
      // cache invalidator would evict entries for records still in the DB.
      const removed = {
        movies:    deleteEligible.movies    ? movieOrphans.map((m) => m.title) : [],
        tvShows:   deleteEligible.tvShows   ? showOrphans.map((s) => s.title) : [],
        tvSeasons: deleteEligible.tvSeasons ? seasonOrphans.map((sn) => `${sn.showTitle} Season ${sn.seasonNumber}`) : [],
        tvEpisodes: deleteEligible.tvEpisodes ? episodeOrphans.map((e) => `${e.showTitle} S${e.seasonNumber}E${e.episodeNumber}`) : [],
      }

      // ─── Phase E: Issue four parallel marker-based deleteMany calls ─────────
      // Each plans as a single IXSCAN on `sync_run_id_index`. No more in-memory
      // predicate iteration over 16k records, no $in arrays — every collection is
      // filtered independently by its own marker. (The marker-based deletes carry
      // no parent→child cascade; Phase E.2 below adds an explicit showId-keyed
      // cascade so a show delete can't leave orphaned children.)
      // Per-collection gated: only collections with proven-complete pre-tag
      // coverage are eligible for deletion (see the coverage gate above).
      //
      // Re-assert ownership before any destructive delete. If the orchestration
      // lock was force-released by the watchdog (this run's cleanup ran long) and
      // a newer run has since taken over — or no run holds it — this stale cleanup
      // must NOT delete: its syncRunId no longer reflects the live marker state,
      // so its orphanFilter ({ syncRunId: { $ne } }) would reap the newer run's
      // freshly re-tagged records (pre-tag doesn't bump updatedAt, so the R2
      // backstop can't catch them). Defer to the run that now holds the lock.
      const lockHolder = getSyncLockHolder()
      if (!lockHolder || lockHolder.syncRunId !== syncRunId) {
        log.error(
          { syncRunId, currentHolder: lockHolder?.syncRunId ?? null },
          'Orchestration lock no longer held by this run (watchdog force-release?) — skipping deletes to avoid racing a newer run'
        )
        span.setAttribute('cleanup.skipped', 'lock_lost')
        return { ...EMPTY_RESULT, removed: { ...EMPTY_RESULT.removed } }
      }
      await Promise.all([
        deleteEligible.movies ? db.collection('FlatMovies').deleteMany(orphanFilter) : Promise.resolve(),
        deleteEligible.tvShows ? db.collection('FlatTVShows').deleteMany(orphanFilter) : Promise.resolve(),
        deleteEligible.tvSeasons ? db.collection('FlatSeasons').deleteMany(orphanFilter) : Promise.resolve(),
        deleteEligible.tvEpisodes ? db.collection('FlatEpisodes').deleteMany(orphanFilter) : Promise.resolve(),
      ])

      // ─── Phase E.2: Cascade child deletes for removed shows ─────────────────
      // The FK-orphan bug came from deleting a show while its seasons/episodes
      // survived (their showId then dangled). Key the cascade on the precise show
      // _ids we just removed so it runs regardless of the children's own marker
      // coverage and cannot touch a live show's children. deletedShowIds is empty
      // unless tvShows is still delete-eligible (post coverage-gate AND breaker).
      const deletedShowIds = deleteEligible.tvShows ? showOrphans.map((s) => s._id) : []
      let cascadeRemoved = { seasons: 0, episodes: 0 }
      if (deletedShowIds.length > 0) {
        cascadeRemoved = await cascadeDeleteChildrenOfShows(db, deletedShowIds)
        if (cascadeRemoved.seasons || cascadeRemoved.episodes) {
          log.info(
            { syncRunId, deletedShows: deletedShowIds.length, ...cascadeRemoved },
            'Cascade-deleted children of removed shows'
          )
        }
      }

      const elapsedMs = Date.now() - startedAt
      log.info(
        {
          syncRunId,
          durationMs: elapsedMs,
          deleteEligible,
          movies: removed.movies.length,
          tvShows: removed.tvShows.length,
          tvSeasons: removed.tvSeasons.length,
          tvEpisodes: removed.tvEpisodes.length,
          cascade: cascadeRemoved,
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
