/**
 * New-content notices: which titles to announce, once per full run, after
 * every server's pass and after post-sync cleanup has decided what is deleted
 * (run/postSync runAfterSyncJobs). NOTIFICATION_FRAMEWORK_DESIGN.md
 * ("New-content notices: what ships") describes the same behaviour for
 * readers who do not read code; keep the two in step.
 *
 * THE ANNOUNCED SET. `Media.AnnouncedTitles` holds a document per key of
 * every title the library has announced, or already had when the set was
 * started (`_id` is the key, so it is unique). A title has one or two keys:
 *
 *  - its folder key: a movie's folder name (`movie:<originalTitle>`); an
 *    episode's show folder name and its numbers
 *    (`episode:<show originalTitle>:S<n>E<m>`);
 *  - its media key, when the processor gave it a durable identity
 *    (`media:<mediaId>`, a `mid:…` id that survives a folder rename).
 *
 * A title counts as announced when either key is in the set. A renamed movie
 * folder, or a renamed show folder (every episode), keeps its media key and is
 * not announced again; its new folder key is added to the set as well. What
 * still looks new: a renamed title without a durable identity, and an episode
 * whose numbers change (an episode's identity is its season and episode
 * numbers). A title removed from the library and added back later is not
 * announced again: its keys stay in the set.
 *
 * THE BASELINE. Until the set has been started on this database, nothing is
 * announced. The set is started by the first complete run: every enabled
 * server answered and every server's pass completed (tickSkip's
 * incompletePassReasons is empty). That run puts every movie and episode the
 * library holds after its writes into the set, hidden ones included, both
 * keys of each, and then leaves a flag (`new-content-baseline` in
 * app_config.migrations, migrations/runOnce). It announces nothing. An
 * incomplete run leaves the baseline to a later one, so a server that is down
 * cannot keep its titles out of the set and have them announced as new when
 * it returns. Seeding is idempotent; if it fails, no flag is written and the
 * next complete run seeds again. A library that is empty at that moment (a
 * fresh install whose first complete run found nothing) has an empty set, and
 * everything added after it is announced.
 *
 * AFTER THE BASELINE. Every full run, after cleanup, derives the candidates
 * from the library itself: every movie and episode a list would show
 * (mediaVisibility filters) and neither of whose keys is in the set or
 * waiting in the outbox. It does not depend on what the run wrote, so a title
 * is never lost to a failure between its write and its notice (a database
 * error here, a restart before the jobs ran): the next full run finds it
 * again. A title becomes a candidate whenever it becomes visible, however
 * that happens (its video arrives, the transcoder serves it, an admin
 * override). A title two servers have is one title. Nothing deleted in this
 * run is read back.
 *
 * DELIVERY AND RETRIES. The candidates' notices (composed by
 * MediaNotificationOrchestrator: movies five to a notice, episodes one per
 * show, one digest when that comes to more than MAX_NOTICES_PER_RUN) are
 * queued as one entry in `Media.NewContentOutbox` with every key of every
 * title in it. Every full run delivers every live entry, oldest first. A
 * delivered entry's keys go into the set and the entry is removed. A failed
 * one stays queued; after MAX_DELIVERY_ATTEMPTS failures it is marked dead,
 * logged once, and never tried again, and the TTL index removes it
 * DEAD_ENTRY_TTL_SECONDS later, after which its titles, if still not in the
 * set, are candidates again. A title is in at most one entry, live or dead,
 * so the outbox holds at most one entry per title still waiting, and gains at
 * most one entry per full run.
 *
 * A notification's `_id` is derived from the entry, the notice and the user
 * (MediaNotificationOrchestrator newContentNotificationId): delivering an
 * entry again inserts only what the last attempt did not, so no user gets a
 * notice twice. One exception: a notification a user dismissed (deleted)
 * after a partly successful attempt is inserted again by the next attempt.
 * An entry is delivered as it was queued; a title deleted while its notice
 * waits is still named in it.
 *
 * RECIPIENTS. notifications/recipients decides, in one place: approved
 * accounts without limited access.
 */

import { ObjectId } from 'mongodb'
import clientPromise from '@src/lib/mongodb'
import { createLogger, logError } from '@src/lib/logger'
import { visibleEpisodeFilter, visibleMovieFilter } from '@src/utils/mediaVisibility'
import { migrationApplied, runMigrationOnce } from '@src/utils/migrations/runOnce'
import { MediaNotificationOrchestrator } from '@src/utils/notifications/MediaNotificationOrchestrator'

/** The announced-titles set, in the media database. */
export const ANNOUNCED_TITLES = 'AnnouncedTitles'

/** Queued deliveries of new-content notices, in the media database. */
export const NEW_CONTENT_OUTBOX = 'NewContentOutbox'

/** The baseline's flag in app_config.migrations. */
export const NEW_CONTENT_BASELINE_MIGRATION = 'new-content-baseline'

/** More notices than this in one run are sent as one digest instead. */
export const MAX_NOTICES_PER_RUN = 5

/** Failed deliveries of an outbox entry before it is marked dead. */
export const MAX_DELIVERY_ATTEMPTS = 10

/** How long a dead outbox entry is kept (a TTL index on deadAt removes it). */
export const DEAD_ENTRY_TTL_SECONDS = 30 * 24 * 60 * 60

const SET_BATCH_SIZE = 1000

/** A movie's folder key. */
export const movieKey = (originalTitle) => `movie:${originalTitle}`

/** An episode's folder key: its show's folder name and its numbers. */
export const episodeKey = (showOriginalTitle, seasonNumber, episodeNumber) =>
  `episode:${showOriginalTitle}:S${seasonNumber}E${episodeNumber}`

/** A title's media key, from the processor's durable identity; null without one. */
export const mediaKey = (mediaId) => (typeof mediaId === 'string' && mediaId.startsWith('mid:') ? `media:${mediaId}` : null)

const kindOfKey = (key) => (key.startsWith('movie:') ? 'movie' : key.startsWith('episode:') ? 'episode' : 'media')

/** The TTL index that removes dead outbox entries. Once per process (on globalThis, shared by every bundle); never throws. */
function ensureOutboxIndex(db, log) {
  globalThis.__newContentOutboxIndex ??= db
    .collection(NEW_CONTENT_OUTBOX)
    .createIndex({ deadAt: 1 }, { name: 'deadAt_ttl', expireAfterSeconds: DEAD_ENTRY_TTL_SECONDS })
    .catch((err) => log.error({ err, indexName: 'deadAt_ttl' }, 'Could not ensure the new-content outbox index'))
  return globalThis.__newContentOutboxIndex
}

/** Put keys into the set (an upsert: a key already there is left as it was). */
async function addToAnnouncedSet(db, keys, by, at) {
  for (let i = 0; i < keys.length; i += SET_BATCH_SIZE) {
    const batch = keys.slice(i, i + SET_BATCH_SIZE)
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
 * The movies and episodes in the library, each with its keys and what a notice
 * says about it. An episode whose show is gone has no folder key and no page,
 * and is left out.
 *
 * @param {import('mongodb').Db} db - The media database
 * @param {Object} args
 * @param {boolean} args.visibleOnly - Only what a list would show (the candidates); else everything (the baseline)
 * @returns {Promise<Array<{kind: 'movie'|'episode', keys: string[], item: Object}>>}
 */
export async function readLibrary(db, { visibleOnly }) {
  const [movies, shows, episodes] = await Promise.all([
    db
      .collection('FlatMovies')
      .find(visibleOnly ? visibleMovieFilter() : {}, {
        projection: { _id: 1, title: 1, originalTitle: 1, mediaId: 1, posterURL: 1, initialDiscoveryDate: 1 },
      })
      .toArray(),
    db.collection('FlatTVShows').find({}, { projection: { _id: 1, title: 1, originalTitle: 1, posterURL: 1 } }).toArray(),
    db
      .collection('FlatEpisodes')
      .find(visibleOnly ? visibleEpisodeFilter() : {}, {
        projection: {
          _id: 1, showId: 1, seasonNumber: 1, episodeNumber: 1, title: 1, mediaId: 1, initialDiscoveryDate: 1,
        },
      })
      .toArray(),
  ])

  const titles = []
  const withMediaKey = (folder, mediaId) => [folder, mediaKey(mediaId)].filter(Boolean)
  for (const doc of movies) {
    if (typeof doc.originalTitle !== 'string') continue
    const key = movieKey(doc.originalTitle)
    titles.push({
      kind: 'movie',
      keys: withMediaKey(key, doc.mediaId),
      item: {
        key,
        id: String(doc._id),
        title: doc.title || doc.originalTitle,
        originalTitle: doc.originalTitle,
        posterURL: doc.posterURL || null,
        createdAt: doc.initialDiscoveryDate ?? null,
      },
    })
  }
  const showById = new Map(shows.map((show) => [String(show._id), show]))
  for (const doc of episodes) {
    const show = showById.get(String(doc.showId))
    if (typeof show?.originalTitle !== 'string' || doc.seasonNumber == null || doc.episodeNumber == null) continue
    const key = episodeKey(show.originalTitle, doc.seasonNumber, doc.episodeNumber)
    titles.push({
      kind: 'episode',
      keys: withMediaKey(key, doc.mediaId),
      item: {
        key,
        id: String(doc._id),
        showTitle: show.title || show.originalTitle,
        originalTitle: show.originalTitle,
        showPosterURL: show.posterURL || null,
        seasonNumber: doc.seasonNumber,
        episodeNumber: doc.episodeNumber,
        title: doc.title || null,
        createdAt: doc.initialDiscoveryDate ?? null,
      },
    })
  }
  return titles
}

/**
 * The baseline: every movie and episode in the library, hidden ones
 * included, both keys of each, into the set. Idempotent.
 *
 * @param {import('mongodb').Db} db - The media database
 * @returns {Promise<{movies: number, episodes: number, keys: number}>}
 */
export async function seedAnnouncedTitles(db) {
  const library = await readLibrary(db, { visibleOnly: false })
  const keys = library.flatMap((title) => title.keys)
  await addToAnnouncedSet(db, keys, 'baseline', new Date())
  return {
    movies: library.filter((title) => title.kind === 'movie').length,
    episodes: library.filter((title) => title.kind === 'episode').length,
    keys: keys.length,
  }
}

/**
 * Deliver every live entry, oldest first. A delivered entry's keys go into
 * the set and the entry is removed; a failed one stays, and is marked dead at
 * its MAX_DELIVERY_ATTEMPTS-th failure.
 */
async function deliverQueued(db, log, syncRunId) {
  const outbox = db.collection(NEW_CONTENT_OUTBOX)
  const entries = await outbox.find({ state: { $ne: 'dead' } }).sort({ createdAt: 1 }).toArray()
  const result = { delivered: 0, failed: 0, died: 0, notificationsInserted: 0 }
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
      const attempts = (entry.attempts ?? 0) + 1
      const dead = attempts >= MAX_DELIVERY_ATTEMPTS
      const context = { syncRunId, deliveryId: String(entry._id), attempts, context: 'new_content_delivery' }
      logError(log, error, context)
      if (dead) {
        result.died++
        log.error(
          { ...context, titles: (entry.titleKeys ?? []).length },
          `Gave up delivering new-content notices after ${attempts} attempts; the entry expires in 30 days and its titles are found again after that`
        )
      }
      try {
        await outbox.updateOne(
          { _id: entry._id },
          {
            $set: {
              attempts,
              lastError: error?.message ?? String(error),
              lastAttemptAt: new Date(),
              ...(dead ? { state: 'dead', deadAt: new Date() } : {}),
            },
          }
        )
      } catch {
        // The entry stays queued either way
      }
    }
  }
  return result
}

/**
 * Announce what the library gained, and deliver anything still queued (see
 * the module comment). Throws when the database cannot be read or written;
 * the caller logs it, and the next full run finds the same titles again.
 *
 * @param {Object} args
 * @param {string} [args.syncRunId] - For the log
 * @param {string[]} [args.incompleteReasons] - Why this run was not complete
 *   (tickSkip incompletePassReasons); empty when it was. Only a complete run
 *   may start the set.
 * @returns {Promise<Object>} What was considered, queued and delivered
 */
export async function announceNewContent({ syncRunId, incompleteReasons = [] } = {}) {
  // The component and messages the dashboards have read these lines under
  // since the notices ran inside each server's pass.
  const log = createLogger('FlatSync.NewArch')
  const startedAt = Date.now()
  log.info({ syncRunId, phase: 'notifications' }, 'Starting notification processing')

  const client = await clientPromise
  const db = client.db('Media')
  await ensureOutboxIndex(db, log)
  const result = {
    baseline: null,
    library: 0,
    candidates: 0,
    alreadyAnnounced: 0,
    alreadyQueued: 0,
    aliasesAdded: 0,
    queued: { movies: 0, episodes: 0, notices: 0 },
    delivery: null,
    scanMs: null,
  }

  const runComplete = incompleteReasons.length === 0
  let baselineReady
  if (runComplete) {
    const baseline = await runMigrationOnce(client, NEW_CONTENT_BASELINE_MIGRATION, () => seedAnnouncedTitles(db))
    if (baseline.applied) {
      // The run that starts the set announces nothing
      result.baseline = baseline.result
      log.info({ syncRunId, seeded: baseline.result }, 'Started the announced-titles set from the library; nothing announced this run')
    }
    baselineReady = !baseline.applied
  } else {
    baselineReady = await migrationApplied(client, NEW_CONTENT_BASELINE_MIGRATION)
    if (!baselineReady) {
      result.baseline = { waiting: incompleteReasons }
      log.info(
        { syncRunId, reasons: incompleteReasons },
        'The announced-titles set is not started yet and this run was not complete; nothing announced'
      )
    }
  }

  if (baselineReady) {
    // The candidates: everything visible, minus what the set and the outbox hold
    const scanStartedAt = Date.now()
    const [library, announced, queued] = await Promise.all([
      readLibrary(db, { visibleOnly: true }),
      db.collection(ANNOUNCED_TITLES).find({}, { projection: { _id: 1 } }).toArray(),
      db.collection(NEW_CONTENT_OUTBOX).find({}, { projection: { titleKeys: 1 } }).toArray(),
    ])
    const announcedKeys = new Set(announced.map((doc) => doc._id))
    const queuedKeys = new Set(queued.flatMap((entry) => entry.titleKeys ?? []))
    result.scanMs = Date.now() - scanStartedAt
    result.library = library.length

    const fresh = []
    const aliases = []
    for (const title of library) {
      const inSet = title.keys.filter((key) => announcedKeys.has(key))
      if (inSet.length > 0) {
        result.alreadyAnnounced++
        // Announced under its other key (a renamed folder, an identity that
        // arrived later): record this one too
        aliases.push(...title.keys.filter((key) => !announcedKeys.has(key)))
      } else if (title.keys.some((key) => queuedKeys.has(key))) {
        result.alreadyQueued++
      } else {
        fresh.push(title)
      }
    }
    result.candidates = fresh.length

    if (aliases.length > 0) {
      await addToAnnouncedSet(db, aliases, 'alias', new Date())
      result.aliasesAdded = aliases.length
    }

    const movies = fresh.filter((title) => title.kind === 'movie').map((title) => title.item)
    const episodes = fresh.filter((title) => title.kind === 'episode').map((title) => title.item)
    const notices = MediaNotificationOrchestrator.composeNewContentNotices(
      { movies, episodes },
      { batchSimilarContent: true, maxMoviesPerNotification: 5, maxNotifications: MAX_NOTICES_PER_RUN, includeMetadata: true }
    )
    if (notices.length > 0) {
      await db.collection(NEW_CONTENT_OUTBOX).insertOne({
        _id: new ObjectId(),
        state: 'pending',
        titleKeys: fresh.flatMap((title) => title.keys),
        notices,
        syncRunId: syncRunId ?? null,
        createdAt: new Date(),
        attempts: 0,
      })
      result.queued = { movies: movies.length, episodes: episodes.length, notices: notices.length }
    }

    result.delivery = await deliverQueued(db, log, syncRunId)
  }

  log.info(
    {
      syncRunId,
      phase: 'notifications',
      durationSec: parseFloat(((Date.now() - startedAt) / 1000).toFixed(2)),
      ...result,
    },
    'Notification processing completed'
  )
  return result
}
