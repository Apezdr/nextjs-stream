/**
 * Media Not Found Component
 * 
 * Unified error page for all not-found scenarios.
 * Handles hierarchical context (show exists but season/episode doesn't) with PosterFan display.
 */

import Image from 'next/image'
import { fetchContextualMediaForError } from '@src/utils/media/mediaFetcher'
import PosterFan from '@src/components/MediaPages/not-found/PosterFan'
import NotFoundHeader from './NotFoundHeader'
import NotFoundContent from './NotFoundContent'

/**
 * Build season data for PosterFan component
 * Combines available seasons from database with missing seasons from TMDB
 */
async function buildAvailableSeasonsData(contextualMedia) {
  if (!contextualMedia?.seasons) return []
  
  // Get available seasons from collection
  const availableSeasonsSet = new Set(contextualMedia.seasons.map(s => s.seasonNumber))
  
  // Format available seasons
  const collectionSeasons = contextualMedia.seasons.map(season => {
    // Try to get air date from TMDB metadata
    let airDate = season.air_date || null
    
    // If not in season data, check TMDB metadata
    if (!airDate && contextualMedia.metadata?.seasons) {
      const tmdbSeason = contextualMedia.metadata.seasons.find(
        tmdb => tmdb.season_number === season.seasonNumber
      )
      if (tmdbSeason) {
        airDate = tmdbSeason.air_date
      }
    }
    
    return {
      id: season._id,
      seasonNumber: season.seasonNumber,
      title: contextualMedia.title,
      posterUrl: season.posterURL || contextualMedia.posterURL || '/sorry-image-not-available.jpg',
      episodeCount: season.episodes?.length || 0,
      airDate: airDate,
      isAvailable: true
    }
  })
  
  // Get missing seasons from TMDB metadata
  const missingSeasons = []
  if (contextualMedia.metadata?.seasons) {
    contextualMedia.metadata.seasons.forEach(tmdbSeason => {
      if (tmdbSeason.season_number > 0 && !availableSeasonsSet.has(tmdbSeason.season_number)) {
        missingSeasons.push({
          id: `missing-${tmdbSeason.season_number}`,
          seasonNumber: tmdbSeason.season_number,
          title: contextualMedia.title,
          posterUrl: tmdbSeason.poster_path 
            ? `https://image.tmdb.org/t/p/w780${tmdbSeason.poster_path}`
            : contextualMedia.posterURL || '/sorry-image-not-available.jpg',
          episodeCount: tmdbSeason.episode_count || 0,
          airDate: tmdbSeason.air_date || null,
          isAvailable: false
        })
      }
    })
  }
  
  // Combine and sort all seasons
  return [...collectionSeasons, ...missingSeasons].sort((a, b) => a.seasonNumber - b.seasonNumber)
}

/**
 * Get appropriate poster for not found errors
 */
async function getPosterForError(notFoundType, contextualMedia, mediaTitle, mediaSeason) {
  let posterSrc = '/sorry-image-not-available.jpg'
  let posterAltText = 'Not found'
  
  if (notFoundType === 'episode' && contextualMedia) {
    // For episode errors, try to get the season poster first
    try {
      const seasonMedia = await fetchContextualMediaForError(mediaTitle)
      if (seasonMedia?.posterURL) {
        posterSrc = seasonMedia.posterURL
      } else if (contextualMedia?.posterURL) {
        posterSrc = contextualMedia.posterURL
        posterAltText = contextualMedia.title
      }
    } catch (error) {
      // Fall back to show poster if season fetch fails
      if (contextualMedia?.posterURL) {
        posterSrc = contextualMedia.posterURL
        posterAltText = contextualMedia.title
      }
    }
  } else if (contextualMedia?.posterURL) {
    // Use show poster for season errors or as fallback
    posterSrc = contextualMedia.posterURL
    posterAltText = contextualMedia.title
  }
  
  return { posterSrc, posterAltText }
}

/**
 * Get error message configuration based on not found type
 */
function getErrorConfig(notFoundType, mediaTitle, mediaSeason, mediaEpisode) {
  switch (notFoundType) {
    case 'show':
      return {
        errorMessage: `Oops! We couldn't find the TV show "${decodeURIComponent(mediaTitle)}" in our collection. Don't worry, though — we have a wide array of other fantastic shows waiting for you.`,
        backHref: `/list/tv`,
        backText: 'Browse TV Shows'
      }
    
    case 'season':
      return {
        errorMessage: `We found the show "${decodeURIComponent(mediaTitle)}", but Season ${mediaSeason || 'Unknown'} isn't available in our collection. Check out the available seasons above.`,
        backHref: `/list/tv/${encodeURIComponent(mediaTitle)}`,
        backText: 'View Available Seasons'
      }
    
    case 'episode':
      return {
        errorMessage: `We found Season ${mediaSeason || 'Unknown'} of "${decodeURIComponent(mediaTitle)}", but Episode ${mediaEpisode || 'Unknown'} isn't available. Browse other episodes in this season.`,
        backHref: `/list/tv/${encodeURIComponent(mediaTitle)}/${mediaSeason}`,
        backText: 'View Season Episodes'
      }
    
    case 'movie':
      return {
        errorMessage: `Oops! We couldn't find the movie "${decodeURIComponent(mediaTitle)}" in our collection. Don't worry, though — we have a wide array of other fantastic movies waiting for you.`,
        backHref: `/list/movie`,
        backText: 'Browse Movies'
      }
    
    default:
      return {
        errorMessage: `Oops! It seems like the content you're searching for isn't available in our collection. Don't worry, though — we have a wide array of other fantastic content waiting for you.`,
        backHref: `/list`,
        backText: 'Browse Content'
      }
  }
}

/**
 * MediaNotFound Component
 * 
 * @param {Object} props
 * @param {string} props.notFoundType - Type of not found error ('show', 'season', 'episode', 'movie')
 * @param {string} props.mediaTitle - Media title (URL encoded)
 * @param {string} [props.mediaSeason] - Season number
 * @param {string} [props.mediaEpisode] - Episode number
 */
export default async function MediaNotFound({ 
  notFoundType, 
  mediaTitle, 
  mediaSeason,
  mediaEpisode 
}) {
  const errorConfig = getErrorConfig(notFoundType, mediaTitle, mediaSeason, mediaEpisode)
  
  // Fetch contextual data for season/episode errors
  let contextualMedia = null
  let availableSeasons = []
  let showPosterFan = false
  
  if (notFoundType === 'season' || notFoundType === 'episode') {
    try {
      contextualMedia = await fetchContextualMediaForError(decodeURIComponent(mediaTitle))
      
      if (contextualMedia?.seasons) {
        availableSeasons = await buildAvailableSeasonsData(contextualMedia)
        showPosterFan = true
      }
    } catch (error) {
      console.error('Error fetching contextual media:', error)
      // Continue with default poster
    }
  }
  
  // Get poster for simple display (when not using PosterFan)
  const { posterSrc, posterAltText } = await getPosterForError(
    notFoundType, 
    contextualMedia, 
    mediaTitle, 
    mediaSeason
  )
  
  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <div className="flex flex-col max-w-screen-lg w-full">
        {/* Identity Header for Show Context */}
        {showPosterFan && contextualMedia && (
          <NotFoundHeader showData={contextualMedia} mediaTitle={mediaTitle} />
        )}
        
        {/* Poster Display - Either PosterFan or single poster */}
        {showPosterFan && availableSeasons.length > 0 ? (
          <div className="mb-8">
            <PosterFan 
              seasons={availableSeasons} 
              showTitle={mediaTitle}
              targetSeasonNumber={mediaSeason ? parseInt(mediaSeason) : null}
            />
          </div>
        ) : (
          <div className="flex justify-center mb-8">
            <Image
              src={posterSrc}
              alt={posterAltText}
              width={400}
              height={600}
              className="w-3/5 max-w-sm h-auto mx-auto rounded-lg"
            />
          </div>
        )}
        
        {/* Error Message and CTA */}
        <NotFoundContent {...errorConfig} />
      </div>
    </div>
  )
}