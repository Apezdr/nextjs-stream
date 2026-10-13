// src/lib/arr/radarr.ts
// Radarr v3 API (checked against Radarr 6.4), one movie at a time: is it
// there, what adding it would look like, add it, change it, search for it now.
import 'server-only'
import { createTtlCache, mapWithConcurrency } from './cache'
import { joinRootFolder, predictRadarrFolder, type RadarrNaming } from './folders'
import { ArrError, arrRequest, type ArrConfig } from './http'
import {
  QUEUE_PAGE_SIZE,
  asRecords,
  downloadsByTitle,
  isRecord,
  mostUsedProfileId,
  summarizeDownload,
  toQualityProfiles,
  toRootFolders,
  type ArrRecord,
} from './resources'
import type { ArrCandidate, ArrDownload, ArrEntry, ArrItemStatus, ArrOptions, MinimumAvailability } from './types'

export type RadarrOptions = ArrOptions & { naming: RadarrNaming }

const optionsCache = createTtlCache<RadarrOptions>(5 * 60_000)
// The most-used profile needs the whole movie list (~5 MB): worked out twice a day.
const defaultProfileCache = createTtlCache<number | null>(12 * 60 * 60_000)
const movieCache = createTtlCache<ArrRecord | null>(30_000)
const queueCache = createTtlCache<Map<number, ArrDownload>>(10_000)

const hasId = (movie: ArrRecord): movie is ArrRecord & { id: number } => typeof movie.id === 'number'

/**
 * The library's movie for a TMDB id, or null. Radarr's lookup can't answer
 * this: it never carries the library id, even for a movie already added.
 */
export async function findMovie(config: ArrConfig, tmdbId: number): Promise<(ArrRecord & { id: number }) | null> {
  const movies = await arrRequest<unknown>(config, 'GET', '/api/v3/movie', { params: { tmdbId } })
  if (!Array.isArray(movies)) throw new ArrError('invalid_response')
  return asRecords(movies).filter(hasId).find((movie) => movie.tmdbId === tmdbId) ?? null
}

/** The movie as Radarr would add it, or null when its metadata server doesn't know the id. */
export async function lookupMovie(config: ArrConfig, tmdbId: number): Promise<ArrRecord | null> {
  try {
    const movie = await arrRequest<unknown>(config, 'GET', '/api/v3/movie/lookup/tmdb', { params: { tmdbId } })
    return isRecord(movie) && movie.tmdbId === tmdbId ? movie : null
  } catch (error) {
    if (error instanceof ArrError && error.reason === 'not_found') return null
    throw error
  }
}

function toNaming(raw: unknown): RadarrNaming {
  const naming = isRecord(raw) ? raw : {}
  return {
    movieFolderFormat: typeof naming.movieFolderFormat === 'string' ? naming.movieFolderFormat : '',
    replaceIllegalCharacters: naming.replaceIllegalCharacters !== false,
    colonReplacementFormat: typeof naming.colonReplacementFormat === 'string' ? naming.colonReplacementFormat : 'delete',
  }
}

export function getRadarrOptions(config: ArrConfig): Promise<RadarrOptions> {
  return optionsCache.get(config.baseUrl, async () => {
    const [profiles, rootFolders, naming] = await Promise.all([
      arrRequest(config, 'GET', '/api/v3/qualityprofile'),
      arrRequest(config, 'GET', '/api/v3/rootfolder'),
      arrRequest(config, 'GET', '/api/v3/config/naming'),
    ])
    const qualityProfiles = toQualityProfiles(profiles)
    // Only a convenience: losing it leaves the dialog on the admin's last choice.
    const defaultQualityProfileId = await defaultProfileCache
      .get(config.baseUrl, async () =>
        mostUsedProfileId(await arrRequest(config, 'GET', '/api/v3/movie'), qualityProfiles)
      )
      .catch(() => null)
    return { qualityProfiles, rootFolders: toRootFolders(rootFolders), naming: toNaming(naming), defaultQualityProfileId }
  })
}

const year = (movie: ArrRecord) => (typeof movie.year === 'number' && movie.year > 0 ? movie.year : null)
const released = (movie: ArrRecord) => (typeof movie.isAvailable === 'boolean' ? movie.isAvailable : null)

export function toRadarrCandidate(movie: ArrRecord, naming: RadarrNaming): ArrCandidate {
  const title = typeof movie.title === 'string' ? movie.title : ''
  return {
    title,
    year: year(movie),
    folder: predictRadarrFolder({ title, year: year(movie) }, naming),
    released: released(movie),
    seasons: [],
  }
}

export function toRadarrEntry(movie: ArrRecord & { id: number }): ArrEntry {
  return {
    id: movie.id,
    title: typeof movie.title === 'string' ? movie.title : '',
    monitored: movie.monitored === true,
    qualityProfileId: typeof movie.qualityProfileId === 'number' ? movie.qualityProfileId : 0,
    path: typeof movie.path === 'string' ? movie.path : null,
    hasFile: movie.hasFile === true,
    released: released(movie),
    episodeFileCount: null,
    episodeCount: null,
    seasons: [],
  }
}

export interface AddMovieRequest {
  qualityProfileId: number
  rootFolderPath: string
  /** The folder under the root folder; null lets Radarr name it from its own format. */
  folder: string | null
  minimumAvailability: MinimumAvailability
  search: boolean
}

export async function addMovie(config: ArrConfig, movie: ArrRecord, request: AddMovieRequest) {
  const added = await arrRequest<unknown>(config, 'POST', '/api/v3/movie', {
    data: {
      // The lookup resource, as Radarr's own add dialog sends it, plus the choices.
      ...movie,
      qualityProfileId: request.qualityProfileId,
      rootFolderPath: request.rootFolderPath,
      ...(request.folder ? { path: joinRootFolder(request.rootFolderPath, request.folder) } : {}),
      monitored: true,
      minimumAvailability: request.minimumAvailability,
      tags: [],
      addOptions: { searchForMovie: request.search, monitor: 'movieOnly' },
    },
  })
  if (!isRecord(added) || !hasId(added)) throw new ArrError('invalid_response')
  forgetMovie(config, movie.tmdbId)
  return added
}

async function getMovie(config: ArrConfig, movieId: number) {
  const movie = await arrRequest<unknown>(config, 'GET', `/api/v3/movie/${movieId}`)
  if (!isRecord(movie) || !hasId(movie)) throw new ArrError('invalid_response')
  return movie
}

/** Radarr's PUT takes the whole resource back; files never move. */
async function putMovie(config: ArrConfig, movie: ArrRecord & { id: number }, changes: ArrRecord) {
  const updated = await arrRequest<unknown>(config, 'PUT', `/api/v3/movie/${movie.id}`, {
    params: { moveFiles: false },
    data: { ...movie, ...changes },
  })
  forgetMovie(config, movie.tmdbId)
  return isRecord(updated) && hasId(updated) ? updated : { ...movie, ...changes }
}

/** Changes fields on a library movie. */
export async function updateMovie(
  config: ArrConfig,
  movieId: number,
  changes: { qualityProfileId?: number; monitored?: boolean }
) {
  return putMovie(config, await getMovie(config, movieId), changes)
}

/** Monitors a library movie, unless it already is. */
export async function ensureMovieMonitored(config: ArrConfig, movieId: number) {
  const movie = await getMovie(config, movieId)
  if (movie.monitored !== true) await putMovie(config, movie, { monitored: true })
}

/** Queues Radarr's automatic search: it grabs the best release its profile allows. */
export async function searchMovie(config: ArrConfig, movieId: number) {
  await arrRequest(config, 'POST', '/api/v3/command', { data: { name: 'MoviesSearch', movieIds: [movieId] } })
  queueCache.clear()
}

export async function movieDownload(config: ArrConfig, movieId: number): Promise<ArrDownload | null> {
  const records = await arrRequest<unknown>(config, 'GET', '/api/v3/queue/details', { params: { movieId } })
  return summarizeDownload(asRecords(records))
}

function forgetMovie(config: ArrConfig, tmdbId: unknown) {
  if (typeof tmdbId === 'number') movieCache.delete(`${config.baseUrl}|${tmdbId}`)
  queueCache.clear()
}

export function movieItemStatus(movie: ArrRecord | null, download: ArrDownload | null): ArrItemStatus {
  if (!movie) return { state: 'absent' }
  if (download) return { state: 'downloading', progress: download.progress, timeLeftSeconds: download.timeLeftSeconds }
  if (movie.hasFile === true) return { state: 'downloaded' }
  if (movie.monitored !== true) return { state: 'unmonitored' }
  return { state: 'wanted', released: released(movie) }
}

/**
 * Chip states for many movies. One small library query per movie (cached
 * briefly) rather than the whole ~5 MB list: a playlist holds a few dozen.
 */
export async function movieStatuses(config: ArrConfig, tmdbIds: number[]): Promise<Map<number, ArrItemStatus>> {
  const [downloads, movies] = await Promise.all([
    queueCache.get(config.baseUrl, async () =>
      downloadsByTitle(
        await arrRequest(config, 'GET', '/api/v3/queue', { params: { page: 1, pageSize: QUEUE_PAGE_SIZE } }),
        'movieId'
      )
    ),
    mapWithConcurrency(tmdbIds, 6, (tmdbId) =>
      movieCache.get(`${config.baseUrl}|${tmdbId}`, () => findMovie(config, tmdbId))
    ),
  ])
  const statuses = new Map<number, ArrItemStatus>()
  tmdbIds.forEach((tmdbId, index) => {
    const movie = movies[index]
    statuses.set(tmdbId, movieItemStatus(movie, movie && hasId(movie) ? downloads.get(movie.id) ?? null : null))
  })
  return statuses
}
