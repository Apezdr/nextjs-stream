/**
 * Core domain types and interfaces for the sync system
 * This file defines the foundational contracts for our domain-driven sync architecture
 */

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
// Sync Context and Results
// ==========================================

export interface SyncContext {
  mediaType: MediaType
  operation: SyncOperation
  serverConfig: ServerConfig
  fieldAvailability: FieldAvailability
  forceSync?: boolean
  skipCache?: boolean
  
  // Entity identifiers for strategies when entity might be null
  entityTitle?: string          // Pretty display title (TMDB)
  entityOriginalTitle?: string  // Filesystem key title
  
  // File server data for content sync
  fileServerData?: any          // File server data structure (movies/TV data)
  
  // Pre-fetched entity caches for performance optimization
  movieCache?: Map<string, MovieEntity>      // Pre-fetched movies indexed by originalTitle
  episodeCache?: Map<string, EpisodeEntity>  // Future: Pre-fetched episodes
  seasonCache?: Map<string, SeasonEntity>    // Future: Pre-fetched seasons
  tvShowCache?: Map<string, TVShowEntity>    // Future: Pre-fetched TV shows
  
  // Metadata hashes cache (fetched once per server for all movies)
  metadataHashesCache?: {
    hash: string  // Overall hash for all movies
    titles: Record<string, {
      hash: string
      lastModified: string
      generated: string
    }>
  }
  
  // TV show-level hashes (fetched once per server from /api/metadata-hashes/tv).
  // Enables whole-show skip: if titles[showTitle].hash === TVShowEntity.syncHash
  // AND titles[showTitle].contentHash === TVShowEntity.contentHash, syncTVShow()
  // returns Skipped immediately without processing seasons or episodes.
  // contentHash is optional — absent/null means the backend predates that signal
  // and the frontend falls back to hash-only.
  tvShowHashesCache?: {
    hash: string  // Overall hash across all TV shows on this server
    titles: Record<string, {
      hash: string
      contentHash?: string  // Aggregate of per-episode hashes — invalidates on video file changes
      lastModified: string
      generated: string
    }>
  }

  // Per-season episode hashes — keyed by showTitle → seasonNumber.
  // Populated lazily at the start of each EpisodeSyncService.syncSeason() call
  // via GET /api/metadata-hashes/tv/{title}/{seasonNumber}.
  // One HTTP call per season replaces N×2 fetchMetadataMultiServer calls for unchanged episodes.
  tvEpisodeHashesCache?: Map<string, Map<number, {
    hash: string  // Season-level aggregate hash
    episodes: Record<string, {  // key = S01E01 format
      hash: string
      lastModified: string
      generated: string
    }>
  }>>

  // Resource manager for throttling HTTP requests and monitoring memory
  // Strategies should use context.resourceManager?.throttleHttp() for outbound calls
  resourceManager?: {
    throttleHttp: <T>(fn: () => Promise<T>) => Promise<T>
    isMemoryPressure: () => boolean
    getHeapUsedMb: () => number
  }

  // Accumulated movie field changes from strategies — keyed by originalTitle.
  // Strategies append their computed changes here instead of writing to the DB
  // directly. MovieSyncService performs a single consolidated write after all
  // strategies complete, using smartUpsert to write only changed fields.
  pendingMovieUpdates?: Map<string, Partial<MovieEntity>>

  // Field-absence cleanup (drops stale optional fields that NO enabled server
  // reports anymore — see core/FieldAbsenceCleaner + FIELD_ABSENCE_CLEANUP_DESIGN.md).
  // Defaults to `enforce`; SYNC_FIELD_CLEANUP=dry-run downgrades to detect+log,
  // and off/false/disabled fully disables (cleanup left undefined). When undefined
  // the cleaner is never invoked. `allEnabledServersProbed` is the mandatory
  // authoritative-pass gate: false (e.g. a server failed this run) makes cleanup a
  // no-op so a transient outage is never mistaken for a deletion.
  cleanup?: {
    enabled: boolean
    mode: 'enforce' | 'dry-run'
    maxFieldsPerEntity: number
    allEnabledServersProbed: boolean
  }
}

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

export interface BatchSyncResult {
  results: SyncResult[]
  summary: {
    total: number
    completed: number
    failed: number
    skipped: number
  }
  duration: number
  errors: string[]
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

  // Content hash from media processor — stored after each successful sync to enable
  // whole-movie skip. If this matches the incoming hash from /api/metadata-hashes/movies,
  // syncMovie() returns Skipped immediately without normalising or running any strategies.
  // Distinct from `metadataHash` (which only covers TMDB metadata) — `syncHash` is the
  // authoritative whole-movie change-detection signal.
  syncHash?: string

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

  // Content hash from media processor — stored after each sync to enable whole-episode skip.
  // If this matches the incoming episode hash from /api/metadata-hashes/tv/{title}/{season},
  // buildEpisodeEntity() is bypassed entirely (no HTTP fetches, no entity build, no write).
  syncHash?: string
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

  // Content hash from media processor — reserved for future season-level skip.
  syncHash?: string
}

export interface TVShowEntity extends BaseMediaEntity {
  // Legacy structural fields
  type?: string           // 'tvShow'
  createdAt?: Date

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

  // Content hash from media processor — stored after each sync to enable whole-show skip.
  // If this matches the incoming hash from /api/metadata-hashes/tv, syncTVShow() returns
  // Skipped immediately without processing any seasons or episodes.
  syncHash?: string

  // Aggregate hash of all per-episode hashes for this show, from the backend's
  // contentHash field on /api/metadata-hashes/tv. Distinct from syncHash (which
  // only covers show-level TMDB metadata). A video-file change invalidates this
  // signal via the per-episode hash's mediaLastModified input, so the show-level
  // skip only fires when BOTH syncHash AND contentHash match.
  contentHash?: string
}

// ==========================================
// Media Assets and Content
// ==========================================

export interface CaptionTrack {
  language: string
  label: string
  url: string
  format: 'srt' | 'vtt' | 'ass'
  source: string
}

export interface ChapterMarker {
  title: string
  startTime: number
  endTime?: number
  thumbnailURL?: string
}

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
// Strategy Pattern Interfaces
// ==========================================

export interface SyncStrategy {
  readonly name: string
  readonly supportedOperations: SyncOperation[]
  readonly supportedMediaTypes: MediaType[]
  
  canHandle(context: SyncContext): boolean
  sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult>
  validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean>
}

// ==========================================
// File System Abstractions
// ==========================================

export interface FileServerAdapter {
  buildUrl(path: string, serverConfig: ServerConfig): string
  validateAvailability(urls: string[]): Promise<AvailabilityResult>
  getMetadata(path: string, serverConfig: ServerConfig): Promise<FileMetadata>
  listFiles(path: string, serverConfig: ServerConfig): Promise<FileEntry[]>
}

export interface AvailabilityResult {
  available: string[]
  unavailable: string[]
  errors: Record<string, string>
}

export interface FileMetadata {
  size: number
  lastModified: Date
  contentType: string
  exists: boolean
}

export interface FileEntry {
  name: string
  path: string
  isDirectory: boolean
  size?: number
  lastModified?: Date
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

export class ValidationError extends SyncError {
  constructor(message: string, entityId?: string, mediaType?: MediaType) {
    super(message, 'VALIDATION_ERROR', entityId, mediaType)
    this.name = 'ValidationError'
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
