// src/lib/arr/picks.ts
// Picking a release by hand, like the services' own interactive search:
// search for a title (a movie, or a show's season or episode), read the
// results as they arrive, and grab one. A grabbed title stays monitored (the
// owner's call), so it is still upgraded later and, if the download fails,
// still looked for.
import 'server-only'
import { createLogger } from '@src/lib/logger'
import { ArrError, type ArrConfig } from './http'
import * as radarr from './radarr'
import { grabRelease, searchReleases, type ReleaseTarget, type StoredRelease } from './releases'
import {
  forgetReleaseSearch,
  getReleaseSearch,
  isExpired,
  startReleaseSearch,
  viewOf,
  type ReleaseSearch,
  type ReleaseSearchView,
} from './releaseSearches'
import * as sonarr from './sonarr'
import {
  ArrRequestError,
  SERVICE_NAMES,
  configFor,
  invalid,
  isPositiveInteger,
  isSeasonNumber,
  notAdded,
} from './titles'
import { serviceForMediaType, type ArrMediaType, type ArrService, type EpisodeScope, type TitleRef } from './types'

const log = createLogger('ArrPicks')

/** What a show's search covers: a season, or one episode. A movie needs none. */
export type PickTarget = { seasonNumber: number } | { episodeId: number } | null

export function parsePickTarget(body: unknown, mediaType: ArrMediaType): PickTarget {
  if (mediaType === 'movie') return null
  const { seasonNumber, episodeId } = (body ?? {}) as { seasonNumber?: unknown; episodeId?: unknown }
  if (episodeId !== undefined && episodeId !== null) {
    if (!isPositiveInteger(episodeId)) throw invalid('episodeId must be an episode id.')
    return { episodeId }
  }
  if (isSeasonNumber(seasonNumber)) return { seasonNumber }
  throw invalid('Choose a season or an episode to search for.')
}

async function resolveTarget(
  config: ArrConfig,
  ref: TitleRef,
  pick: PickTarget,
  titleHint: string | null
): Promise<ReleaseTarget> {
  if (ref.mediaType === 'movie') {
    const movie = await radarr.findMovie(config, ref.tmdbId)
    if (!movie) throw notAdded('radarr')
    return { kind: 'movie', movieId: movie.id }
  }
  const { entry } = await sonarr.resolveSeries(config, ref.tmdbId, titleHint)
  if (!entry) throw notAdded('sonarr')
  if (pick && 'episodeId' in pick) {
    const episodes = await sonarr.listEpisodes(config, entry.id)
    if (!episodes.some((episode) => episode.id === pick.episodeId)) {
      throw invalid('That episode isn’t one Sonarr lists for this show.')
    }
    return { kind: 'episode', seriesId: entry.id, episodeId: pick.episodeId }
  }
  const seasonNumber = pick?.seasonNumber
  if (seasonNumber === undefined || !sonarr.toSonarrEntry(entry).seasons.some((s) => s.seasonNumber === seasonNumber)) {
    throw invalid('That season isn’t one Sonarr lists for this show.')
  }
  return { kind: 'season', seriesId: entry.id, seasonNumber }
}

/** Starts (or joins) a search for a title Radarr/Sonarr already has. */
export async function startPick(
  ref: TitleRef,
  pick: PickTarget,
  titleHint: string | null,
  ownerId: string
): Promise<ReleaseSearchView> {
  const service = serviceForMediaType(ref.mediaType)
  const config = configFor(service)
  const target = await resolveTarget(config, ref, pick, titleHint)
  const search = startReleaseSearch({
    ownerId,
    service,
    title: ref,
    target,
    run: () => searchReleases(config, target),
  })
  log.info({ service, tmdbId: ref.tmdbId, target: target.kind, searchId: search.id }, 'Interactive search started')
  return viewOf(search)
}

const expired = (service: ArrService) =>
  new ArrRequestError(410, 'expired', `${SERVICE_NAMES[service]} no longer has these results. Search again.`)

/** Which service a search ran on, for naming it in errors; null once it's gone. */
export const pickService = (searchId: string): ArrService | null => getReleaseSearch(searchId)?.service ?? null

export function readPick(searchId: string): ReleaseSearchView {
  const search = getReleaseSearch(searchId)
  if (!search) throw new ArrRequestError(410, 'expired', 'This search has expired. Search again.')
  return viewOf(search)
}

/** What a grabbed release covers, as a monitoring scope: its season pack, its episodes, or what was searched. */
function scopeOf(release: StoredRelease, target: ReleaseTarget): EpisodeScope {
  if (release.fullSeason !== null) return { type: 'seasons', seasons: [release.fullSeason] }
  if (release.episodeIds.length > 0) return { type: 'episodes', episodeIds: release.episodeIds }
  if (target.kind === 'season') return { type: 'seasons', seasons: [target.seasonNumber] }
  if (target.kind === 'episode') return { type: 'episodes', episodeIds: [target.episodeId] }
  return { type: 'all' }
}

async function keepMonitored(config: ArrConfig, search: ReleaseSearch, release: StoredRelease) {
  const { target } = search
  if (target.kind === 'movie') return radarr.ensureMovieMonitored(config, target.movieId)
  await sonarr.applyMonitoring(config, target.seriesId, scopeOf(release, target))
}

/**
 * Sends one release of a finished search to the download client, then keeps
 * the title monitored. That second step failing doesn't undo the grab: it is
 * reported as `monitored: false`.
 */
export async function grabPick(
  searchId: string,
  releaseId: unknown
): Promise<{ service: ArrService; title: string; monitored: boolean }> {
  const search = getReleaseSearch(searchId)
  if (!search) throw new ArrRequestError(410, 'expired', 'This search has expired. Search again.')
  if (search.state !== 'done') throw new ArrRequestError(409, 'not_ready', 'The search hasn’t finished yet.')
  if (isExpired(search)) throw expired(search.service)
  const index = typeof releaseId === 'string' && /^\d+$/.test(releaseId) ? Number(releaseId) : -1
  const release = search.releases[index]
  if (!release) throw invalid('That release isn’t one this search found.')

  const config = configFor(search.service)
  try {
    await grabRelease(config, release)
  } catch (error) {
    // The service's 404 here means the release has left its cache.
    if (error instanceof ArrError && error.reason === 'not_found') {
      forgetReleaseSearch(search.id)
      throw expired(search.service)
    }
    throw error
  }
  search.grabbed.add(index)
  log.info({ service: search.service, tmdbId: search.title.tmdbId, target: search.target.kind }, 'Release grabbed')

  const monitored = await keepMonitored(config, search, release).then(
    () => true,
    (error) => {
      log.warn(
        { service: search.service, reason: error instanceof ArrError ? error.reason : 'unexpected' },
        'Grabbed, but could not keep the title monitored'
      )
      return false
    }
  )
  return { service: search.service, title: release.summary.title, monitored }
}
