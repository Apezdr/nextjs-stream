/**
 * Episode sync service — bulk-write pattern with read-merge-replace.
 *
 * Write pattern:
 *  1. Pre-fetch all existing episodes for the season (one query).
 *  2. Pre-fetch the parent TV show + season for showId/seasonId foreign keys.
 *  3. For each episode in file-server data, merge onto existing doc with priority.
 *  4. Flush all episodes with a single EpisodeRepository.bulkUpsertSeason() call.
 *
 * repository.upsert() is NEVER called inside an episode loop.
 */

import {
  EpisodeEntity,
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus
} from '../../core'

import { EpisodeRepository, SeasonRepository, TVShowRepository } from '../../infrastructure'
import { isCurrentServerHighestPriorityForField, createFullUrl, processCaptionURLs } from '@src/utils/sync/utils'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'

export class EpisodeSyncService {
  constructor(
    private readonly episodeRepository: EpisodeRepository,
    private readonly seasonRepository: SeasonRepository,
    private readonly tvShowRepository: TVShowRepository
  ) {}

  /**
   * Sync all episodes for one season via a single bulkUpsertSeason call.
   *
   * Pattern:
   *  1. Pre-fetch existing episodes + parent show/season for foreign keys.
   *  2. Build merged EpisodeEntity[] from file-server data + existing docs.
   *  3. episodeRepository.bulkUpsertSeason(entities) once — never per-episode upserts.
   */
  async syncSeason(
    showTitle: string,
    seasonNumber: number,
    context: SyncContext
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []
    const label = `${showTitle} S${seasonNumber}`

    syncEventBus.emitStarted(label, MediaType.Episode, context.serverConfig.id)

    try {
      const seasonFileData = this.extractSeasonFileData(showTitle, seasonNumber, context)

      if (!seasonFileData) {
        results.push(this.makeResult(label, context, SyncStatus.Skipped, [], [
          'No file server data found for this season'
        ]))
        return results
      }

      // Pre-fetch parent show first to resolve display title and foreign keys
      const parentShow = await this.tvShowRepository.findByOriginalTitle(showTitle)
      const showId = (parentShow as any)?._id || null
      // Use the display title for showTitle on episodes (matches legacy document shape)
      const displayTitle = parentShow?.title || showTitle

      // Find existing episodes and parent season using display title
      const [existingEpisodes, parentSeason] = await Promise.all([
        this.episodeRepository.findByShowAndSeason(displayTitle, seasonNumber),
        this.seasonRepository.findSeason(displayTitle, seasonNumber)
      ])

      const existingByNumber = new Map(
        existingEpisodes.map(e => [e.episodeNumber, e])
      )

      const seasonId = (parentSeason as any)?._id || null

      // ---- Accumulate merged entities — do NOT write one by one ----
      const episodeEntities: EpisodeEntity[] = []

      for (const [key, fileData] of Object.entries(seasonFileData.episodes || {})) {
        const epNum = this.parseEpisodeNumber(key, fileData)
        if (epNum === null) {
          results.push(this.makeResult(
            `${label}E?`, context, SyncStatus.Skipped, [],
            [`Cannot determine episode number for key "${key}"`]
          ))
          continue
        }

        const existing = existingByNumber.get(epNum) || null
        episodeEntities.push(
          await this.buildEpisodeEntity(showTitle, displayTitle, seasonNumber, epNum, fileData, context, existing, showId, seasonId, parentShow, seasonFileData, key)
        )
      }

      // ---- Single bulk write for the whole season ----
      if (episodeEntities.length > 0) {
        await this.episodeRepository.bulkUpsertSeason(episodeEntities)
      }

      for (const entity of episodeEntities) {
        results.push(this.makeResult(
          `${label}E${entity.episodeNumber}`, context,
          SyncStatus.Completed, [`Upserted episode ${entity.episodeNumber}`], []
        ))
      }

      syncEventBus.emitComplete(label, MediaType.Episode, context.serverConfig.id, undefined, {
        totalOperations: episodeEntities.length,
        successful: episodeEntities.length,
        failed: 0
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      syncEventBus.emitError(label, MediaType.Episode, context.serverConfig.id, msg, SyncOperation.Content)
      results.push(this.makeResult(label, context, SyncStatus.Failed, [], [msg]))
    }

    return results
  }

  /**
   * Sync all seasons (and their episodes) for a show.
   * Each season triggers exactly one bulkUpsertSeason() call.
   */
  async syncShow(showTitle: string, context: SyncContext): Promise<SyncResult[]> {
    const showData = context.fileServerData?.tv?.[showTitle]
    if (!showData) {
      return [this.makeResult(showTitle, context, SyncStatus.Skipped, [], [
        'No file server data found for this show'
      ])]
    }

    const allResults: SyncResult[] = []
    for (const key of Object.keys(showData.seasons || {})) {
      const seasonNumber = this.parseSeasonNumber(key)
      if (seasonNumber === null) continue
      allResults.push(...await this.syncSeason(showTitle, seasonNumber, context))
    }
    return allResults
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractSeasonFileData(showTitle: string, seasonNumber: number, context: SyncContext): any {
    const showData = context.fileServerData?.tv?.[showTitle]
    if (!showData?.seasons) return null

    for (const candidate of [
      String(seasonNumber),
      `Season ${seasonNumber}`,
      `season_${seasonNumber}`,
      `S${String(seasonNumber).padStart(2, '0')}`
    ]) {
      if (showData.seasons[candidate]) return showData.seasons[candidate]
    }

    for (const [key, data] of Object.entries(showData.seasons)) {
      if (this.parseSeasonNumber(key) === seasonNumber) return data
    }
    return null
  }

  /**
   * Build an episode entity by merging existing data with incoming file-server
   * data, respecting per-field server priority.
   *
   * Key differences from naive field copy:
   *  - fileData.metadata is a URL path, not inline data — must be fetched via
   *    fetchMetadataMultiServer. Fallback: parent show's metadata.seasons[].episodes[].
   *  - fileData.thumbnailBlurhash is a URL path to a blurhash file, not the actual
   *    blurhash string. Existing values are preserved from the spread; BlurhashStrategy
   *    handles fetching actual values.
   */
  private async buildEpisodeEntity(
    showOriginalTitle: string,
    displayTitle: string,
    seasonNumber: number,
    episodeNumber: number,
    fileData: any,
    context: SyncContext,
    existing: EpisodeEntity | null,
    showId: any,
    seasonId: any,
    parentShow: any,
    seasonFileData?: any,
    episodeFileName?: string
  ): Promise<EpisodeEntity> {
    const now = new Date()

    // Start from existing doc (preserving ALL fields) or create new
    const entity: EpisodeEntity = existing
      ? { ...existing, lastSynced: now }
      : {
          title: fileData?.title || `Episode ${episodeNumber}`,
          originalTitle: showOriginalTitle,  // Show's filesystem key (matches legacy)
          type: 'episode',
          createdAt: now,
          lastSynced: now,
          episodeNumber,
          seasonNumber,
          showTitle: displayTitle,
        }

    // Heal structural fields
    if (!entity.type) entity.type = 'episode'
    if (!entity.createdAt) entity.createdAt = now
    if (showId) entity.showId = showId
    if (seasonId) entity.seasonId = seasonId
    // Use display title as showTitle (matches legacy document shape)
    entity.showTitle = displayTitle

    // --- Video URL (priority-gated, use originalTitle for field availability lookup) ---
    const canUpdateVideo = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, 'videoURL', context.serverConfig
    )
    if (canUpdateVideo && fileData?.videoURL) {
      entity.videoURL = createFullUrl(fileData.videoURL, context.serverConfig)
      entity.videoSource = context.serverConfig.id
      entity.normalizedVideoId = generateNormalizedVideoId(entity.videoURL)
    }

    // --- Video info (follows video priority) ---
    if (canUpdateVideo && fileData?.videoInfo && typeof fileData.videoInfo === 'object') {
      entity.videoInfo = fileData.videoInfo
      entity.videoInfoSource = context.serverConfig.id
    }

    // --- Top-level video info fields (flat, matching legacy document shape) ---
    // Legacy extracts these from season-level and episode-level file server data
    // and stores videoInfoSource alongside them
    if (canUpdateVideo) {
      let hasVideoInfoFields = false

      // Duration from season-level lengths map (e.g., seasonFileData.lengths["S01E01"])
      if (seasonFileData?.lengths && episodeFileName && seasonFileData.lengths[episodeFileName] != null) {
        entity.duration = seasonFileData.lengths[episodeFileName]
        hasVideoInfoFields = true
      }
      // Dimensions from season-level dimensions map
      if (seasonFileData?.dimensions && episodeFileName && seasonFileData.dimensions[episodeFileName]) {
        entity.dimensions = seasonFileData.dimensions[episodeFileName]
        hasVideoInfoFields = true
      }
      // HDR, size, mediaQuality, mediaLastModified from episode-level file data
      if (fileData?.hdr !== undefined && fileData.hdr !== null) {
        entity.hdr = fileData.hdr
        hasVideoInfoFields = true
      }
      if (fileData?.size != null) {
        entity.size = fileData.size
        hasVideoInfoFields = true
      } else if (fileData?.additionalMetadata?.size?.kb != null) {
        entity.size = fileData.additionalMetadata.size.kb
        hasVideoInfoFields = true
      }
      if (fileData?.mediaQuality) {
        entity.mediaQuality = fileData.mediaQuality
        hasVideoInfoFields = true
      }
      if (fileData?.mediaLastModified) {
        entity.mediaLastModified = new Date(fileData.mediaLastModified)
        hasVideoInfoFields = true
      }

      // Set videoInfoSource when any top-level video info field was extracted
      if (hasVideoInfoFields) {
        entity.videoInfoSource = context.serverConfig.id
      }
    }

    // --- Thumbnail (priority-gated) ---
    const canUpdateThumbnail = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, 'thumbnail', context.serverConfig
    )
    if (canUpdateThumbnail && (fileData?.thumbnail || fileData?.thumbnailURL)) {
      entity.thumbnail = createFullUrl(
        fileData.thumbnail || fileData.thumbnailURL,
        context.serverConfig
      )
      entity.thumbnailSource = context.serverConfig.id
    }

    // --- Captions (priority-gated) ---
    // Legacy field: captionURLs (object keyed by language), NOT captions (array)
    // File server data key: "subtitles" (not "captions")
    if (fileData?.subtitles && typeof fileData.subtitles === 'object') {
      const processed = processCaptionURLs(fileData.subtitles, context.serverConfig)
      if (processed && Object.keys(processed).length > 0) {
        // Merge with existing captionURLs (preserve captions from other servers)
        const merged = { ...(existing?.captionURLs || {}), ...processed }
        entity.captionURLs = merged
        entity.captionSource = context.serverConfig.id
      }
    }

    // --- Chapters (priority-gated) ---
    // Legacy stores chapterURL as a single URL string (not an array)
    const canUpdateChapters = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, 'chapters', context.serverConfig
    )
    if (canUpdateChapters && fileData?.chapters) {
      entity.chapterURL = createFullUrl(fileData.chapters, context.serverConfig)
      entity.chapterSource = context.serverConfig.id
    }

    // --- Metadata (priority-gated) ---
    const canUpdateMetadata = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, 'metadata', context.serverConfig
    )
    if (canUpdateMetadata && fileData?.metadata) {
      // fileData.metadata is typically a URL path — fetch actual metadata from file server
      let episodeMetadata: any = null

      if (typeof fileData.metadata === 'string') {
        try {
          episodeMetadata = await fetchMetadataMultiServer(
            context.serverConfig.id,
            fileData.metadata,
            'file',
            'tv',
            showOriginalTitle
          )
        } catch {
          // Fetch failed — try fallback below
        }
      } else if (typeof fileData.metadata === 'object') {
        episodeMetadata = fileData.metadata
      }

      // Fallback: parent show's metadata.seasons[].episodes[] array
      if (!episodeMetadata || episodeMetadata.error) {
        const seasonMeta = parentShow?.metadata?.seasons?.find(
          (s: any) => s.season_number === seasonNumber
        )
        if (seasonMeta?.episodes) {
          episodeMetadata = seasonMeta.episodes.find(
            (e: any) => e.episode_number === episodeNumber
          )
        }
      }

      if (episodeMetadata && typeof episodeMetadata === 'object' && !episodeMetadata.error) {
        entity.metadata = episodeMetadata
        entity.metadataSource = context.serverConfig.id

        // Extract title from metadata if available
        if (episodeMetadata.name) entity.title = episodeMetadata.name
      }
    }

    // --- Thumbnail Blurhash (priority-gated, fetch actual string) ---
    // Legacy pattern: fetchMetadataMultiServer(id, url, 'blurhash', 'tv', originalTitle)
    if (fileData?.thumbnailBlurhash) {
      // Build the field path matching legacy: "seasons.Season N.episodes.FILENAME.thumbnailBlurhash"
      const seasonKey = Object.keys(
        context.fileServerData?.tv?.[showOriginalTitle]?.seasons || {}
      ).find(k => this.parseSeasonNumber(k) === seasonNumber) || String(seasonNumber)
      const blurhashFieldPath = `seasons.${seasonKey}.thumbnailBlurhash`

      const canUpdateBlurhash = isCurrentServerHighestPriorityForField(
        context.fieldAvailability, 'tv', showOriginalTitle, blurhashFieldPath, context.serverConfig
      )
      if (canUpdateBlurhash) {
        try {
          const blurhashUrl = createFullUrl(fileData.thumbnailBlurhash, context.serverConfig)
          const blurhash = await fetchMetadataMultiServer(
            context.serverConfig.id,
            blurhashUrl,
            'blurhash',
            'tv',
            showOriginalTitle
          )
          if (blurhash && typeof blurhash === 'string' && !(blurhash as any).error) {
            entity.thumbnailBlurhash = blurhash
            entity.thumbnailBlurhashSource = context.serverConfig.id
          }
        } catch {
          // Blurhash fetch failed — preserve existing value from spread
        }
      }
    }

    return entity
  }

  private parseEpisodeNumber(key: string, data: any): number | null {
    if (typeof data?.episodeNumber === 'number' && data.episodeNumber > 0) return data.episodeNumber
    const match = key.match(/(?:episode_?|ep_?|e)?(\d+)/i)
    const n = match ? parseInt(match[1], 10) : NaN
    return n > 0 ? n : null
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
      mediaType: MediaType.Episode,
      operation: SyncOperation.Content,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors
    }
  }
}
