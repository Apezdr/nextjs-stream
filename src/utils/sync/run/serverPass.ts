/**
 * One file server's pass over the flat collections.
 *
 * syncAllServers runs one pass per server, one server at a time, inside the
 * orchestration lock: after pre-tag, before post-sync cleanup. A pass, top to
 * bottom:
 *
 *   1. config: the server's settings in the shape the services read, one copy
 *      for movies and TV. A server with no baseURL, or whose priority is not a
 *      positive integer, fails here: ownership ranks servers on priority, and a
 *      guessed one would hand fields to the wrong server.
 *   2. movies: every movie the payload lists, through MovieSyncService.
 *   3. TV: every show, with its seasons and episodes, through TVShowSyncService.
 *      Movies and shows share one pool, as wide as the ResourceManager's
 *      syncConcurrency; the last movie finishes before the first show starts.
 *   4. results: per kind, what was processed, skipped or failed; the entities
 *      the pass changed (post-sync cache invalidation) and the documents it
 *      created (the admins' "sync complete" notice).
 *
 * As each title finishes, its results are also recorded into the run's
 * record of what was written (options.written, run/writtenMedia), so the run
 * has them even if the pass throws later. The jobs that run once per run —
 * the new-content notices, the PlaybackStatus migration and the watch-history
 * validation — are not a pass's: they run after every server's pass and after
 * post-sync cleanup (run/postSync runAfterSyncJobs).
 *
 * Failures. A title that fails is a failed result and the pass goes on: the
 * failure is counted, so run/tickSkip does not record the pass as complete.
 * Anything else that throws (the config check, the database adapter, the
 * pass's own code) is not caught here. It reaches syncAllServers' per-server
 * catch, which records the server as failed, and the pass is not recorded as
 * complete either.
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
import { createWrittenMedia, type ChangedMedia, type WrittenMedia } from './writtenMedia'

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
  /**
   * The run's record of what the passes wrote (run/writtenMedia). Each title's
   * results are recorded into it as the title finishes.
   */
  written?: WrittenMedia
}

interface KindResults {
  processed: number
  errors: number
  details: any[]
  skipped?: number
}

export interface ServerPassResult {
  movies: KindResults
  episodes: KindResults
  seasons: KindResults
  tvShows: KindResults
  performance: { startTime: Date; endTime: Date | null; duration: number }
  errors: Array<{ phase: string; error: unknown; stack?: string; serverId: string }>
  /** Display titles of what this pass changed, for post-sync cache invalidation. */
  changedMedia: ChangedMedia
  /** Documents this pass created (not updated): the admins' sync notice counts them. */
  added: { movies: number; shows: number; episodes: number }
}

/** The file server's metadata hash for every movie (GET /api/metadata-hashes/movies). */
type MovieHashes = {
  hash: string
  titles: Record<string, { hash: string; lastModified: string; generated: string }>
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
  // This pass's own record of what it wrote, for its result and its log; the
  // run's record (options.written) gets the same results as each title finishes.
  const written = createWrittenMedia()
  const record = (titleResults: SyncResult[]) => {
    written.record(titleResults)
    options.written?.record(titleResults)
  }

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
      metadataHashesCache: (await fetchMovieHashes(serverConfig)) ?? undefined,
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
    const movieResults = await syncTitles(
      movieTitles,
      pool,
      (title) => movieService.syncMovie(title, context, MOVIE_OPERATIONS, title),
      (title, error) => failedResult(title, MediaType.Movie, serverConfig.id, error),
      (titleResults) => {
        record(titleResults)
        progress.update(titleResults.some((r) => r.status === SyncStatus.Failed))
      }
    )
    logSummary('Movie', movieResults, Date.now() - movieStart)

    results.movies = translateMovieResults(movieResults)
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
    const context: SyncContext = {
      mediaType: MediaType.TVShow,
      operation: SyncOperation.Metadata,
      serverConfig,
      fieldAvailability,
      forceSync,
      fileServerData: fileServer,
      resourceManager,
      cleanup: resolveCleanupConfig(allEnabledServersProbed),
      allEnabledServersProbed,
    }
    const tvResults = await syncTitles(
      showTitles,
      pool,
      (title) => tvShowService.syncTVShow(title, context),
      (title, error) => failedResult(title, MediaType.TVShow, serverConfig.id, error),
      record
    )
    logSummary('TV', tvResults, performance.now() - tvStart)

    translateTVResults(tvResults, results, serverConfig.id)
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
  }

  // ---- 4. Results ----
  results.changedMedia = written.changedMedia
  results.added = written.addedCounts()
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

  return results
}

/**
 * The server's settings in the shape the services read. Throws when a setting
 * the pass cannot do without is missing; nothing is defaulted.
 */
function toServerConfig(config: ServerPassConfig): ServerConfig {
  if (!config || !config.baseURL) {
    throw new Error(`Invalid server configuration: missing baseURL for server ${config?.id || 'unknown'}`)
  }
  // Ownership ranks servers on priority (core/ownership): 1 is the highest,
  // and config gives 1, 2, 3… in server order. Anything else is a broken
  // config, not a rank to guess.
  if (typeof config.priority !== 'number' || !Number.isInteger(config.priority) || config.priority < 1) {
    const shown = typeof config.priority === 'string' ? JSON.stringify(config.priority) : String(config.priority)
    throw new Error(`Invalid server configuration: priority ${shown} for server ${config.id} is not a positive integer`)
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
 * The file server's metadata hash for every movie, fetched once per pass: a
 * movie's metadata step skips the metadata.json fetch when the hash matches
 * the one it stored (metadataHash). Null when it cannot be had: the pass then
 * fetches each movie's metadata. (Shows have no such step, and nothing reads
 * the TV list, so it is not fetched.)
 */
async function fetchMovieHashes(serverConfig: ServerConfig): Promise<MovieHashes | null> {
  const kind = 'movies'
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
    errors: [],
    changedMedia: { movies: [], shows: [], seasons: [], episodes: [] },
    added: { movies: 0, shows: 0, episodes: 0 },
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
