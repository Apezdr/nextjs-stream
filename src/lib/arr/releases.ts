// src/lib/arr/releases.ts
// Interactive search: what Radarr/Sonarr find on the indexers for one title,
// and grabbing one of those releases. From their ReleaseControllers (Radarr
// 6.4, Sonarr 4.0): GET /api/v3/release runs the search and answers in the
// service's own priority order; each result stays in the service's cache for
// 30 minutes under `${indexerId}_${guid}`, and POST /api/v3/release with those
// two fields grabs it (404 once it has left the cache). Rejections are not
// checked again at grab time, so a rejected release can still be grabbed, as
// in the services' own UIs.
import 'server-only'
import { arrRequest, type ArrConfig } from './http'
import { asRecords, finiteNumber, isRecord, type ArrRecord } from './resources'

/** What to search: a movie, a whole season, or one episode. */
export type ReleaseTarget =
  | { kind: 'movie'; movieId: number }
  | { kind: 'season'; seriesId: number; seasonNumber: number }
  | { kind: 'episode'; seriesId: number; episodeId: number }

/**
 * A release as the browser sees it. No guid and no links: a newznab guid or
 * download link can carry the indexer's API key.
 */
export interface ReleaseSummary {
  title: string
  indexer: string
  protocol: 'usenet' | 'torrent' | 'unknown'
  quality: string
  sizeBytes: number | null
  ageHours: number | null
  seeders: number | null
  leechers: number | null
  languages: string[]
  customFormats: string[]
  customFormatScore: number
  releaseGroup: string | null
  /** Radarr: e.g. "Director's Cut". */
  edition: string | null
  /** Sonarr: what the release holds, e.g. "Season 2" or "S02E03". */
  coverage: string | null
  approved: boolean
  /** Rejected for now (a delay profile, say), not for good. */
  temporarilyRejected: boolean
  rejections: string[]
}

/** A release as kept on the server: what a grab sends, and what it covers. */
export interface StoredRelease {
  guid: string
  indexerId: number
  summary: ReleaseSummary
  /** Sonarr: the episodes it maps to; [] for a movie. */
  episodeIds: number[]
  /** Sonarr: the season of a full-season release, else null. */
  fullSeason: number | null
}

/** A search waits for the service's slowest indexer. */
export const SEARCH_TIMEOUT_MS = 150_000

export function searchParams(target: ReleaseTarget): Record<string, number> {
  switch (target.kind) {
    case 'movie':
      return { movieId: target.movieId }
    case 'season':
      return { seriesId: target.seriesId, seasonNumber: target.seasonNumber }
    case 'episode':
      return { episodeId: target.episodeId }
  }
}

const names = (raw: unknown) =>
  asRecords(raw)
    .map((entry) => entry.name)
    .filter((name): name is string => typeof name === 'string' && name !== '')

const pad = (number: number) => String(number).padStart(2, '0')

/** Sonarr's parse of what a release holds, preferring its mapping onto the show. */
function coverage(release: ArrRecord): string | null {
  const season = finiteNumber(release.mappedSeasonNumber) ?? finiteNumber(release.seasonNumber)
  if (season === null) return null
  if (release.fullSeason === true) return season === 0 ? 'Specials' : `Season ${season}`
  const mapped = Array.isArray(release.mappedEpisodeNumbers) ? release.mappedEpisodeNumbers : []
  const parsed = Array.isArray(release.episodeNumbers) ? release.episodeNumbers : []
  const episodes = (mapped.length ? mapped : parsed).filter((n): n is number => typeof n === 'number').sort((a, b) => a - b)
  if (episodes.length === 0) return null
  const first = `S${pad(season)}E${pad(episodes[0])}`
  return episodes.length === 1 ? first : `${first}–E${pad(episodes[episodes.length - 1])}`
}

function rejectionMessages(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((rejection) =>
      typeof rejection === 'string'
        ? rejection
        : isRecord(rejection) && typeof rejection.message === 'string'
          ? rejection.message
          : ''
    )
    .filter(Boolean)
}

/** One search result, or null when it lacks what a grab needs. */
export function toStoredRelease(release: ArrRecord): StoredRelease | null {
  const { guid, indexerId } = release
  if (typeof guid !== 'string' || guid === '' || typeof indexerId !== 'number') return null
  const quality = isRecord(release.quality) && isRecord(release.quality.quality) ? release.quality.quality : null
  const age = finiteNumber(release.age)
  const isSeasonPack = release.fullSeason === true
  return {
    guid,
    indexerId,
    summary: {
      title: typeof release.title === 'string' ? release.title : '',
      indexer: typeof release.indexer === 'string' ? release.indexer : '',
      protocol: release.protocol === 'usenet' || release.protocol === 'torrent' ? release.protocol : 'unknown',
      quality: typeof quality?.name === 'string' ? quality.name : 'Unknown',
      sizeBytes: finiteNumber(release.size),
      ageHours: finiteNumber(release.ageHours) ?? (age !== null ? age * 24 : null),
      seeders: finiteNumber(release.seeders),
      leechers: finiteNumber(release.leechers),
      languages: names(release.languages),
      customFormats: names(release.customFormats),
      customFormatScore: finiteNumber(release.customFormatScore) ?? 0,
      releaseGroup: typeof release.releaseGroup === 'string' && release.releaseGroup ? release.releaseGroup : null,
      edition: typeof release.edition === 'string' && release.edition ? release.edition : null,
      coverage: coverage(release),
      approved: release.approved === true,
      temporarilyRejected: release.temporarilyRejected === true,
      rejections: rejectionMessages(release.rejections),
    },
    episodeIds: asRecords(release.mappedEpisodeInfo)
      .map((episode) => episode.id)
      .filter((id): id is number => typeof id === 'number'),
    fullSeason: isSeasonPack ? finiteNumber(release.mappedSeasonNumber) ?? finiteNumber(release.seasonNumber) : null,
  }
}

/** Runs the service's interactive search for the target. */
export async function searchReleases(config: ArrConfig, target: ReleaseTarget): Promise<StoredRelease[]> {
  const results = await arrRequest<unknown>(config, 'GET', '/api/v3/release', {
    params: searchParams(target),
    timeoutMs: SEARCH_TIMEOUT_MS,
  })
  return asRecords(results)
    .map(toStoredRelease)
    .filter((release): release is StoredRelease => release !== null)
}

/** Sends one release from the service's cache to its download client. */
export async function grabRelease(config: ArrConfig, release: Pick<StoredRelease, 'guid' | 'indexerId'>) {
  await arrRequest(config, 'POST', '/api/v3/release', { data: { guid: release.guid, indexerId: release.indexerId } })
}
