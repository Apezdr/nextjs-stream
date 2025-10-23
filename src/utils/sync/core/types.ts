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
  Validation = 'validation'
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
// Media Entities
// ==========================================

export interface BaseMediaEntity {
  // Pretty display title (from TMDB metadata)
  title: string
  
  // Filesystem key title (used for file server operations)
  originalTitle: string
  
  lastSynced: Date
  metadata?: Record<string, any>
  
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
  
  // Server identification
  serverId?: string
}

export interface EpisodeEntity extends BaseMediaEntity {
  episodeNumber: number
  seasonNumber: number
  showTitle: string
  videoURL?: string
  videoSource?: string
  thumbnailURL?: string
  captions?: CaptionTrack[]
  chapters?: ChapterMarker[]
  videoInfo?: VideoInfo
  thumbnailBlurhash?: string
}

export interface SeasonEntity extends BaseMediaEntity {
  seasonNumber: number
  showTitle: string
  posterURL?: string
  episodeCount?: number
  posterBlurhash?: string
}

export interface TVShowEntity extends BaseMediaEntity {
  posterURL?: string
  backdropURL?: string
  logoURL?: string
  seasonCount?: number
  totalEpisodeCount?: number
  posterBlurhash?: string
  backdropBlurhash?: string
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
