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
  
  // Video content (stored as "urls.X" in fieldAvailability)
  | 'urls.mp4'
  | 'urls.mediaLastModified'
  | 'urls.metadata'
  | 'urls.chapters'
  
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
 * Filter captions based on individual field availability instead of root captionURLs field
 * Only returns captions for languages where the specified server has priority for at least one caption field
 * 
 * @param allCaptions - All available captions from file server data
 * @param originalTitle - Movie's original title (filesystem key)
 * @param fieldAvailability - Field availability data structure
 * @param serverConfig - Server configuration to check priority for
 * @param shouldUpdateFieldFn - Function to check if server has priority for a specific field
 * @returns Filtered captions object containing only languages this server should handle
 */
export function filterCaptionsByFieldAvailability<T extends { srcLang: string; url: string; lastModified?: string; sourceServerId?: string }>(
  allCaptions: Record<string, T>,
  originalTitle: string,
  fieldAvailability: any,
  serverConfig: any,
  shouldUpdateFieldFn: (fieldPath: string, originalTitle: string) => boolean
): Record<string, T> {
  const filteredCaptions: Record<string, T> = {}

  console.log(`🔍 Filtering captions based on field availability for: "${originalTitle}"`)

  // Check each caption language to see if this server has priority for any of its fields
  for (const [language, captionData] of Object.entries(allCaptions)) {
    let hasAnyPriority = false

    // Check priority for each caption subfield (url, srcLang, lastModified)
    const captionFields = ['url', 'srcLang', 'lastModified'] as const
    
    for (const subField of captionFields) {
      const fieldPath = getCaptionFieldPath(language, subField)
      const hasPriority = shouldUpdateFieldFn(fieldPath, originalTitle)
      
      if (hasPriority) {
        console.log(`✅ Server ${serverConfig.id} has priority for ${language} caption ${subField} (${fieldPath})`)
        hasAnyPriority = true
        break // If we have priority for any subfield, we can handle this language
      } else {
        console.log(`❌ Server ${serverConfig.id} does NOT have priority for ${language} caption ${subField} (${fieldPath})`)
      }
    }

    // If this server has priority for any field of this caption language, include it
    if (hasAnyPriority) {
      filteredCaptions[language] = captionData
      console.log(`✅ Including ${language} caption based on field availability`)
    } else {
      console.log(`⚠️ Excluding ${language} caption - no field priority for this server`)
    }
  }

  console.log(`📊 Caption filtering result: ${Object.keys(filteredCaptions).length}/${Object.keys(allCaptions).length} captions included`)
  return filteredCaptions
}

/**
 * Type guard to check if a string is a valid MovieFieldPath
 */
export function isValidMovieFieldPath(path: string): path is MovieFieldPath {
  // Check known static paths
  if (Object.values(MovieFieldPathMap).includes(path as any)) {
    return true
  }
  
  // Check dynamic caption paths
  if (path.startsWith('urls.subtitles.') &&
      (path.endsWith('.url') || path.endsWith('.srcLang') || path.endsWith('.lastModified'))) {
    return true
  }
  
  // Check mediaQuality nested paths
  if (path.startsWith('mediaQuality.')) {
    return true
  }

  // Check normalized additional_metadata paths
  if (path.startsWith('additional_metadata.')) {
    return true
  }
  
  return false
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
