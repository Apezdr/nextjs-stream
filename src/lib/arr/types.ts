// src/lib/arr/types.ts
// The shapes the /api/authenticated/arr routes answer in. Radarr and Sonarr
// each speak their own v3 dialect; radarr.ts and sonarr.ts map them onto these,
// so the dialog and the watchlist chips depend on neither.

export const ARR_SERVICES = ['radarr', 'sonarr'] as const
export type ArrService = (typeof ARR_SERVICES)[number]

export const ARR_MEDIA_TYPES = ['movie', 'tv'] as const
export type ArrMediaType = (typeof ARR_MEDIA_TYPES)[number]

export const serviceForMediaType = (mediaType: ArrMediaType): ArrService =>
  mediaType === 'movie' ? 'radarr' : 'sonarr'

/** A title by its TMDB id, which is unique only within its media type. */
export interface TitleRef {
  mediaType: ArrMediaType
  tmdbId: number
}

/**
 * Why a request failed. `rejected` means the service answered and refused,
 * with its own validation messages (a path already in use, say); `not_found`
 * is a 404 from the service.
 */
export type ArrFailureReason =
  | 'timeout'
  | 'unauthorized'
  | 'refused'
  | 'network'
  | 'bad_url'
  | 'http_error'
  | 'invalid_response'
  | 'not_found'
  | 'rejected'

export interface QualityProfile {
  id: number
  name: string
}

export interface RootFolder {
  path: string
  accessible: boolean
  freeSpaceBytes: number | null
}

export interface ArrOptions {
  qualityProfiles: QualityProfile[]
  rootFolders: RootFolder[]
  /** The profile most of the library already uses: the dialog's first-time default. */
  defaultQualityProfileId: number | null
}

/** Radarr's minimumAvailability values an admin can pick. */
export const MINIMUM_AVAILABILITY = ['announced', 'inCinemas', 'released'] as const
export type MinimumAvailability = (typeof MINIMUM_AVAILABILITY)[number]

/**
 * Which episodes of a show an add or a search covers. On an add, `episodes`
 * carries no ids: the show goes in with nothing monitored, and the episodes are
 * picked from Sonarr's own list afterwards, because TMDB numbers episodes
 * differently from Sonarr's source for some shows.
 */
export type EpisodeScope =
  | { type: 'all' }
  | { type: 'seasons'; seasons: number[] }
  | { type: 'episodes'; episodeIds: number[] }

export interface SeasonSummary {
  seasonNumber: number
  monitored: boolean
  /** Library entries only: Sonarr's per-season statistics. */
  episodeFileCount: number | null
  episodeCount: number | null
}

/** A title as the service would add it. */
export interface ArrCandidate {
  title: string
  year: number | null
  /**
   * The folder the title would get under the root folder. It becomes the
   * title's originalTitle, so the dialog shows it before anything is created.
   * Null when the naming format has tokens this app cannot reproduce.
   */
  folder: string | null
  /** Radarr: isAvailable. Sonarr: anything but status "upcoming". */
  released: boolean | null
  /** Sonarr only; [] for Radarr. */
  seasons: SeasonSummary[]
}

/** A title the service already manages. */
export interface ArrEntry {
  id: number
  title: string
  monitored: boolean
  qualityProfileId: number
  path: string | null
  /** Radarr: the movie file is on disk. Sonarr: every monitored aired episode is. */
  hasFile: boolean
  released: boolean | null
  /** Sonarr only (null for Radarr). */
  episodeFileCount: number | null
  episodeCount: number | null
  seasons: SeasonSummary[]
}

/** What is downloading for one title right now. */
export interface ArrDownload {
  /** 0-100 across everything queued for the title; null when sizes are unknown. */
  progress: number | null
  timeLeftSeconds: number | null
  /** Queue records for the title: one movie, or several episodes / season packs. */
  records: number
}

/** Our own library's view of a title: shown before an add, checked again during it. */
export interface CatalogCheck {
  /** The title is already in the library (FlatMovies / FlatTVShows). */
  inLibrary: boolean
  /** A different title already lives in the folder this one would get. */
  folderTakenBy: { title: string } | null
}

/** What the dialog may offer this user for this title (their role, applied to it). */
export interface ArrTitlePermissions {
  /** Choose the folder and root folder, change the quality profile, grab rejected releases. */
  manage: boolean
  /** Pick a release by hand. */
  manual: boolean
  /** Search and pick for this title: always true for one not yet added. */
  canAct: boolean
}

export type ArrTitle =
  | { state: 'not_configured'; service: ArrService; missing: string[] }
  | { state: 'unreachable'; service: ArrService; reason: ArrFailureReason; httpStatus: number | null }
  | { state: 'not_found'; service: ArrService }
  | {
      state: 'absent'
      service: ArrService
      candidate: ArrCandidate
      options: ArrOptions
      catalog: CatalogCheck
      rootFolderPath: string | null
      permissions: ArrTitlePermissions
    }
  | {
      state: 'present'
      service: ArrService
      entry: ArrEntry
      options: ArrOptions
      download: ArrDownload | null
      permissions: ArrTitlePermissions
    }

/** One watchlist card's chip. */
export type ArrItemStatus =
  | { state: 'absent' }
  | { state: 'downloading'; progress: number | null; timeLeftSeconds: number | null }
  | { state: 'downloaded' }
  | { state: 'partial'; episodeFileCount: number; episodeCount: number }
  | { state: 'wanted'; released: boolean | null }
  | { state: 'unmonitored' }

/** no_access: the user's role doesn't include the service. */
export type ArrServiceState = 'ok' | 'not_configured' | 'unreachable' | 'no_access'

export interface ArrStatusResponse {
  services: Record<ArrService, ArrServiceState>
  /** Keyed `${mediaType}:${tmdbId}`; a title whose service failed is left out. */
  items: Record<string, ArrItemStatus>
}

export const titleKey = (mediaType: ArrMediaType, tmdbId: number) => `${mediaType}:${tmdbId}`
