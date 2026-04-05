/**
 * BlurhashStrategy - Shared cross-domain blurhash computation strategy
 *
 * This is a post-entity strategy: it runs AFTER the entity has been saved to the
 * database (by Metadata/Asset strategies). It is gated on field availability and
 * skips computation when the blurhash is already stored.
 *
 * Supported media types: Movie, TVShow, Season
 * Operation:            SyncOperation.Blurhash
 *
 * Computation pattern mirrors src/utils/flatSync/blurhashSync.js and
 * src/utils/flatSync/movies/blurhash.js:
 *   1. Resolve the blurhash URL from fileServerData
 *   2. Fetch the pre-computed blurhash string via fetchMetadataMultiServer
 *   3. Persist only the blurhash fields via repository.update() — no full upsert
 */

import {
  SyncStrategy,
  SyncContext,
  SyncResult,
  SyncStatus,
  SyncOperation,
  MediaType,
  BaseMediaEntity,
  MovieEntity,
  SeasonEntity,
  TVShowEntity,
  syncEventBus,
} from '../../core'

import { MovieRepository } from '../../infrastructure'
import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'

// ────────────────────────────────────────────────────────────────────────────
// Field-path constants used in fieldAvailability lookups
// ────────────────────────────────────────────────────────────────────────────

/** fieldAvailability path for movie poster blurhash */
const MOVIE_POSTER_BLURHASH_FIELD = 'urls.posterBlurhash'
/** fieldAvailability path for movie backdrop blurhash */
const MOVIE_BACKDROP_BLURHASH_FIELD = 'urls.backdropBlurhash'
/** fieldAvailability path for TV show poster blurhash */
const TV_POSTER_BLURHASH_FIELD = 'posterBlurhash'
/** fieldAvailability path for TV show backdrop blurhash */
const TV_BACKDROP_BLURHASH_FIELD = 'backdropBlurhash'
/** prefix for season fieldAvailability path */
const SEASON_POSTER_BLURHASH_FIELD_PREFIX = 'seasons.Season '

// ────────────────────────────────────────────────────────────────────────────
// BlurhashStrategy
// ────────────────────────────────────────────────────────────────────────────

export class BlurhashStrategy implements SyncStrategy {
  readonly name = 'BlurhashStrategy'
  readonly supportedOperations = [SyncOperation.Blurhash]
  readonly supportedMediaTypes = [
    MediaType.Movie,
    MediaType.TVShow,
    MediaType.Season,
  ]

  /**
   * The repository is typed as MovieRepository because that is the only domain
   * wired so far. For TVShow/Season the strategy receives the entity directly
   * and uses the context fileServerData — a typed generic repository can be
   * introduced later.
   */
  constructor(private repository: MovieRepository) {}

  // ──────────────────────────────────────────────────────────────────────────
  // canHandle
  // ──────────────────────────────────────────────────────────────────────────

  canHandle(context: SyncContext): boolean {
    return (
      this.supportedOperations.includes(context.operation) &&
      this.supportedMediaTypes.includes(context.mediaType)
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // sync — entry point dispatched per mediaType
  // ──────────────────────────────────────────────────────────────────────────

  async sync(
    entity: BaseMediaEntity | null,
    context: SyncContext
  ): Promise<SyncResult> {
    const startTime = Date.now()
    const title = context.entityTitle || entity?.title || 'unknown'
    const originalTitle =
      context.entityOriginalTitle || entity?.originalTitle || title

    try {
      syncEventBus.emitProgress(
        title,
        context.mediaType,
        context.serverConfig.id,
        SyncOperation.Blurhash,
        { stage: 'starting', progress: 0 }
      )

      let changes: string[] = []

      switch (context.mediaType) {
        case MediaType.Movie:
          changes = await this.syncMovieBlurhash(
            entity as MovieEntity | null,
            originalTitle,
            context
          )
          break

        case MediaType.TVShow:
          changes = await this.syncTVShowBlurhash(
            entity as TVShowEntity | null,
            originalTitle,
            context
          )
          break

        case MediaType.Season:
          changes = await this.syncSeasonBlurhash(
            entity as SeasonEntity | null,
            originalTitle,
            context
          )
          break

        default:
          return this.createResult(title, context, SyncStatus.Skipped, [], [], {
            reason: `BlurhashStrategy does not handle mediaType: ${context.mediaType}`,
            processingTime: Date.now() - startTime,
          })
      }

      if (changes.length > 0) {
        syncEventBus.emitProgress(
          title,
          context.mediaType,
          context.serverConfig.id,
          SyncOperation.Blurhash,
          { stage: 'completed', progress: 100, updatedFields: changes }
        )
      } else {
        syncEventBus.emitProgress(
          title,
          context.mediaType,
          context.serverConfig.id,
          SyncOperation.Blurhash,
          { stage: 'unchanged', progress: 100 }
        )
      }

      return this.createResult(
        title,
        context,
        changes.length > 0 ? SyncStatus.Completed : SyncStatus.Skipped,
        changes,
        [],
        { processingTime: Date.now() - startTime }
      )
    } catch (error) {
      syncEventBus.emitError(
        title,
        context.mediaType,
        context.serverConfig.id,
        error instanceof Error ? error.message : String(error),
        SyncOperation.Blurhash
      )

      return this.createResult(
        title,
        context,
        SyncStatus.Failed,
        [],
        [error instanceof Error ? error.message : String(error)],
        { processingTime: Date.now() - startTime }
      )
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Movie blurhash sync
  // ──────────────────────────────────────────────────────────────────────────

  private async syncMovieBlurhash(
    movie: MovieEntity | null,
    originalTitle: string,
    context: SyncContext
  ): Promise<string[]> {
    const changes: string[] = []

    // Resolve entity from cache or DB when not passed in directly
    let entity = movie
    if (!entity) {
      if (context.movieCache?.has(originalTitle)) {
        entity = context.movieCache.get(originalTitle)!
        console.log(`💾 BlurhashStrategy cache HIT for movie: "${originalTitle}"`)
      } else {
        console.log(`🔍 BlurhashStrategy cache MISS for movie: "${originalTitle}", querying DB…`)
        entity = await this.repository.findByOriginalTitle(originalTitle)
      }
    }

    // Post-entity gate: entity must exist (must have been saved by a prior strategy)
    if (!entity) {
      console.log(`⏭️ BlurhashStrategy: movie "${originalTitle}" not in DB yet — skipping (post-entity gate)`)
      return changes
    }

    const fileServerMovieData = context.fileServerData?.movies?.[originalTitle]
    if (!fileServerMovieData?.urls) {
      console.log(`⏭️ BlurhashStrategy: no fileServerData.urls for movie "${originalTitle}"`)
      return changes
    }

    // ── Poster blurhash ──────────────────────────────────────────────────────
    const posterChange = await this.processBlurhashField({
      label: 'posterBlurhash',
      currentValue: entity.posterBlurhash,
      blurhashRelativePath: fileServerMovieData.urls.posterBlurhash,
      fieldPath: MOVIE_POSTER_BLURHASH_FIELD,
      mediaCategory: 'movies',
      originalTitle,
      context,
      onSuccess: async (blurhash: string) => {
        await this.repository.update(entity!.title, {
          posterBlurhash: blurhash,
          posterBlurhashSource: context.serverConfig.id,
        } as Partial<MovieEntity>)
      },
    })
    if (posterChange) changes.push(posterChange)

    // ── Backdrop blurhash ────────────────────────────────────────────────────
    const backdropChange = await this.processBlurhashField({
      label: 'backdropBlurhash',
      currentValue: entity.backdropBlurhash,
      blurhashRelativePath: fileServerMovieData.urls.backdropBlurhash,
      fieldPath: MOVIE_BACKDROP_BLURHASH_FIELD,
      mediaCategory: 'movies',
      originalTitle,
      context,
      onSuccess: async (blurhash: string) => {
        await this.repository.update(entity!.title, {
          backdropBlurhash: blurhash,
          backdropBlurhashSource: context.serverConfig.id,
        } as Partial<MovieEntity>)
      },
    })
    if (backdropChange) changes.push(backdropChange)

    return changes
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TVShow blurhash sync
  // ──────────────────────────────────────────────────────────────────────────

  private async syncTVShowBlurhash(
    show: TVShowEntity | null,
    originalTitle: string,
    context: SyncContext
  ): Promise<string[]> {
    const changes: string[] = []

    // Post-entity gate: entity must be provided
    if (!show) {
      console.log(`⏭️ BlurhashStrategy: TVShow entity not provided for "${originalTitle}" — skipping`)
      return changes
    }

    const fileServerShowData = context.fileServerData?.tv?.[originalTitle]
    if (!fileServerShowData) {
      console.log(`⏭️ BlurhashStrategy: no fileServerData.tv for TVShow "${originalTitle}"`)
      return changes
    }

    // ── Poster blurhash ──────────────────────────────────────────────────────
    const posterChange = await this.processBlurhashField({
      label: 'posterBlurhash',
      currentValue: show.posterBlurhash,
      blurhashRelativePath: fileServerShowData.posterBlurhash,
      fieldPath: TV_POSTER_BLURHASH_FIELD,
      mediaCategory: 'tv',
      originalTitle,
      context,
      onSuccess: async (_blurhash: string) => {
        // TVShow repository not yet wired — log intent only.
        // When TVShowRepository is available, call:
        //   tvShowRepository.update(show.title, { posterBlurhash: blurhash, posterBlurhashSource: context.serverConfig.id })
        console.log(`ℹ️ BlurhashStrategy: TVShow posterBlurhash computed but TVShowRepository not yet wired`)
      },
    })
    if (posterChange) changes.push(posterChange)

    // ── Backdrop blurhash ────────────────────────────────────────────────────
    const backdropChange = await this.processBlurhashField({
      label: 'backdropBlurhash',
      currentValue: show.backdropBlurhash,
      blurhashRelativePath: fileServerShowData.backdropBlurhash,
      fieldPath: TV_BACKDROP_BLURHASH_FIELD,
      mediaCategory: 'tv',
      originalTitle,
      context,
      onSuccess: async (_blurhash: string) => {
        console.log(`ℹ️ BlurhashStrategy: TVShow backdropBlurhash computed but TVShowRepository not yet wired`)
      },
    })
    if (backdropChange) changes.push(backdropChange)

    return changes
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Season blurhash sync
  // ──────────────────────────────────────────────────────────────────────────

  private async syncSeasonBlurhash(
    season: SeasonEntity | null,
    originalTitle: string,
    context: SyncContext
  ): Promise<string[]> {
    const changes: string[] = []

    // Post-entity gate
    if (!season) {
      console.log(`⏭️ BlurhashStrategy: Season entity not provided for "${originalTitle}" — skipping`)
      return changes
    }

    const showTitle = season.showTitle || originalTitle
    const seasonNumber = season.seasonNumber
    const fileServerSeasonData =
      context.fileServerData?.tv?.[showTitle]?.seasons?.[`Season ${seasonNumber}`]

    if (!fileServerSeasonData) {
      console.log(`⏭️ BlurhashStrategy: no fileServerData for Season ${seasonNumber} of "${showTitle}"`)
      return changes
    }

    // fieldAvailability path: "seasons.Season N.seasonPosterBlurhash"
    const fieldPath = `${SEASON_POSTER_BLURHASH_FIELD_PREFIX}${seasonNumber}.seasonPosterBlurhash`

    const posterChange = await this.processBlurhashField({
      label: 'posterBlurhash',
      currentValue: season.posterBlurhash,
      blurhashRelativePath: fileServerSeasonData.seasonPosterBlurhash,
      fieldPath,
      mediaCategory: 'tv',
      originalTitle: showTitle,
      context,
      onSuccess: async (_blurhash: string) => {
        // SeasonRepository not yet wired — log intent only.
        // When SeasonRepository is available, call:
        //   seasonRepository.update(season.title, { posterBlurhash: blurhash, posterBlurhashSource: context.serverConfig.id })
        console.log(`ℹ️ BlurhashStrategy: Season ${seasonNumber} posterBlurhash computed but SeasonRepository not yet wired`)
      },
    })
    if (posterChange) changes.push(posterChange)

    return changes
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Core: process a single blurhash field
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Processes one blurhash field end-to-end:
   *  1. Skip if already computed (idempotency gate)
   *  2. Skip if no URL available in fileServerData (field availability gate)
   *  3. Check server priority via isCurrentServerHighestPriorityForField
   *  4. Fetch the blurhash string via fetchMetadataMultiServer
   *  5. Call onSuccess to persist via repository.update()
   *
   * Returns the field label string if a change was made, null otherwise.
   */
  private async processBlurhashField(params: {
    label: string
    currentValue: string | undefined
    blurhashRelativePath: string | undefined
    fieldPath: string
    mediaCategory: 'movies' | 'tv'
    originalTitle: string
    context: SyncContext
    onSuccess: (blurhash: string) => Promise<void>
  }): Promise<string | null> {
    const {
      label,
      currentValue,
      blurhashRelativePath,
      fieldPath,
      mediaCategory,
      originalTitle,
      context,
      onSuccess,
    } = params

    // ── 1. Idempotency gate: skip if already stored ─────────────────────────
    if (currentValue) {
      console.log(`⏭️ BlurhashStrategy: "${label}" already stored for "${originalTitle}" — skipping`)
      return null
    }

    // ── 2. Field availability gate: URL must be present ─────────────────────
    if (!blurhashRelativePath) {
      console.log(`⏭️ BlurhashStrategy: no "${label}" URL in fileServerData for "${originalTitle}"`)
      return null
    }

    // ── 3. Server priority gate ──────────────────────────────────────────────
    const isHighestPriority = isCurrentServerHighestPriorityForField(
      context.fieldAvailability,
      mediaCategory,
      originalTitle,
      fieldPath,
      context.serverConfig
    )

    if (!isHighestPriority) {
      console.log(
        `⏭️ BlurhashStrategy: server "${context.serverConfig.id}" does not have highest priority for "${fieldPath}" on "${originalTitle}"`
      )
      return null
    }

    // ── 4. Fetch blurhash string via fetchMetadataMultiServer ────────────────
    console.log(
      `🔍 BlurhashStrategy: fetching "${label}" for "${originalTitle}" (server: "${context.serverConfig.id}", path: ${blurhashRelativePath})`
    )

    const doFetch = async (): Promise<string | null> => {
      try {
        const blurhash = await fetchMetadataMultiServer(
          context.serverConfig.id,
          blurhashRelativePath,
          'blurhash',
          mediaCategory === 'movies' ? 'movie' : 'tv',
          originalTitle
        )
        return blurhash || null
      } catch (fetchError) {
        console.warn(
          `⚠️ BlurhashStrategy: failed to fetch "${label}" for "${originalTitle}":`,
          fetchError instanceof Error ? fetchError.message : String(fetchError)
        )
        return null
      }
    }

    const blurhash = context.resourceManager
      ? await context.resourceManager.throttleHttp(doFetch)
      : await doFetch()

    if (!blurhash) {
      console.log(`⏭️ BlurhashStrategy: "${label}" fetch returned empty/null for "${originalTitle}"`)
      return null
    }

    // ── 5. Persist via repository.update() — not upsert ─────────────────────
    try {
      await onSuccess(blurhash)
      console.log(
        `✅ BlurhashStrategy: "${label}" updated for "${originalTitle}" (server: ${context.serverConfig.id})`
      )
      return `Updated ${label}`
    } catch (dbError) {
      console.error(
        `❌ BlurhashStrategy: failed to persist "${label}" for "${originalTitle}":`,
        dbError instanceof Error ? dbError.message : String(dbError)
      )
      throw dbError
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────────────────────

  private createResult(
    entityId: string,
    context: SyncContext,
    status: SyncStatus,
    changes: string[],
    errors: string[],
    metadata?: Record<string, any>
  ): SyncResult {
    return {
      status,
      entityId,
      mediaType: context.mediaType,
      operation: SyncOperation.Blurhash,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      metadata,
    }
  }

  async validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean> {
    return !!(entity.title && context.serverConfig.id)
  }
}
