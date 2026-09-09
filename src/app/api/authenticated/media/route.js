import { sanitizeCardData, sanitizeTVData } from '@src/utils/auth_utils'
import isAuthenticated, { isAuthenticatedAndApproved } from '../../../../utils/routeAuth'
import { getFlatRequestedMedia, getFlatTVSeasonWithEpisodes } from '@src/utils/flatDatabaseUtils'
import { addWatchHistoryToItems } from '@src/utils/watchHistoryUtils'
import { applyJitPreference } from '@src/utils/jit/preference'

// IDENTITY HIERARCHY — three layers, each with one job; never invent a fourth:
//   originalTitle — the ROUTING key (unique folder name; how clients address media)
//   mediaId       — the IDENTITY key ('mid:…', folder-derived, rename/re-encode-proof;
//                   what watch history will join on after the P5 cutover)
//   _id           — per-scan EPHEMERAL (mediainfo header hash; rotates on re-encode)
// The serve-time JIT swap below changes none of them: videoURL is DELIVERY,
// and watch-history hashing canonicalizes jit and raw URLs to the same id.

// This payload carries videoURL — it must always be current, so no HTTP
// cache (including tvOS NSURLCache, which heuristically caches responses
// with no freshness info) may ever store it. Belt-and-suspenders with the
// same no-store default applied in src/proxy.ts for /api/authenticated/.
const NO_STORE_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store, private',
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: NO_STORE_HEADERS })

export async function POST(req) {
  const authResult = await isAuthenticatedAndApproved(req)
  if (authResult instanceof Response) {
    return authResult
  }
  const data = await req.json()
  const { mediaType, mediaTitle, mediaOriginalTitle } = data
  // Prefer the unique originalTitle when the client sends it; the resolver is
  // originalTitle-first so an originalTitle value in either param resolves the
  // exact item (no _id/mediaId churn, no display-title collisions).
  const resolvedTitle = mediaOriginalTitle
    ? decodeURIComponent(mediaOriginalTitle)
    : (mediaTitle ? decodeURIComponent(mediaTitle) : null)
  const media = await getFlatRequestedMedia({
    type: mediaType,
    title: resolvedTitle,
  })
  await applyJitPreference(media)
  return jsonResponse(media)
}

export async function GET(req) {
  try {
    const authResult = await isAuthenticatedAndApproved(req)
    if (authResult instanceof Response) {
      return authResult
    }
    const url = new URL(req.url)
    const mediaType = url.searchParams.get('mediaType')
    const mediaTitle = url.searchParams.get('mediaTitle')
    const mediaOriginalTitle = url.searchParams.get('mediaOriginalTitle')
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
    
    // Prefer the unique originalTitle when the client explicitly sends it. The
    // resolver treats a valid ObjectId (mediaId) as authoritative, so clients
    // that dual-send mediaId + originalTitle (e.g. the RN app during its staged
    // migration) would otherwise have mediaId win and the migration silently
    // no-op. When mediaOriginalTitle is present we resolve by it and drop mediaId,
    // giving callers a clean opt-in to stable-key resolution.
    const preferOriginalTitle = Boolean(mediaOriginalTitle)
    const resolvedTitle = preferOriginalTitle
      ? decodeURIComponent(mediaOriginalTitle)
      : (mediaTitle ? decodeURIComponent(mediaTitle) : null)

    const mediaRequest = {
      type: mediaType,
      title: resolvedTitle,
      id: preferOriginalTitle ? null : (mediaId ? decodeURIComponent(mediaId) : null),
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
      return jsonResponse({ error: 'Media not found' }, 404)
    }

    // Serve-time delivery decision (payload-only; see jit/preference.js).
    // Applied before the TV/card branches so both clients receive the chosen
    // URL through the existing videoURL contract field.
    await applyJitPreference(media)

    // Add watch history if requested - only for playable media items (movies,
    // episodes). Gate on "has something to play", not on the stored hash: a
    // doc that lost its normalizedVideoId still resolves through its URLs and
    // mediaId (watchHistory/resolve.js), and failing closed here let an RN
    // session start at 0 and blind-write over a position the web still read.
    if (includeWatchHistory && authResult.id && (media?.videoURL || media?.normalizedVideoId)) {
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
              title: resolvedTitle,
              id: preferOriginalTitle ? null : (mediaId ? decodeURIComponent(mediaId) : null),
              // Don't include season/episode to get full show data
            }
            
            fullShowData = await getFlatRequestedMedia(fullShowRequest)
            
            if (Boolean(process.env.DEBUG) == true) {
              console.log(`TV Device: Fetched full show data with ${fullShowData?.seasons?.length || 0} seasons`);
            }
            
              // For season requests, also fetch episode list
              if (mediaSeason && !mediaEpisode) {
                const seasonWithEpisodes = await getFlatTVSeasonWithEpisodes({
                  // Resolve by the unique originalTitle to avoid display-title collisions
                  showTitle: fullShowData?.originalTitle || media.originalTitle || fullShowData?.title || media.title,
                  seasonNumber: parseInt(mediaSeason.replace('Season ', ''))
                })
                
                if (seasonWithEpisodes && seasonWithEpisodes.episodes) {
                  // The RN app can start playback straight from this list, so
                  // each episode gets the same delivery decision as the detail
                  // payload — applied BEFORE the watch-history join, in the same
                  // order as the detail path above (health result is cached —
                  // one probe per origin).
                  await Promise.all(seasonWithEpisodes.episodes.map((ep) => applyJitPreference(ep)))

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
                    // Preserve backdrop data from full show data (fix for TV device backdrop issue)
                    backdrop: fullShowData?.backdrop || media.backdrop || null,
                    backdropBlurhash: fullShowData?.backdropBlurhash || media.backdropBlurhash || null,
                    backdropBlurhashSource: fullShowData?.backdropBlurhashSource || media.backdropBlurhashSource || null,
                    backdropSource: fullShowData?.backdropSource || media.backdropSource || null,
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
                  // Preserve backdrop data from full show data (fix for TV device backdrop issue)
                  backdrop: fullShowData?.backdrop || media.backdrop || null,
                  backdropBlurhash: fullShowData?.backdropBlurhash || media.backdropBlurhash || null,
                  backdropBlurhashSource: fullShowData?.backdropBlurhashSource || media.backdropBlurhashSource || null,
                  backdropSource: fullShowData?.backdropSource || media.backdropSource || null,
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
        return jsonResponse(tvData)
      } catch (tvError) {
        console.error('Error in sanitizeTVData:', tvError);
        // Return partial data if possible
        return jsonResponse({
          error: 'Error processing TV data',
          partialData: media ? {
            id: media.id,
            title: media.title,
            originalTitle: media.originalTitle || null,
            type: media.type,
            posterURL: media.posterURL
          } : null
        }, 206) // Partial Content
      }
    }

    // Card Data Handling
    if (isCard) {
      try {
        const cardData = await sanitizeCardData(media, true)
        return jsonResponse(cardData)
      } catch (cardError) {
        console.error('Error in sanitizeCardData:', cardError);
        // Return partial data if possible
        return jsonResponse({
          error: 'Error processing card data',
          partialData: media ? {
            id: media.id,
            title: media.title,
            originalTitle: media.originalTitle || null,
            type: media.type,
            posterURL: media.posterURL
          } : null
        }, 206) // Partial Content
      }
    }
    return jsonResponse(media)
  } catch (error) {
    console.error('Error in media API:', error);
    return jsonResponse({
      error: 'Failed to fetch media data',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    }, 500)
  }
}
