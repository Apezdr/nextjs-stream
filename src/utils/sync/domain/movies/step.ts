/**
 * What a movie's sync steps (metadata, artwork, video) take and return.
 *
 * MovieSyncService runs the steps in a fixed order. Each one is handed the
 * movie as it stands after the steps before it and returns a write plan (what
 * to set, what to remove, what it held back) and its result. The service
 * merges the plans into the one write the pass makes (core/writePlan).
 */

import { MediaType, type MovieEntity, type SyncContext, type SyncOperation, type SyncResult, type SyncStatus, type WritePlan } from '../../core'

export interface MovieStepInput {
  /** The folder name: the payload key, the availability key and the results' entity id. */
  originalTitle: string
  /** The movie as normalized for this pass, with what the earlier steps set. */
  movie: MovieEntity
  context: SyncContext
}

export interface MovieStepOutcome {
  plan: WritePlan<MovieEntity>
  result: SyncResult
}

/** One step's result. */
export function movieStepResult(
  entityId: string,
  operation: SyncOperation,
  context: SyncContext,
  status: SyncStatus,
  changes: string[],
  errors: string[],
  metadata?: Record<string, any>
): SyncResult {
  return {
    status,
    entityId,
    mediaType: MediaType.Movie,
    operation,
    serverId: context.serverConfig.id,
    timestamp: new Date(),
    changes,
    errors,
    metadata,
  }
}
