/**
 * Season sync service — bulk-write pattern with read-merge-replace.
 *
 * Write pattern:
 *  1. Pre-fetch all existing seasons for the show (one query).
 *  2. Pre-fetch the parent TV show for its _id (showId foreign key).
 *  3. For each season in file-server data, merge onto existing doc with priority.
 *  4. Flush all seasons with a single SeasonRepository.bulkUpsertShow() call.
 *
 * repository.upsert() is NEVER called inside a season loop.
 */

import {
  SeasonEntity,
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus
} from '../../core'

import { SeasonRepository, TVShowRepository } from '../../infrastructure'
import { isCurrentServerHighestPriorityForField, createFullUrl } from '@src/utils/sync/utils'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'

export class SeasonSyncService {
  constructor(
    private readonly seasonRepository: SeasonRepository,
    private readonly tvShowRepository: TVShowRepository
  ) {}

  /**
   * Sync all seasons for a show via a single bulkUpsertShow call.
   *
   * Pattern:
   *  1. Pre-fetch existing seasons + parent show for showId.
   *  2. Build merged SeasonEntity[] from file-server data + existing docs.
   *  3. seasonRepository.bulkUpsertShow(entities) once — never per-season upserts.
   */
  async syncShow(showTitle: string, context: SyncContext): Promise<SyncResult[]> {
    const results: SyncResult[] = []

    syncEventBus.emitStarted(showTitle, MediaType.Season, context.serverConfig.id)

    try {
      const showFileData = context.fileServerData?.tv?.[showTitle]

      if (!showFileData?.seasons) {
        results.push(this.makeResult(showTitle, context, SyncStatus.Skipped, [], [
          'No season data found in file server data for this show'
        ]))
        return results
      }

      // Pre-fetch parent show first to resolve display title, showId, and metadata
      const parentShow = await this.tvShowRepository.findByOriginalTitle(showTitle)
      const showId = (parentShow as any)?._id || null
      // Use the display title for showTitle on seasons (matches legacy document shape)
      const displayTitle = parentShow?.title || showTitle

      // Find existing seasons by display title (legacy uses display title as showTitle)
      const existingSeasons = await this.seasonRepository.findByShow(displayTitle)
      const existingByNumber = new Map(
        existingSeasons.map(s => [s.seasonNumber, s])
      )

      // ---- Accumulate merged entities — do NOT write one by one ----
      const seasonEntities: SeasonEntity[] = []

      for (const [key, fileData] of Object.entries(showFileData.seasons)) {
        const seasonNumber = this.parseSeasonNumber(key)
        if (seasonNumber === null) {
          results.push(this.makeResult(
            `${showTitle} S?`, context, SyncStatus.Skipped, [],
            [`Cannot determine season number for key "${key}"`]
          ))
          continue
        }

        const existing = existingByNumber.get(seasonNumber) || null
        seasonEntities.push(
          await this.buildSeasonEntity(showTitle, displayTitle, seasonNumber, fileData, context, existing, showId, parentShow)
        )
      }

      // ---- Single bulk write for all seasons of the show ----
      if (seasonEntities.length > 0) {
        await this.seasonRepository.bulkUpsertShow(seasonEntities)
      }

      for (const entity of seasonEntities) {
        results.push(this.makeResult(
          `${showTitle} S${entity.seasonNumber}`, context,
          SyncStatus.Completed, [`Upserted season ${entity.seasonNumber}`], []
        ))
      }

      syncEventBus.emitComplete(showTitle, MediaType.Season, context.serverConfig.id, undefined, {
        totalOperations: seasonEntities.length,
        successful: seasonEntities.length,
        failed: 0
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      syncEventBus.emitError(showTitle, MediaType.Season, context.serverConfig.id, msg, SyncOperation.Metadata)
      results.push(this.makeResult(showTitle, context, SyncStatus.Failed, [], [msg]))
    }

    return results
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Build a season entity by merging existing data with incoming file-server
   * data, respecting per-field server priority.
   *
   * Key differences from naive field copy:
   *  - Season metadata lives in the PARENT SHOW's metadata.seasons[] array,
   *    not in the season file-server data directly.
   *  - The poster key in file-server data is "season_poster", not "poster".
   *  - Blurhash fields in file-server data are URL paths (fetched separately
   *    by BlurhashStrategy) — never copied directly to the entity.
   */
  private async buildSeasonEntity(
    showOriginalTitle: string,
    displayTitle: string,
    seasonNumber: number,
    fileData: any,
    context: SyncContext,
    existing: SeasonEntity | null,
    showId: any,
    parentShow: any
  ): Promise<SeasonEntity> {
    const now = new Date()

    // Start from existing doc (preserving ALL fields) or create new
    const entity: SeasonEntity = existing
      ? { ...existing, lastSynced: now }
      : {
          title: `Season ${seasonNumber}`,
          originalTitle: `Season ${seasonNumber}`,
          type: 'season',
          createdAt: now,
          lastSynced: now,
          seasonNumber,
          showTitle: displayTitle,
        }

    // Heal structural fields
    if (!entity.type) entity.type = 'season'
    if (!entity.createdAt) entity.createdAt = now
    if (showId) entity.showId = showId
    // Use display title as showTitle (matches legacy document shape)
    entity.showTitle = displayTitle

    // --- Metadata from parent show (priority-gated) ---
    // Season metadata is stored in the parent TV show's metadata.seasons[] array,
    // NOT in the season's own file-server data.
    const canUpdateMetadata = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, 'metadata', context.serverConfig
    )

    if (canUpdateMetadata) {
      // Season metadata lives in the parent TV show's metadata.seasons[] array
      // Use the DB entity's metadata (already synced by TVShowSyncService) as primary source
      const showMetadata = parentShow?.metadata
      const seasonMetadata = showMetadata?.seasons?.find(
        (s: any) => s.season_number === seasonNumber
      )

      if (seasonMetadata) {
        // Clean metadata: remove episodes array (stored separately)
        const cleanedMetadata = { ...seasonMetadata }
        delete cleanedMetadata.episodes

        entity.metadata = cleanedMetadata
        entity.metadataSource = context.serverConfig.id

        // Extract queryable fields from metadata (matching legacy document shape)
        if (seasonMetadata.name) entity.title = seasonMetadata.name
        if (seasonMetadata.air_date) entity.airDate = new Date(seasonMetadata.air_date)
        if (seasonMetadata.overview) entity.overview = seasonMetadata.overview
        if (seasonMetadata.poster_path) entity.posterPath = seasonMetadata.poster_path
        if (seasonMetadata.vote_average != null) entity.rating = seasonMetadata.vote_average
        if (seasonMetadata.episode_count != null) entity.episodeCount = seasonMetadata.episode_count
      }
    }

    // --- Poster (priority-gated) ---
    // File-server key for season poster is "season_poster", not "poster"
    const posterFieldPath = `seasons.Season ${seasonNumber}.season_poster`
    const canUpdatePoster = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, posterFieldPath, context.serverConfig
    )
    if (canUpdatePoster && (fileData as any)?.season_poster) {
      entity.posterURL = createFullUrl(
        (fileData as any).season_poster,
        context.serverConfig
      )
      entity.posterSource = context.serverConfig.id
    }

    // Episode count from file-server (fallback if metadata didn't provide it)
    if (entity.episodeCount == null) {
      if (typeof (fileData as any)?.episodeCount === 'number') {
        entity.episodeCount = (fileData as any).episodeCount
      } else if ((fileData as any)?.episodes && typeof (fileData as any).episodes === 'object') {
        entity.episodeCount = Object.keys((fileData as any).episodes).length
      }
    }

    // --- Season Poster Blurhash (priority-gated, fetch actual string) ---
    // Legacy pattern: fetchMetadataMultiServer(id, url, 'blurhash', 'tv', originalTitle)
    // Field path: "seasons.Season N.seasonPosterBlurhash"
    const blurhashFieldPath = `seasons.Season ${seasonNumber}.seasonPosterBlurhash`
    const canUpdateBlurhash = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, blurhashFieldPath, context.serverConfig
    )
    if (canUpdateBlurhash && (fileData as any)?.seasonPosterBlurhash) {
      try {
        const blurhashUrl = createFullUrl((fileData as any).seasonPosterBlurhash, context.serverConfig)
        const blurhash = await fetchMetadataMultiServer(
          context.serverConfig.id,
          blurhashUrl,
          'blurhash',
          'tv',
          showOriginalTitle
        )
        if (blurhash && typeof blurhash === 'string' && !(blurhash as any).error) {
          entity.posterBlurhash = blurhash
          entity.posterBlurhashSource = context.serverConfig.id
        }
      } catch {
        // Blurhash fetch failed — preserve existing value from spread
      }
    }

    return entity
  }

  private parseSeasonNumber(key: string): number | null {
    const match = key.match(/(?:season_?|s)?(\d+)/i)
    const n = match ? parseInt(match[1], 10) : NaN
    return n >= 0 ? n : null
  }

  private makeResult(
    entityId: string,
    context: SyncContext,
    status: SyncStatus,
    changes: string[],
    errors: string[]
  ): SyncResult {
    return {
      status,
      entityId,
      mediaType: MediaType.Season,
      operation: SyncOperation.Metadata,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors
    }
  }
}
