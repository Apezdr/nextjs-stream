/**
 * What a movie's sync steps (metadata, artwork, video) take and return.
 *
 * MovieSyncService runs the steps in a fixed order. Each one is handed the
 * movie as it stands after the steps before it and returns a write plan (what
 * to set, what to remove, what it held back) and its result. The service
 * merges the plans into the one write the pass makes (core/writePlan).
 *
 * The steps do no I/O. A step that reads a file (the metadata file, a
 * blurhash) takes the files fetched for it (core/resources); a call made
 * before they are fetched names them in its plan's `needs` and does nothing
 * else, and the service calls it again once they are
 * (infrastructure/fileSystem/prefetch).
 */

import {
  MediaType,
  SyncStatus,
  type Availability,
  type Caches,
  type MovieEntity,
  type PlanOutcome,
  type ResourceRequest,
  type RunConfig,
  type SyncOperation,
  type SyncResult,
} from '../../core'
import { emptyWritePlan } from '../../core/writePlan'

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

/**
 * The artwork step's input (./artwork). No caches: the HTTP throttle its
 * blurhash reads take is the prefetch step's.
 */
export interface MovieArtworkInput extends MovieStepBase {
  run: Pick<RunConfig, 'serverConfig' | 'allEnabledServersProbed'>
  availability: Availability
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

/**
 * The outcome of a call made before the files a step reads were fetched:
 * their requests, and nothing else. Its result is pending, and never
 * reported: the service calls the step again.
 */
export function pendingStep(
  entityId: string,
  operation: SyncOperation,
  run: Pick<RunConfig, 'serverConfig'>,
  needs: ResourceRequest[]
): MovieStepOutcome {
  return {
    plan: { ...emptyWritePlan<MovieEntity>(), needs },
    wroteDocument: false,
    result: movieStepResult(entityId, operation, run, SyncStatus.Pending, [], []),
  }
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
