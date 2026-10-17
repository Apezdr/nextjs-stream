/**
 * New-content notices, once per run: after every server's pass, and after
 * post-sync cleanup has decided what is deleted (run/postSync runAfterSyncJobs).
 *
 * The candidates are the movies and episodes whose document a pass created
 * this run (run/writtenMedia), keyed by title, so a title two servers have is
 * one candidate. A created document is not necessarily new content:
 *
 *  - post-sync cleanup can delete a document whose title comes back later;
 *  - a show re-created under a new _id has every one of its episodes inserted
 *    again;
 *  - a first sync into an empty database, or a newly added server, creates a
 *    document for everything.
 *
 * What says whether the library has had a title before is the document's
 * `initialDiscoveryDate` (core/discovery): seeded when the document is
 * created, and moved only earlier, to the first-seen date the processor keeps
 * in the title's identity sidecar on the media volume (`mediaIdentity.firstSeen`,
 * per episode for TV). That date survives the document being deleted, so a
 * re-created document carries the day its title first arrived, not today.
 *
 * A candidate is announced when, read back after cleanup:
 *
 *  1. its document is still there: a title deleted this run is not announced;
 *  2. a list would show it (mediaVisibility.isWebVisible), so the notice never
 *     links to a title the app hides;
 *  3. its initialDiscoveryDate falls within NEW_CONTENT_WINDOW_MS of the run's
 *     start: the title first reached this library (any server's processor)
 *     within the last day;
 *  4. it is not in the ledger of titles announced within that same window. A
 *     title can be announced, deleted and re-created within a day of arriving,
 *     and then still carries a recent date: the ledger is what keeps it to one
 *     notice.
 *
 * What is left is handed to MediaNotificationOrchestrator.announceNewContent
 * in one call, which groups it (movies in fives, episodes by show) and sends
 * one digest instead when that would come to more than MAX_NOTICES_PER_RUN.
 *
 * Without the processor's first-seen date (an older processor, or a sidecar it
 * could not write) a document's date is the day it was created here, and a
 * re-created document beyond the ledger's window is announced again.
 */

import clientPromise from '@src/lib/mongodb'
import { createLogger, logError } from '@src/lib/logger'
import { isWebVisible } from '@src/utils/mediaVisibility'
import { MediaNotificationOrchestrator } from '@src/utils/notifications/MediaNotificationOrchestrator'
import { episodeKey, movieKey } from './writtenMedia'

/** How recently a title must have first arrived to be announced; also how long the ledger remembers a title. */
export const NEW_CONTENT_WINDOW_MS = 24 * 60 * 60 * 1000

/** More notices than this in one run are sent as one digest instead. */
export const MAX_NOTICES_PER_RUN = 5

/** The ledger of announced titles, in `app_config.syncInfo`. */
const LEDGER_ID = 'announcedContent'

/** The fields mediaVisibility.isWebVisible reads. */
const VISIBILITY_PROJECTION = { videoURL: 1, primaryContainer: 1, jitUrl: 1, jitEligible: 1, jitServeOverride: 1 }

function toDate(value) {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The created titles that are new to the library (rules 1 to 3 above), read
 * from the database as it stands after cleanup.
 *
 * @param {import('mongodb').Db} db - The media database
 * @param {Map<string, Object>} createdTitles - run/writtenMedia createdTitles
 * @param {Date} runStartedAt
 * @returns {Promise<{movies: Object[], episodes: Object[], gone: number, hidden: number, arrivedBefore: number}>}
 */
export async function selectNewContent(db, createdTitles, runStartedAt) {
  const since = runStartedAt.getTime() - NEW_CONTENT_WINDOW_MS
  const out = { movies: [], episodes: [], gone: 0, hidden: 0, arrivedBefore: 0 }
  /** Rules 2 and 3 for a document that is there. */
  const announceable = (doc) => {
    if (!isWebVisible(doc)) {
      out.hidden++
      return false
    }
    const arrived = toDate(doc.initialDiscoveryDate)
    if (!arrived || arrived.getTime() < since) {
      out.arrivedBefore++
      return false
    }
    return true
  }

  const candidates = [...(createdTitles?.values() ?? [])]
  const movieTitles = [...new Set(candidates.filter((c) => c.kind === 'movie').map((c) => c.originalTitle))]
  const episodeCandidates = candidates.filter((c) => c.kind === 'episode')

  if (movieTitles.length > 0) {
    const docs = await db
      .collection('FlatMovies')
      .find(
        { originalTitle: { $in: movieTitles } },
        { projection: { _id: 1, title: 1, originalTitle: 1, initialDiscoveryDate: 1, ...VISIBILITY_PROJECTION } }
      )
      .toArray()
    const byTitle = new Map(docs.map((doc) => [doc.originalTitle, doc]))
    for (const originalTitle of movieTitles) {
      const doc = byTitle.get(originalTitle)
      if (!doc) {
        out.gone++
        continue
      }
      if (!announceable(doc)) continue
      out.movies.push({
        key: movieKey(originalTitle),
        id: String(doc._id),
        title: doc.title || originalTitle,
        originalTitle,
        createdAt: toDate(doc.initialDiscoveryDate),
      })
    }
  }

  if (episodeCandidates.length > 0) {
    const showTitles = [...new Set(episodeCandidates.map((c) => c.showOriginalTitle))]
    const shows = await db
      .collection('FlatTVShows')
      .find({ originalTitle: { $in: showTitles } }, { projection: { _id: 1, title: 1, originalTitle: 1 } })
      .toArray()
    const showByTitle = new Map(shows.map((show) => [show.originalTitle, show]))
    const seasonNumbers = [...new Set(episodeCandidates.map((c) => c.seasonNumber))]
    const episodes = shows.length === 0
      ? []
      : await db
        .collection('FlatEpisodes')
        .find(
          { showId: { $in: shows.map((show) => show._id) }, seasonNumber: { $in: seasonNumbers } },
          {
            projection: {
              _id: 1, showId: 1, seasonNumber: 1, episodeNumber: 1, title: 1, initialDiscoveryDate: 1,
              ...VISIBILITY_PROJECTION,
            },
          }
        )
        .toArray()
    const episodeAt = new Map(
      episodes.map((ep) => [`${String(ep.showId)}:${ep.seasonNumber}:${ep.episodeNumber}`, ep])
    )
    for (const c of episodeCandidates) {
      const show = showByTitle.get(c.showOriginalTitle)
      const doc = show ? episodeAt.get(`${String(show._id)}:${c.seasonNumber}:${c.episodeNumber}`) : null
      if (!doc) {
        out.gone++
        continue
      }
      if (!announceable(doc)) continue
      out.episodes.push({
        key: episodeKey(c.showOriginalTitle, c.seasonNumber, c.episodeNumber),
        id: String(doc._id),
        showTitle: show.title || c.showOriginalTitle,
        originalTitle: c.showOriginalTitle,
        seasonNumber: c.seasonNumber,
        episodeNumber: c.episodeNumber,
        title: doc.title || null,
        createdAt: toDate(doc.initialDiscoveryDate),
      })
    }
  }

  return out
}

/** The titles announced within the window before `now`, by key. */
async function readLedger(syncInfo, now) {
  const doc = await syncInfo.findOne({ _id: LEDGER_ID })
  const since = now.getTime() - NEW_CONTENT_WINDOW_MS
  const ledger = new Map()
  for (const entry of doc?.entries ?? []) {
    const at = toDate(entry?.at)
    if (typeof entry?.key === 'string' && at && at.getTime() >= since) ledger.set(entry.key, at)
  }
  return ledger
}

async function writeLedger(syncInfo, ledger) {
  await syncInfo.replaceOne(
    { _id: LEDGER_ID },
    { _id: LEDGER_ID, entries: [...ledger].map(([key, at]) => ({ key, at })), updatedAt: new Date() },
    { upsert: true }
  )
}

/**
 * Announce the titles this run added to the library (see the module comment).
 * Throws only when the database cannot be read; the caller logs it.
 *
 * @param {Map<string, Object>} createdTitles - run/writtenMedia createdTitles
 * @param {Object} args
 * @param {Date|number} args.runStartedAt - When the run started
 * @param {string} [args.syncRunId] - For the log
 * @returns {Promise<Object>} What was considered and what was sent
 */
export async function announceNewContent(createdTitles, { runStartedAt, syncRunId } = {}) {
  // The component and messages the dashboards have read these lines under
  // since the notices ran inside each server's pass.
  const log = createLogger('FlatSync.NewArch')
  const startedAt = Date.now()
  const runStart = toDate(runStartedAt)
  if (!runStart) throw new Error('announceNewContent needs the run start time')

  const candidates = createdTitles?.size ?? 0
  log.info({ syncRunId, phase: 'notifications', candidates }, 'Starting notification processing')

  const result = { candidates, gone: 0, hidden: 0, arrivedBefore: 0, alreadyAnnounced: 0, movies: 0, episodes: 0, delivery: null }
  if (candidates > 0) {
    const client = await clientPromise
    const selection = await selectNewContent(client.db('Media'), createdTitles, runStart)
    Object.assign(result, { gone: selection.gone, hidden: selection.hidden, arrivedBefore: selection.arrivedBefore })

    const syncInfo = client.db('app_config').collection('syncInfo')
    const ledger = await readLedger(syncInfo, runStart)
    const notYetAnnounced = (item) => !ledger.has(item.key)
    const movies = selection.movies.filter(notYetAnnounced)
    const episodes = selection.episodes.filter(notYetAnnounced)
    result.alreadyAnnounced = selection.movies.length + selection.episodes.length - movies.length - episodes.length
    result.movies = movies.length
    result.episodes = episodes.length

    if (movies.length > 0 || episodes.length > 0) {
      result.delivery = await MediaNotificationOrchestrator.announceNewContent({ movies, episodes }, {
        generationOptions: {
          batchSimilarContent: true,
          maxMoviesPerNotification: 5,
          maxNotifications: MAX_NOTICES_PER_RUN,
          includeMetadata: true,
        },
        deliveryOptions: {
          targetAllUsers: true,
          checkDuplicates: true,
          duplicateWindow: NEW_CONTENT_WINDOW_MS,
        },
      })
      // Recorded whatever the delivery reported: nothing offers these titles
      // again, and a title must never be announced twice.
      for (const item of [...movies, ...episodes]) ledger.set(item.key, runStart)
      try {
        await writeLedger(syncInfo, ledger)
      } catch (error) {
        logError(log, error, { syncRunId, context: 'new_content_ledger' })
      }
    }
  }

  log.info(
    {
      syncRunId,
      phase: 'notifications',
      durationSec: parseFloat(((Date.now() - startedAt) / 1000).toFixed(2)),
      candidates,
      announced: { movies: result.movies, episodes: result.episodes },
      notAnnounced: {
        gone: result.gone,
        hidden: result.hidden,
        arrivedBefore: result.arrivedBefore,
        alreadyAnnounced: result.alreadyAnnounced,
      },
      notices: result.delivery?.summary?.totalGenerated ?? 0,
    },
    'Notification processing completed'
  )
  return result
}
