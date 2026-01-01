/**
 * Metadata Builder for Media Routes
 * 
 * Builds metadata for both generateMetadata and social sharing.
 * Eliminates duplication between metadata generation and page component.
 */

import { fileServerURLWithPrefixPath } from '@src/utils/config'

const posterCollage = fileServerURLWithPrefixPath(`/poster_collage.jpg`)

/**
 * Build complete metadata object for Next.js generateMetadata
 * 
 * @param {Object} media - Media object from database
 * @param {Object} parsedParams - Parsed URL parameters
 * @param {Object} parentMetadata - Parent metadata from Next.js
 * @returns {Object} Metadata object for Next.js
 */
export async function buildMediaMetadata(media, parsedParams, parentMetadata) {
  const { mediaType, mediaSeason, mediaEpisode } = parsedParams
  
  const title = getMetadataTitle(media, parsedParams, parentMetadata)
  const description = getMetadataDescription(media, parentMetadata)
  const poster = getMetadataPoster(media, parsedParams)
  
  return {
    title,
    description,
    openGraph: {
      images: [poster, []],
    },
  }
}

/**
 * Get formatted title for metadata
 * Includes show title and S01E01 notation for TV episodes
 * 
 * @param {Object} media - Media object
 * @param {Object} parsedParams - Parsed URL parameters
 * @param {Object} parentMetadata - Parent metadata
 * @returns {string} Formatted title
 */
export function getMetadataTitle(media, parsedParams, parentMetadata) {
  const { mediaType, mediaSeason, mediaEpisode } = parsedParams
  
  // Default title from parent
  let title = parentMetadata?.title?.absolute || 'Media'
  
  if (!media) return title
  
  // Use media title if available
  title = media.title || title
  
  // For TV shows, add season/episode notation
  if (mediaType === 'tv') {
    // For episodes, prepend show title
    if (mediaEpisode && media.showTitle) {
      title = `${media.showTitle} - ${title}`
    }
    
    // Add S01E01 notation for seasons/episodes
    if (mediaSeason) {
      const seasonNum = mediaSeason.replace('Season ', '').padStart(2, '0')
      title = `${title} - S${seasonNum}`
      
      if (mediaEpisode) {
        const episodeNum = mediaEpisode.replace('Episode ', '').padStart(2, '0')
        title = `${title}E${episodeNum}`
      }
    }
  }
  
  return title
}

/**
 * Get description/overview for metadata
 * 
 * @param {Object} media - Media object
 * @param {Object} parentMetadata - Parent metadata
 * @returns {string} Description text
 */
export function getMetadataDescription(media, parentMetadata) {
  // Default description from parent
  let description = parentMetadata?.description || ''
  
  if (!media) return description
  
  // Try to get overview from metadata
  // For TV shows, prefer episode overview, fallback to show overview
  if (media.metadata?.overview) {
    description = media.metadata.overview
  } else if (media.metadata?.tvOverview) {
    description = media.metadata.tvOverview
  }
  
  return description
}

/**
 * Get poster URL for metadata and social sharing
 * Prioritizes episode thumbnails over show posters
 * 
 * @param {Object} media - Media object
 * @param {Object} parsedParams - Parsed URL parameters
 * @returns {string} Poster URL
 */
export function getMetadataPoster(media, parsedParams) {
  const { mediaEpisode } = parsedParams
  
  // Default fallback poster
  if (!media) return posterCollage
  
  // For TV episodes, prioritize episode thumbnail over season/show poster
  if (mediaEpisode && media.thumbnail) {
    return media.thumbnail
  }
  
  // Try posterURL first
  if (media.posterURL) {
    return media.posterURL
  }
  
  // Try TMDB poster path
  if (media.metadata?.poster_path) {
    return `https://image.tmdb.org/t/p/w780${media.metadata.poster_path}`
  }
  
  // Fallback to not available image
  return '/sorry-image-not-available.jpg'
}

/**
 * Build breadcrumb-style navigation data for metadata
 * Useful for structured data and navigation hints
 * 
 * @param {Object} parsedParams - Parsed URL parameters
 * @param {Object} media - Media object
 * @returns {Array} Array of breadcrumb items
 */
export function buildMetadataBreadcrumbs(parsedParams, media) {
  const { mediaType, mediaTitle, mediaSeason, mediaEpisode } = parsedParams
  const breadcrumbs = []
  
  // Root
  breadcrumbs.push({ name: 'Home', url: '/' })
  
  // Media type level
  if (mediaType) {
    breadcrumbs.push({
      name: mediaType === 'movie' ? 'Movies' : 'TV Shows',
      url: `/list/${mediaType}`,
    })
  }
  
  // Show level
  if (mediaTitle) {
    breadcrumbs.push({
      name: media?.title || mediaTitle,
      url: `/list/${mediaType}/${encodeURIComponent(mediaTitle)}`,
    })
  }
  
  // Season level
  if (mediaSeason) {
    breadcrumbs.push({
      name: `Season ${mediaSeason}`,
      url: `/list/${mediaType}/${encodeURIComponent(mediaTitle)}/${mediaSeason}`,
    })
  }
  
  // Episode level
  if (mediaEpisode) {
    breadcrumbs.push({
      name: media?.title || `Episode ${mediaEpisode}`,
      url: `/list/${mediaType}/${encodeURIComponent(mediaTitle)}/${mediaSeason}/${mediaEpisode}`,
    })
  }
  
  return breadcrumbs
}