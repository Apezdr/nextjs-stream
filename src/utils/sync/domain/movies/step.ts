/**
 * What a movie's sync steps (metadata, artwork, video) take and return.
 *
 * MovieSyncService runs the steps in a fixed order. Each one is handed the
 * movie as it stands after the steps before it and returns a write plan (what
 * to set, what to remove, what it held back) and its result. The service
 * merges the plans into the one write the pass makes (core/writePlan).
 */

import {
  MediaType,
  type Availability,
  type Caches,
  type MovieEntity,
  type PlanOutcome,
  type RunConfig,
  type SyncOperation,
  type SyncResult,
  type SyncStatus,
} from '../../core'

/**
 * What every step is handed. Each step's input adds the parts of the pass
 * (core/types) it reads, typed down to the fields it reads, and nothing else.
 */
interface MovieStepBase {
  /** The folder name: the payload key, the availability key and the results' entity id. */
  originalTitle: string
  /** The movie as normalized for this pass, with what the earlier steps set. */
  movie: MovieEntity
  /** This server's payload for the movie (`fileServer.movies[originalTitle]`). */
  payload: any
}

/** The metadata step's input (./metadata). */
export interface MovieMetadataInput extends MovieStepBase {
  run: Pick<RunConfig, 'serverConfig'>
  availability: Availability
  caches: Pick<Caches, 'metadataHashes'>
}

/** The artwork step's input (./artwork). */
export interface MovieArtworkInput extends MovieStepBase {
  run: Pick<RunConfig, 'serverConfig' | 'allEnabledServersProbed'>
  availability: Availability
  caches: Pick<Caches, 'resourceManager'>
}

/** The video step's input (./video). */
export interface MovieVideoInput extends MovieStepBase {
  run: Pick<RunConfig, 'serverConfig' | 'allEnabledServersProbed'>
  availability: Availability
}

/** The blurhash retry's input (./artwork): it works from the artwork step's retries. */
export interface MovieBlurhashRetryInput {
  originalTitle: string
  run: Pick<RunConfig, 'serverConfig'>
}

export interface MovieStepOutcome extends PlanOutcome<MovieEntity> {
  result: SyncResult
}

/** One step's result. */
export function movieStepResult(
  entityId: string,
  operation: SyncOperation,
  run: Pick<RunConfig, 'serverConfig'>,
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
    serverId: run.serverConfig.id,
    timestamp: new Date(),
    changes,
    errors,
    metadata,
  }
}
