// src/lib/arr/sonarr.ts
// Sonarr v3 API (checked against Sonarr 4.0.20), one show at a time: is it
// there, what adding it would look like, add it with an episode scope, change
// it, and monitor + search a scope now.
//
// How Sonarr decides what is monitored (from its source, Sonarr 4.0):
// - a new episode starts with its season's monitored flag (RefreshEpisodeService);
// - an added show's addOptions are applied once, after its first refresh and
//   disk scan, inside that same RefreshSeries command (SeriesScannedHandler),
//   which then queues the add's searches and clears addOptions.
import 'server-only'
import { createTtlCache } from './cache'
import { joinRootFolder } from './folders'
import { ArrError, arrRequest, type ArrConfig } from './http'
import {
  QUEUE_PAGE_SIZE,
  asRecords,
  downloadsByTitle,
  finiteNumber,
  isRecord,
  mostUsedProfileId,
  summarizeDownload,
  toQualityProfiles,
  toRootFolders,
  type ArrRecord,
} from './resources'
import type {
  ArrCandidate,
  ArrDownload,
  ArrEntry,
  ArrItemStatus,
  ArrOptions,
  EpisodeScope,
  SeasonSummary,
} from './types'

type Series = ArrRecord & { id: number }

interface SeriesIndex {
  all: Series[]
  byTmdbId: Map<number, Series>
}

const optionsCache = createTtlCache<ArrOptions>(5 * 60_000)
// The whole series list is ~1 MB at ~240 shows: shared for a minute.
const indexCache = createTtlCache<SeriesIndex>(60_000)
const queueCache = createTtlCache<Map<number, ArrDownload>>(10_000)

const hasId = (series: ArrRecord): series is Series => typeof series.id === 'number'

/** Every series Sonarr manages, by TMDB id (a few have none and are only in `all`). */
export function seriesIndex(config: ArrConfig): Promise<SeriesIndex> {
  return indexCache.get(config.baseUrl, async () => {
    const all = asRecords(await arrRequest(config, 'GET', '/api/v3/series')).filter(hasId)
    const byTmdbId = new Map<number, Series>()
    for (const series of all) {
      if (typeof series.tmdbId === 'number' && series.tmdbId > 0) byTmdbId.set(series.tmdbId, series)
    }
    return { all, byTmdbId }
  })
}

function forgetSeries(config: ArrConfig) {
  indexCache.delete(config.baseUrl)
  queueCache.clear()
}

export function getSonarrOptions(config: ArrConfig): Promise<ArrOptions> {
  return optionsCache.get(config.baseUrl, async () => {
    const [profiles, rootFolders] = await Promise.all([
      arrRequest(config, 'GET', '/api/v3/qualityprofile'),
      arrRequest(config, 'GET', '/api/v3/rootfolder'),
    ])
    const qualityProfiles = toQualityProfiles(profiles)
    // Only a convenience: losing it leaves the dialog on the admin's last choice.
    const defaultQualityProfileId = await seriesIndex(config)
      .then((index) => mostUsedProfileId(index.all, qualityProfiles))
      .catch(() => null)
    return { qualityProfiles, rootFolders: toRootFolders(rootFolders), defaultQualityProfileId }
  })
}

/**
 * The show as Sonarr would add it; a show it already manages comes back with
 * its library id. Sonarr resolves `tmdb:<id>` through its own metadata; when
 * that has no TMDB mapping, a title search matched on the TMDB id is the
 * fallback. Null when neither finds it.
 */
export async function lookupSeries(config: ArrConfig, tmdbId: number, titleHint: string | null): Promise<ArrRecord | null> {
  const byId = asRecords(
    await arrRequest(config, 'GET', '/api/v3/series/lookup', { params: { term: `tmdb:${tmdbId}` } })
  )
  // The term itself names the show, so a lone answer is it.
  const match = byId.find((series) => series.tmdbId === tmdbId) ?? (byId.length === 1 ? byId[0] : null)
  if (match || !titleHint?.trim()) return match
  const byTitle = asRecords(
    await arrRequest(config, 'GET', '/api/v3/series/lookup', { params: { term: titleHint.trim() } })
  )
  return byTitle.find((series) => series.tmdbId === tmdbId) ?? null
}

export async function getSeries(config: ArrConfig, seriesId: number): Promise<Series> {
  const series = await arrRequest<unknown>(config, 'GET', `/api/v3/series/${seriesId}`)
  if (!isRecord(series) || !hasId(series)) throw new ArrError('invalid_response')
  return series
}

/**
 * The library series for a TMDB id (`entry`), or what an add would send
 * (`candidate`). The index answers for most shows; the lookup also finds one
 * whose Sonarr record carries no TMDB id.
 */
export async function resolveSeries(
  config: ArrConfig,
  tmdbId: number,
  titleHint: string | null
): Promise<{ entry: Series | null; candidate: ArrRecord | null }> {
  const indexed = (await seriesIndex(config)).byTmdbId.get(tmdbId)
  if (indexed) return { entry: await getSeries(config, indexed.id), candidate: null }
  const found = await lookupSeries(config, tmdbId, titleHint)
  if (found && hasId(found)) return { entry: await getSeries(config, found.id), candidate: null }
  return { entry: null, candidate: found }
}

function toSeasons(raw: unknown): SeasonSummary[] {
  return asRecords(raw)
    .filter((season) => typeof season.seasonNumber === 'number')
    .map((season) => {
      const stats = isRecord(season.statistics) ? season.statistics : null
      return {
        seasonNumber: season.seasonNumber as number,
        monitored: season.monitored === true,
        episodeFileCount: stats ? finiteNumber(stats.episodeFileCount) : null,
        episodeCount: stats ? finiteNumber(stats.episodeCount) : null,
      }
    })
    .sort((a, b) => a.seasonNumber - b.seasonNumber)
}

const year = (series: ArrRecord) => (typeof series.year === 'number' && series.year > 0 ? series.year : null)
const released = (series: ArrRecord) => (typeof series.status === 'string' ? series.status !== 'upcoming' : null)

export function toSonarrCandidate(series: ArrRecord): ArrCandidate {
  return {
    title: typeof series.title === 'string' ? series.title : '',
    year: year(series),
    // Sonarr's lookup names the folder itself, from its own naming config.
    folder: typeof series.folder === 'string' && series.folder.trim() ? series.folder : null,
    released: released(series),
    seasons: toSeasons(series.seasons),
  }
}

export function toSonarrEntry(series: Series): ArrEntry {
  const stats = isRecord(series.statistics) ? series.statistics : {}
  // Sonarr's episodeCount: monitored episodes that have aired, or have a file.
  const episodeFileCount = finiteNumber(stats.episodeFileCount) ?? 0
  const episodeCount = finiteNumber(stats.episodeCount) ?? 0
  return {
    id: series.id,
    title: typeof series.title === 'string' ? series.title : '',
    monitored: series.monitored === true,
    qualityProfileId: typeof series.qualityProfileId === 'number' ? series.qualityProfileId : 0,
    path: typeof series.path === 'string' ? series.path : null,
    hasFile: episodeCount > 0 && episodeFileCount >= episodeCount,
    released: released(series),
    episodeFileCount,
    episodeCount,
    seasons: toSeasons(series.seasons),
  }
}

/** Each season's flag on an add. New episodes start with their season's flag. */
export function seasonFlagsFor(series: ArrRecord, scope: EpisodeScope) {
  const chosen = scope.type === 'seasons' ? new Set(scope.seasons) : null
  return toSeasons(series.seasons).map(({ seasonNumber }) => ({
    seasonNumber,
    monitored: scope.type === 'all' ? seasonNumber > 0 : chosen ? chosen.has(seasonNumber) : false,
  }))
}

/**
 * The add's monitoring pass, per scope:
 * - all: Sonarr's "All Episodes" (every season but specials);
 * - seasons: no `monitor`, i.e. Sonarr's legacy pass, which keeps each season's
 *   flag from the add and unmonitors every episode of an unmonitored season
 *   (what Overseerr relies on for per-season requests);
 * - episodes: "None", and no search; the picked episodes are monitored and
 *   searched once the add's refresh has finished (see refreshPending).
 */
export function addOptionsFor(scope: EpisodeScope, search: boolean) {
  if (scope.type === 'all') {
    return { monitor: 'all', searchForMissingEpisodes: search, searchForCutoffUnmetEpisodes: false }
  }
  if (scope.type === 'seasons') {
    return {
      ignoreEpisodesWithFiles: false,
      ignoreEpisodesWithoutFiles: false,
      searchForMissingEpisodes: search,
      searchForCutoffUnmetEpisodes: false,
    }
  }
  return { monitor: 'none', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false }
}

export interface AddSeriesRequest {
  qualityProfileId: number
  rootFolderPath: string
  /** The folder under the root folder; null lets Sonarr name it from its own format. */
  folder: string | null
  scope: EpisodeScope
  search: boolean
}

export async function addSeries(config: ArrConfig, series: ArrRecord, request: AddSeriesRequest): Promise<Series> {
  const added = await arrRequest<unknown>(config, 'POST', '/api/v3/series', {
    data: {
      // The lookup resource, as Sonarr's own add dialog sends it, plus the choices.
      ...series,
      qualityProfileId: request.qualityProfileId,
      rootFolderPath: request.rootFolderPath,
      ...(request.folder ? { path: joinRootFolder(request.rootFolderPath, request.folder) } : {}),
      // As every show in the library has it.
      seasonFolder: true,
      monitored: true,
      // A whole-show request follows new seasons; a narrower one doesn't.
      monitorNewItems: request.scope.type === 'all' ? 'all' : 'none',
      seasons: seasonFlagsFor(series, request.scope),
      tags: [],
      addOptions: addOptionsFor(request.scope, request.search),
    },
  })
  if (!isRecord(added) || !hasId(added)) throw new ArrError('invalid_response')
  forgetSeries(config)
  return added
}

/** Changes fields on a library series: Sonarr's PUT takes the whole resource back. */
async function putSeries(config: ArrConfig, series: Series, changes: ArrRecord): Promise<Series> {
  const updated = await arrRequest<unknown>(config, 'PUT', `/api/v3/series/${series.id}`, {
    params: { moveFiles: false },
    data: { ...series, ...changes },
  })
  forgetSeries(config)
  return isRecord(updated) && hasId(updated) ? updated : { ...series, ...changes }
}

export async function updateSeries(config: ArrConfig, seriesId: number, changes: { qualityProfileId?: number }) {
  return putSeries(config, await getSeries(config, seriesId), changes)
}

export interface EpisodeSummary {
  id: number
  seasonNumber: number
  episodeNumber: number
  title: string
  airDate: string | null
  hasFile: boolean
  monitored: boolean
}

export async function listEpisodes(config: ArrConfig, seriesId: number): Promise<EpisodeSummary[]> {
  const episodes = await arrRequest<unknown>(config, 'GET', '/api/v3/episode', { params: { seriesId } })
  return asRecords(episodes)
    .filter(
      (episode) =>
        typeof episode.id === 'number' &&
        typeof episode.seasonNumber === 'number' &&
        typeof episode.episodeNumber === 'number'
    )
    .map((episode) => ({
      id: episode.id as number,
      seasonNumber: episode.seasonNumber as number,
      episodeNumber: episode.episodeNumber as number,
      title: typeof episode.title === 'string' ? episode.title : '',
      airDate: typeof episode.airDate === 'string' ? episode.airDate : null,
      hasFile: episode.hasFile === true,
      monitored: episode.monitored === true,
    }))
    .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber)
}

/**
 * True while Sonarr is still refreshing a show. A just-added show's monitoring
 * pass runs at the end of that refresh, so episodes monitored before it ends
 * would be unmonitored again by an add with monitor "none".
 */
export async function refreshPending(config: ArrConfig, seriesId: number): Promise<boolean> {
  const commands = asRecords(await arrRequest(config, 'GET', '/api/v3/command'))
  return commands.some((command) => {
    if (command.name !== 'RefreshSeries') return false
    if (command.status !== 'queued' && command.status !== 'started') return false
    const body = isRecord(command.body) ? command.body : {}
    return body.seriesId === seriesId || (Array.isArray(body.seriesIds) && body.seriesIds.includes(seriesId))
  })
}

/**
 * Monitors a scope of a show Sonarr has, then searches it now. Monitoring is
 * only ever added, never taken away, and comes first so RSS keeps looking for
 * whatever the search doesn't find.
 */
export async function monitorAndSearch(
  config: ArrConfig,
  seriesId: number,
  scope: EpisodeScope
): Promise<{ episodes: number }> {
  const [series, episodes] = await Promise.all([getSeries(config, seriesId), listEpisodes(config, seriesId)])
  const seasons = toSeasons(series.seasons)

  let seasonNumbers: number[] = []
  let wanted: EpisodeSummary[]
  if (scope.type === 'all') {
    seasonNumbers = seasons.map((season) => season.seasonNumber).filter((number) => number > 0)
    wanted = episodes.filter((episode) => episode.seasonNumber > 0)
  } else if (scope.type === 'seasons') {
    const chosen = new Set(scope.seasons)
    seasonNumbers = seasons.map((season) => season.seasonNumber).filter((number) => chosen.has(number))
    wanted = episodes.filter((episode) => chosen.has(episode.seasonNumber))
  } else {
    const chosen = new Set(scope.episodeIds)
    wanted = episodes.filter((episode) => chosen.has(episode.id))
  }
  if (wanted.length === 0) {
    throw new ArrError('rejected', null, ['Sonarr has no episodes in that selection yet.'])
  }

  const seasonChanges = seasons.some((season) => seasonNumbers.includes(season.seasonNumber) && !season.monitored)
  const followNewSeasons = scope.type === 'all' && series.monitorNewItems !== 'all'
  if (series.monitored !== true || seasonChanges || followNewSeasons) {
    await putSeries(config, series, {
      monitored: true,
      ...(followNewSeasons ? { monitorNewItems: 'all' } : {}),
      seasons: asRecords(series.seasons).map((season) =>
        seasonNumbers.includes(season.seasonNumber as number) ? { ...season, monitored: true } : season
      ),
    })
  }
  const unmonitored = wanted.filter((episode) => !episode.monitored).map((episode) => episode.id)
  if (unmonitored.length > 0) {
    await arrRequest(config, 'PUT', '/api/v3/episode/monitor', { data: { episodeIds: unmonitored, monitored: true } })
  }

  const commands =
    scope.type === 'all'
      ? [{ name: 'SeriesSearch', seriesId }]
      : scope.type === 'seasons'
        ? seasonNumbers.map((seasonNumber) => ({ name: 'SeasonSearch', seriesId, seasonNumber }))
        : [{ name: 'EpisodeSearch', episodeIds: wanted.map((episode) => episode.id) }]
  for (const command of commands) {
    await arrRequest(config, 'POST', '/api/v3/command', { data: command })
  }
  queueCache.clear()
  return { episodes: wanted.length }
}

export async function seriesDownload(config: ArrConfig, seriesId: number): Promise<ArrDownload | null> {
  const records = await arrRequest<unknown>(config, 'GET', '/api/v3/queue/details', { params: { seriesId } })
  return summarizeDownload(asRecords(records))
}

export function seriesItemStatus(series: ArrRecord | null, download: ArrDownload | null): ArrItemStatus {
  if (!series) return { state: 'absent' }
  if (download) return { state: 'downloading', progress: download.progress, timeLeftSeconds: download.timeLeftSeconds }
  const stats = isRecord(series.statistics) ? series.statistics : {}
  const episodeFileCount = finiteNumber(stats.episodeFileCount) ?? 0
  const episodeCount = finiteNumber(stats.episodeCount) ?? 0
  if (episodeCount > 0 && episodeFileCount >= episodeCount) return { state: 'downloaded' }
  if (episodeFileCount > 0) return { state: 'partial', episodeFileCount, episodeCount }
  if (series.monitored !== true) return { state: 'unmonitored' }
  return { state: 'wanted', released: released(series) }
}

/** Chip states for many shows, from the shared series index and queue. */
export async function seriesStatuses(config: ArrConfig, tmdbIds: number[]): Promise<Map<number, ArrItemStatus>> {
  const [index, downloads] = await Promise.all([
    seriesIndex(config),
    queueCache.get(config.baseUrl, async () =>
      downloadsByTitle(
        await arrRequest(config, 'GET', '/api/v3/queue', { params: { page: 1, pageSize: QUEUE_PAGE_SIZE } }),
        'seriesId'
      )
    ),
  ])
  const statuses = new Map<number, ArrItemStatus>()
  for (const tmdbId of tmdbIds) {
    const series = index.byTmdbId.get(tmdbId) ?? null
    statuses.set(tmdbId, seriesItemStatus(series, series ? downloads.get(series.id) ?? null : null))
  }
  return statuses
}
