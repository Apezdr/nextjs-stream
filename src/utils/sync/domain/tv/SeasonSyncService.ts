/**
 * Season sync service — bulk-write pattern only.
 *
 * All seasons for a show are accumulated into an array then flushed with
 * a single SeasonRepository.bulkUpsertShow(seasons[]) call.
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

import { SeasonRepository } from '../../infrastructure'

export class SeasonSyncService {
  constructor(private readonly seasonRepository: SeasonRepository) {}

  /**
   * Sync all seasons for a show via a single bulkUpsertShow call.
   *
   * Pattern:
   *  1. Accumulate SeasonEntity[] from fileServerData (one entry per season).
   *  2. seasonRepository.bulkUpsertShow(entities) once — never per-season upserts.
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

      // ---- Accumulate — do NOT write one by one ----
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
        seasonEntities.push(this.buildSeasonEntity(showTitle, seasonNumber, fileData, context))
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

  private buildSeasonEntity(
    showTitle: string,
    seasonNumber: number,
    fileData: any,
    context: SyncContext
  ): SeasonEntity {
    const now = new Date()
    const entity: SeasonEntity = {
      title: fileData?.title || `Season ${seasonNumber}`,
      originalTitle: fileData?.originalTitle || `Season ${seasonNumber}`,
      lastSynced: now,
      seasonNumber,
      showTitle
    }

    if (fileData?.posterURL || fileData?.poster) {
      entity.posterURL = fileData.posterURL || fileData.poster
    }
    if (typeof fileData?.episodeCount === 'number') {
      entity.episodeCount = fileData.episodeCount
    } else if (fileData?.episodes && typeof fileData.episodes === 'object') {
      entity.episodeCount = Object.keys(fileData.episodes).length
    }
    if (fileData?.posterBlurhash) {
      entity.posterBlurhash = fileData.posterBlurhash
    }
    if (fileData?.metadata && typeof fileData.metadata === 'object') {
      entity.metadata = fileData.metadata
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
