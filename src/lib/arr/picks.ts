// src/lib/arr/picks.ts
// Picking a release by hand, like the services' own interactive search:
// search for a title (a movie, or a show's season or episode), read the
// results as they arrive, and grab one. A grabbed title stays monitored (the
// owner's call), so it is still upgraded later and, if the download fails,
// still looked for.
import 'server-only'
import { createLogger } from '@src/lib/logger'
import { requireActOn, requireService, type ArrActor } from './rules'
import { forbidden } from './errors'
import { ArrError, type ArrConfig } from './http'
import * as radarr from './radarr'
import { logArrActivity } from './requestLog'
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

/** What to search, and the quality profile the title has (the one a grab will be in). */
async function resolveTarget(
  config: ArrConfig,
  ref: TitleRef,
  pick: PickTarget,
  titleHint: string | null
): Promise<{ target: ReleaseTarget; qualityProfileId: number }> {
  if (ref.mediaType === 'movie') {
    const movie = await radarr.findMovie(config, ref.tmdbId)
    if (!movie) throw notAdded('radarr')
    return { target: { kind: 'movie', movieId: movie.id }, qualityProfileId: radarr.toRadarrEntry(movie).qualityProfileId }
  }
  const { entry } = await sonarr.resolveSeries(config, ref.tmdbId, titleHint)
  if (!entry) throw notAdded('sonarr')
  const series = sonarr.toSonarrEntry(entry)
  if (pick && 'episodeId' in pick) {
    const episodes = await sonarr.listEpisodes(config, entry.id)
    if (!episodes.some((episode) => episode.id === pick.episodeId)) {
      throw invalid('That episode isn’t one Sonarr lists for this show.')
    }
    return {
      target: { kind: 'episode', seriesId: entry.id, episodeId: pick.episodeId },
      qualityProfileId: series.qualityProfileId,
    }
  }
  const seasonNumber = pick?.seasonNumber
  if (seasonNumber === undefined || !series.seasons.some((s) => s.seasonNumber === seasonNumber)) {
    throw invalid('That season isn’t one Sonarr lists for this show.')
  }
  return { target: { kind: 'season', seriesId: entry.id, seasonNumber }, qualityProfileId: series.qualityProfileId }
}

/** Starts (or joins) a search for a title Radarr/Sonarr already has. */
export async function startPick(
  ref: TitleRef,
  pick: PickTarget,
  titleHint: string | null,
  actor: ArrActor
): Promise<ReleaseSearchView> {
  const service = serviceForMediaType(ref.mediaType)
  requireService(actor, service)
  if (!actor.permissions.manual) throw forbidden('Picking releases by hand isn’t part of your role.')
  const config = configFor(service)
  const { target, qualityProfileId } = await resolveTarget(config, ref, pick, titleHint)
  await requireActOn(actor, ref, service, qualityProfileId)
  const search = startReleaseSearch({
    ownerId: actor.userId,
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

/** A search, for whoever started it, or a manager. */
function searchFor(searchId: string, actor: ArrActor): ReleaseSearch {
  const search = getReleaseSearch(searchId)
  if (!search) throw new ArrRequestError(410, 'expired', 'This search has expired. Search again.')
  if (search.ownerId !== actor.userId && !actor.permissions.manage) throw forbidden('That search isn’t yours.')
  return search
}

export function readPick(searchId: string, actor: ArrActor): ReleaseSearchView {
  return viewOf(searchFor(searchId, actor))
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
  releaseId: unknown,
  actor: ArrActor
): Promise<{ service: ArrService; title: string; monitored: boolean }> {
  const search = searchFor(searchId, actor)
  if (search.state !== 'done') throw new ArrRequestError(409, 'not_ready', 'The search hasn’t finished yet.')
  if (isExpired(search)) throw expired(search.service)
  const index = typeof releaseId === 'string' && /^\d+$/.test(releaseId) ? Number(releaseId) : -1
  const release = search.releases[index]
  if (!release) throw invalid('That release isn’t one this search found.')
  // A rejection is often the title's quality profile saying no: grabbing it
  // anyway would step around the role's quality limits.
  if (!release.summary.approved && !actor.permissions.manage) {
    throw forbidden(`Only managers can grab a release ${SERVICE_NAMES[search.service]} rejected.`)
  }

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
  await logArrActivity({
    kind: 'grab',
    actor,
    ref: search.title,
    service: search.service,
    detail: {
      release: release.summary.title,
      indexer: release.summary.indexer,
      quality: release.summary.quality,
      rejected: !release.summary.approved,
    },
  })

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
