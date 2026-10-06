/**
 * Movie sync service - domain orchestrator for all movie sync operations
 * Demonstrates the new domain-driven architecture with strategy pattern
 */

import {
  MovieEntity,
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  SyncStrategy,
  ValidationError,
  DatabaseError,
  syncEventBus,
  validateEntityOrThrow,
  planFieldCleanup,
  seedDiscovery,
  type CleanableField,
  type CleanupPlan
} from '../../core'

import {
  MovieRepository,
  isTopLevelFieldLocked
} from '../../infrastructure'

import {
  FileServerAdapter
} from '../../core'

import { createLogger } from '@src/lib/logger'
import {
  availabilityFingerprint,
  payloadFingerprint,
  isHighestPriorityAmongServers,
  getServersReportingTitle,
} from '@src/utils/sync/utils'
import { buildSyncGate, readSyncGate, changesDocument, nextSyncGates } from '../../core/syncGate'
import isEqual from 'lodash/isEqual'

const pinoLog = createLogger('Sync.Movie')

// Movie asset fields eligible for field-absence cleanup. Paths carry the `urls.`
// prefix (movie fileAvailability is built from movieData.urls.*). videoURL
// (urls.mp4) and captions are deliberately excluded — higher-stakes / per-language.
const MOVIE_CLEANABLE_FIELDS: CleanableField[] = [
  { entityField: 'posterURL', fieldPath: 'urls.poster', companions: ['posterSource', 'posterBlurhash', 'posterBlurhashSource'] },
  { entityField: 'backdrop', fieldPath: 'urls.backdrop', companions: ['backdropSource', 'backdropBlurhash', 'backdropBlurhashSource'] },
  { entityField: 'logo', fieldPath: 'urls.logo', companions: ['logoSource', 'logoBlurhash'] },
  { entityField: 'chapterURL', fieldPath: 'urls.chapters', companions: ['chapterSource'] },
]

/**
 * The value a movie's skip gate must hold, for one server, for that server's
 * pass to be skipped: a fingerprint of the payload being applied and a
 * fingerprint of which servers have which fields for the title. See
 * core/syncGate for the whole rule.
 */
export function movieSyncGate(
  payload: unknown,
  fieldAvailability: SyncContext['fieldAvailability'],
  originalTitle: string
): string {
  return buildSyncGate(
    payloadFingerprint(payload),
    availabilityFingerprint(fieldAvailability, 'movies', originalTitle)
  )
}

export class MovieSyncService {
  private repository: MovieRepository
  private fileAdapter: FileServerAdapter
  private strategies: Map<SyncOperation, SyncStrategy[]> = new Map()

  constructor(
    repository: MovieRepository,
    fileAdapter: FileServerAdapter,
    strategies: SyncStrategy[] = []
  ) {
    this.repository = repository
    this.fileAdapter = fileAdapter
    this.registerStrategies(strategies)
  }

  /**
   * Register sync strategies by operation type
   */
  private registerStrategies(strategies: SyncStrategy[]): void {
    for (const strategy of strategies) {
      for (const operation of strategy.supportedOperations) {
        if (!this.strategies.has(operation)) {
          this.strategies.set(operation, [])
        }
        this.strategies.get(operation)!.push(strategy)
      }
    }
  }

  /**
   * Sync a single movie with all applicable strategies
   */
  async syncMovie(
    title: string,
    context: SyncContext,
    operations: SyncOperation[] = [
      SyncOperation.Metadata,
      SyncOperation.Assets,
      SyncOperation.Content
    ],
    originalTitle?: string  // Optional filesystem key title
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    syncEventBus.emitStarted(title, MediaType.Movie, context.serverConfig.id)

    try {
      // Determine the filesystem key and display title
      // When originalTitle is provided, it's the definitive filesystem key
      const effectiveOriginalTitle = originalTitle || title
      // For display title, use the originalTitle as fallback since that's what we have
      const effectiveTitle = originalTitle ? originalTitle : title

      // Whole-movie early-skip: bypass entity normalisation and all strategies
      // when neither this server's payload nor the who-has-what picture for the
      // title has changed since this server's last complete pass, and no other
      // server has changed the document since (movieSyncGate).
      //
      // The gate is only ever stamped by a pass in which no strategy failed, so
      // a matching gate is by itself the evidence the earlier checks here used
      // to look for in the stored metadata.
      const incomingHash = context.metadataHashesCache?.titles?.[effectiveOriginalTitle]?.hash
      const syncGate = movieSyncGate(
        context.fileServerData?.movies?.[effectiveOriginalTitle],
        context.fieldAvailability,
        effectiveOriginalTitle
      )

      if (!context.forceSync) {
        // Prefer pre-fetched cache — avoids extra DB read when movieCache is populated
        const cached = context.movieCache?.get(effectiveOriginalTitle)
                    ?? await this.repository.findByOriginalTitle(effectiveOriginalTitle)

        if (readSyncGate(cached as any, context.serverConfig.id) === syncGate) {
          syncEventBus.emitComplete(title, MediaType.Movie, context.serverConfig.id, undefined, {
            totalOperations: 0,
            successful: 0,
            failed: 0
          })
          return [{
            status: SyncStatus.Skipped,
            entityId: title,
            mediaType: MediaType.Movie,
            operation: SyncOperation.Metadata,
            serverId: context.serverConfig.id,
            timestamp: new Date(),
            changes: [],
            errors: []
          }]
        }
      }

      const existingMovie = await this.repository.findByOriginalTitle(effectiveOriginalTitle)

      // Normalize entity to ensure complete schema (handles new, existing, and partial records)
      let movie = this.normalizeMovieEntity(existingMovie, effectiveTitle, effectiveOriginalTitle, context)

      // Initialise accumulator — strategies append their changes here instead of
      // writing to the DB directly. A single consolidated write happens after all
      // strategies complete, writing only what changed (or nothing if unchanged).
      if (!context.pendingMovieUpdates) context.pendingMovieUpdates = new Map()
      context.pendingMovieUpdates.set(effectiveOriginalTitle, {})
      if (!context.pendingMovieUnsets) context.pendingMovieUnsets = new Map()
      context.pendingMovieUnsets.set(effectiveOriginalTitle, new Set())
      // Created here, not by the strategy that needs it: each strategy is handed
      // a copy of the context, so a set it created would never be seen again.
      if (!context.pendingMovieDeferrals) context.pendingMovieDeferrals = new Set()
      context.pendingMovieDeferrals.delete(effectiveOriginalTitle)
      if (!context.pendingMovieFetchFailures) context.pendingMovieFetchFailures = new Map()
      context.pendingMovieFetchFailures.set(effectiveOriginalTitle, new Set())

      for (const operation of operations) {
        try {
          const operationResult = await this.syncMovieOperation(movie, operation, context, effectiveTitle)
          results.push(operationResult)

          // Advance `movie` to include changes accumulated by this strategy so that
          // the next strategy's `{ ...(movie || {}), ...itsChanges }` spread sees the
          // current accumulated state rather than the stale normalized base.
          // Without this, each strategy overwrites the previous strategy's fields
          // (e.g. AssetStrategy would clobber metadata: {} over MetadataStrategy's
          // populated metadata because both spread from the same stale `movie`).
          const accumulated = context.pendingMovieUpdates?.get(effectiveOriginalTitle)
          if (accumulated) movie = { ...movie, ...accumulated } as any
        } catch (error) {
          const errorResult: SyncResult = {
            status: SyncStatus.Failed,
            entityId: title,
            mediaType: MediaType.Movie,
            operation,
            serverId: context.serverConfig.id,
            timestamp: new Date(),
            changes: [],
            errors: [error instanceof Error ? error.message : String(error)]
          }

          results.push(errorResult)

          syncEventBus.emitError(
            title,
            MediaType.Movie,
            context.serverConfig.id,
            errorResult.errors[0],
            operation
          )
        }
      }

      // ---- Consolidated write — single smartUpsert after all strategies ----
      const pending: any = context.pendingMovieUpdates.get(effectiveOriginalTitle) || {}

      // Fields a strategy asked to remove (their data is gone). An admin lock
      // keeps a field, here as everywhere else. A field being removed must not
      // also be written, so it is taken out of the pending set.
      const strategyUnset = [...(context.pendingMovieUnsets.get(effectiveOriginalTitle) ?? [])].filter(
        (field) => !isTopLevelFieldLocked((existingMovie as any)?.lockedFields, field)
      )
      for (const field of strategyUnset) delete pending[field]

      // The display title is derived here, once, from the metadata the document
      // ends up with: its TMDB title when it has one, the folder name otherwise.
      // Each strategy used to write a title of its own (the metadata strategy
      // the TMDB one, the asset and content strategies the folder name), so the
      // stored title depended on which of them last had something to change.
      // (A locked `metadata` keeps what is stored: the strategy's copy will be
      // dropped on the way to the database, so it must not name the title.)
      const metadataLocked = isTopLevelFieldLocked((existingMovie as any)?.lockedFields, 'metadata')
      const storedMetadata: any = metadataLocked
        ? existingMovie?.metadata
        : pending.metadata ?? existingMovie?.metadata
      // (The stub the metadata strategy writes after a failed first fetch
      // carries the folder name as its title and `hasExternalMetadata: false`;
      // that is not a metadata title.)
      const metadataTitle =
        typeof storedMetadata?.title === 'string' && storedMetadata.hasExternalMetadata !== false
          ? storedMetadata.title.trim()
          : ''
      const displayTitle = metadataTitle || effectiveOriginalTitle
      if (existingMovie ? existingMovie.title !== displayTitle : true) {
        pending.title = displayTitle
      } else {
        // Unchanged: make sure a strategy's stale copy cannot override it.
        delete pending.title
      }

      // The title's source goes with it: the metadata's owner when the title
      // is the metadata's, otherwise the highest-priority server that has the
      // folder. (The folder name is the same on every server, so for a title
      // with no metadata anywhere the source used to be whichever server had
      // created the document.)
      const titleSource = metadataTitle
        ? (metadataLocked ? existingMovie?.metadataSource : pending.metadataSource ?? existingMovie?.metadataSource)
        : isHighestPriorityAmongServers(
            getServersReportingTitle(context.fieldAvailability, 'movies', effectiveOriginalTitle),
            context.serverConfig
          )
          ? context.serverConfig.id
          : undefined
      delete pending.titleSource
      if (
        titleSource &&
        !isTopLevelFieldLocked((existingMovie as any)?.lockedFields, 'title') &&
        (existingMovie as any)?.titleSource !== titleSource
      ) {
        pending.titleSource = titleSource
      }
      context.pendingMovieUpdates.set(effectiveOriginalTitle, pending)

      // A failed metadata fetch must not advance the metadata gate. If the
      // metadata strategy reported Failed (fetch error, or it preserved existing
      // metadata because the fetch came back empty), still persist whatever other
      // strategies changed (e.g. asset URLs) but leave syncHash unstamped so the
      // next sync retries the fetch. Without this, an asset-only change during a
      // metadata-fetch failure would stamp syncHash to the current hash and lock
      // the movie out of future metadata refreshes (the "spent gate" failure mode).
      const metadataFetchFailed = results.some(
        r => r.operation === SyncOperation.Metadata && r.status === SyncStatus.Failed
      )
      // The same holds for any other strategy that failed: its work was not
      // done, so the gate must stay open for the next run to retry it.
      const anyStrategyFailed = results.some(r => r.status === SyncStatus.Failed)

      // Field-absence cleanup: drop asset fields no enabled server reports anymore
      // (only meaningful for an existing doc). planFieldCleanup logs (both modes)
      // and returns `unset` only in enforce. effectiveOriginalTitle is the
      // fieldAvailability key.
      const cleanupPlan: CleanupPlan = planFieldCleanup({
        cleanup: context.cleanup,
        mediaType: 'movies',
        availabilityKey: effectiveOriginalTitle,
        entity: existingMovie,
        fieldAvailability: context.fieldAvailability,
        fields: MOVIE_CLEANABLE_FIELDS,
        log: (obj, msg) => pinoLog.info(obj, msg),
        logContext: { title: (movie as any)?.title || effectiveTitle, originalTitle: effectiveOriginalTitle },
      })
      const unsetFields = [...new Set([...(cleanupPlan.unset ?? []), ...strategyUnset])]
      const hasUnset = unsetFields.length > 0

      // The skip gate (core/syncGate). This server's entry is stamped when the
      // pass ran to the end with nothing failed and nothing deferred — including
      // a pass that found nothing to change, which would otherwise be repeated
      // in full on every run. It is left out when a strategy failed, or when a
      // removal was held back because not every server answered, so the next
      // run does the work again. A pass that changed the document drops the
      // other servers' entries.
      // `syncHash` (the file server's hash for the title) is still recorded when
      // the document changes, for anyone inspecting it; nothing decides on it.
      const removalDeferred =
        context.pendingMovieDeferrals?.has(effectiveOriginalTitle) === true || cleanupPlan.withheld === true
      const documentChanged = changesDocument(existingMovie as any, pending, unsetFields)
      // A file the server publishes (a blurhash) that could not be fetched is
      // work left undone as well.
      const fetchFailed = (context.pendingMovieFetchFailures?.get(effectiveOriginalTitle)?.size ?? 0) > 0
      const gateToStamp =
        !metadataFetchFailed && !anyStrategyFailed && !removalDeferred && !fetchFailed ? syncGate : null
      const storedGates = ((existingMovie as any)?.syncGates ?? {}) as Record<string, string>
      const gates = nextSyncGates(storedGates, context.serverConfig.id, gateToStamp, documentChanged)
      if (!isEqual(gates, storedGates)) pending.syncGates = gates
      if (gateToStamp && incomingHash && documentChanged) pending.syncHash = incomingHash
      context.pendingMovieUpdates.set(effectiveOriginalTitle, pending)

      // Write when strategies changed something OR there are fields to clear. A
      // pure field-absence pass (empty pending + unset) must still write.
      if (Object.keys(pending).length > 0 || hasUnset) {
        if (!existingMovie) {
          // New document — full insert from the accumulated pending fields.
          // There is nothing stored to remove; a field a strategy wanted gone
          // is simply left out.
          const toInsert: any = { ...movie, ...pending }
          for (const field of strategyUnset) delete toInsert[field]
          await this.repository.upsert(toInsert)
        } else {
          // Existing document — diff against the pre-loop snapshot, write only changes,
          // and $unset the fields whose data is gone (absent on every server, or
          // removed by a strategy).
          await this.repository.smartUpsert(
            { ...existingMovie, ...pending } as any,
            existingMovie as any,
            { unset: unsetFields }
          )
        }
      }

      // Stamp the resolved display title onto completed results so the post-sync
      // cache invalidation can build the correct `movie-details-<displayTitle>`
      // tag. `movie.title` reflects metadata-strategy updates (line ~141 spread);
      // fall back to the filesystem key only when no display title is available.
      const movieDisplayTitle = displayTitle
      // A corrected display title is a change in its own right, and the page
      // caches are keyed on it. When no strategy had anything else to write
      // there is no completed result to carry it to the cache invalidation, so
      // add one.
      const titleChanged = Boolean(existingMovie) && existingMovie!.title !== displayTitle &&
        !isTopLevelFieldLocked((existingMovie as any)?.lockedFields, 'title')
      if (titleChanged && !results.some(r => r.status === SyncStatus.Completed)) {
        results.push({
          status: SyncStatus.Completed,
          entityId: title,
          mediaType: MediaType.Movie,
          operation: SyncOperation.Metadata,
          serverId: context.serverConfig.id,
          timestamp: new Date(),
          changes: [`Updated display title: "${displayTitle}"`],
          errors: []
        })
      }
      for (const r of results) {
        if (r.status === SyncStatus.Completed) {
          r.metadata = { ...r.metadata, displayTitle: movieDisplayTitle }
        }
      }
      // Surface field-absence diagnostics on the first completed result (once).
      if (cleanupPlan.changes.length > 0) {
        const firstCompleted = results.find(r => r.status === SyncStatus.Completed)
        if (firstCompleted) firstCompleted.changes = [...firstCompleted.changes, ...cleanupPlan.changes]
      }

      syncEventBus.emitComplete(title, MediaType.Movie, context.serverConfig.id, undefined, {
        totalOperations: operations.length,
        successful: results.filter(r => r.status === SyncStatus.Completed).length,
        failed: results.filter(r => r.status === SyncStatus.Failed).length
      })

      return results

    } catch (error) {
      const errorResult: SyncResult = {
        status: SyncStatus.Failed,
        entityId: title,
        mediaType: MediaType.Movie,
        operation: SyncOperation.Metadata, // Default operation for general failures
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [error instanceof Error ? error.message : String(error)]
      }

      syncEventBus.emitError(
        title,
        MediaType.Movie,
        context.serverConfig.id,
        errorResult.errors[0]
      )

      return [errorResult]
    }
  }

  /**
   * Sync multiple movies efficiently
   */
  async syncMovies(
    titles: string[],
    context: SyncContext,
    concurrency: number = 5
  ): Promise<SyncResult[]> {
    const allResults: SyncResult[] = []

    // Process movies in batches to control concurrency
    for (let i = 0; i < titles.length; i += concurrency) {
      const batch = titles.slice(i, i + concurrency)
      
      const batchPromises = batch.map(title =>
        this.syncMovie(title, context).catch(error => [{
          status: SyncStatus.Failed,
          entityId: title,
          mediaType: MediaType.Movie,
          operation: SyncOperation.Metadata,
          serverId: context.serverConfig.id,
          timestamp: new Date(),
          changes: [],
          errors: [error instanceof Error ? error.message : String(error)]
        }])
      )

      const batchResults = await Promise.allSettled(batchPromises)
      
      batchResults.forEach(result => {
        if (result.status === 'fulfilled') {
          allResults.push(...result.value)
        } else {
          // This shouldn't happen due to catch above, but handle anyway
          console.error('Unexpected batch result failure:', result.reason)
        }
      })
    }

    return allResults
  }

  /**
   * Sync a single operation for a movie
   */
  private async syncMovieOperation(
    movie: MovieEntity | null,
    operation: SyncOperation,
    context: SyncContext,
    title: string
  ): Promise<SyncResult> {
    const strategies = this.strategies.get(operation) || []
    
    if (strategies.length === 0) {
      return {
        status: SyncStatus.Skipped,
        entityId: movie?.title || 'unknown',
        mediaType: MediaType.Movie,
        operation,
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [`No strategies available for operation: ${operation}`]
      }
    }

    // Find the first strategy that can handle this context
    const applicableStrategy = strategies.find(strategy => 
      strategy.canHandle({ ...context, operation })
    )

    if (!applicableStrategy) {
      return {
        status: SyncStatus.Skipped,
        entityId: movie?.title || 'unknown',
        mediaType: MediaType.Movie,
        operation,
        serverId: context.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [`No applicable strategy found for operation: ${operation}`]
      }
    }

    // Execute the strategy with both titles in context
    const strategyContext = { 
      ...context, 
      operation,
      entityTitle: title,
      entityOriginalTitle: movie?.originalTitle || movie?.title || title
    }
    
    
    return await applicableStrategy.sync(movie, strategyContext)
  }

  /**
   * Normalize movie entity to ensure complete schema regardless of input state
   * Handles new entities, existing entities, partial records, and schema migrations
   */
  private normalizeMovieEntity(
    existingMovie: MovieEntity | null,
    title: string,
    originalTitle: string,
    context: SyncContext
  ): MovieEntity {
    const now = new Date()
    
    // If existing movie found, preserve all existing data
    if (existingMovie) {
      console.log(`🔄 Normalizing existing movie entity for: "${title}"`)
      
      // Start with existing movie data - preserve everything
      const normalizedMovie: MovieEntity = {
        ...existingMovie,
        // Update sync timestamp
        lastSynced: now,
        // Ensure core fields are current
        title,
        originalTitle
      }
      
      // Heal any critical missing fields
      this.healCriticalFields(normalizedMovie, existingMovie, context)
      
      console.log(`🔧 Entity normalized: preserved all ${Object.keys(existingMovie).length} existing fields`)
      return normalizedMovie
    }
    
    // Creating new movie - set all required legacy fields for compatibility
    console.log(`🆕 Creating new movie entity for: "${title}" (originalTitle: "${originalTitle}")`)
    
    const normalizedMovie: MovieEntity = {
      // Core identification
      title,
      originalTitle,
      
      // REQUIRED: Legacy discovery fields (for "recently added" queries, type filtering, etc.)
      type: 'movie',
      createdAt: now,
      initialDiscoveryDate: now,
      initialDiscoveryServer: context.serverConfig.id,
      
      // Sync tracking
      lastSynced: now,
      
      // Content metadata (empty object, will be populated by strategies)
      metadata: {},
      
      // Source tracking for field-level ownership
      titleSource: context.serverConfig.id,
      originalTitleSource: context.serverConfig.id,
      
      // All other fields will be populated by strategies as needed
      // No need to initialize them as undefined - strategies will set them when data is available
    }
    
    console.log(`🔍 TRACE: New entity created with ${Object.keys(normalizedMovie).length} fields:`, Object.keys(normalizedMovie).sort())
    
    return normalizedMovie
  }
  
  /**
   * Heal critical fields that must never be null/undefined for system stability
   */
  private healCriticalFields(
    normalizedMovie: MovieEntity,
    existingMovie: MovieEntity,
    context: SyncContext
  ): void {
    const healedFields: string[] = []
    
    // Ensure legacy discovery fields exist (for backward compatibility)
    if (!normalizedMovie.type) {
      normalizedMovie.type = 'movie'
      healedFields.push('type')
    }
    
    if (!normalizedMovie.createdAt) {
      normalizedMovie.createdAt = new Date()
      healedFields.push('createdAt')
    }
    
    // One rule for movies and TV (core/discovery.ts): a document that predates
    // the field is healed from its createdAt; a date already held never moves.
    healedFields.push(
      ...seedDiscovery(normalizedMovie, existingMovie, context.serverConfig.id, new Date())
    )

    // Ensure source tracking for critical fields
    if (!normalizedMovie.titleSource) {
      normalizedMovie.titleSource = context.serverConfig.id
      healedFields.push('titleSource')
    }
    
    if (!normalizedMovie.originalTitleSource) {
      normalizedMovie.originalTitleSource = context.serverConfig.id
      healedFields.push('originalTitleSource')
    }
    
    // Ensure metadata is always an object
    if (!normalizedMovie.metadata || typeof normalizedMovie.metadata !== 'object') {
      normalizedMovie.metadata = {}
      healedFields.push('metadata')
    }
    
    if (healedFields.length > 0) {
      console.log(`🏥 Healed critical fields: ${healedFields.join(', ')}`)
    }
  }

  /**
   * Get movie sync statistics
   */
  async getSyncStats(): Promise<{
    totalMovies: number
    needingSync: number
    recentlyUpdated: number
    byOperation: Record<SyncOperation, number>
  }> {
    try {
      const [
        totalMovies,
        recentlyUpdated,
        missingVideo,
        missingPosters,
        missingBackdrops
      ] = await Promise.all([
        this.repository.count(),
        this.repository.findModifiedSince(new Date(Date.now() - 24 * 60 * 60 * 1000)).then(movies => movies.length),
        this.repository.findMissingAssets('poster').then(movies => movies.length),
        this.repository.findMissingAssets('backdrop').then(movies => movies.length),
        this.repository.findWithVideo().then(movies => totalMovies - movies.length)
      ])

      const needingSync = missingVideo + missingPosters + missingBackdrops

      return {
        totalMovies,
        needingSync,
        recentlyUpdated,
        byOperation: {
          [SyncOperation.Metadata]: 0, // Would need to calculate based on missing metadata
          [SyncOperation.Assets]: missingPosters + missingBackdrops,
          [SyncOperation.Content]: missingVideo,
          [SyncOperation.Validation]: 0,
          [SyncOperation.Blurhash]: 0  // Would need to calculate based on missing blurhashes
        }
      }
    } catch (error) {
      throw new DatabaseError(`Failed to get movie sync statistics: ${error}`)
    }
  }

  /**
   * Find movies that need sync based on criteria
   */
  async findMoviesNeedingSync(criteria: {
    missingAssets?: boolean
    missingVideo?: boolean
    olderThan?: Date
    limit?: number
  }): Promise<MovieEntity[]> {
    const conditions: Promise<MovieEntity[]>[] = []

    if (criteria.missingVideo) {
      conditions.push(
        this.repository.findAll({
          $or: [
            { videoURL: { $exists: false } },
            { videoURL: null },
            { videoURL: '' }
          ]
        })
      )
    }

    if (criteria.missingAssets) {
      conditions.push(
        this.repository.findMissingAssets('poster'),
        this.repository.findMissingAssets('backdrop')
      )
    }

    if (criteria.olderThan) {
      conditions.push(
        this.repository.findAll({
          $or: [
            { lastSynced: { $lt: criteria.olderThan } },
            { lastSynced: { $exists: false } }
          ]
        })
      )
    }

    if (conditions.length === 0) {
      return []
    }

    // Combine results and deduplicate
    const allResults = await Promise.all(conditions)
    const combined = allResults.flat()
    const unique = Array.from(
      new Map(combined.map(movie => [movie.title, movie])).values()
    )

    // Apply limit if specified
    if (criteria.limit && unique.length > criteria.limit) {
      return unique.slice(0, criteria.limit)
    }

    return unique
  }

  /**
   * Cleanup movies that are no longer on the file server or have invalid content
   */
  async cleanup(
    availableTitles: string[],
    context: SyncContext
  ): Promise<{
    orphansRemoved: number
    invalidRemoved: number
    errors: string[]
  }> {
    const result = {
      orphansRemoved: 0,
      invalidRemoved: 0,
      errors: [] as string[]
    }

    try {
      syncEventBus.emitProgress(
        'cleanup',
        MediaType.Movie,
        context.serverConfig.id,
        SyncOperation.Validation, // Use Validation as operation type
        { stage: 'starting', progress: 0 }
      )

      // 1. Get all movies from DB
      const allMovies = await this.repository.getAllMoviesForCleanup()
      const dbTitles = new Set(allMovies.map(m => m.originalTitle))
      const availableSet = new Set(availableTitles)

      // 2. Identify orphans (in DB but not in availableTitles)
      const orphans = allMovies
        .filter(m => !availableSet.has(m.originalTitle))
        .map(m => m.originalTitle)

      if (orphans.length > 0) {
        console.log(`🧹 Found ${orphans.length} orphaned movies to remove`)
        const deletedCount = await this.repository.deleteByOriginalTitles(orphans)
        result.orphansRemoved = deletedCount
        console.log(`✅ Removed ${deletedCount} orphaned movies`)
      }

      // 3. Identify invalid video URLs for remaining movies
      const remainingMovies = allMovies.filter(m => availableSet.has(m.originalTitle))
      const moviesWithVideo = remainingMovies.filter(m => m.videoURL)
      
      if (moviesWithVideo.length > 0) {
        console.log(`🔍 Validating video URLs for ${moviesWithVideo.length} movies...`)
        
        // Validate in batches to avoid overwhelming the file server
        const batchSize = 50
        const invalidTitles: string[] = []

        for (let i = 0; i < moviesWithVideo.length; i += batchSize) {
          const batch = moviesWithVideo.slice(i, i + batchSize)
          const urls = batch.map(m => m.videoURL!)
          
          try {
            const availability = await this.fileAdapter.validateAvailability(urls)
            
            // Find movies associated with unavailable URLs
            const unavailableUrls = new Set(availability.unavailable)
            const batchInvalid = batch
              .filter(m => unavailableUrls.has(m.videoURL!))
              .map(m => m.originalTitle)
            
            invalidTitles.push(...batchInvalid)
            
            // Update progress
            const progress = Math.round(((i + batch.length) / moviesWithVideo.length) * 100)
            syncEventBus.emitProgress(
              'cleanup',
              MediaType.Movie,
              context.serverConfig.id,
              SyncOperation.Validation,
              { stage: 'validating', progress }
            )
            
          } catch (error) {
            console.error(`Failed to validate batch ${i}-${i+batchSize}:`, error)
            result.errors.push(`Failed to validate batch starting at index ${i}: ${error}`)
          }
        }

        if (invalidTitles.length > 0) {
          console.log(`🧹 Found ${invalidTitles.length} movies with invalid video URLs`)
          const deletedCount = await this.repository.deleteByOriginalTitles(invalidTitles)
          result.invalidRemoved = deletedCount
          console.log(`✅ Removed ${deletedCount} movies with invalid video URLs`)
        }
      }

      syncEventBus.emitProgress(
        'cleanup',
        MediaType.Movie,
        context.serverConfig.id,
        SyncOperation.Validation,
        { stage: 'completed', progress: 100 }
      )

      return result

    } catch (error) {
      console.error('Cleanup failed:', error)
      result.errors.push(error instanceof Error ? error.message : String(error))
      return result
    }
  }

  /**
   * Validate movie data
   */
  async validateMovie(movie: MovieEntity): Promise<boolean> {
    try {
      validateEntityOrThrow(movie, MediaType.Movie)
      
      // Additional movie-specific validation
      if (movie.videoURL) {
        const availability = await this.fileAdapter.validateAvailability([movie.videoURL])
        if (availability.unavailable.includes(movie.videoURL)) {
          throw new ValidationError(
            `Video URL is not accessible: ${movie.videoURL}`,
            movie.title,
            MediaType.Movie
          )
        }
      }

      return true
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error
      }
      
      throw new ValidationError(
        `Movie validation failed: ${error}`,
        movie.title,
        MediaType.Movie
      )
    }
  }

  /**
   * Get repository reference for advanced operations
   */
  getRepository(): MovieRepository {
    return this.repository
  }

  /**
   * Get file adapter reference for advanced operations
   */
  getFileAdapter(): FileServerAdapter {
    return this.fileAdapter
  }

  /**
   * Add or update sync strategy
   */
  addStrategy(strategy: SyncStrategy): void {
    this.registerStrategies([strategy])
  }

  /**
   * Remove strategy by name
   */
  removeStrategy(strategyName: string): void {
    for (const [operation, strategies] of this.strategies.entries()) {
      const filtered = strategies.filter(s => s.name !== strategyName)
      this.strategies.set(operation, filtered)
    }
  }

  /**
   * Get available strategies for debugging
   */
  getStrategies(): Record<SyncOperation, string[]> {
    const result: Record<SyncOperation, string[]> = {} as any

    for (const [operation, strategies] of this.strategies.entries()) {
      result[operation] = strategies.map(s => s.name)
    }

    return result
  }
}