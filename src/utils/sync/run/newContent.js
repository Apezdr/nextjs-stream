/**
 * New-content notices: which titles to announce, once per run, after every
 * server's pass and after post-sync cleanup has decided what is deleted
 * (run/postSync runAfterSyncJobs). NOTIFICATION_FRAMEWORK_DESIGN.md
 * ("New-content notices: what ships") describes the same behaviour for
 * readers who do not read code; keep the two in step.
 *
 * THE ANNOUNCED SET. `Media.AnnouncedTitles` holds one document per title the
 * library has ever announced, or already had when the set was started. Its
 * `_id` is the title's key, built from folder names and never from a document
 * `_id` (run/writtenMedia movieKey / episodeKey): a movie's originalTitle; an
 * episode's show originalTitle, season and episode. `_id` makes the key unique.
 * A title is announced at most once, ever: a title removed from the library and
 * added back later keeps its key in the set and is not announced again.
 *
 * THE BASELINE. Until the set has been started on this database, a run
 * announces nothing: it puts every movie and episode the library holds after
 * that run's writes into the set — hidden ones included, so a title that was
 * already here is never news later — and then leaves a flag
 * (`new-content-baseline` in app_config.migrations, migrations/runOnce). That
 * covers an upgrade (the existing library is seeded, nothing is announced) and
 * a fresh install (the first sync into an empty database announces nothing).
 * Seeding is idempotent; if it fails, no flag is written, nothing is
 * announced, and the next run seeds again.
 *
 * AFTER THE BASELINE. The candidates are every movie and episode a pass wrote
 * this run, created or updated (run/writtenMedia writtenTitles); a title whose
 * pass was skipped on its gate is not one. A candidate is announced when, read
 * back after cleanup:
 *
 *  1. its document is still there (a title deleted this run is not announced);
 *  2. a list would show it (mediaVisibility.isWebVisible): a title that becomes
 *     visible later — a folder that appears before its video, a container that
 *     needed the transcoder — is announced when it does;
 *  3. its key is neither in the set nor waiting in the outbox.
 *
 * A title two servers have is one candidate (the keys are the folder names).
 *
 * DELIVERY AND RETRIES. The notices for a run's titles (composed by
 * MediaNotificationOrchestrator: movies five to a notice, episodes one per
 * show, one digest when that comes to more than MAX_NOTICES_PER_RUN) are queued
 * as one entry in `Media.NewContentOutbox`, with the keys they announce. Every
 * run then delivers every queued entry, oldest first, whether or not that run
 * wrote anything. An entry that delivers is removed, and only then do its keys
 * go into the set. One that fails stays queued, and the next run delivers it
 * again. Nothing is lost: the keys are in the outbox until the set has them.
 * Nothing is sent twice: a notification's `_id` is derived from the entry, the
 * notice and the user (MediaNotificationOrchestrator newContentNotificationId),
 * so delivering an entry again adds only what the last attempt did not, and a
 * key waiting in the outbox is never queued a second time. An entry is
 * delivered as it was queued (a title deleted while its notice waits is still
 * in it).
 *
 * RECIPIENTS. notifications/recipients decides, in one place: approved accounts
 * without limited access.
 */

import { ObjectId } from 'mongodb'
import clientPromise from '@src/lib/mongodb'
import { createLogger, logError } from '@src/lib/logger'
import { isWebVisible } from '@src/utils/mediaVisibility'
import { runMigrationOnce } from '@src/utils/migrations/runOnce'
import { MediaNotificationOrchestrator } from '@src/utils/notifications/MediaNotificationOrchestrator'
import { episodeKey, movieKey } from './writtenMedia'

/** The announced-titles set, in the media database. */
export const ANNOUNCED_TITLES = 'AnnouncedTitles'

/** Queued deliveries of new-content notices, in the media database. */
export const NEW_CONTENT_OUTBOX = 'NewContentOutbox'

/** The baseline's flag in app_config.migrations. */
export const NEW_CONTENT_BASELINE_MIGRATION = 'new-content-baseline'

/** More notices than this in one run are sent as one digest instead. */
export const MAX_NOTICES_PER_RUN = 5

const SEED_BATCH_SIZE = 1000

/** The fields mediaVisibility.isWebVisible reads. */
const VISIBILITY_PROJECTION = { videoURL: 1, primaryContainer: 1, jitUrl: 1, jitEligible: 1, jitServeOverride: 1 }

const kindOfKey = (key) => (key.startsWith('movie:') ? 'movie' : 'episode')

/** Put keys into the set (an upsert: a key already there is left as it was). */
async function addToAnnouncedSet(db, keys, by, at) {
  for (let i = 0; i < keys.length; i += SEED_BATCH_SIZE) {
    const batch = keys.slice(i, i + SEED_BATCH_SIZE)
    await db.collection(ANNOUNCED_TITLES).bulkWrite(
      batch.map((key) => ({
        updateOne: {
          filter: { _id: key },
          update: { $setOnInsert: { kind: kindOfKey(key), by, announcedAt: at } },
          upsert: true,
        },
      })),
      { ordered: false }
    )
  }
}

/**
 * The baseline: every movie and episode in the library, hidden ones included,
 * into the set. Idempotent.
 *
 * @param {import('mongodb').Db} db - The media database
 * @returns {Promise<{movies: number, episodes: number}>}
 */
export async function seedAnnouncedTitles(db) {
  const movies = await db.collection('FlatMovies').find({}, { projection: { _id: 0, originalTitle: 1 } }).toArray()
  const shows = await db.collection('FlatTVShows').find({}, { projection: { _id: 1, originalTitle: 1 } }).toArray()
  const showTitleById = new Map(shows.map((show) => [String(show._id), show.originalTitle]))
  const episodes = await db
    .collection('FlatEpisodes')
    .find({}, { projection: { _id: 0, showId: 1, seasonNumber: 1, episodeNumber: 1 } })
    .toArray()

  const movieKeys = movies.filter((m) => typeof m.originalTitle === 'string').map((m) => movieKey(m.originalTitle))
  const episodeKeys = []
  for (const ep of episodes) {
    const showTitle = showTitleById.get(String(ep.showId))
    // An episode whose show is gone has no folder name to key it by
    if (typeof showTitle === 'string' && ep.seasonNumber != null && ep.episodeNumber != null) {
      episodeKeys.push(episodeKey(showTitle, ep.seasonNumber, ep.episodeNumber))
    }
  }
  await addToAnnouncedSet(db, [...movieKeys, ...episodeKeys], 'baseline', new Date())
  return { movies: movieKeys.length, episodes: episodeKeys.length }
}

/**
 * The written titles that exist and that a list would show (rules 1 and 2),
 * read from the database as it stands after cleanup.
 *
 * @param {import('mongodb').Db} db - The media database
 * @param {Map<string, Object>} writtenTitles - run/writtenMedia writtenTitles
 * @returns {Promise<{movies: Object[], episodes: Object[], gone: number, hidden: number}>}
 */
export async function selectAnnounceable(db, writtenTitles) {
  const out = { movies: [], episodes: [], gone: 0, hidden: 0 }
  const candidates = [...(writtenTitles?.values() ?? [])]
  const movieTitles = [...new Set(candidates.filter((c) => c.kind === 'movie').map((c) => c.originalTitle))]
  const episodeCandidates = candidates.filter((c) => c.kind === 'episode')

  if (movieTitles.length > 0) {
    const docs = await db
      .collection('FlatMovies')
      .find(
        { originalTitle: { $in: movieTitles } },
        { projection: { _id: 1, title: 1, originalTitle: 1, posterURL: 1, initialDiscoveryDate: 1, ...VISIBILITY_PROJECTION } }
      )
      .toArray()
    const byTitle = new Map(docs.map((doc) => [doc.originalTitle, doc]))
    for (const originalTitle of movieTitles) {
      const doc = byTitle.get(originalTitle)
      if (!doc) out.gone++
      else if (!isWebVisible(doc)) out.hidden++
      else {
        out.movies.push({
          key: movieKey(originalTitle),
          id: String(doc._id),
          title: doc.title || originalTitle,
          originalTitle,
          posterURL: doc.posterURL || null,
          createdAt: doc.initialDiscoveryDate ?? null,
        })
      }
    }
  }

  if (episodeCandidates.length > 0) {
    const showTitles = [...new Set(episodeCandidates.map((c) => c.showOriginalTitle))]
    const shows = await db
      .collection('FlatTVShows')
      .find({ originalTitle: { $in: showTitles } }, { projection: { _id: 1, title: 1, originalTitle: 1, posterURL: 1 } })
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
      if (!doc) out.gone++
      else if (!isWebVisible(doc)) out.hidden++
      else {
        out.episodes.push({
          key: episodeKey(c.showOriginalTitle, c.seasonNumber, c.episodeNumber),
          id: String(doc._id),
          showTitle: show.title || c.showOriginalTitle,
          originalTitle: c.showOriginalTitle,
          showPosterURL: show.posterURL || null,
          seasonNumber: c.seasonNumber,
          episodeNumber: c.episodeNumber,
          title: doc.title || null,
          createdAt: doc.initialDiscoveryDate ?? null,
        })
      }
    }
  }

  return out
}

/**
 * Deliver every queued entry, oldest first. A delivered entry's keys go into
 * the set and the entry is removed; a failed one stays for the next run.
 */
async function deliverQueued(db, log, syncRunId) {
  const outbox = db.collection(NEW_CONTENT_OUTBOX)
  const entries = await outbox.find({}).sort({ createdAt: 1 }).toArray()
  const result = { delivered: 0, failed: 0, notificationsInserted: 0 }
  for (const entry of entries) {
    try {
      const delivery = await MediaNotificationOrchestrator.deliverNewContentNotices(entry.notices ?? [], String(entry._id))
      // Delivered: only now are its titles announced
      await addToAnnouncedSet(db, entry.titleKeys ?? [], 'notice', new Date())
      await outbox.deleteOne({ _id: entry._id })
      result.delivered++
      result.notificationsInserted += delivery.inserted
    } catch (error) {
      result.failed++
      logError(log, error, { syncRunId, deliveryId: String(entry._id), attempts: (entry.attempts ?? 0) + 1, context: 'new_content_delivery' })
      try {
        await outbox.updateOne(
          { _id: entry._id },
          { $set: { attempts: (entry.attempts ?? 0) + 1, lastError: error?.message ?? String(error), lastAttemptAt: new Date() } }
        )
      } catch {
        // The entry stays queued either way
      }
    }
  }
  return result
}

/**
 * Announce what this run added to the library, and deliver anything still
 * queued from earlier runs (see the module comment). Throws only when the
 * database cannot be read or the baseline cannot be seeded; the caller logs
 * it, and nothing new is queued.
 *
 * @param {Map<string, Object>} writtenTitles - run/writtenMedia writtenTitles
 * @param {Object} args
 * @param {string} [args.syncRunId] - For the log
 * @returns {Promise<Object>} What was considered, queued and delivered
 */
export async function announceNewContent(writtenTitles, { syncRunId } = {}) {
  // The component and messages the dashboards have read these lines under
  // since the notices ran inside each server's pass.
  const log = createLogger('FlatSync.NewArch')
  const startedAt = Date.now()
  const candidates = writtenTitles?.size ?? 0
  log.info({ syncRunId, phase: 'notifications', candidates }, 'Starting notification processing')

  const client = await clientPromise
  const db = client.db('Media')
  const result = {
    candidates,
    baseline: null,
    gone: 0,
    hidden: 0,
    alreadyAnnounced: 0,
    alreadyQueued: 0,
    queued: { movies: 0, episodes: 0, notices: 0 },
    delivery: null,
  }

  const baseline = await runMigrationOnce(client, NEW_CONTENT_BASELINE_MIGRATION, () => seedAnnouncedTitles(db))
  if (baseline.applied) {
    // The run that starts the set announces nothing
    result.baseline = baseline.result
    log.info({ syncRunId, seeded: baseline.result }, 'Started the announced-titles set from the library; nothing announced this run')
  } else {
    if (candidates > 0) {
      const selection = await selectAnnounceable(db, writtenTitles)
      Object.assign(result, { gone: selection.gone, hidden: selection.hidden })
      const items = [...selection.movies, ...selection.episodes]
      const keys = items.map((item) => item.key)
      const announced = keys.length === 0
        ? []
        : await db.collection(ANNOUNCED_TITLES).find({ _id: { $in: keys } }, { projection: { _id: 1 } }).toArray()
      const announcedKeys = new Set(announced.map((doc) => doc._id))
      const queuedKeys = new Set(
        keys.length === 0
          ? []
          : (await db.collection(NEW_CONTENT_OUTBOX).find({}, { projection: { titleKeys: 1 } }).toArray())
            .flatMap((entry) => entry.titleKeys ?? [])
      )
      const fresh = (item) => !announcedKeys.has(item.key) && !queuedKeys.has(item.key)
      const movies = selection.movies.filter(fresh)
      const episodes = selection.episodes.filter(fresh)
      result.alreadyAnnounced = items.filter((item) => announcedKeys.has(item.key)).length
      result.alreadyQueued = items.filter((item) => !announcedKeys.has(item.key) && queuedKeys.has(item.key)).length

      const notices = MediaNotificationOrchestrator.composeNewContentNotices(
        { movies, episodes },
        { batchSimilarContent: true, maxMoviesPerNotification: 5, maxNotifications: MAX_NOTICES_PER_RUN, includeMetadata: true }
      )
      if (notices.length > 0) {
        await db.collection(NEW_CONTENT_OUTBOX).insertOne({
          _id: new ObjectId(),
          titleKeys: [...movies, ...episodes].map((item) => item.key),
          notices,
          syncRunId: syncRunId ?? null,
          createdAt: new Date(),
          attempts: 0,
        })
        result.queued = { movies: movies.length, episodes: episodes.length, notices: notices.length }
      }
    }
    result.delivery = await deliverQueued(db, log, syncRunId)
  }

  log.info(
    {
      syncRunId,
      phase: 'notifications',
      durationSec: parseFloat(((Date.now() - startedAt) / 1000).toFixed(2)),
      candidates,
      baseline: result.baseline,
      queued: result.queued,
      notAnnounced: {
        gone: result.gone,
        hidden: result.hidden,
        alreadyAnnounced: result.alreadyAnnounced,
        alreadyQueued: result.alreadyQueued,
      },
      delivery: result.delivery,
    },
    'Notification processing completed'
  )
  return result
}
