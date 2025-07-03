import { sanitizeCardData, sanitizeTVData } from '@src/utils/auth_utils'
import isAuthenticated, { isAuthenticatedEither } from '../../../../utils/routeAuth'
import { getFlatRequestedMedia, getFlatTVSeasonWithEpisodes } from '@src/utils/flatDatabaseUtils'
import { addWatchHistoryToItems } from '@src/utils/watchHistoryUtils'

export async function POST(req) {
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult
  }
  const data = await req.json()
  const { mediaType, mediaTitle } = data
  const media = await getFlatRequestedMedia({
    type: mediaType,
    title: mediaTitle ? decodeURIComponent(mediaTitle) : null,
  })
  return new Response(JSON.stringify(media))
}

export async function GET(req) {
  try {
    const authResult = await isAuthenticatedEither(req)
    if (authResult instanceof Response) {
      return authResult
    }
    const url = new URL(req.url)
    const mediaType = url.searchParams.get('mediaType')
    const mediaTitle = url.searchParams.get('mediaTitle')
    const mediaId = url.searchParams.get('mediaId')
    const mediaSeason = url.searchParams.get('season')
    const mediaEpisode = url.searchParams.get('episode')
    const isCard = url.searchParams.get('card')
    const isTVdevice = url.searchParams.get('isTVdevice') === 'true'
    const includeWatchHistory = url.searchParams.get('includeWatchHistory') === 'true'

    // Log request parameters for debugging
    if (Boolean(process.env.DEBUG) == true) {
      console.log(`Media API request: type=${mediaType}, id=${mediaId}, season=${mediaSeason}, episode=${mediaEpisode}, isCard=${isCard}, isTVdevice=${isTVdevice}`);
    }
    
    const mediaRequest = {
      type: mediaType,
      title: mediaTitle ? decodeURIComponent(mediaTitle) : null,
      id: mediaId ? decodeURIComponent(mediaId) : null,
    }

    if (mediaSeason && mediaSeason !== 'null') {
      mediaRequest.season = mediaSeason
    }

    if (mediaEpisode) {
      mediaRequest.episode = mediaEpisode
    }

    let media = await getFlatRequestedMedia(mediaRequest)
    
    if (!media) {
      console.warn(`No media found for request: ${JSON.stringify(mediaRequest)}`);
      return new Response(
        JSON.stringify({ error: 'Media not found' }),
        { status: 404 }
      )
    }

    // Add watch history if requested - only for playable media items (movies, episodes)
    if (includeWatchHistory && authResult.id && media?.normalizedVideoId) {
      try {
        const mediaArray = await addWatchHistoryToItems([media], authResult.id)
        media = mediaArray[0] || media
      } catch (watchHistoryError) {
        console.warn('Failed to add watch history to media:', watchHistoryError.message)
        // Continue without watch history data
      }
    }

    // React Native TV Device Handling
    if (isTVdevice) {
      try {
        let enhancedMedia = media
        let fullShowData = null
        
        // For TV shows, we need the full show context for proper navigation
        if (mediaType === 'tv') {
          try {
            // First, get the full show data (without season/episode) to get all seasons info
            const fullShowRequest = {
              type: mediaType,
              title: mediaTitle ? decodeURIComponent(mediaTitle) : null,
              id: mediaId ? decodeURIComponent(mediaId) : null,
              // Don't include season/episode to get full show data
            }
            
            fullShowData = await getFlatRequestedMedia(fullShowRequest)
            
            if (Boolean(process.env.DEBUG) == true) {
              console.log(`TV Device: Fetched full show data with ${fullShowData?.seasons?.length || 0} seasons`);
            }
            
            // For season requests, also fetch episode list
            if (mediaSeason && !mediaEpisode) {
              const seasonWithEpisodes = await getFlatTVSeasonWithEpisodes({
                showTitle: fullShowData?.title || media.title,
                seasonNumber: parseInt(mediaSeason.replace('Season ', ''))
              })
              
              if (seasonWithEpisodes && seasonWithEpisodes.episodes) {
                // Add watch history to episodes if requested
                let episodesWithHistory = seasonWithEpisodes.episodes
                if (includeWatchHistory && authResult.id) {
                  try {
                    episodesWithHistory = await addWatchHistoryToItems(seasonWithEpisodes.episodes, authResult.id)
                  } catch (watchHistoryError) {
                    console.warn('Failed to add watch history to episodes:', watchHistoryError.message)
                    // Continue with episodes without watch history
                  }
                }

                // Extract available season numbers from full show data
                const availableSeasons = fullShowData?.seasons
                  ? fullShowData.seasons.map((season, index) => {
                      return season.seasonNumber
                    }).filter(num => num !== null && num !== undefined).sort((a, b) => a - b)
                  : []

                // Merge the episode data and full show context
                enhancedMedia = {
                  ...media, // Keep the current season/episode specific data
                  episodes: episodesWithHistory, // Add episode list with watch history
                  seasons: fullShowData?.seasons || media.seasons, // Ensure we have all seasons
                  totalSeasons: fullShowData?.seasons?.length || 0, // Add total seasons count
                  availableSeasons: availableSeasons, // Array of actual season numbers available
                  logo: fullShowData?.logo || media.logo, // Preserve show logo
                  // Preserve first air date and air date for seasons
                  // helpful to see when the show started vs when the season started
                  first_air_date: media.first_air_date,
                  airDate: media.metadata?.air_date // Explicit air_date for TV seasons
                }
                
                if (Boolean(process.env.DEBUG) == true) {
                  console.log(`TV Device: Enhanced season data with ${seasonWithEpisodes.episodes.length} episodes and ${enhancedMedia.totalSeasons} total seasons`);
                }
              }
            } else {
              // Extract available season numbers from full show data
              const availableSeasons = fullShowData?.seasons
                ? fullShowData.seasons.map((season, index) => {
                    return season.seasonNumber
                  }).filter(num => num !== null && num !== undefined).sort((a, b) => a - b)
                : []

              // For episode requests or show-level requests, merge full show data
              enhancedMedia = {
                ...media, // Keep all original data
                seasons: fullShowData?.seasons || media.seasons,
                totalSeasons: fullShowData?.seasons?.length || 0,
                availableSeasons: availableSeasons, // Array of actual season numbers available
                logo: fullShowData?.logo || media.logo || null, // Preserve show logo
                // Preserve date information for TV shows
                first_air_date: media.first_air_date,
                airDate: media.metadata?.air_date // Season/episode air date if available
              }
            }
          } catch (showDataError) {
            console.warn('Could not fetch full show data for TV device:', showDataError.message);
            // Continue with original media data
          }
        }
        
        const tvData = await sanitizeTVData(enhancedMedia, {
          includeEpisodeList: Boolean(mediaSeason && !mediaEpisode),
          includeNavigation: true,
          mediaType,
          seasonNumber: mediaSeason,
          episodeNumber: mediaEpisode
        })
        return new Response(JSON.stringify(tvData))
      } catch (tvError) {
        console.error('Error in sanitizeTVData:', tvError);
        // Return partial data if possible
        return new Response(
          JSON.stringify({
            error: 'Error processing TV data',
            partialData: media ? {
              id: media.id,
              title: media.title,
              type: media.type,
              posterURL: media.posterURL
            } : null
          }),
          { status: 206 } // Partial Content
        )
      }
    }

    // Card Data Handling
    if (isCard) {
      try {
        const cardData = await sanitizeCardData(media, true)
        return new Response(JSON.stringify(cardData))
      } catch (cardError) {
        console.error('Error in sanitizeCardData:', cardError);
        // Return partial data if possible
        return new Response(
          JSON.stringify({
            error: 'Error processing card data',
            partialData: media ? {
              id: media.id,
              title: media.title,
              type: media.type,
              posterURL: media.posterURL
            } : null
          }),
          { status: 206 } // Partial Content
        )
      }
    }
    return new Response(JSON.stringify(media))
  } catch (error) {
    console.error('Error in media API:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to fetch media data', 
        details: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }),
      { status: 500 }
    )
  }
}
