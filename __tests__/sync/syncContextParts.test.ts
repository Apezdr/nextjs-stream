/**
 * The parts of a pass (core/types: RunConfig, Availability, Caches) that each
 * movie step and TV builder is handed.
 *
 * The check is the typecheck (`tsc --noEmit`), which covers this file: each
 * `@ts-expect-error` below is itself an error unless the line fails, so a
 * step or builder that is handed a part it was not handed before, or whose
 * input type widens, fails the typecheck here. The reads without the
 * directive pin what each one is handed. Jest only loads the file.
 */
import type { syncMovieMetadata } from '@src/utils/sync/domain/movies/metadata'
import type { syncMovieArtwork, retryMovieBlurhashes } from '@src/utils/sync/domain/movies/artwork'
import type { syncMovieVideo } from '@src/utils/sync/domain/movies/video'
import type { MovieSyncService } from '@src/utils/sync/domain/movies/MovieSyncService'
import type { TVShowSyncService } from '@src/utils/sync/domain/tv/TVShowSyncService'
import type { SeasonSyncService } from '@src/utils/sync/domain/tv/SeasonSyncService'
import type { EpisodeSyncService } from '@src/utils/sync/domain/tv/EpisodeSyncService'
import type { TVBuilderRun } from '@src/utils/sync/core/types'

// The repository has no jest type package; the two globals this file uses.
declare const test: (name: string, fn: () => void) => void
declare const expect: (value: unknown) => { toBe: (expected: unknown) => void }

type MoviePass = Parameters<MovieSyncService['syncMovie']>[2]
type MetadataInput = Parameters<typeof syncMovieMetadata>[0]
type ArtworkInput = Parameters<typeof syncMovieArtwork>[0]
type VideoInput = Parameters<typeof syncMovieVideo>[0]
type RetryInput = Parameters<typeof retryMovieBlurhashes>[0]
type ShowPass = Parameters<TVShowSyncService['syncTVShow']>[2]
type SeasonPass = Parameters<SeasonSyncService['syncShow']>[2]
type EpisodePass = Parameters<EpisodeSyncService['syncShow']>[2]

/** Never called: the typecheck reads it. */
function movieSteps(pass: MoviePass, metadata: MetadataInput, artwork: ArtworkInput, video: VideoInput, retry: RetryInput) {
  // The movie pass holds all three parts.
  void [pass.run.forceSync, pass.run.cleanup, pass.availability, pass.caches.metadataHashes, pass.caches.resourceManager]

  // The metadata step: the server, the availability and the metadata hashes.
  void [metadata.run.serverConfig, metadata.availability.fieldAvailability, metadata.caches.metadataHashes, metadata.payload]
  // @ts-expect-error The metadata step does not get the HTTP throttle.
  void metadata.caches.resourceManager
  // @ts-expect-error The metadata step does not read allEnabledServersProbed.
  void metadata.run.allEnabledServersProbed

  // The artwork step: the server, allEnabledServersProbed, the availability and the throttle.
  void [artwork.run.serverConfig, artwork.run.allEnabledServersProbed, artwork.availability, artwork.caches.resourceManager]
  // @ts-expect-error The artwork step does not get the metadata hashes.
  void artwork.caches.metadataHashes
  // @ts-expect-error No step reads forceSync: the gate is checked before the steps run.
  void artwork.run.forceSync

  // The video step: the server, allEnabledServersProbed and the availability.
  void [video.run.serverConfig, video.run.allEnabledServersProbed, video.availability, video.payload]
  // @ts-expect-error The video step is handed no caches.
  void video.caches
  // @ts-expect-error No step reads the cleanup config: field-absence cleanup plans apart.
  void video.run.cleanup

  // The blurhash retry: the server, and the artwork step's retries beside it.
  void retry.run.serverConfig
  // @ts-expect-error The blurhash retry is handed no availability.
  void retry.availability
  // @ts-expect-error The blurhash retry is handed no payload.
  void retry.payload
  // @ts-expect-error The blurhash retry is handed no caches.
  void retry.caches
}

/** Never called: the typecheck reads it. */
function tvBuilders(show: ShowPass, season: SeasonPass, episode: EpisodePass, builderRun: TVBuilderRun) {
  // A TV pass holds the run and the availability.
  void [show.run.forceSync, show.run.cleanup, show.availability, season.availability, episode.run]
  // @ts-expect-error A TV pass has no caches.
  void show.caches
  // @ts-expect-error The season service is handed no caches.
  void season.caches
  // @ts-expect-error The episode service is handed no caches.
  void episode.caches

  // The builders (planTVShow, planSeason, planEpisode) read this of the run.
  void [builderRun.serverConfig, builderRun.allEnabledServersProbed]
  // @ts-expect-error A TV builder does not read forceSync: the gates are checked before it runs.
  void builderRun.forceSync
  // @ts-expect-error A TV builder does not read the cleanup config.
  void builderRun.cleanup
}

test('the parts of a pass are pinned by the typecheck', () => {
  expect([movieSteps, tvBuilders].every((probe) => typeof probe === 'function')).toBe(true)
})
