/**
 * Episode sync service — bulk-write pattern only.
 *
 * All episodes for a season are accumulated into an array then flushed with
 * a single EpisodeRepository.bulkUpsertSeason(episodes[]) call.
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

import { EpisodeRepository, SeasonRepository } from '../../infrastructure'

export class EpisodeSyncService {
  constructor(
    private readonly episodeRepository: EpisodeRepository,
    private readonly seasonRepository: SeasonRepository
  ) {}

  /**
   * Sync all episodes for one season via a single bulkUpsertSeason call.
   *
   * Pattern:
   *  1. Accumulate EpisodeEntity[] from fileServerData.
   *  2. episodeRepository.bulkUpsertSeason(entities) once — never per-episode upserts.
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

      // ---- Accumulate — do NOT write one by one ----
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
        episodeEntities.push(
          this.buildEpisodeEntity(showTitle, seasonNumber, epNum, fileData, context)
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

  private buildEpisodeEntity(
    showTitle: string,
    seasonNumber: number,
    episodeNumber: number,
    fileData: any,
    context: SyncContext
  ): EpisodeEntity {
    const now = new Date()
    const entity: EpisodeEntity = {
      title: fileData?.title || `Episode ${episodeNumber}`,
      originalTitle: fileData?.originalTitle || `Episode ${episodeNumber}`,
      lastSynced: now,
      episodeNumber,
      seasonNumber,
      showTitle
    }

    if (fileData?.videoURL) {
      entity.videoURL = fileData.videoURL
      entity.videoSource = context.serverConfig.id
    }
    if (fileData?.thumbnail || fileData?.thumbnailURL) {
      entity.thumbnailURL = fileData.thumbnail || fileData.thumbnailURL
    }
    if (Array.isArray(fileData?.captions) && fileData.captions.length > 0) {
      entity.captions = fileData.captions
    }
    if (Array.isArray(fileData?.chapters) && fileData.chapters.length > 0) {
      entity.chapters = fileData.chapters
    }
    if (fileData?.videoInfo && typeof fileData.videoInfo === 'object') {
      entity.videoInfo = fileData.videoInfo
    }
    if (fileData?.thumbnailBlurhash) {
      entity.thumbnailBlurhash = fileData.thumbnailBlurhash
    }
    if (fileData?.metadata && typeof fileData.metadata === 'object') {
      entity.metadata = fileData.metadata
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
