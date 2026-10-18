/**
 * Core domain types and interfaces for the sync system
 * This file defines the foundational contracts for our domain-driven sync architecture
 */

import type { CleanupConfig } from './FieldAbsenceCleaner'

// ==========================================
// Media Domain Types
// ==========================================

export enum MediaTypesFieldAvailability {
  Movie = 'movies',
  TVShow = 'tv'
}

export enum MediaType {
  Movie = 'movie',
  Episode = 'episode',
  Season = 'season',
  TVShow = 'tvshow'
}

export enum SyncOperation {
  Metadata = 'metadata',
  Assets = 'assets',      // posters, backdrops, logos
  Content = 'content',    // video URLs, captions, chapters
  Validation = 'validation',
  Blurhash = 'blurhash'  // post-entity blurhash computation (poster + backdrop)
}

export enum SyncStatus {
  Pending = 'pending',
  InProgress = 'in_progress',
  Completed = 'completed',
  Failed = 'failed',
  Skipped = 'skipped'
}

// ==========================================
// Server Configuration
// ==========================================

export interface ServerConfig {
  id: string
  priority: number
  baseUrl: string        // File server URL (for media files)
  nodeUrl?: string       // Node.js server URL
  prefix?: string
  enabled: boolean
  timeout?: number
}

export interface FieldAvailability {
  movies: Record<string, Record<string, string[]>>
  tv: Record<string, Record<string, string[]>>
}

// ==========================================
// What a server's pass hands its steps and builders
// ==========================================
//
// run/serverPass builds these once per pass and none of them changes during
// it. Each movie step and TV builder is given only the parts it reads, typed
// down to the fields it reads, so reaching for anything else fails the
// typecheck. The title's payload is not one of them: each title is handed its
// own (`fileServer.movies[title]`, `fileServer.tv[title]`).

/** The run and the server this pass applies. */
export interface RunConfig {
  serverConfig: ServerConfig
  /** Ignore the skip gates: every title is synced in full. */
  forceSync: boolean
  /**
   * True only when every enabled file server answered this run. "No server
   * reports this" means the data is gone only then; on a run with a server
   * missing it may just mean that server is down.
   */
  allEnabledServersProbed: boolean
  /**
   * Field-absence cleanup (drops stale optional fields that NO enabled server
   * reports anymore — see core/FieldAbsenceCleaner +
   * FIELD_ABSENCE_CLEANUP_DESIGN.md). Defaults to `enforce`;
   * SYNC_FIELD_CLEANUP=dry-run downgrades to detect+log, and
   * off/false/disabled leaves it undefined, and the cleaner is never invoked.
   * Its own `allEnabledServersProbed` is the run's: false makes cleanup a
   * no-op, so a transient outage is never mistaken for a deletion.
   */
  cleanup?: CleanupConfig
}

/** Who reports what: the input of every ownership check and of the gates. */
export interface Availability {
  fieldAvailability: FieldAvailability
}

/** The file server's metadata hash for every movie (GET /api/metadata-hashes/movies). */
export interface MovieMetadataHashes {
  hash: string
  titles: Record<string, { hash: string; lastModified: string; generated: string }>
}

/** What a movie pass fetches or creates once and its steps share. */
export interface Caches {
  /**
   * The metadata step skips a movie's metadata.json fetch when its hash
   * matches the stored metadataHash.
   */
  metadataHashes?: MovieMetadataHashes
  /**
   * Throttles the outbound calls a step makes itself. Not around
   * fetchMetadataMultiServer, which takes its own slot
   * (infrastructure/fileSystem/fetchFile).
   */
  resourceManager?: {
    throttleHttp: <T>(fn: () => Promise<T>) => Promise<T>
  }
}

/** Everything a movie pass hands MovieSyncService. */
export interface MoviePassParts {
  run: RunConfig
  availability: Availability
  caches: Caches
}

/** Everything a TV pass hands the TV services: no caches. */
export interface TVPassParts {
  run: RunConfig
  availability: Availability
}

// ==========================================
// Sync Results
// ==========================================

export interface SyncResult {
  status: SyncStatus
  entityId: string
  mediaType: MediaType
  operation: SyncOperation
  serverId: string
  timestamp: Date
  changes: string[]
  errors: string[]
  metadata?: Record<string, any>
}

// ==========================================
// Write plans
// ==========================================

/**
 * A file a sync step wants fetched before it runs. Steps fetch for themselves
 * for now and leave `needs` empty; the request shape is the prefetch step's to
 * settle.
 */
export interface ResourceRequest {
  /** What the file is. */
  kind: 'metadata' | 'blurhash'
  /** The server to ask. */
  serverId: string
  /** The file's path in that server's payload. */
  path: string
}

/**
 * What one sync step wants written: its inputs go in, this comes out, and the
 * service merges the steps' plans into one write (core/writePlan).
 */
export interface WritePlan<E = Record<string, any>> {
  /** Fields to write. */
  set: Partial<E>
  /** Fields to remove: their data is gone, which `$set` cannot express. */
  unset: string[]
  /** Fetches the step wants done first. */
  needs: ResourceRequest[]
  /**
   * A decision was held back (a step failed, a removal waits for a run on
   * which every server answers, a file could not be fetched): the skip gate
   * stays open, so the next pass does the work.
   */
  incomplete: boolean
  /** Which decisions were held back, for the event log. */
  deferrals: string[]
}

/**
 * What one step of a pass returns: its write plan, and whether it writes the
 * document. A step that writes stamps `lastSynced` in its plan; the flag says
 * so explicitly, so the service does not read it off the plan's fields.
 */
export interface PlanOutcome<E = Record<string, any>> {
  plan: WritePlan<E>
  /** The step writes the document (its plan stamps `lastSynced`). */
  wroteDocument: boolean
}

// ==========================================
// Backdrop focal-point hint
// ==========================================

/**
 * Canonical focal-point values emitted by the media-processor for a backdrop image.
 * Drives the banner layout variant on the frontend.
 *
 * - `null` (or missing) = no hint available; UI renders the legacy focal-right design
 * - `'left'` / `'right'` = subject sits in that third; UI mirrors gradient and anchors text on the opposite side
 * - `'left-center'` / `'right-center'` = subject between center and edge; UI nudges text inward
 * - `'center'` = subject dead-center; UI switches to a vertical-only letterbox gradient
 */
export type BackdropFocal = 'left' | 'left-center' | 'center' | 'right-center' | 'right' | null

// ==========================================
// Media Entities
// ==========================================

export interface BaseMediaEntity {
  // Pretty display title (from TMDB metadata)
  title: string
  
  // Filesystem key title (used for file server operations)
  originalTitle: string
  
  lastSynced: Date
  metadata?: Record<string, any>

  // Creation tracking (every concrete entity re-declares this; the base-level
  // declaration lets BaseRepository.save() preserve it generically)
  createdAt?: Date

  // When this content first entered the library — what "Recently Added" ranks
  // on. NOT createdAt (a document-lifecycle stamp that resets when a doc is
  // deleted and re-created) and NOT mediaLastModified (file mtime, which a
  // quality upgrade bumps and a preserved download mtime buries). Seeded once,
  // never moved later, earlier-wins against the backend's sidecar date — the
  // whole rule lives in core/discovery.ts. `initialDiscoveryServer` is a server
  // id, or the sentinels 'backfill' / 'manual'.
  initialDiscoveryDate?: Date
  initialDiscoveryServer?: string

  // Field-level source tracking (sources are tracked per field)
  metadataSource?: string
  titleSource?: string
  originalTitleSource?: string
  videoSource?: string
  posterSource?: string
  backdropSource?: string
  logoSource?: string
  captionSource?: string
  chapterSource?: string
  videoInfoSource?: string
  
  // Sync versioning for schema evolution
  syncVersion?: string  // Version of sync logic that last updated this record
}

/**
 * One video file belonging to a title, as published by the media-processor's
 * `sources[]` (backend components/media-scanner/domain/video-sources.mjs).
 *
 * A title can hold several containers of the same content; exactly one is
 * `isPrimary` and its `url` is what `videoURL` points at. The array's ORDER is
 * a backend hash contract (VIDEO_EXTENSIONS priority, then filename) — store
 * it verbatim, never re-sort.
 *
 * `jitEligible` is a CAPABILITY claim (can the transcoder serve this without
 * the viewer losing an audio language), never a liveness signal.
 */
export interface MediaSourceEntry {
  url: string
  filename: string
  container: string          // 'mp4' | 'm4v' | 'mov' | 'mkv' | 'webm' | 'avi'
  formatName?: string | null // ffprobe format_name, verbatim
  size?: number | null
  length?: number | null     // duration, ms
  dimensions?: string | null
  videoCodec?: string | null
  pixFmt?: string | null
  fieldOrder?: string | null // null = unknown; treat as progressive
  hdr?: string | null
  audioTrackCount?: number
  audioLanguages?: string[]  // distinct strict language codes; [] when untagged
  mediaLastModified?: string | null
  uuid?: string | null       // info.uuid of THIS file, not of the title
  isPrimary?: boolean
  jitEligible?: boolean
  jitReason?: string | null  // why not, when ineligible
  jitKey?: string | null
  jitUrl?: string | null
}

export interface MovieEntity extends BaseMediaEntity {
  // Type marker - REQUIRED for collection queries
  type?: string  // 'movie' - must always be set for new records

  // Creation tracking - REQUIRED for "recently added" features
  createdAt?: Date
  initialDiscoveryDate?: Date
  initialDiscoveryServer?: string

  // Video and info
  videoURL?: string
  videoSource?: string
  videoInfo?: VideoInfo
  videoInfoSource?: string
  normalizedVideoId?: string

  // Backend-sourced content identity (`mid:<sha256[0:16]>` of the library-
  // relative folder path, sidecar-persisted so it survives renames and
  // re-encodes). This is what watch history joins on — distinct from `_id`,
  // which is per-file and churns. Set-only: never written as null, and
  // protected from absence cleanup.
  mediaId?: string

  // Delivery facts describing the PRIMARY source (companions of the video
  // block — same owner as videoSource, mirrored so a host disabling JIT
  // clears them).
  sources?: MediaSourceEntry[] | null
  primaryContainer?: string | null  // container of the isPrimary source
  jitEligible?: boolean | null
  jitUrl?: string | null
  // Admin-set JIT delivery override ('on'|'off'; absent = follow the
  // global mode). Written ONLY by the admin editors — sync never touches it.
  jitServeOverride?: 'on' | 'off' | null

  // Video metadata (FLAT at root level - matches legacy structure)
  duration?: number  // Video duration in seconds
  dimensions?: string  // e.g., "1920x1080"
  hdr?: string  // HDR format string (e.g., "HDR10", "Dolby Vision")
  size?: number  // File size in bytes
  mediaLastModified?: Date  // When the media file was last modified
  mediaQuality?: MediaQuality
  
  // Metadata hash for change detection (from /api/metadata-hashes/movies)
  metadataHash?: string
  
  // Asset URLs (IMPORTANT: backdrop and logo have NO "URL" suffix)
  posterURL?: string
  posterSource?: string
  backdrop?: string  // NOT backdropURL - legacy field name
  backdropSource?: string
  logo?: string  // NOT logoURL - legacy field name
  logoSource?: string
  
  // Subtitles/Captions
  captionURLs?: Record<string, {
    srcLang: string
    url: string
    lastModified?: string
    sourceServerId?: string
  }>
  captionSource?: string
  
  // Chapters
  chapterURL?: string
  chapterSource?: string
  
  posterBlurhash?: string
  posterBlurhashSource?: string
  backdropBlurhash?: string
  backdropBlurhashSource?: string

  // Backdrop focal-point hint (admin override + auto-detected). Frontend resolves
  // the effective value with `backdropFocal ?? backdropFocalSuggested`.
  backdropFocal?: BackdropFocal
  backdropFocalSource?: string
  backdropFocalSuggested?: BackdropFocal
  backdropFocalSuggestedSource?: string

  // Per-server skip gates: { <serverId>: "g<version>:<payload>#<availability>" }.
  // A server's pass over this document is skipped when its entry matches the
  // gate computed for the current run. See core/syncGate for the whole rule.
  syncGates?: Record<string, string>

  // Server identification
  serverId?: string
}

export interface EpisodeEntity extends BaseMediaEntity {
  // Legacy structural fields
  type?: string           // 'episode'
  createdAt?: Date
  showId?: any            // ObjectId reference to parent TV show
  seasonId?: any          // ObjectId reference to parent season

  episodeNumber: number
  seasonNumber: number
  showTitle: string
  videoURL?: string
  videoSource?: string
  normalizedVideoId?: string

  // Backend-sourced content identity — `${showMediaId}:s##e##`. Set-only,
  // protected from absence cleanup. See MovieEntity.mediaId.
  mediaId?: string

  // Delivery facts describing the PRIMARY source (episodes carry these flat,
  // beside videoURL, matching the backend's episode payload convention).
  sources?: MediaSourceEntry[] | null
  primaryContainer?: string | null
  jitEligible?: boolean | null
  jitUrl?: string | null
  // Admin-set JIT delivery override ('on'|'off'; absent = follow the
  // global mode). Written ONLY by the admin editors — sync never touches it.
  jitServeOverride?: 'on' | 'off' | null
  thumbnail?: string   // NOT thumbnailURL - legacy field name
  thumbnailSource?: string
  captionURLs?: Record<string, {   // NOT captions - legacy field name (object keyed by language)
    srcLang: string
    url: string
    lastModified?: string
    sourceServerId?: string
  }>
  chapterURL?: string              // NOT chapters - legacy stores URL string
  chapterSource?: string
  videoInfo?: VideoInfo
  thumbnailBlurhash?: string
  thumbnailBlurhashSource?: string

  // Top-level video info fields (extracted flat, matching legacy document shape)
  duration?: number
  dimensions?: string
  hdr?: string
  size?: number
  mediaQuality?: MediaQuality
  mediaLastModified?: Date

  // Per-server skip gates: { <serverId>: "g<version>:<payload>#<availability>" }.
  // A server's pass over this document is skipped when its entry matches the
  // gate computed for the current run. See core/syncGate for the whole rule.
  syncGates?: Record<string, string>
}

export interface SeasonEntity extends BaseMediaEntity {
  // Legacy structural fields
  type?: string           // 'season'
  createdAt?: Date
  showId?: any            // ObjectId reference to parent TV show

  seasonNumber: number
  showTitle: string
  posterURL?: string
  episodeCount?: number
  // Admin-set JIT delivery override ('on'|'off'; absent = follow the
  // global mode). Written ONLY by the admin editors — sync never touches it.
  jitServeOverride?: 'on' | 'off' | null

  posterBlurhash?: string
  posterBlurhashSource?: string

  // Extracted metadata fields (for easier querying, matching legacy)
  airDate?: Date
  overview?: string
  posterPath?: string
  rating?: number
}

export interface TVShowEntity extends BaseMediaEntity {
  // Legacy structural fields
  type?: string           // 'tvShow'
  createdAt?: Date

  // Backend-sourced show identity ('mid:…'), published from payload version 6.
  // Every episode's mediaId is this plus an ':s##e##' coordinate. Set-only,
  // same discipline as MovieEntity.mediaId.
  mediaId?: string

  posterURL?: string
  backdrop?: string   // NOT backdropURL - legacy field name
  logo?: string       // NOT logoURL - legacy field name
  seasonCount?: number
  totalEpisodeCount?: number
  // Denormalized count of episodes passing the web-visibility rule
  // (mediaVisibility.visibleEpisodeFilter). Written after each show's
  // episodes sync; show-level list filters key on it (visibleShowFilter).
  visibleEpisodeCount?: number
  // Admin-set JIT delivery override ('on'|'off'; absent = follow the
  // global mode). Written ONLY by the admin editors — sync never touches it.
  jitServeOverride?: 'on' | 'off' | null
  posterBlurhash?: string
  posterBlurhashSource?: string
  backdropBlurhash?: string
  backdropBlurhashSource?: string

  // Backdrop focal-point hint (admin override + auto-detected).
  backdropFocal?: BackdropFocal
  backdropFocalSource?: string
  backdropFocalSuggested?: BackdropFocal
  backdropFocalSuggestedSource?: string

  // Extracted metadata fields (for easier querying, matching legacy)
  firstAirDate?: Date
  lastAirDate?: Date
  status?: string
  numberOfSeasons?: number
  rating?: number
  overview?: string
  genres?: any[]
  networks?: any[]

  // Per-server skip gates: { <serverId>: "g<version>:<payload>#<availability>" }.
  // A server's pass over this document is skipped when its entry matches the
  // gate computed for the current run. See core/syncGate for the whole rule.
  syncGates?: Record<string, string>
}

// ==========================================
// Media Assets and Content
// ==========================================

export interface VideoInfo {
  duration?: number
  resolution?: string
  codec?: string
  bitrate?: number
  frameRate?: number
  audioCodec?: string
  audioChannels?: number
  fileSize?: number
  mediaQuality?: MediaQuality
}

export interface MediaQuality {
  format?: string          // 'HEVC', 'AVC', etc.
  bitDepth?: number        // 8, 10, 12
  colorSpace?: string      // 'BT.709', 'BT.2020', etc.
  transferCharacteristics?: string  // 'SDR', 'HDR', etc.
  hdrFormat?: string       // 'Dolby Vision', 'HDR10+', 'HDR10'
  enhancedViewing?: boolean  // Simplified format (new architecture)
  
  // Legacy format fields (for backward compatibility)
  isHDR?: boolean          // Legacy: simple HDR flag
  viewingExperience?: {    // Legacy: detailed viewing experience object
    enhancedColor?: boolean
    highDynamicRange?: boolean
    dolbyVision?: boolean
    hdr10Plus?: boolean
    standardHDR?: boolean
  }
}

// ==========================================
// Events and Progress Tracking
// ==========================================

export enum SyncEventType {
  Progress = 'progress',
  Error = 'error',
  Complete = 'complete',
  Started = 'started',
  Warning = 'warning'
}

export interface SyncEvent {
  type: SyncEventType
  entityId: string
  mediaType: MediaType
  operation?: SyncOperation
  serverId: string
  timestamp: Date
  data?: any
  error?: string
}

// ==========================================
// Repository Interfaces
// ==========================================

export interface MediaRepository<T extends BaseMediaEntity> {
  findByTitle(title: string): Promise<T | null>
  findByTitleAndServer(title: string, serverId: string): Promise<T | null>
  save(entity: T): Promise<void>
  update(title: string, updates: Partial<T>): Promise<void>
  delete(title: string): Promise<void>
  findAll(filter?: Record<string, any>): Promise<T[]>
  exists(title: string): Promise<boolean>
}

// ==========================================
// Error Types
// ==========================================

export class SyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly entityId?: string,
    public readonly mediaType?: MediaType,
    public readonly operation?: SyncOperation
  ) {
    super(message)
    this.name = 'SyncError'
  }
}

export class NetworkError extends SyncError {
  constructor(message: string, entityId?: string) {
    super(message, 'NETWORK_ERROR', entityId)
    this.name = 'NetworkError'
  }
}

export class DatabaseError extends SyncError {
  constructor(message: string, entityId?: string, operation?: SyncOperation) {
    super(message, 'DATABASE_ERROR', entityId, undefined, operation)
    this.name = 'DatabaseError'
  }
}
