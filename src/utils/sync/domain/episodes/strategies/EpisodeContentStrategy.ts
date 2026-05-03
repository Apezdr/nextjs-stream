/**
 * Episode content sync strategy
 * Handles SyncOperation.Content for MediaType.Episode.
 *
 * For each episode this strategy:
 *  1. Locates the file-server episode record via findEpisodeFileName()
 *  2. Builds videoURL from urls.mp4 (preferred) or urls.m3u8 fallback
 *  3. Extracts captionURLs from urls.subtitles
 *  4. Extracts chapterURL from urls.chapters
 *  5. Extracts thumbnailURL from urls.thumbnail
 *  6. Extracts videoInfo from urls.videoInfo or infers from legacy metadata fields
 *
 * All field updates respect the priority system via isCurrentServerHighestPriorityForField.
 * Writes are performed through EpisodeRepository.bulkUpsertSeason() – NEVER one-by-one.
 */

import {
  SyncStrategy,
  SyncContext,
  SyncResult,
  SyncStatus,
  SyncOperation,
  MediaType,
  BaseMediaEntity,
  EpisodeEntity,
  VideoInfo,
  MediaQuality,
  syncEventBus,
} from '../../../core'

import { EpisodeRepository, UrlBuilder } from '../../../infrastructure'
import { FileServerAdapter } from '../../../core'
import { syncLogger } from '../../../core/logger'
import { isCurrentServerHighestPriorityForField, findEpisodeFileName } from '@src/utils/sync/utils'
import { sortSubtitleEntries } from '@src/utils/sync/captions'

export class EpisodeContentStrategy implements SyncStrategy {
  readonly name = 'EpisodeContentStrategy'
  readonly supportedOperations = [SyncOperation.Content]
  readonly supportedMediaTypes = [MediaType.Episode]

  constructor(
    private readonly repository: EpisodeRepository,
    private readonly fileAdapter: FileServerAdapter
  ) {}

  canHandle(context: SyncContext): boolean {
    return (
      context.mediaType === MediaType.Episode &&
      context.operation === SyncOperation.Content
    )
  }

  // ─── Main sync entry-point ────────────────────────────────────────────────

  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const startTime = Date.now()

    const episode = entity as EpisodeEntity | null
    const showTitle =
      context.entityOriginalTitle ?? episode?.showTitle ?? episode?.originalTitle ?? 'unknown'
    const seasonNumber = episode?.seasonNumber ?? 0
    const episodeNumber = episode?.episodeNumber ?? 0
    const entityId = `${showTitle} S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`

    syncLogger.debug(
      `[EpisodeContentStrategy] start: ${entityId}, server=${context.serverConfig.id}`
    )

    if (!showTitle || showTitle === 'unknown') {
      return this.makeResult(entityId, context, SyncStatus.Failed, [],
        ['showTitle is required for EpisodeContentStrategy'],
        { processingTime: Date.now() - startTime })
    }

    try {
      syncEventBus.emitProgress(entityId, MediaType.Episode, context.serverConfig.id,
        SyncOperation.Content, { stage: 'starting', progress: 0 })

      // Locate the raw file-server data for this episode
      const seasonKey = `Season ${seasonNumber}`
      const showData =
        context.fileServerData?.tv?.[showTitle] ??
        context.fileServerData?.tv?.[showTitle.toLowerCase()] ??
        null
      const fileServerSeasonData: Record<string, any> | null =
        showData?.seasons?.[seasonKey] ??
        context.fileServerData?.seasons?.[seasonKey] ??
        null

      const episodeKeys = Object.keys(fileServerSeasonData?.episodes ?? {})
      const episodeFileName = findEpisodeFileName(episodeKeys, seasonNumber, episodeNumber) ?? null
      const fileServerEpisodeData: Record<string, any> | null =
        episodeFileName ? (fileServerSeasonData?.episodes?.[episodeFileName] ?? null) : null

      if (!fileServerEpisodeData) {
        syncLogger.debug(`[EpisodeContentStrategy] No file-server data for ${entityId} – skipping`)
        return this.makeResult(entityId, context, SyncStatus.Skipped, [], [],
          { processingTime: Date.now() - startTime })
      }

      const epFile = episodeFileName ?? `S${String(seasonNumber).padStart(2,'0')}E${String(episodeNumber).padStart(2,'0')}`

      // Build the content updates
      const updates = await this.buildContentUpdates(
        showTitle, seasonNumber, episodeNumber, epFile,
        fileServerEpisodeData, fileServerSeasonData, episode, context
      )

      const changes = Object.keys(updates)

      if (changes.length > 0) {
        const merged: EpisodeEntity = {
          ...(episode ?? this.makeBareEpisode(showTitle, seasonNumber, episodeNumber)),
          ...updates,
          lastSynced: new Date(),
        }
        await this.repository.bulkUpsertSeason([merged])
        syncLogger.debug(`[EpisodeContentStrategy] Updated ${entityId}: ${changes.join(', ')}`)
        syncEventBus.emitProgress(entityId, MediaType.Episode, context.serverConfig.id,
          SyncOperation.Content, { stage: 'completed', progress: 100, updatedFields: changes })
      } else {
        syncLogger.debug(`[EpisodeContentStrategy] No changes for ${entityId}`)
        syncEventBus.emitProgress(entityId, MediaType.Episode, context.serverConfig.id,
          SyncOperation.Content, { stage: 'unchanged', progress: 100 })
      }

      return this.makeResult(
        entityId, context,
        changes.length > 0 ? SyncStatus.Completed : SyncStatus.Skipped,
        changes.map(k => `Updated ${k}`), [],
        { processingTime: Date.now() - startTime, contentProcessed: changes }
      )
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      syncEventBus.emitError(entityId, MediaType.Episode, context.serverConfig.id,
        msg, SyncOperation.Content)
      return this.makeResult(entityId, context, SyncStatus.Failed, [], [msg],
        { processingTime: Date.now() - startTime })
    }
  }

  async validate?(entity: BaseMediaEntity, _context: SyncContext): Promise<boolean> {
    const ep = entity as EpisodeEntity
    return !!(ep.showTitle && typeof ep.episodeNumber === 'number')
  }

  // ─── Content update builder ───────────────────────────────────────────────

  private async buildContentUpdates(
    showTitle: string,
    seasonNumber: number,
    episodeNumber: number,
    epFile: string,
    epData: Record<string, any>,
    seasonData: Record<string, any> | null,
    currentEpisode: EpisodeEntity | null,
    context: SyncContext
  ): Promise<Partial<EpisodeEntity>> {
    const updates: Partial<EpisodeEntity> = {}

    // 1. videoURL ──────────────────────────────────────────────────────────
    const videoFieldPath = `seasons.Season ${seasonNumber}.episodes.${epFile}.videoURL`
    if (this.hasHighestPriority(showTitle, videoFieldPath, context)) {
      const videoURL = this.extractVideoUrl(epData, context)
      if (videoURL && videoURL !== currentEpisode?.videoURL) {
        updates.videoURL = videoURL
        ;(updates as any).videoSource = context.serverConfig.id
        syncLogger.debug(`[EpisodeContentStrategy] videoURL → ${videoURL}`)
      }
    }

    // 2. captionURLs ───────────────────────────────────────────────────────
    const captionUpdates = this.extractCaptions(
      showTitle, seasonNumber, epFile, epData, currentEpisode, context
    )
    if (captionUpdates) {
      ;(updates as any).captionURLs = captionUpdates.captionURLs
      ;(updates as any).captionSource = captionUpdates.captionSource
    }

    // 3. chapterURL ────────────────────────────────────────────────────────
    const chapterFieldPath = `seasons.Season ${seasonNumber}.episodes.${epFile}.chapters`
    if (this.hasHighestPriority(showTitle, chapterFieldPath, context)) {
      const chapterURL = this.extractChapterUrl(epData, context)
      if (chapterURL && chapterURL !== (currentEpisode as any)?.chapterURL) {
        ;(updates as any).chapterURL = chapterURL
        ;(updates as any).chapterSource = context.serverConfig.id
        syncLogger.debug(`[EpisodeContentStrategy] chapterURL → ${chapterURL}`)
      }
    }

    // 4. thumbnailURL ──────────────────────────────────────────────────────
    const thumbFieldPath = `seasons.Season ${seasonNumber}.episodes.${epFile}.thumbnail`
    if (this.hasHighestPriority(showTitle, thumbFieldPath, context)) {
      const thumbnailURL = this.extractThumbnailUrl(epData, context)
      if (thumbnailURL && thumbnailURL !== currentEpisode?.thumbnail) {
        updates.thumbnail = thumbnailURL
        ;(updates as any).thumbnailSource = context.serverConfig.id
        syncLogger.debug(`[EpisodeContentStrategy] thumbnailURL → ${thumbnailURL}`)
      }
    }

    // 5. videoInfo ─────────────────────────────────────────────────────────
    if (this.hasHighestPriorityForAnyVideoInfoField(showTitle, epFile, seasonNumber, context)) {
      const videoInfo = this.extractVideoInfo(epData, seasonData, epFile)
      if (videoInfo && this.videoInfoChanged(currentEpisode?.videoInfo, videoInfo)) {
        updates.videoInfo = videoInfo
        ;(updates as any).videoInfoSource = context.serverConfig.id
        syncLogger.debug(`[EpisodeContentStrategy] videoInfo updated`)
      }
    }

    return updates
  }

  // ─── Field extractors ─────────────────────────────────────────────────────

  /** Build full video URL from urls.mp4 or urls.m3u8 */
  private extractVideoUrl(epData: Record<string, any>, context: SyncContext): string | null {
    try {
      const mp4Path: string | undefined = epData?.urls?.mp4 ?? epData?.videoURL
      if (mp4Path) {
        return UrlBuilder.createFullUrl(this.stripPrefix(mp4Path, context), context.serverConfig)
      }
      const m3u8Path: string | undefined = epData?.urls?.m3u8
      if (m3u8Path) {
        return UrlBuilder.createFullUrl(this.stripPrefix(m3u8Path, context), context.serverConfig)
      }
      return null
    } catch { return null }
  }

  /** Extract and merge caption tracks from urls.subtitles */
  private extractCaptions(
    showTitle: string,
    seasonNumber: number,
    epFile: string,
    epData: Record<string, any>,
    currentEpisode: EpisodeEntity | null,
    context: SyncContext
  ): { captionURLs: Record<string, any>; captionSource: string | null } | null {
    const subtitles = epData?.urls?.subtitles ?? epData?.subtitles
    if (!subtitles || typeof subtitles !== 'object') return null

    const currentCaptions: Record<string, any> = (currentEpisode as any)?.captionURLs ?? {}
    const finalCaptions: Record<string, any> = { ...currentCaptions }
    const seenFromThisServer = new Set<string>()
    let changed = false

    for (const [langName, subtitleData] of Object.entries(subtitles)) {
      if (!subtitleData || typeof subtitleData !== 'object') continue
      const fieldPath = `seasons.Season ${seasonNumber}.episodes.${epFile}.subtitles.${langName}.url`
      if (!this.hasHighestPriority(showTitle, fieldPath, context)) continue

      const sd = subtitleData as Record<string, any>
      const rawUrl: string | undefined = sd.url
      if (!rawUrl) continue

      const fullUrl = UrlBuilder.createFullUrl(this.stripPrefix(rawUrl, context), context.serverConfig)
      seenFromThisServer.add(langName)

      const existing = finalCaptions[langName]
      if (!existing || existing.url !== fullUrl || existing.lastModified !== sd.lastModified
          || existing.sourceServerId !== context.serverConfig.id) {
        finalCaptions[langName] = {
          srcLang: sd.srcLang ?? 'en',
          url: fullUrl,
          lastModified: sd.lastModified,
          sourceServerId: context.serverConfig.id,
        }
        changed = true
      }
    }

    for (const [lang, caption] of Object.entries(finalCaptions)) {
      if ((caption as any).sourceServerId === context.serverConfig.id && !seenFromThisServer.has(lang)) {
        delete finalCaptions[lang]
        changed = true
      }
    }

    if (!changed) return null

    const sortedEntries = sortSubtitleEntries(Object.entries(finalCaptions))
    const captionSource = sortedEntries.length > 0 ? (sortedEntries[0][1] as any).sourceServerId : null
    return { captionURLs: Object.fromEntries(sortedEntries), captionSource }
  }

  /** Extract chapter URL from urls.chapters */
  private extractChapterUrl(epData: Record<string, any>, context: SyncContext): string | null {
    try {
      const raw: string | undefined = epData?.urls?.chapters ?? epData?.chapters
      if (!raw) return null
      return UrlBuilder.createFullUrl(this.stripPrefix(raw, context), context.serverConfig)
    } catch { return null }
  }

  /** Extract thumbnail URL from urls.thumbnail */
  private extractThumbnailUrl(epData: Record<string, any>, context: SyncContext): string | null {
    try {
      const raw: string | undefined = epData?.urls?.thumbnail ?? epData?.thumbnail
      if (!raw) return null
      return UrlBuilder.createFullUrl(this.stripPrefix(raw, context), context.serverConfig)
    } catch { return null }
  }

  /**
   * Extract VideoInfo from urls.videoInfo (preferred) or infer from legacy metadata.
   * Legacy shape: mediaQuality, hdr, additionalMetadata, seasons.lengths[epFile],
   * seasons.dimensions[epFile].
   */
  private extractVideoInfo(
    epData: Record<string, any>,
    seasonData: Record<string, any> | null,
    epFile: string
  ): VideoInfo | null {
    try {
      // Prefer explicit urls.videoInfo block
      if (epData?.urls?.videoInfo && typeof epData.urls.videoInfo === 'object') {
        const vi = epData.urls.videoInfo as Record<string, any>
        return {
          duration: vi.duration ?? vi.length ?? undefined,
          resolution: vi.resolution ?? vi.dimensions ?? undefined,
          codec: vi.codec ?? undefined,
          bitrate: vi.bitrate ?? undefined,
          frameRate: vi.frameRate ?? vi.fps ?? undefined,
          audioCodec: vi.audioCodec ?? undefined,
          audioChannels: vi.audioChannels ?? undefined,
          fileSize: vi.fileSize ?? vi.size ?? undefined,
          mediaQuality: vi.mediaQuality ?? undefined,
        }
      }

      // Infer from legacy flat-sync fields
      const additionalMetadata = epData?.additionalMetadata ?? {}
      const mediaQuality: MediaQuality | undefined = epData?.mediaQuality ?? undefined
      const hdr: string | undefined = epData?.hdr ?? undefined
      const rawDuration = seasonData?.lengths?.[epFile] ?? additionalMetadata?.duration ?? undefined
      const rawDimensions = seasonData?.dimensions?.[epFile] ?? additionalMetadata?.dimensions ?? undefined
      const rawFileSize: number | undefined =
        additionalMetadata?.size?.kb ?? additionalMetadata?.size ?? epData?.size ?? undefined

      if (rawDuration === undefined && rawDimensions === undefined
          && !hdr && !mediaQuality && rawFileSize === undefined) {
        return null
      }

      const videoInfo: VideoInfo = {}
      if (rawDuration !== undefined) videoInfo.duration = Number(rawDuration)
      if (rawDimensions !== undefined) videoInfo.resolution = String(rawDimensions)
      if (rawFileSize !== undefined) videoInfo.fileSize = Number(rawFileSize)
      if (mediaQuality !== undefined) videoInfo.mediaQuality = mediaQuality
      if (hdr) videoInfo.mediaQuality = { ...(videoInfo.mediaQuality ?? {}), hdrFormat: hdr } as MediaQuality
      return videoInfo
    } catch { return null }
  }

  // ─── Priority helpers ─────────────────────────────────────────────────────

  private hasHighestPriority(showTitle: string, fieldPath: string, context: SyncContext): boolean {
    if (!context.fieldAvailability) {
      syncLogger.debug(`[EpisodeContentStrategy] No fieldAvailability – defaulting true for ${fieldPath}`)
      return true
    }
    const result = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showTitle, fieldPath, context.serverConfig
    )
    syncLogger.debug(
      `[EpisodeContentStrategy] priority: field="${fieldPath}" server=${context.serverConfig.id} result=${result}`
    )
    return result
  }

  private hasHighestPriorityForAnyVideoInfoField(
    showTitle: string, epFile: string, seasonNumber: number, context: SyncContext
  ): boolean {
    const fields = [
      `seasons.Season ${seasonNumber}.dimensions.${epFile}`,
      `seasons.Season ${seasonNumber}.lengths.${epFile}`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.hdr`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.additionalMetadata.size.kb`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.format`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.bitDepth`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.colorSpace`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.transferCharacteristics`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.isHDR`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.viewingExperience.enhancedColor`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.viewingExperience.highDynamicRange`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.viewingExperience.dolbyVision`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.viewingExperience.hdr10Plus`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.mediaQuality.viewingExperience.standardHDR`,
      `seasons.Season ${seasonNumber}.episodes.${epFile}.urls.videoInfo`,
    ]
    return fields.some(f => this.hasHighestPriority(showTitle, f, context))
  }

  // ─── Utility helpers ──────────────────────────────────────────────────────

  private stripPrefix(path: string, context: SyncContext): string {
    const prefix = context.serverConfig.prefix
    if (prefix && path.startsWith(prefix)) return path.substring(prefix.length)
    return path
  }

  private videoInfoChanged(current: VideoInfo | undefined | null, incoming: VideoInfo): boolean {
    if (!current) return true
    return (
      current.duration !== incoming.duration ||
      current.resolution !== incoming.resolution ||
      current.codec !== incoming.codec ||
      current.bitrate !== incoming.bitrate ||
      current.frameRate !== incoming.frameRate ||
      current.audioCodec !== incoming.audioCodec ||
      current.audioChannels !== incoming.audioChannels ||
      current.fileSize !== incoming.fileSize
    )
  }

  private makeBareEpisode(showTitle: string, seasonNumber: number, episodeNumber: number): EpisodeEntity {
    return {
      title: `Episode ${episodeNumber}`,
      originalTitle: showTitle,
      showTitle,
      seasonNumber,
      episodeNumber,
      lastSynced: new Date(),
      metadata: {},
    } as EpisodeEntity
  }

  // ─── Result factory ───────────────────────────────────────────────────────

  private makeResult(
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
      mediaType: MediaType.Episode,
      operation: SyncOperation.Content,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      metadata,
    }
  }
}
