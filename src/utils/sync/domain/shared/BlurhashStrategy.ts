/**
 * BlurhashStrategy - Shared cross-domain blurhash computation strategy
 *
 * This is a post-entity strategy: it runs AFTER the Metadata, Asset and Content
 * strategies, on the document with their changes. It is the second attempt at
 * a movie's poster and backdrop blurhash: the asset strategy has already
 * applied the blurhash rule (core/imageAndBlurhash), and what is left here is
 * a blurhash that rule told it to fetch and it did not get. The same rule
 * decides here.
 *
 * Supported media types: Movie
 * Operation:            SyncOperation.Blurhash
 *
 * Computation pattern:
 *   1. Decide with core/imageAndBlurhash, on the image's owner and locks
 *   2. Fetch the pre-computed blurhash string via fetchMetadataMultiServer
 *   3. Persist only the blurhash fields (into the consolidated movie write)
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
  syncEventBus,
} from '../../core'

import { MovieRepository, fetchMetadataMultiServer, fileServerUrl, isTopLevelFieldLocked } from '../../infrastructure'
import { isCurrentServerHighestPriorityForReportedField } from '@src/utils/sync/core/ownership'
import { decideBlurhash, settleBlurhash } from '@src/utils/sync/core/imageAndBlurhash'

// ────────────────────────────────────────────────────────────────────────────
// The movie images that carry a blurhash
// ────────────────────────────────────────────────────────────────────────────

const MOVIE_IMAGES = [
  {
    /** The blurhash field, and the key of its file in the payload's `urls`. */
    label: 'posterBlurhash',
    sourceField: 'posterBlurhashSource',
    /** The image's field on the document, and its key in the payload's `urls`. */
    imageField: 'posterURL',
    payloadKey: 'poster',
    /** fieldAvailability path of the blurhash, named in the log line. */
    fieldPath: 'urls.posterBlurhash',
  },
  {
    label: 'backdropBlurhash',
    sourceField: 'backdropBlurhashSource',
    imageField: 'backdrop',
    payloadKey: 'backdrop',
    fieldPath: 'urls.backdropBlurhash',
  },
] as const

// ────────────────────────────────────────────────────────────────────────────
// BlurhashStrategy
// ────────────────────────────────────────────────────────────────────────────

export class BlurhashStrategy implements SyncStrategy {
  readonly name = 'BlurhashStrategy'
  readonly supportedOperations = [SyncOperation.Blurhash]
  readonly supportedMediaTypes = [MediaType.Movie]

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

    // Resolve entity from the DB when not passed in directly
    let entity = movie
    if (!entity) {
      entity = await this.repository.findByOriginalTitle(originalTitle)
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

    for (const image of MOVIE_IMAGES) {
      const change = await this.retryMissingBlurhash(image, entity, fileServerMovieData.urls, originalTitle, context)
      if (change) changes.push(change)
    }

    return changes
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Core: the second attempt at one blurhash
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * The second attempt at one image's blurhash, through fetchMetadataMultiServer.
   *
   * The asset strategy has already applied the rule (core/imageAndBlurhash) to
   * the stored document earlier in this pass: a blurhash it kept, wrote or
   * asked to remove is settled, and `entity` (the document with this pass's
   * changes so far) still carries it. What is left for this attempt is a
   * blurhash the rule told it to fetch, for an image with none, that it did
   * not get. The same rule decides here, on the same locks and the same owner.
   *
   * Returns the change label when the blurhash was written, null otherwise.
   */
  private async retryMissingBlurhash(
    image: (typeof MOVIE_IMAGES)[number],
    entity: MovieEntity,
    urls: Record<string, any>,
    originalTitle: string,
    context: SyncContext
  ): Promise<string | null> {
    const { label, sourceField, imageField, payloadKey } = image
    const currentValue = (entity as any)[label] as string | undefined
    const blurhashRelativePath = urls[label] as string | undefined
    const imagePath = urls[payloadKey]
    const lockedFields = (entity as any).lockedFields

    const decision = decideBlurhash({
      stored: { url: (entity as any)[imageField], blurhash: currentValue, blurhashSource: (entity as any)[sourceField] },
      reported: {
        url: typeof imagePath === 'string' && imagePath ? fileServerUrl(imagePath, context.serverConfig) : null,
        blurhashUrl: blurhashRelativePath,
      },
      // A blurhash is of one image, so it comes from the server that owns that
      // image: ranked on its own it could be another server's, of another file.
      owner: isCurrentServerHighestPriorityForReportedField(
        context.fieldAvailability,
        'movies',
        originalTitle,
        `urls.${payloadKey}`,
        context.serverConfig
      )
        ? context.serverConfig.id
        : null,
      locks: {
        image: isTopLevelFieldLocked(lockedFields, imageField),
        blurhash: isTopLevelFieldLocked(lockedFields, label),
      },
    })

    // An admin lock leaves the blurhash alone.
    if (decision.action === 'keep' && decision.reason === 'locked') return null

    if (currentValue) {
      console.log(`⏭️ BlurhashStrategy: "${label}" already stored for "${originalTitle}" — skipping`)
      return null
    }

    if (!blurhashRelativePath) {
      console.log(`⏭️ BlurhashStrategy: no "${label}" URL in fileServerData for "${originalTitle}"`)
      return null
    }

    if (decision.action !== 'fetch') {
      console.log(
        `⏭️ BlurhashStrategy: server "${context.serverConfig.id}" does not have highest priority for "${image.fieldPath}" on "${originalTitle}"`
      )
      return null
    }

    console.log(
      `🔍 BlurhashStrategy: fetching "${label}" for "${originalTitle}" (server: "${context.serverConfig.id}", path: ${blurhashRelativePath})`
    )

    // fetchMetadataMultiServer takes the ResourceManager's HTTP slot itself:
    // wrapping it in throttleHttp would hold one slot while waiting for another.
    let fetched: unknown = null
    try {
      fetched = await fetchMetadataMultiServer(
        context.serverConfig.id,
        decision.blurhashUrl,
        'blurhash',
        'movie',
        originalTitle
      )
    } catch (fetchError) {
      console.warn(
        `⚠️ BlurhashStrategy: failed to fetch "${label}" for "${originalTitle}":`,
        fetchError instanceof Error ? fetchError.message : String(fetchError)
      )
    }
    const outcome = settleBlurhash(decision, fetched)

    // The file server publishes this blurhash, and it is still missing after
    // this attempt (or was fetched after all). MovieSyncService reads the set:
    // while anything is in it the pass is not marked complete, so the title is
    // not skipped from now on with the blurhash missing.
    const failures = context.pendingMovieFetchFailures
    if (failures) {
      const forTitle = failures.get(originalTitle) ?? new Set<string>()
      if (outcome.action === 'write') forTitle.delete(label)
      else forTitle.add(label)
      failures.set(originalTitle, forTitle)
    }

    if (outcome.action !== 'write') {
      console.log(`⏭️ BlurhashStrategy: "${label}" fetch returned empty/null for "${originalTitle}"`)
      return null
    }

    // ── Persist ──────────────────────────────────────────────────────────────
    const blurhashUpdate = { [label]: outcome.blurhash, [sourceField]: outcome.blurhashSource }
    try {
      // Into the consolidated movie write. MovieSyncService, the only caller,
      // creates the pending map before any strategy runs; without it there is
      // nowhere to write, and the pass fails rather than writing on its own.
      const pending = context.pendingMovieUpdates
      if (!pending) {
        throw new Error(`no pending movie update for "${originalTitle}": BlurhashStrategy runs inside MovieSyncService`)
      }
      pending.set(originalTitle, { ...(pending.get(originalTitle) || {}), ...blurhashUpdate })
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
