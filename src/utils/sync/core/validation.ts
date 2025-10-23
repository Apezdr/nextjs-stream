/**
 * Cross-domain validation utilities for sync operations
 * Provides validation rules and checks for media entities and sync operations
 */

import { 
  BaseMediaEntity, 
  MovieEntity, 
  EpisodeEntity, 
  SeasonEntity, 
  TVShowEntity,
  MediaType,
  SyncContext,
  ValidationError,
  VideoInfo,
  CaptionTrack,
  ChapterMarker
} from './types'

// ==========================================
// Validation Rules
// ==========================================

export interface ValidationRule<T> {
  name: string
  validate: (entity: T, context?: SyncContext) => ValidationResult
  required?: boolean
}

export interface ValidationResult {
  isValid: boolean
  errors: string[]
  warnings: string[]
}

// ==========================================
// Base Entity Validation
// ==========================================

export const baseEntityRules: ValidationRule<BaseMediaEntity>[] = [
  {
    name: 'title_required',
    required: true,
    validate: (entity) => ({
      isValid: !!entity.title && entity.title.trim().length > 0,
      errors: !entity.title || entity.title.trim().length === 0 ? ['Title is required'] : [],
      warnings: []
    })
  },
  {
    name: 'field_sources_present',
    required: false,
    validate: (entity) => ({
      isValid: true, // Field-level source tracking means entities don't need a single serverId
      errors: [],
      warnings: !entity.metadataSource && !entity.titleSource && !entity.originalTitleSource ? 
        ['Entity has no source tracking - may indicate sync issues'] : []
    })
  },
  {
    name: 'title_length',
    validate: (entity) => ({
      isValid: !entity.title || entity.title.length <= 500,
      errors: entity.title && entity.title.length > 500 ? ['Title exceeds maximum length of 500 characters'] : [],
      warnings: entity.title && entity.title.length > 100 ? ['Title is quite long, consider shortening'] : []
    })
  }
]

// ==========================================
// Movie Validation
// ==========================================

export const movieRules: ValidationRule<MovieEntity>[] = [
  ...baseEntityRules,
  {
    name: 'video_url_format',
    validate: (entity) => {
      if (!entity.videoURL) {
        return { isValid: true, errors: [], warnings: ['No video URL provided'] }
      }
      
      const isValidUrl = /^https?:\/\/.+/.test(entity.videoURL)
      return {
        isValid: isValidUrl,
        errors: !isValidUrl ? ['Invalid video URL format'] : [],
        warnings: []
      }
    }
  },
  {
    name: 'poster_url_format',
    validate: (entity) => {
      if (!entity.posterURL) {
        return { isValid: true, errors: [], warnings: [] }
      }
      
      const isValidUrl = /^https?:\/\/.+\.(jpg|jpeg|png|webp)$/i.test(entity.posterURL)
      return {
        isValid: isValidUrl,
        errors: !isValidUrl ? ['Invalid poster URL format'] : [],
        warnings: []
      }
    }
  }
]

// ==========================================
// Episode Validation
// ==========================================

export const episodeRules: ValidationRule<EpisodeEntity>[] = [
  ...baseEntityRules,
  {
    name: 'episode_number_valid',
    required: true,
    validate: (entity) => ({
      isValid: typeof entity.episodeNumber === 'number' && entity.episodeNumber > 0,
      errors: typeof entity.episodeNumber !== 'number' || entity.episodeNumber <= 0 ? 
        ['Episode number must be a positive number'] : [],
      warnings: []
    })
  },
  {
    name: 'season_number_valid',
    required: true,
    validate: (entity) => ({
      isValid: typeof entity.seasonNumber === 'number' && entity.seasonNumber >= 0,
      errors: typeof entity.seasonNumber !== 'number' || entity.seasonNumber < 0 ? 
        ['Season number must be a non-negative number'] : [],
      warnings: []
    })
  },
  {
    name: 'show_title_required',
    required: true,
    validate: (entity) => ({
      isValid: !!entity.showTitle && entity.showTitle.trim().length > 0,
      errors: !entity.showTitle || entity.showTitle.trim().length === 0 ? 
        ['Show title is required for episodes'] : [],
      warnings: []
    })
  }
]

// ==========================================
// Season Validation
// ==========================================

export const seasonRules: ValidationRule<SeasonEntity>[] = [
  ...baseEntityRules,
  {
    name: 'season_number_valid',
    required: true,
    validate: (entity) => ({
      isValid: typeof entity.seasonNumber === 'number' && entity.seasonNumber >= 0,
      errors: typeof entity.seasonNumber !== 'number' || entity.seasonNumber < 0 ? 
        ['Season number must be a non-negative number'] : [],
      warnings: []
    })
  },
  {
    name: 'show_title_required',
    required: true,
    validate: (entity) => ({
      isValid: !!entity.showTitle && entity.showTitle.trim().length > 0,
      errors: !entity.showTitle || entity.showTitle.trim().length === 0 ? 
        ['Show title is required for seasons'] : [],
      warnings: []
    })
  },
  {
    name: 'episode_count_reasonable',
    validate: (entity) => {
      if (typeof entity.episodeCount !== 'number') {
        return { isValid: true, errors: [], warnings: [] }
      }
      
      return {
        isValid: entity.episodeCount >= 0 && entity.episodeCount <= 1000,
        errors: entity.episodeCount < 0 || entity.episodeCount > 1000 ? 
          ['Episode count must be between 0 and 1000'] : [],
        warnings: entity.episodeCount > 50 ? 
          ['Unusually high episode count for a season'] : []
      }
    }
  }
]

// ==========================================
// TV Show Validation
// ==========================================

export const tvShowRules: ValidationRule<TVShowEntity>[] = [
  ...baseEntityRules,
  {
    name: 'season_count_reasonable',
    validate: (entity) => {
      if (typeof entity.seasonCount !== 'number') {
        return { isValid: true, errors: [], warnings: [] }
      }
      
      return {
        isValid: entity.seasonCount >= 0 && entity.seasonCount <= 100,
        errors: entity.seasonCount < 0 || entity.seasonCount > 100 ? 
          ['Season count must be between 0 and 100'] : [],
        warnings: entity.seasonCount > 20 ? 
          ['Unusually high season count'] : []
      }
    }
  }
]

// ==========================================
// Content Validation
// ==========================================

export function validateVideoInfo(videoInfo: VideoInfo): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  if (videoInfo.duration && (videoInfo.duration <= 0 || videoInfo.duration > 86400)) {
    errors.push('Duration must be between 1 second and 24 hours')
  }

  if (videoInfo.fileSize && videoInfo.fileSize <= 0) {
    errors.push('File size must be positive')
  }

  if (videoInfo.frameRate && (videoInfo.frameRate < 1 || videoInfo.frameRate > 120)) {
    warnings.push('Unusual frame rate detected')
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

export function validateCaptionTracks(captions: CaptionTrack[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  const languages = new Set<string>()
  
  for (const caption of captions) {
    if (!caption.language || caption.language.length < 2) {
      errors.push('Caption language code must be at least 2 characters')
    }
    
    if (!caption.url || !/^https?:\/\/.+/.test(caption.url)) {
      errors.push('Caption URL must be a valid HTTP/HTTPS URL')
    }
    
    if (languages.has(caption.language)) {
      warnings.push(`Duplicate caption language: ${caption.language}`)
    }
    languages.add(caption.language)
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

export function validateChapterMarkers(chapters: ChapterMarker[]): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  let previousEndTime = 0

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i]
    
    if (chapter.startTime < 0) {
      errors.push(`Chapter ${i + 1}: Start time cannot be negative`)
    }
    
    if (chapter.startTime < previousEndTime) {
      errors.push(`Chapter ${i + 1}: Start time overlaps with previous chapter`)
    }
    
    if (chapter.endTime && chapter.endTime <= chapter.startTime) {
      errors.push(`Chapter ${i + 1}: End time must be after start time`)
    }
    
    if (!chapter.title || chapter.title.trim().length === 0) {
      warnings.push(`Chapter ${i + 1}: Missing chapter title`)
    }
    
    previousEndTime = chapter.endTime || chapter.startTime
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings
  }
}

// ==========================================
// Main Validation Functions
// ==========================================

export function validateEntity(entity: BaseMediaEntity, mediaType: MediaType, context?: SyncContext): ValidationResult {
  let rules: ValidationRule<any>[]

  switch (mediaType) {
    case MediaType.Movie:
      rules = movieRules
      break
    case MediaType.Episode:
      rules = episodeRules
      break
    case MediaType.Season:
      rules = seasonRules
      break
    case MediaType.TVShow:
      rules = tvShowRules
      break
    default:
      rules = baseEntityRules
  }

  const allErrors: string[] = []
  const allWarnings: string[] = []

  for (const rule of rules) {
    const result = rule.validate(entity, context)
    allErrors.push(...result.errors)
    allWarnings.push(...result.warnings)

    // If this is a required rule and it failed, we can stop early
    if (rule.required && !result.isValid) {
      break
    }
  }

  return {
    isValid: allErrors.length === 0,
    errors: allErrors,
    warnings: allWarnings
  }
}

export function validateEntityOrThrow(entity: BaseMediaEntity, mediaType: MediaType, context?: SyncContext): void {
  const result = validateEntity(entity, mediaType, context)
  
  if (!result.isValid) {
    throw new ValidationError(
      `Validation failed: ${result.errors.join(', ')}`,
      entity.title,
      mediaType
    )
  }
}