/**
 * Type-safe field path definitions for fieldAvailability lookups
 * 
 * The fieldAvailability object uses dotted path notation to track which servers
 * have which data. This file defines the mapping between entity fields and their
 * corresponding fieldAvailability paths.
 * 
 * Example fieldAvailability structure:
 * {
 *   movies: {
 *     "Movie Title": {
 *       "urls.poster": ["server1", "server2"],
 *       "urls.backdrop": ["server1"],
 *       "metadata": ["server1", "server2"],
 *       // etc.
 *     }
 *   }
 * }
 */

/**
 * Valid field paths for movie fieldAvailability lookups
 * These paths use dot notation and must match the structure in fieldAvailability
 */
export type MovieFieldPath =
  // Core metadata
  | 'metadata'
  | 'title'
  | 'originalTitle'
  
  // Asset URLs (stored as "urls.X" in fieldAvailability)
  | 'urls.poster'
  | 'urls.backdrop'
  | 'urls.logo'
  | 'urls.posterBlurhash'
  | 'urls.backdropBlurhash'
  | 'urls.logoBlurhash'

  // Backdrop focal-point hints (top-level scalars in fileServerData, NOT under urls.*)
  | 'backdropFocal'
  | 'backdropFocalSuggested'
  
  // Video content (stored as "urls.X" in fieldAvailability)
  | 'urls.mp4'
  | 'urls.mediaLastModified'
  | 'urls.metadata'
  | 'urls.chapters'

  // Delivery facts describing the primary source. Declared for diagnostics
  // and completeness only — ingestion gates them on 'urls.mp4' (the video
  // block's own path) because they describe the file videoURL points at and
  // must share its owner. Do NOT gate on these leaves directly.
  | 'urls.jitEligible'
  | 'urls.jitUrl'


  // Video info fields (normalized in fieldAvailability under additional_metadata)
  | 'additional_metadata.duration'
  | 'additional_metadata.dimensions'
  | 'additional_metadata.size.gb'
  | 'additional_metadata.size.mb'
  | 'additional_metadata.size.kb'
  | 'hdr'
  | 'normalizedVideoId'
  
  // Caption/subtitle fields (dynamic, but follow pattern)
  | `urls.subtitles.${string}.url`
  | `urls.subtitles.${string}.srcLang`
  | `urls.subtitles.${string}.lastModified`
  
  // Media quality fields (nested structure)
  | 'mediaQuality'
  | 'mediaQuality.format'
  | 'mediaQuality.bitDepth'
  | 'mediaQuality.colorSpace'
  | 'mediaQuality.transferCharacteristics'
  | 'mediaQuality.isHDR'
  | 'mediaQuality.viewingExperience.enhancedColor'
  | 'mediaQuality.viewingExperience.highDynamicRange'
  | 'mediaQuality.viewingExperience.dolbyVision'
  | 'mediaQuality.viewingExperience.hdr10Plus'
  | 'mediaQuality.viewingExperience.standardHDR'

/**
 * Mapping from MovieEntity field names to their fieldAvailability paths
 * This provides a type-safe way to look up the correct field path
 */
export const MovieFieldPathMap = {
  // Metadata
  metadata: 'urls.metadata',
  title: 'title',
  originalTitle: 'originalTitle',
  
  // Assets - Note the "urls." prefix!
  posterURL: 'urls.poster',
  backdrop: 'urls.backdrop',
  logo: 'urls.logo',
  posterBlurhash: 'urls.posterBlurhash',
  backdropBlurhash: 'urls.backdropBlurhash',
  logoBlurhash: 'urls.logoBlurhash',

  // Focal-point hints — top-level scalars in fileServerData, so no "urls." prefix
  backdropFocal: 'backdropFocal',
  backdropFocalSuggested: 'backdropFocalSuggested',
  
  // Video content - Note the "urls." prefix!
  videoURL: 'urls.mp4',
  mediaLastModified: 'urls.mediaLastModified',
  chapterURL: 'urls.chapters',
  
  // Video info - normalized under additional_metadata (NO "urls." prefix)
  duration: 'additional_metadata.duration',
  dimensions: 'additional_metadata.dimensions',
  size: 'additional_metadata.size.gb', // Default to gb, but strategy checks all units
  hdr: 'hdr',
  normalizedVideoId: 'normalizedVideoId',
  
  // Media quality
  mediaQuality: 'mediaQuality',
  
  // Caption URLs are dynamic - use helper function
  captionURLs: 'urls.subtitles', // Base path, will need to append language
} as const

/**
 * Helper function to get the correct fieldAvailability path for a caption language
 */
export function getCaptionFieldPath(language: string, subField: 'url' | 'srcLang' | 'lastModified'): MovieFieldPath {
  return `urls.subtitles.${language}.${subField}` as MovieFieldPath
}

/**
 * Get the fieldAvailability path for an entity field
 * Provides compile-time type safety and runtime validation
 */
export function getFieldPath(entityField: keyof typeof MovieFieldPathMap): MovieFieldPath {
  const path = MovieFieldPathMap[entityField]
  if (!path) {
    throw new Error(`Unknown entity field: ${entityField}`)
  }
  return path as MovieFieldPath
}

/**
 * Example usage:
 * 
 * // Type-safe field path lookup
 * const posterPath = getFieldPath('posterURL')  // Returns: 'urls.poster'
 * const backdropPath = getFieldPath('backdrop')  // Returns: 'urls.backdrop'
 * 
 * // Use in shouldUpdateField
 * if (shouldUpdateField(posterPath, originalTitle, context)) {
 *   // Update poster
 * }
 * 
 * // For captions (dynamic)
 * const captionPath = getCaptionFieldPath('English', 'url')  // Returns: 'urls.subtitles.English.url'
 */
