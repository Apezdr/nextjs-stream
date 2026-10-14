// src/lib/arr/titles.ts
// One title in Radarr or Sonarr, as the /api/authenticated/arr routes ask
// about it: its state for the dialog, adding it, changing its quality profile,
// and searching for it now. The routes only authorize and translate; the rules
// live here.
import 'server-only'
import { NextResponse } from 'next/server'
import { createLogger } from '@src/lib/logger'
import { canActOn, requireActOn, requireManage, requireService, type ArrActor } from './rules'
import { allowsProfile } from './capabilities'
import { checkCatalog } from './catalog'
import { ArrRequestError, REASON_TEXT, SERVICE_NAMES, forbidden } from './errors'
import { folderNameProblem } from './folders'
import { ArrError, readArrConfig, type ArrConfig } from './http'
import * as radarr from './radarr'
import { logArrActivity } from './requestLog'
import * as sonarr from './sonarr'
import {
  ARR_MEDIA_TYPES,
  MINIMUM_AVAILABILITY,
  serviceForMediaType,
  type ArrEntry,
  type ArrFailureReason,
  type ArrMediaType,
  type ArrOptions,
  type ArrService,
  type ArrTitle,
  type ArrTitlePermissions,
  type CatalogCheck,
  type EpisodeScope,
  type MinimumAvailability,
  type TitleRef,
} from './types'

const log = createLogger('Arr')

export { ArrRequestError, REASON_TEXT, SERVICE_NAMES }

export const invalid = (message: string) => new ArrRequestError(400, 'invalid_request', message)

export const isPositiveInteger = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0

// Season 0 is specials.
export const isSeasonNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

// ---- Input ----------------------------------------------------------------

export function parseTitleRef(params: { mediaType?: string; tmdbId?: string }): TitleRef {
  const mediaType = params.mediaType as ArrMediaType
  if (!ARR_MEDIA_TYPES.includes(mediaType)) throw invalid('mediaType must be movie or tv.')
  const tmdbId = Number(params.tmdbId)
  if (!isPositiveInteger(tmdbId)) throw invalid('tmdbId must be a positive integer.')
  return { mediaType, tmdbId }
}

/** Shows only; a movie ignores it. Absent means the whole show. */
export function parseScope(raw: unknown, { forAdd }: { forAdd: boolean }): EpisodeScope {
  if (raw === undefined || raw === null) return { type: 'all' }
  if (typeof raw !== 'object') throw invalid('scope must be an object.')
  const { type, seasons, episodeIds } = raw as { type?: unknown; seasons?: unknown; episodeIds?: unknown }
  if (type === 'all') return { type: 'all' }
  if (type === 'seasons') {
    if (!Array.isArray(seasons) || seasons.length === 0 || !seasons.every(isSeasonNumber)) {
      throw invalid('Pick at least one season.')
    }
    return { type: 'seasons', seasons: [...new Set(seasons)] }
  }
  if (type === 'episodes') {
    // On an add the episodes are picked afterwards, from Sonarr's own list.
    if (forAdd) return { type: 'episodes', episodeIds: [] }
    if (!Array.isArray(episodeIds) || episodeIds.length === 0 || !episodeIds.every(isPositiveInteger)) {
      throw invalid('Pick at least one episode.')
    }
    return { type: 'episodes', episodeIds: [...new Set(episodeIds)] }
  }
  throw invalid('scope.type must be all, seasons or episodes.')
}

export interface AddInput {
  qualityProfileId: number
  /** Null takes the service's (first accessible) root folder. */
  rootFolderPath: string | null
  /** The folder name the admin settled on; null takes the one the service would use. */
  folder: string | null
  /** Radarr only. */
  minimumAvailability: MinimumAvailability
  /** Sonarr only. */
  scope: EpisodeScope
  /** Search right away, rather than waiting for a new release to turn up. */
  search: boolean
}

export function parseAddInput(body: unknown): AddInput {
  if (!body || typeof body !== 'object') throw invalid('Expected a JSON body.')
  const input = body as Record<string, unknown>
  if (!isPositiveInteger(input.qualityProfileId)) throw invalid('Choose a quality profile.')
  if (input.rootFolderPath != null && typeof input.rootFolderPath !== 'string') {
    throw invalid('rootFolderPath must be a string.')
  }
  if (input.folder != null && typeof input.folder !== 'string') throw invalid('folder must be a string.')
  const minimumAvailability = input.minimumAvailability ?? 'released'
  if (!MINIMUM_AVAILABILITY.includes(minimumAvailability as MinimumAvailability)) {
    throw invalid('minimumAvailability must be announced, inCinemas or released.')
  }
  return {
    qualityProfileId: input.qualityProfileId,
    rootFolderPath: typeof input.rootFolderPath === 'string' ? input.rootFolderPath : null,
    folder: typeof input.folder === 'string' ? input.folder : null,
    minimumAvailability: minimumAvailability as MinimumAvailability,
    scope: parseScope(input.scope, { forAdd: true }),
    search: input.search !== false,
  }
}

export function parseProfileChange(body: unknown): { qualityProfileId: number } {
  const qualityProfileId = (body as { qualityProfileId?: unknown } | null)?.qualityProfileId
  if (!isPositiveInteger(qualityProfileId)) throw invalid('Choose a quality profile.')
  return { qualityProfileId }
}

// ---- Shared checks ----------------------------------------------------------

export function configFor(service: ArrService): ArrConfig {
  const resolved = readArrConfig(service)
  if ('missing' in resolved) {
    throw new ArrRequestError(503, 'not_configured', `${SERVICE_NAMES[service]} isn’t set up on this server.`, {
      missing: resolved.missing,
    })
  }
  return resolved.config
}

/** The options as the browser sees them: Radarr's naming config stays here. */
const publicOptions = ({ qualityProfiles, rootFolders, defaultQualityProfileId }: ArrOptions): ArrOptions => ({
  qualityProfiles,
  rootFolders,
  defaultQualityProfileId,
})

const defaultRootFolder = (options: ArrOptions) =>
  (options.rootFolders.find((folder) => folder.accessible) ?? options.rootFolders[0])?.path ?? null

function requireProfile(options: ArrOptions, qualityProfileId: number) {
  if (!options.qualityProfiles.some((profile) => profile.id === qualityProfileId)) {
    throw invalid('That quality profile no longer exists. Reopen the dialog and choose again.')
  }
}

function chooseRootFolder(options: ArrOptions, requested: string | null): string {
  if (requested !== null) {
    if (!options.rootFolders.some((folder) => folder.path === requested)) {
      throw invalid('That root folder isn’t one the service has.')
    }
    return requested
  }
  const path = defaultRootFolder(options)
  if (!path) throw new ArrRequestError(409, 'no_root_folder', 'The service has no root folder to add titles to.')
  return path
}

/** The folder must be a usable name that no other title in the library already has. */
async function checkFolder(
  mediaType: ArrMediaType,
  tmdbId: number,
  folder: string | null,
  canRename: boolean
): Promise<CatalogCheck> {
  if (folder !== null) {
    const problem = folderNameProblem(folder)
    if (problem) throw new ArrRequestError(400, 'invalid_folder', problem)
  }
  const catalog = await checkCatalog(mediaType, tmdbId, folder)
  if (catalog.folderTakenBy) {
    throw new ArrRequestError(
      409,
      'folder_taken',
      `“${catalog.folderTakenBy.title}” already lives in the folder “${folder}”. ${
        canRename ? 'Choose a different folder name.' : 'Ask a manager to add it under another folder name.'
      }`
    )
  }
  return catalog
}

export const notAdded = (service: ArrService) =>
  new ArrRequestError(404, 'not_added', `${SERVICE_NAMES[service]} doesn’t have this title.`)

/** The add form's choices: the quality profiles the user's role allows; only managers pick a root folder. */
function choicesFor(actor: ArrActor, service: ArrService, options: ArrOptions): ArrOptions {
  const qualityProfiles = options.qualityProfiles.filter((profile) => allowsProfile(actor.permissions, service, profile.id))
  const root = defaultRootFolder(options)
  return {
    qualityProfiles,
    rootFolders: actor.permissions.manage ? options.rootFolders : options.rootFolders.filter((folder) => folder.path === root),
    defaultQualityProfileId: qualityProfiles.some((profile) => profile.id === options.defaultQualityProfileId)
      ? options.defaultQualityProfileId
      : (qualityProfiles[0]?.id ?? null),
  }
}

const titlePermissions = (actor: ArrActor, canAct: boolean): ArrTitlePermissions => ({
  manage: actor.permissions.manage,
  manual: actor.permissions.manual,
  canAct,
})

function requireAllowedProfile(actor: ArrActor, service: ArrService, options: ArrOptions, qualityProfileId: number) {
  requireProfile(options, qualityProfileId)
  if (!allowsProfile(actor.permissions, service, qualityProfileId)) {
    throw forbidden('That quality profile isn’t one your role allows.')
  }
}

/** A manager's folder and root folder choices; anyone else gets the ones the service would use. */
function placementFor(actor: ArrActor, options: ArrOptions, input: AddInput, predictedFolder: string | null) {
  if (actor.permissions.manage) {
    return { rootFolderPath: chooseRootFolder(options, input.rootFolderPath), folder: input.folder ?? predictedFolder }
  }
  if (input.rootFolderPath !== null && input.rootFolderPath !== defaultRootFolder(options)) {
    throw forbidden('Choosing the root folder is for managers.')
  }
  if (input.folder !== null && input.folder !== predictedFolder) throw forbidden('Choosing the folder name is for managers.')
  return { rootFolderPath: chooseRootFolder(options, null), folder: predictedFolder }
}

// ---- Reads ------------------------------------------------------------------

async function radarrTitle(config: ArrConfig, ref: TitleRef, actor: ArrActor): Promise<ArrTitle> {
  const { tmdbId } = ref
  const [movie, options] = await Promise.all([radarr.findMovie(config, tmdbId), radarr.getRadarrOptions(config)])
  if (movie) {
    const entry = radarr.toRadarrEntry(movie)
    const [download, canAct] = await Promise.all([
      // Detail only: losing the queue still shows the title.
      radarr.movieDownload(config, movie.id).catch(() => null),
      canActOn(actor, ref, 'radarr', entry.qualityProfileId),
    ])
    return {
      state: 'present',
      service: 'radarr',
      entry,
      options: publicOptions(options),
      download,
      permissions: titlePermissions(actor, canAct),
    }
  }
  const lookup = await radarr.lookupMovie(config, tmdbId)
  if (!lookup) return { state: 'not_found', service: 'radarr' }
  const candidate = radarr.toRadarrCandidate(lookup, options.naming)
  return {
    state: 'absent',
    service: 'radarr',
    candidate,
    options: choicesFor(actor, 'radarr', publicOptions(options)),
    catalog: await checkCatalog('movie', tmdbId, candidate.folder),
    rootFolderPath: defaultRootFolder(options),
    permissions: titlePermissions(actor, true),
  }
}

async function sonarrTitle(config: ArrConfig, ref: TitleRef, titleHint: string | null, actor: ArrActor): Promise<ArrTitle> {
  const { tmdbId } = ref
  const [found, options] = await Promise.all([
    sonarr.resolveSeries(config, tmdbId, titleHint),
    sonarr.getSonarrOptions(config),
  ])
  if (found.entry) {
    const entry = sonarr.toSonarrEntry(found.entry)
    const [download, canAct] = await Promise.all([
      sonarr.seriesDownload(config, found.entry.id).catch(() => null),
      canActOn(actor, ref, 'sonarr', entry.qualityProfileId),
    ])
    return { state: 'present', service: 'sonarr', entry, options, download, permissions: titlePermissions(actor, canAct) }
  }
  if (!found.candidate) return { state: 'not_found', service: 'sonarr' }
  const candidate = sonarr.toSonarrCandidate(found.candidate)
  return {
    state: 'absent',
    service: 'sonarr',
    candidate,
    options: choicesFor(actor, 'sonarr', options),
    catalog: await checkCatalog('tv', tmdbId, candidate.folder),
    rootFolderPath: defaultRootFolder(options),
    permissions: titlePermissions(actor, true),
  }
}

/** The dialog's view of a title, shaped by the user's role. Service failures are a state, not an error. */
export async function getArrTitle(ref: TitleRef, titleHint: string | null, actor: ArrActor): Promise<ArrTitle> {
  const service = serviceForMediaType(ref.mediaType)
  requireService(actor, service)
  const resolved = readArrConfig(service)
  if ('missing' in resolved) return { state: 'not_configured', service, missing: resolved.missing }
  try {
    return service === 'radarr'
      ? await radarrTitle(resolved.config, ref, actor)
      : await sonarrTitle(resolved.config, ref, titleHint, actor)
  } catch (error) {
    if (!(error instanceof ArrError)) throw error
    log.warn({ service, reason: error.reason, httpStatus: error.httpStatus }, 'Arr title lookup failed')
    return { state: 'unreachable', service, reason: error.reason, httpStatus: error.httpStatus }
  }
}

export interface ArrEpisodes {
  seriesId: number
  /** False while Sonarr is still refreshing the show (just added): pick once it's true. */
  ready: boolean
  episodes: sonarr.EpisodeSummary[]
}

export async function getArrEpisodes(tmdbId: number, titleHint: string | null, actor: ArrActor): Promise<ArrEpisodes> {
  requireService(actor, 'sonarr')
  const config = configFor('sonarr')
  const { entry } = await sonarr.resolveSeries(config, tmdbId, titleHint)
  if (!entry) throw notAdded('sonarr')
  await requireActOn(actor, { mediaType: 'tv', tmdbId }, 'sonarr', sonarr.toSonarrEntry(entry).qualityProfileId)
  const [pending, episodes] = await Promise.all([
    sonarr.refreshPending(config, entry.id),
    sonarr.listEpisodes(config, entry.id),
  ])
  return { seriesId: entry.id, ready: !pending && episodes.length > 0, episodes }
}

// ---- Writes -----------------------------------------------------------------

export interface AddResult {
  service: ArrService
  entry: ArrEntry
  /** Already in our library (a folder the service just adopted): no "Coming soon" for it. */
  inLibrary: boolean
  /** "choose_episodes": the show went in with nothing monitored; pick its episodes next. */
  next: 'choose_episodes' | null
}

export async function addArrTitle(
  ref: TitleRef,
  input: AddInput,
  titleHint: string | null,
  actor: ArrActor
): Promise<AddResult> {
  const service = serviceForMediaType(ref.mediaType)
  requireService(actor, service)
  const config = configFor(service)
  const logAdd = () =>
    logArrActivity({
      kind: 'add',
      actor,
      ref,
      service,
      detail: { qualityProfileId: input.qualityProfileId, search: input.search, scope: input.scope.type },
    })

  if (service === 'radarr') {
    const options = await radarr.getRadarrOptions(config)
    requireAllowedProfile(actor, service, options, input.qualityProfileId)
    if (await radarr.findMovie(config, ref.tmdbId)) {
      throw new ArrRequestError(409, 'already_added', 'Radarr already has this movie.')
    }
    const movie = await radarr.lookupMovie(config, ref.tmdbId)
    if (!movie) throw new ArrRequestError(404, 'not_found', 'Radarr can’t find this movie by its TMDB id.')
    const { rootFolderPath, folder } = placementFor(
      actor,
      options,
      input,
      radarr.toRadarrCandidate(movie, options.naming).folder
    )
    const catalog = await checkFolder('movie', ref.tmdbId, folder, actor.permissions.manage)
    const added = await radarr.addMovie(config, movie, {
      qualityProfileId: input.qualityProfileId,
      rootFolderPath,
      folder,
      minimumAvailability: input.minimumAvailability,
      search: input.search,
    })
    log.info({ service, tmdbId: ref.tmdbId, movieId: added.id, search: input.search }, 'Movie added to Radarr')
    // Before answering: it's what lets a requester search for this title later.
    await logAdd()
    return { service, entry: radarr.toRadarrEntry(added), inLibrary: catalog.inLibrary, next: null }
  }

  const options = await sonarr.getSonarrOptions(config)
  requireAllowedProfile(actor, service, options, input.qualityProfileId)
  const found = await sonarr.resolveSeries(config, ref.tmdbId, titleHint)
  if (found.entry) throw new ArrRequestError(409, 'already_added', 'Sonarr already has this show.')
  if (!found.candidate) throw new ArrRequestError(404, 'not_found', 'Sonarr can’t find this show by its TMDB id.')
  const candidate = sonarr.toSonarrCandidate(found.candidate)
  if (input.scope.type === 'seasons') {
    const known = new Set(candidate.seasons.map((season) => season.seasonNumber))
    if (!input.scope.seasons.every((season) => known.has(season))) {
      throw invalid('Sonarr doesn’t list one of those seasons.')
    }
  }
  const { rootFolderPath, folder } = placementFor(actor, options, input, candidate.folder)
  const catalog = await checkFolder('tv', ref.tmdbId, folder, actor.permissions.manage)
  const added = await sonarr.addSeries(config, found.candidate, {
    qualityProfileId: input.qualityProfileId,
    rootFolderPath,
    folder,
    scope: input.scope,
    search: input.search,
  })
  log.info(
    { service, tmdbId: ref.tmdbId, seriesId: added.id, scope: input.scope.type, search: input.search },
    'Show added to Sonarr'
  )
  await logAdd()
  return {
    service,
    entry: sonarr.toSonarrEntry(added),
    inLibrary: catalog.inLibrary,
    next: input.scope.type === 'episodes' ? 'choose_episodes' : null,
  }
}

export async function updateArrTitle(
  ref: TitleRef,
  change: { qualityProfileId: number },
  titleHint: string | null,
  actor: ArrActor
): Promise<{ service: ArrService; entry: ArrEntry }> {
  requireManage(actor, 'Changing a title’s quality profile')
  const service = serviceForMediaType(ref.mediaType)
  const config = configFor(service)

  if (service === 'radarr') {
    requireProfile(await radarr.getRadarrOptions(config), change.qualityProfileId)
    const movie = await radarr.findMovie(config, ref.tmdbId)
    if (!movie) throw notAdded(service)
    const updated = await radarr.updateMovie(config, movie.id, change)
    return { service, entry: radarr.toRadarrEntry(updated) }
  }

  requireProfile(await sonarr.getSonarrOptions(config), change.qualityProfileId)
  const { entry } = await sonarr.resolveSeries(config, ref.tmdbId, titleHint)
  if (!entry) throw notAdded(service)
  const updated = await sonarr.updateSeries(config, entry.id, change)
  return { service, entry: sonarr.toSonarrEntry(updated) }
}

/** Searches a title the service already has, monitoring it (or the scope) first. */
export async function searchArrTitle(
  ref: TitleRef,
  scope: EpisodeScope,
  titleHint: string | null,
  actor: ArrActor
): Promise<{ service: ArrService; episodes: number | null }> {
  const service = serviceForMediaType(ref.mediaType)
  requireService(actor, service)
  const config = configFor(service)

  if (service === 'radarr') {
    const movie = await radarr.findMovie(config, ref.tmdbId)
    if (!movie) throw notAdded(service)
    await requireActOn(actor, ref, service, radarr.toRadarrEntry(movie).qualityProfileId)
    // An unmonitored movie would be searched once and then forgotten by RSS.
    if (movie.monitored !== true) await radarr.updateMovie(config, movie.id, { monitored: true })
    await radarr.searchMovie(config, movie.id)
    log.info({ service, tmdbId: ref.tmdbId, movieId: movie.id }, 'Radarr search queued')
    await logArrActivity({ kind: 'search', actor, ref, service, detail: { scope: 'all' } })
    return { service, episodes: null }
  }

  const { entry } = await sonarr.resolveSeries(config, ref.tmdbId, titleHint)
  if (!entry) throw notAdded(service)
  await requireActOn(actor, ref, service, sonarr.toSonarrEntry(entry).qualityProfileId)
  const { episodes } = await sonarr.monitorAndSearch(config, entry.id, scope)
  await logArrActivity({ kind: 'search', actor, ref, service, detail: { scope: scope.type, episodes } })
  log.info({ service, tmdbId: ref.tmdbId, seriesId: entry.id, scope: scope.type, episodes }, 'Sonarr search queued')
  return { service, episodes }
}

// ---- Responses --------------------------------------------------------------


/** The JSON error answer for anything a write or an episode read throws. */
export function arrErrorResponse(error: unknown, service: ArrService | null): NextResponse {
  if (error instanceof ArrRequestError) {
    return NextResponse.json({ error: error.code, message: error.message, ...error.details }, { status: error.status })
  }
  const name = service ? SERVICE_NAMES[service] : 'The service'
  if (error instanceof ArrError) {
    if (error.reason === 'rejected') {
      const message = error.messages.length ? `${name}: ${error.messages.join(' ')}` : `${name} refused the request.`
      return NextResponse.json({ error: 'rejected', message, messages: error.messages }, { status: 422 })
    }
    if (error.reason === 'not_found') {
      return NextResponse.json({ error: 'not_found', message: `${name} no longer has that title.` }, { status: 404 })
    }
    log.warn({ service, reason: error.reason, httpStatus: error.httpStatus }, 'Arr request failed')
    return NextResponse.json(
      {
        error: 'unreachable',
        reason: error.reason,
        httpStatus: error.httpStatus,
        message: `${name} didn’t answer: ${REASON_TEXT[error.reason]}.`,
      },
      { status: 502 }
    )
  }
  log.error({ err: error, service }, 'Arr request failed')
  return NextResponse.json({ error: 'internal', message: 'Something went wrong. Try again.' }, { status: 500 })
}
