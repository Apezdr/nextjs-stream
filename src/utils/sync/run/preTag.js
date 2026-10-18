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
 *   architectures short-circuit when nothing has changed. In steady-state
 *   cycles where most records are unchanged, the per-write injection alone
 *   leaves coverage at ~0%, so pre-tag closes the gap with a small number of
 *   indexed bulk writes:
 *     - FlatMovies / FlatTVShows: one updateMany keyed by originalTitle
 *     - FlatSeasons: bulkWrite keyed by (showId, seasonNumber)
 *     - FlatEpisodes: bulkWrite keyed by (showId, seasonNumber, episodeNumber)
 *
 * RETURN CONTRACT (load-bearing for cleanup safety):
 *   Post-sync cleanup deletes records whose `syncRunId !== currentRun`. That is
 *   only safe if pre-tag PROVABLY stamped every server-present record this run.
 *   A transient Mongo connection drop can make a chunked bulkWrite throw partway,
 *   leaving a contiguous suffix of records un-stamped — which cleanup would then
 *   wrongly delete (the episode add/delete cascade). To make cleanup fail-CLOSED,
 *   pre-tag never returns a bare `null`/throw; it returns a structured
 *   per-collection coverage report. Cleanup deletes a collection ONLY when that
 *   collection's coverage is proven complete:
 *
 *     complete === true && needsSeen === opsBuilt && opsBuilt === opsCommitted
 *
 *   - needsSeen    : unique server-present records (raw key, BEFORE showId resolution)
 *   - opsBuilt     : records that resolved to a DB key (showId) and produced an op
 *   - opsCommitted : ops actually flushed to Mongo before any throw
 *
 *   needsSeen > opsBuilt   ⇒ a server-present record could not be keyed (e.g. a
 *     show whose originalTitle doesn't resolve to a FlatTVShows _id) — fail closed.
 *   opsBuilt  > opsCommitted ⇒ a chunk threw mid-flight — fail closed.
 *
 * @typedef {Object} PreTagCollectionCoverage
 * @property {boolean} complete      - true iff every op was built AND committed without throwing
 * @property {number}  needsSeen     - unique server-present records (before showId resolution)
 * @property {number}  opsBuilt      - records that resolved to a key and produced an op
 * @property {number}  opsCommitted  - ops actually flushed before any throw
 * @property {number}  modified      - sum of modifiedCount (observability only; NOT a coverage signal)
 * @property {string=} error
 *
 * @typedef {Object} PreTagResult
 * @property {boolean} ok           - true iff ALL collections are fully covered (the gate cleanup checks)
 * @property {boolean} skipped      - true iff there was no server data (nothing to tag / nothing to clean)
 * @property {string|null} syncRunId
 * @property {{movies:PreTagCollectionCoverage, shows:PreTagCollectionCoverage,
 *            seasons:PreTagCollectionCoverage, episodes:PreTagCollectionCoverage}} coverage
 * @property {number} durationMs
 */

import { createLogger, logError } from '@src/lib/logger'
import clientPromise from '@src/lib/mongodb'

// Transport-level transient errors observed in prod tearing down the pooled
// connection mid-bulkWrite: `connection N to <host>:27017 closed`, `read ECONNRESET`.
const RETRYABLE_MESSAGE = /connection .* closed|ECONNRESET|socket hang up|socket|network|pool (was )?(cleared|closed)|server is closed/i

function isTransient(error) {
  if (!error) return false
  if (
    typeof error.hasErrorLabel === 'function' &&
    (error.hasErrorLabel('TransientTransactionError') || error.hasErrorLabel('RetryableWriteError'))
  ) {
    return true
  }
  return RETRYABLE_MESSAGE.test(error.message || '')
}

/**
 * Retry `fn` on transient transport errors with linear backoff. The pre-tag
 * ops are `$set: { syncRunId }` (idempotent) and run with `{ ordered: false }`,
 * so re-applying a chunk is safe (no double-effect).
 */
async function withTransientRetry(fn, { tries = 3, baseMs = 150 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= tries || !isTransient(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, baseMs * attempt))
    }
  }
}

/** Coverage object for a collection that had zero server-present records. */
function emptyCoverage() {
  return { complete: true, needsSeen: 0, opsBuilt: 0, opsCommitted: 0, modified: 0 }
}

/** Fail-closed coverage — used when the run can't prove it stamped anything. */
function failClosedCoverage(error) {
  return { complete: false, needsSeen: 0, opsBuilt: 0, opsCommitted: 0, modified: 0, ...(error ? { error } : {}) }
}

/** A whole-result fail-closed report (cleanup will skip ALL deletes). */
function failClosedResult(syncRunId, startedAt, error) {
  const c = failClosedCoverage(error)
  return {
    ok: false,
    skipped: false,
    syncRunId: syncRunId ?? null,
    coverage: { movies: c, shows: c, seasons: c, episodes: c },
    durationMs: Date.now() - startedAt,
  }
}

/** A collection is safe to clean only when its coverage is provably complete. */
export function isCollectionFullyCovered(c) {
  return Boolean(c && c.complete && c.needsSeen === c.opsBuilt && c.opsBuilt === c.opsCommitted)
}

function summarize(coverage) {
  const out = {}
  for (const [k, c] of Object.entries(coverage)) {
    out[k] = {
      needsSeen: c.needsSeen,
      opsBuilt: c.opsBuilt,
      opsCommitted: c.opsCommitted,
      modified: c.modified,
      complete: c.complete,
      ...(c.unkeyable ? { unkeyable: c.unkeyable } : {}),
    }
  }
  return out
}

/**
 * @param {Object} allFileServers - { [serverId]: { movies, tv, ... } }
 * @param {string} syncRunId - The orchestration's syncRunId (already-set in syncContext).
 * @returns {Promise<PreTagResult>} Structured, fail-closed coverage report (never null).
 */
export async function preTagSyncRunId(allFileServers, syncRunId) {
  const log = createLogger('FlatSync.PreTag')
  const startedAt = Date.now()

  if (!syncRunId) {
    // Fail closed: without an id, cleanup must not delete anything this run.
    log.warn('preTagSyncRunId called without a syncRunId — returning fail-closed coverage')
    return failClosedResult(null, startedAt)
  }

  const client = await clientPromise
  const db = client.db('Media')

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
    return {
      ok: true,
      skipped: true,
      syncRunId,
      coverage: {
        movies: emptyCoverage(),
        shows: emptyCoverage(),
        seasons: emptyCoverage(),
        episodes: emptyCoverage(),
      },
      durationMs: Date.now() - startedAt,
    }
  }

  // ─── Resolve show originalTitle → _id for season/episode keying ─────────
  let titleToShowId
  try {
    const showsOnServer = showArr.length
      ? await withTransientRetry(() =>
          db.collection('FlatTVShows')
            .find({ originalTitle: { $in: showArr } }, { projection: { _id: 1, originalTitle: 1 } })
            .toArray()
        )
      : []
    titleToShowId = new Map(showsOnServer.map((s) => [s.originalTitle, s._id]))
  } catch (error) {
    // Can't resolve show ids ⇒ can't prove ANY tv coverage. Fail closed.
    logError(log, error, { syncRunId, context: 'pre_tag_failed' })
    return failClosedResult(syncRunId, startedAt, error.message)
  }

  // ─── updateMany coverage helper (movies/shows: keyed directly by originalTitle) ─
  const updateManyCoverage = async (collectionName, arr) => {
    const needsSeen = arr.length
    if (needsSeen === 0) return emptyCoverage()
    try {
      const r = await withTransientRetry(() =>
        db.collection(collectionName).updateMany({ originalTitle: { $in: arr } }, { $set: { syncRunId } })
      )
      // updateMany targets the entire $in set server-side; success ⇒ full coverage.
      return { complete: true, needsSeen, opsBuilt: needsSeen, opsCommitted: needsSeen, modified: r.modifiedCount ?? 0 }
    } catch (error) {
      return { complete: false, needsSeen, opsBuilt: needsSeen, opsCommitted: 0, modified: 0, error: error.message }
    }
  }

  // ─── Chunked bulkWrite coverage helper (seasons/episodes: keyed by showId) ─
  // `rawKey`  — server-side identity, independent of showId resolution (drives
  //             `needsSeen` + dedup). A record whose show can't be keyed still
  //             counts toward needsSeen but not opsBuilt ⇒ coverage incomplete.
  // `buildOp` — returns the updateOne op, or null if the record can't be keyed.
  // Ops are built incrementally and chunks released after each flush to keep the
  // live working set small (~chunkSize ops + the in-flight bulkWrite response).
  const streamChunkedCoverage = async (collectionName, needs, buildOp, rawKey, chunkSize = 1000, unkeyableLabelOf = null) => {
    const seen = new Set()
    let needsSeen = 0
    let opsBuilt = 0
    let opsCommitted = 0
    let modified = 0
    let unkeyable = 0
    const unkeyableShows = new Set()
    let batch = []
    const flush = async () => {
      if (!batch.length) return
      const ops = batch
      batch = [] // release before await so a throw never double-counts this chunk
      const r = await withTransientRetry(() => db.collection(collectionName).bulkWrite(ops, { ordered: false }))
      modified += r.modifiedCount ?? 0
      opsCommitted += ops.length
    }
    try {
      for (const need of needs) {
        const key = rawKey(need)
        if (key == null || seen.has(key)) continue
        seen.add(key)
        needsSeen++
        const op = buildOp(need)
        if (!op) {
          // Server-present but unkeyable: the parent show's originalTitle didn't
          // resolve to a FlatTVShows _id (the show is absent at pre-tag time, e.g.
          // it was deleted last run). Tracked so the perpetual-incompleteness driver
          // is named in logs. Coverage still stays fail-closed (this blocks deletes).
          unkeyable++
          if (unkeyableLabelOf && unkeyableShows.size < 50) {
            const label = unkeyableLabelOf(need)
            if (label) unkeyableShows.add(label)
          }
          continue
        }
        batch.push(op)
        opsBuilt++
        if (batch.length >= chunkSize) await flush()
      }
      await flush()
      return { complete: true, needsSeen, opsBuilt, opsCommitted, modified, unkeyable, unkeyableShows: [...unkeyableShows] }
    } catch (error) {
      return { complete: false, needsSeen, opsBuilt, opsCommitted, modified, unkeyable, unkeyableShows: [...unkeyableShows], error: error.message }
    }
  }

  const seasonBuilder = ({ origTitle, seasonNumber }) => {
    const showId = titleToShowId.get(origTitle)
    if (!showId) return null
    return { updateOne: { filter: { showId, seasonNumber }, update: { $set: { syncRunId } } } }
  }
  const seasonRawKey = ({ origTitle, seasonNumber }) => `${origTitle}|${seasonNumber}`

  const episodeBuilder = ({ origTitle, seasonNumber, episodeNumber }) => {
    const showId = titleToShowId.get(origTitle)
    if (!showId) return null
    return { updateOne: { filter: { showId, seasonNumber, episodeNumber }, update: { $set: { syncRunId } } } }
  }
  const episodeRawKey = ({ origTitle, seasonNumber, episodeNumber }) =>
    `${origTitle}|${seasonNumber}|${episodeNumber}`

  // Each helper catches its own transient/throw internally and returns a
  // coverage object, so one collection failing never aborts another's reporting.
  const [movies, shows, seasons, episodes] = await Promise.all([
    updateManyCoverage('FlatMovies', movieArr),
    updateManyCoverage('FlatTVShows', showArr),
    streamChunkedCoverage('FlatSeasons', seasonNeeds, seasonBuilder, seasonRawKey, 1000, ({ origTitle }) => origTitle),
    streamChunkedCoverage('FlatEpisodes', episodeNeeds, episodeBuilder, episodeRawKey, 1000, ({ origTitle }) => origTitle),
  ])

  const coverage = { movies, shows, seasons, episodes }
  const ok = Object.values(coverage).every(isCollectionFullyCovered)
  const result = { ok, skipped: false, syncRunId, coverage, durationMs: Date.now() - startedAt }

  if (ok) {
    log.info({ syncRunId, ...summarize(coverage) }, 'Pre-tagged Flat* records with current syncRunId')
  } else {
    const incomplete = Object.entries(coverage)
      .filter(([, c]) => !isCollectionFullyCovered(c))
      .map(([k]) => k)
    // Surface the shows whose absence at pre-tag time drove the incompleteness —
    // these are the originalTitles whose episodes/seasons couldn't be keyed because
    // their FlatTVShows doc was missing (the FK-orphan/_id-churn signature).
    const unkeyableDueToMissingShow = [
      ...new Set(Object.values(coverage).flatMap((c) => c.unkeyableShows || [])),
    ]
    logError(log, new Error('pre-tag incomplete'), {
      syncRunId,
      context: 'pre_tag_failed',
      ...summarize(coverage),
      incomplete,
      ...(unkeyableDueToMissingShow.length ? { unkeyableDueToMissingShow } : {}),
    })
    log.error(
      { syncRunId, incomplete, ...(unkeyableDueToMissingShow.length ? { unkeyableDueToMissingShow } : {}) },
      'Pre-tag INCOMPLETE — post-sync cleanup will SKIP deletes for affected collections'
    )
  }

  return result
}
