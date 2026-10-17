/**
 * One file server's pass over the flat collections.
 *
 * syncAllServers runs one pass per server, one server at a time, inside the
 * orchestration lock: after pre-tag, before post-sync cleanup. A pass, top to
 * bottom:
 *
 *   1. config: the server's settings in the shape the services read, one copy
 *      for movies and TV. A server with no baseURL, or whose priority is not a
 *      number, fails here: ownership ranks servers on priority, and a guessed
 *      one would hand fields to the wrong server.
 *   2. movies: every movie the payload lists, through MovieSyncService.
 *   3. TV: every show, with its seasons and episodes, through TVShowSyncService.
 *      Movies and shows share one pool, as wide as the ResourceManager's
 *      syncConcurrency; the last movie finishes before the first show starts.
 *   4. results: per kind, what was processed, skipped or failed, and the
 *      entities the pass changed (post-sync cache invalidation).
 *   5. this server's side jobs: new-content notifications, the PlaybackStatus
 *      migration and the watch-history validation.
 *
 * Failures. A title that fails is a failed result and the pass goes on: the
 * failure is counted, so run/tickSkip does not record the pass as complete.
 * The config check throws to the caller. An error anywhere else in steps 2 to
 * 5 ends the pass with an entry in its `errors`; run/tickSkip does not record
 * that pass either. The side jobs keep their own catches: they never failed a
 * pass, and run/tickSkip does not count them.
 */

import pLimit from 'p-limit'
import { performance } from 'perf_hooks'
import {
  MediaType,
  SyncOperation,
  SyncStatus,
  resolveCleanupConfig,
  type FieldAvailability,
  type ServerConfig,
  type SyncContext,
  type SyncResult,
} from '../core'
import { syncLogger } from '../core/logger'
import { ResourceManager } from '../core/ResourceManager'
import { createDatabaseAdapter } from '../infrastructure'
import {
  BlurhashStrategy,
  MovieAssetStrategy,
  MovieContentStrategy,
  MovieMetadataStrategy,
  MovieSyncService,
} from '../domain'
import { EpisodeSyncService, SeasonSyncService, TVShowSyncService } from '../domain/tv'
import { createLogger, logError } from '@src/lib/logger'
import { MediaNotificationOrchestrator } from '@src/utils/notifications/MediaNotificationOrchestrator'
import { migratePlaybackStatusIfNeeded } from '@src/utils/watchHistory/migrate'
import { validateWatchHistoryAgainstDatabase } from './watchHistoryValidation'

/** A server's settings as syncAllServers hands them over: its id plus `fileServer.config`. */
export interface ServerPassConfig {
  id: string
  baseURL?: string
  prefixPath?: string
  syncEndpoint?: string
  internalEndpoint?: string
  priority?: unknown
}

export interface ServerPassOptions {
  forceSync?: boolean
  /** True only when every enabled file server answered this run. */
  allEnabledServersProbed?: boolean
}

interface KindResults {
  processed: number
  errors: number
  details: any[]
  skipped?: number
}

/** Display titles of what the pass changed, for post-sync cache invalidation. */
interface ChangedMedia {
  movies: string[]
  shows: string[]
  seasons: Array<{ title: string; season: number }>
  episodes: Array<{ title: string; season: number; episode: number }>
}

export interface ServerPassResult {
  movies: KindResults
  episodes: KindResults
  seasons: KindResults
  tvShows: KindResults
  performance: { startTime: Date; endTime: Date | null; duration: number }
  notifications: any
  errors: Array<{ phase: string; error: unknown; stack?: string; serverId: string }>
  migration: { completed: boolean; error?: string } | null
  watchHistoryValidation: any
  changedMedia: ChangedMedia
}

type TitleHashes = {
  hash: string
  titles: Record<string, { hash: string; contentHash?: string; lastModified: string; generated: string }>
}

/** The four movie operations every pass runs, in this order. */
const MOVIE_OPERATIONS = [SyncOperation.Metadata, SyncOperation.Assets, SyncOperation.Content, SyncOperation.Blurhash]

/**
 * Run one file server's pass. See the module comment for the steps, and for
 * which errors are caught and which reach the caller.
 *
 * @param fileServer - The server's payloads (`movies`, `tv`) and its `config`
 * @param config - `{ id, ...fileServer.config }`
 * @param fieldAvailability - Which servers report which field, for every server that answered
 */
export async function runServerPass(
  fileServer: any,
  config: ServerPassConfig,
  fieldAvailability: FieldAvailability,
  options: ServerPassOptions = {}
): Promise<ServerPassResult> {
  // The component names the dashboards and the sync verifier read these
  // lines under; they predate this module.
  const log = createLogger('FlatSync.NewArch')
  const forceSync = Boolean(options.forceSync)
  const allEnabledServersProbed = options.allEnabledServersProbed === true

  // ---- 1. Config ----
  log.info({ serverId: config?.id, architecture: 'new', forceSync }, 'Starting NEW architecture sync')
  let serverConfig: ServerConfig
  try {
    serverConfig = toServerConfig(config)
  } catch (error) {
    logError(log, error, { serverId: config?.id, context: 'server_config_validation' })
    throw error
  }
  log.info({ serverId: serverConfig.id, baseURL: serverConfig.baseUrl }, 'Server config validated')

  const startTime = Date.now()
  const results = emptyResults()

  try {
    const { movieService, tvShowService } = await createServices()
    const resourceManager = ResourceManager.getInstance()
    const pool = pLimit(resourceManager.config.syncConcurrency)

    // ---- 2. Movies ----
    const movieTitles = extractMovieTitles(fileServer)
    if (movieTitles.length > 0) {
      log.info(
        { serverId: serverConfig.id, movieCount: movieTitles.length, architecture: 'new' },
        'Processing movies with new architecture'
      )
      const movieStart = Date.now()
      const context: SyncContext = {
        mediaType: MediaType.Movie,
        operation: SyncOperation.Metadata,
        serverConfig,
        fieldAvailability,
        forceSync,
        fileServerData: fileServer,
        metadataHashesCache: (await fetchTitleHashes(serverConfig, 'movies')) ?? undefined,
        resourceManager,
        // Field-absence cleanup, and the same signal for the sync's own clearing
        // decisions (present whether or not cleanup is switched on).
        cleanup: resolveCleanupConfig(allEnabledServersProbed),
        allEnabledServersProbed,
      }
      syncLogger.info(
        `Processing ${movieTitles.length} movies with concurrency: ${resourceManager.config.syncConcurrency} ` +
          `(HTTP limit: ${resourceManager.config.httpConcurrency})`
      )
      const progress = progressTracker(movieTitles.length)
      let movieResults: SyncResult[] = []
      try {
        movieResults = await syncTitles(
          movieTitles,
          pool,
          (title) => movieService.syncMovie(title, context, MOVIE_OPERATIONS, title),
          (title, error) => failedResult(title, MediaType.Movie, serverConfig.id, error),
          (titleResults) => progress.update(titleResults.some((r) => r.status === SyncStatus.Failed))
        )
      } catch (error) {
        syncLogger.error('Movie sync failed:', error)
      }
      logSummary('Movie', movieResults, Date.now() - movieStart)

      results.movies = translateMovieResults(movieResults)
      collectChangedMedia(movieResults, results.changedMedia)
      log.info(
        {
          serverId: serverConfig.id,
          processed: results.movies.processed,
          errors: results.movies.errors,
          skipped: results.movies.skipped,
        },
        'Movie processing completed'
      )
    }

    // ---- 3. TV ----
    const tvLog = createLogger('FlatSync.NewArch.TV')
    const showTitles = fileServer?.tv ? Object.keys(fileServer.tv) : []
    if (!fileServer?.tv) {
      tvLog.info({ serverId: serverConfig.id }, 'No TV content in fileServer, skipping TV sync')
    } else if (showTitles.length === 0) {
      tvLog.info({ serverId: serverConfig.id }, 'No TV show titles found, skipping TV sync')
    } else {
      tvLog.info(
        { serverId: serverConfig.id, tvShowCount: showTitles.length, architecture: 'new' },
        'Starting TV sync with new domain architecture'
      )
      const tvStart = performance.now()
      try {
        const tvShowHashes = await fetchTitleHashes(serverConfig, 'tv')
        if (!tvShowHashes) syncLogger.warn('TV show hashes unavailable — proceeding without show-level skip optimisation')
        const context: SyncContext = {
          mediaType: MediaType.TVShow,
          operation: SyncOperation.Metadata,
          serverConfig,
          fieldAvailability,
          forceSync,
          fileServerData: fileServer,
          resourceManager,
          tvShowHashesCache: tvShowHashes ?? undefined,
          cleanup: resolveCleanupConfig(allEnabledServersProbed),
          allEnabledServersProbed,
        }
        const tvResults = await syncTitles(
          showTitles,
          pool,
          (title) => tvShowService.syncTVShow(title, context),
          (title, error) => failedResult(title, MediaType.TVShow, serverConfig.id, error)
        )
        logSummary('TV', tvResults, performance.now() - tvStart)

        translateTVResults(tvResults, results, serverConfig.id)
        collectChangedMedia(tvResults, results.changedMedia)
        tvLog.info(
          {
            serverId: serverConfig.id,
            durationSec: parseFloat(((performance.now() - tvStart) / 1000).toFixed(2)),
            processed: {
              tvShows: results.tvShows.processed,
              seasons: results.seasons.processed,
              episodes: results.episodes.processed,
            },
            errors: results.tvShows.errors + results.seasons.errors + results.episodes.errors,
          },
          'TV content sync completed with new architecture'
        )
      } catch (error) {
        logError(tvLog, error, { serverId: serverConfig.id, phase: 'tvContentSync', architecture: 'new' })
        results.errors.push({
          phase: 'tvContentSync',
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          serverId: serverConfig.id,
        })
      }
    }

    // ---- 4. Results ----
    results.performance.endTime = new Date()
    results.performance.duration = Date.now() - startTime

    // changedMedia should track the processed counts closely; changedMedia
    // dwarfing what actually changed on disk is the over-invalidation signal.
    log.info(
      {
        serverId: serverConfig.id,
        changedMedia: {
          movies: results.changedMedia.movies.length,
          shows: results.changedMedia.shows.length,
          seasons: results.changedMedia.seasons.length,
          episodes: results.changedMedia.episodes.length,
        },
        processed: {
          movies: results.movies.processed,
          tvShows: results.tvShows.processed,
          seasons: results.seasons.processed,
          episodes: results.episodes.processed,
        },
      },
      'Collected changed media for post-sync cache invalidation'
    )
    log.info(
      { serverId: serverConfig.id, durationMs: results.performance.duration, architecture: 'new' },
      'NEW architecture sync completed'
    )

    // ---- 5. This server's side jobs ----
    await runSideJobs(results, serverConfig.id, log)

    return results
  } catch (error) {
    logError(log, error, { serverId: serverConfig.id, phase: 'newArchitectureSync', architecture: 'new' })
    results.errors.push({
      phase: 'newArchitectureSync',
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      serverId: serverConfig.id,
    })
    results.performance.endTime = new Date()
    results.performance.duration = Date.now() - startTime
    return results
  }
}

/**
 * The server's settings in the shape the services read. Throws when a setting
 * the pass cannot do without is missing; nothing is defaulted.
 */
function toServerConfig(config: ServerPassConfig): ServerConfig {
  if (!config || !config.baseURL) {
    throw new Error(`Invalid server configuration: missing baseURL for server ${config?.id || 'unknown'}`)
  }
  // The test ownership applies to every other server's priority (core/ownership).
  if (typeof config.priority !== 'number' || !Number.isFinite(config.priority)) {
    const shown = typeof config.priority === 'string' ? JSON.stringify(config.priority) : String(config.priority)
    throw new Error(`Invalid server configuration: priority ${shown} for server ${config.id} is not a number`)
  }
  return {
    id: config.id,
    priority: config.priority,
    baseUrl: config.baseURL, // file server URL (media files)
    // Node.js server URL (API endpoints): the internal one when set
    nodeUrl: config.internalEndpoint || config.syncEndpoint,
    prefix: config.prefixPath,
    enabled: true,
    timeout: 30000,
  }
}

/** The domain services over the sync's repositories (the sync-dedicated Mongo pool). */
async function createServices(): Promise<{ movieService: MovieSyncService; tvShowService: TVShowSyncService }> {
  const db = await createDatabaseAdapter()
  const movieService = new MovieSyncService(db.movies, [
    new MovieMetadataStrategy(db.movies),
    new MovieAssetStrategy(db.movies),
    new MovieContentStrategy(db.movies),
    // Runs after the entity is saved by the metadata and asset strategies.
    new BlurhashStrategy(db.movies),
  ])
  // The season and episode services read the show (and the season) for the
  // showId / seasonId foreign keys.
  const tvShowService = new TVShowSyncService(
    db.tvShows,
    new SeasonSyncService(db.seasons, db.tvShows),
    new EpisodeSyncService(db.episodes, db.seasons, db.tvShows),
    db.episodes,
    db.seasons
  )
  return { movieService, tvShowService }
}

/**
 * Sync every title through the pool: as each title finishes the next one
 * starts. A title whose sync throws is reported as one failed result; it never
 * fails the pass. Results come back in title order.
 */
async function syncTitles(
  titles: string[],
  pool: ReturnType<typeof pLimit>,
  sync: (title: string) => Promise<SyncResult[]>,
  failed: (title: string, error: unknown) => SyncResult,
  onTitleDone?: (results: SyncResult[]) => void
): Promise<SyncResult[]> {
  const perTitle = await Promise.all(
    titles.map((title) =>
      pool(async () => {
        let titleResults: SyncResult[]
        try {
          titleResults = await sync(title)
        } catch (error) {
          syncLogger.error(`Failed to sync "${title}":`, error)
          titleResults = [failed(title, error)]
        }
        onTitleDone?.(titleResults)
        return titleResults
      })
    )
  )
  return perTitle.flat()
}

function failedResult(title: string, mediaType: MediaType, serverId: string, error: unknown): SyncResult {
  return {
    status: SyncStatus.Failed,
    entityId: title,
    mediaType,
    operation: SyncOperation.Metadata,
    serverId,
    timestamp: new Date(),
    changes: [],
    errors: [error instanceof Error ? error.message : String(error)],
  }
}

/**
 * The file server's hashes for every title of one kind, fetched once per
 * pass. Null when they cannot be had: the pass then runs without them.
 */
async function fetchTitleHashes(serverConfig: ServerConfig, kind: 'movies' | 'tv'): Promise<TitleHashes | null> {
  if (!serverConfig.nodeUrl) {
    syncLogger.warn(`⚠️ No Node.js server URL for ${serverConfig.id}: no ${kind} hashes`)
    return null
  }
  // The Node.js server's API, not the file server (baseUrl serves media files).
  const url = `${serverConfig.nodeUrl}/api/metadata-hashes/${kind}`
  syncLogger.info(`Fetching ${kind} metadata hashes from: ${url}`)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' },
    })
    clearTimeout(timeoutId)
    if (!response.ok) {
      syncLogger.warn(`⚠️ ${kind} metadata hashes endpoint returned status ${response.status}`)
      return null
    }
    const hashes = await response.json()
    const count = hashes?.titles ? Object.keys(hashes.titles).length : 0
    syncLogger.info(`✅ ${kind} metadata hashes loaded: ${count} titles, overall=${hashes?.hash?.substring(0, 8)}...`)
    return hashes
  } catch (error) {
    clearTimeout(timeoutId)
    syncLogger.warn(`⚠️ Failed to fetch ${kind} metadata hashes: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

/** Progress lines for the movie phase: every 3 seconds, and when the last title finishes. */
function progressTracker(total: number) {
  let done = 0
  let failed = 0
  let lastLogTime = Date.now()
  const startTime = Date.now()
  return {
    update(isFailed: boolean) {
      done += 1
      if (isFailed) failed += 1
      const now = Date.now()
      if (now - lastLogTime > 3000 || done === total) {
        const percentage = Math.round((done / total) * 100)
        const etaSeconds = Math.round(((total - done) * (now - startTime)) / done / 1000)
        syncLogger.progress(`${done}/${total} (${percentage}%) | Failed: ${failed} | ETA: ${etaSeconds}s`)
        lastLogTime = now
      }
    },
  }
}

function logSummary(label: 'Movie' | 'TV', results: SyncResult[], durationMs: number) {
  const count = (status: SyncStatus) => results.filter((r) => r.status === status).length
  syncLogger.info(
    `${label} sync completed in ${Math.round(durationMs)}ms: ${count(SyncStatus.Completed)} completed, ` +
      `${count(SyncStatus.Failed)} failed, ${count(SyncStatus.Skipped)} skipped`
  )
}

function emptyResults(): ServerPassResult {
  const kind = (): KindResults => ({ processed: 0, errors: 0, details: [] })
  return {
    movies: kind(),
    episodes: kind(),
    seasons: kind(),
    tvShows: kind(),
    performance: { startTime: new Date(), endTime: null, duration: 0 },
    notifications: [],
    errors: [],
    migration: null,
    watchHistoryValidation: null,
    changedMedia: { movies: [], shows: [], seasons: [], episodes: [] },
  }
}

/** The movie titles the payload lists with something to sync (a URL, metadata or a poster). */
function extractMovieTitles(fileServer: any): string[] {
  if (!fileServer || !fileServer.movies) return []
  return Object.keys(fileServer.movies).filter((title) => {
    const movieData = fileServer.movies[title]
    return movieData && (movieData.urls || movieData.metadata || movieData.poster)
  })
}

/**
 * Per movie: failed when any operation failed, processed when one completed,
 * skipped otherwise. The batch's error messages are not counted: a skipped
 * operation's message is not a failure.
 */
function translateMovieResults(movieResults: SyncResult[]): KindResults & { skipped: number } {
  const translated = { processed: 0, errors: 0, details: [] as any[], skipped: 0 }

  const byEntity = new Map<string, SyncResult[]>()
  for (const result of movieResults) {
    if (!byEntity.has(result.entityId)) byEntity.set(result.entityId, [])
    byEntity.get(result.entityId)!.push(result)
  }

  for (const [entityId, entityResults] of byEntity) {
    const completed = entityResults.filter((r) => r.status === SyncStatus.Completed)
    const failed = entityResults.filter((r) => r.status === SyncStatus.Failed)
    const skipped = entityResults.filter((r) => r.status === SyncStatus.Skipped)

    translated.details.push({
      title: entityId,
      serverId: entityResults[0]?.serverId,
      operations: { completed: completed.length, failed: failed.length, skipped: skipped.length },
      changes: completed.flatMap((r) => r.changes),
      errors: failed.flatMap((r) => r.errors),
      timestamp: new Date(),
    })

    if (failed.length > 0) translated.errors++
    else if (completed.length > 0) translated.processed++
    else translated.skipped++
  }

  return translated
}

/**
 * Per kind (show, season, episode): processed = completed, errors = failed.
 * Every message any result carries, a skipped one's included, goes to the
 * pass's errors: run/tickSkip does not record a pass that reports one.
 */
function translateTVResults(tvResults: SyncResult[], results: ServerPassResult, serverId: string) {
  const byType: Record<string, SyncResult[]> = { tvshow: [], season: [], episode: [] }
  for (const r of tvResults) {
    const key = r.mediaType?.toLowerCase()
    if (Object.prototype.hasOwnProperty.call(byType, key)) byType[key].push(r)
  }
  const kind = (rows: SyncResult[]): KindResults => ({
    processed: rows.filter((r) => r.status === SyncStatus.Completed).length,
    errors: rows.filter((r) => r.status === SyncStatus.Failed).length,
    details: rows,
  })
  results.tvShows = kind(byType.tvshow)
  results.seasons = kind(byType.season)
  results.episodes = kind(byType.episode)

  for (const error of tvResults.filter((r) => r.errors.length > 0).flatMap((r) => r.errors)) {
    results.errors.push({ phase: 'tvContentSync', error, serverId })
  }
}

/**
 * The entities the results that completed (were not skipped) changed, by
 * display title: the media page cache tags key on it. A movie and a show fall
 * back to the entity id when no display title was stamped; a season or an
 * episode without its numbers is left out, since a partial tag would be wrong.
 *
 * "Completed" means the smart upsert ran, not that a field changed; the
 * pass's log compares these counts with the processed counts.
 */
function collectChangedMedia(syncResults: SyncResult[], changedMedia: ChangedMedia) {
  for (const r of syncResults) {
    if (r.status !== SyncStatus.Completed) continue
    const md = r.metadata || {}
    switch (r.mediaType) {
      case MediaType.Movie: {
        const title = md.displayTitle || r.entityId
        if (title) changedMedia.movies.push(title)
        break
      }
      case MediaType.TVShow: {
        const title = md.displayTitle || r.entityId
        if (title) changedMedia.shows.push(title)
        break
      }
      case MediaType.Season: {
        if (md.displayTitle && md.seasonNumber != null) {
          changedMedia.seasons.push({ title: md.displayTitle, season: md.seasonNumber })
        }
        break
      }
      case MediaType.Episode: {
        if (md.displayTitle && md.seasonNumber != null && md.episodeNumber != null) {
          changedMedia.episodes.push({ title: md.displayTitle, season: md.seasonNumber, episode: md.episodeNumber })
        }
        break
      }
      default:
        break
    }
  }
}

/**
 * This server's side jobs, after its movies and TV. Each catches its own
 * failure: none of them fails the pass.
 */
async function runSideJobs(results: ServerPassResult, serverId: string, log: ReturnType<typeof createLogger>) {
  // New-content notifications
  log.info({ serverId, phase: 'notifications' }, 'Starting notification processing')
  const notificationStart = performance.now()
  try {
    results.notifications = await MediaNotificationOrchestrator.processSyncResults(results, {
      enableNotifications: true,
      analysisOptions: {
        minSignificanceThreshold: 1,
        timeWindow: 24 * 60 * 60 * 1000, // 24 hours
      },
      generationOptions: {
        batchSimilarContent: true,
        maxMoviesPerNotification: 5,
        includeMetadata: true,
      },
      deliveryOptions: {
        targetAllUsers: true,
        checkDuplicates: true,
        duplicateWindow: 24 * 60 * 60 * 1000, // 24 hours
      },
    })
  } catch (notificationError) {
    logError(log, notificationError, { serverId, context: 'notification_processing' })
  }
  log.info(
    {
      serverId,
      phase: 'notifications',
      durationSec: parseFloat(((performance.now() - notificationStart) / 1000).toFixed(2)),
    },
    'Notification processing completed'
  )

  // PlaybackStatus -> WatchHistory migration (if needed)
  try {
    await migratePlaybackStatusIfNeeded()
    results.migration = { completed: true }
  } catch (migrationError) {
    log.warn({ error: migrationError }, 'WatchHistory migration encountered an issue, but sync continues')
    results.migration = {
      completed: false,
      error: migrationError instanceof Error ? migrationError.message : String(migrationError),
    }
  }

  // WatchHistory records against the current database state
  try {
    results.watchHistoryValidation = await validateWatchHistoryAgainstDatabase()
  } catch (validationError) {
    log.warn({ error: validationError }, 'WatchHistory validation encountered an issue, but sync continues')
    results.watchHistoryValidation = {
      error: validationError instanceof Error ? validationError.message : String(validationError),
    }
  }
}
