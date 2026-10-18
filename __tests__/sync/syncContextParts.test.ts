/**
 * The parts of a pass (core/types: RunConfig, Availability, Caches) that each
 * movie step and TV builder is handed.
 *
 * The check is the typecheck (`tsc --noEmit`), which covers this file: each
 * `@ts-expect-error` below is itself an error unless the line fails, so a
 * step or builder that is handed a part it was not handed before, or whose
 * input type widens, fails the typecheck here. The reads without the
 * directive pin what each one is handed. Each type is taken from the step's
 * or builder's own signature, so widening the signature is caught, not only
 * widening a type it names. Jest only loads the file.
 */
import type { syncMovieMetadata } from '@src/utils/sync/domain/movies/metadata'
import type { syncMovieArtwork, retryMovieBlurhashes } from '@src/utils/sync/domain/movies/artwork'
import type { syncMovieVideo } from '@src/utils/sync/domain/movies/video'
import type { MovieSyncService } from '@src/utils/sync/domain/movies/MovieSyncService'
import type { TVShowSyncService } from '@src/utils/sync/domain/tv/TVShowSyncService'
import type { SeasonSyncService } from '@src/utils/sync/domain/tv/SeasonSyncService'
import type { EpisodeSyncService } from '@src/utils/sync/domain/tv/EpisodeSyncService'
import type { planTVShow } from '@src/utils/sync/domain/tv/showPlan'
import type { planSeason } from '@src/utils/sync/domain/tv/seasonPlan'
import type { planEpisode } from '@src/utils/sync/domain/tv/episodePlan'

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
// Each builder's own input (./showPlan, ./seasonPlan, ./episodePlan).
type ShowBuilderInput = Parameters<typeof planTVShow>[0]
type SeasonBuilderInput = Parameters<typeof planSeason>[0]
type EpisodeBuilderInput = Parameters<typeof planEpisode>[0]

/** Never called: the typecheck reads it. */
function movieSteps(pass: MoviePass, metadata: MetadataInput, artwork: ArtworkInput, video: VideoInput, retry: RetryInput) {
  // The movie pass holds all three parts.
  void [pass.run.forceSync, pass.run.cleanup, pass.availability, pass.caches.metadataHashes, pass.caches.resourceManager]

  // No step reads forceSync (the gate is checked before the steps run) or the
  // cleanup config (field-absence cleanup plans apart).

  // The metadata step: the server, the availability and the metadata hashes.
  void [metadata.run.serverConfig, metadata.availability.fieldAvailability, metadata.caches.metadataHashes, metadata.payload]
  // @ts-expect-error The metadata step does not read forceSync.
  void metadata.run.forceSync
  // @ts-expect-error The metadata step does not read allEnabledServersProbed.
  void metadata.run.allEnabledServersProbed
  // @ts-expect-error The metadata step does not read the cleanup config.
  void metadata.run.cleanup
  // @ts-expect-error The metadata step does not get the HTTP throttle.
  void metadata.caches.resourceManager

  // The artwork step: the server, allEnabledServersProbed and the availability.
  void [artwork.run.serverConfig, artwork.run.allEnabledServersProbed, artwork.availability, artwork.payload]
  // @ts-expect-error The artwork step does not read forceSync.
  void artwork.run.forceSync
  // @ts-expect-error The artwork step does not read the cleanup config.
  void artwork.run.cleanup
  // @ts-expect-error The artwork step is handed no caches: the throttle its reads take is the prefetch step's.
  void artwork.caches

  // The video step: the server, allEnabledServersProbed and the availability.
  void [video.run.serverConfig, video.run.allEnabledServersProbed, video.availability, video.payload]
  // @ts-expect-error The video step does not read forceSync.
  void video.run.forceSync
  // @ts-expect-error The video step does not read the cleanup config.
  void video.run.cleanup
  // @ts-expect-error The video step is handed no caches.
  void video.caches

  // The blurhash retry: the server, and the artwork step's retries beside it.
  void retry.run.serverConfig
  // @ts-expect-error The blurhash retry does not read forceSync.
  void retry.run.forceSync
  // @ts-expect-error The blurhash retry does not read allEnabledServersProbed.
  void retry.run.allEnabledServersProbed
  // @ts-expect-error The blurhash retry does not read the cleanup config.
  void retry.run.cleanup
  // @ts-expect-error The blurhash retry is handed no availability.
  void retry.availability
  // @ts-expect-error The blurhash retry is handed no payload.
  void retry.payload
  // @ts-expect-error The blurhash retry is handed no movie.
  void retry.movie
  // @ts-expect-error The blurhash retry is handed no caches.
  void retry.caches
}

/** Never called: the typecheck reads it. */
function tvBuilders(
  show: ShowPass,
  season: SeasonPass,
  episode: EpisodePass,
  showInput: ShowBuilderInput,
  seasonInput: SeasonBuilderInput,
  episodeInput: EpisodeBuilderInput
) {
  const [showRun, seasonRun, episodeRun] = [showInput.run, seasonInput.run, episodeInput.run]
  // A TV pass holds the run and the availability.
  void [show.run.forceSync, show.run.cleanup, show.availability, season.availability, episode.run]
  // @ts-expect-error A TV pass has no caches.
  void show.caches
  // @ts-expect-error The season service is handed no caches.
  void season.caches
  // @ts-expect-error The episode service is handed no caches.
  void episode.caches

  // Each builder reads the server and allEnabledServersProbed of the run, not
  // forceSync (the gates are checked before it runs) or the cleanup config
  // (field-absence cleanup plans apart).
  void [showInput.availability, seasonInput.availability, episodeInput.availability]
  // @ts-expect-error planTVShow is handed no caches.
  void showInput.caches
  // @ts-expect-error planSeason is handed no caches.
  void seasonInput.caches
  // @ts-expect-error planEpisode is handed no caches.
  void episodeInput.caches

  void [showRun.serverConfig, showRun.allEnabledServersProbed]
  // @ts-expect-error planTVShow does not read forceSync.
  void showRun.forceSync
  // @ts-expect-error planTVShow does not read the cleanup config.
  void showRun.cleanup

  void [seasonRun.serverConfig, seasonRun.allEnabledServersProbed]
  // @ts-expect-error planSeason does not read forceSync.
  void seasonRun.forceSync
  // @ts-expect-error planSeason does not read the cleanup config.
  void seasonRun.cleanup

  void [episodeRun.serverConfig, episodeRun.allEnabledServersProbed]
  // @ts-expect-error planEpisode does not read forceSync.
  void episodeRun.forceSync
  // @ts-expect-error planEpisode does not read the cleanup config.
  void episodeRun.cleanup
}

test('the parts of a pass are pinned by the typecheck', () => {
  expect([movieSteps, tvBuilders].every((probe) => typeof probe === 'function')).toBe(true)
})
