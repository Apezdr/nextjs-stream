import { formatDateToEST, getFullImageUrl } from '@src/utils'
import { getServer } from './config'
import { cache } from 'react'
import { normalize } from 'path'

export const movieProjectionFields = {
  _id: 1,
  mediaLastModified: 1,
  posterURL: 1,
  posterBlurhash: 1,
  backdrop: 1,
  backdropBlurhash: 1,
  title: 1,
  dimensions: 1,
  posterBlurhashSource: 1,
  backdropBlurhashSource: 1,
  hdr: 1,
  mediaQuality: 1,
  'metadata.id': 1,
  'metadata.overview': 1,
  'metadata.release_date': 1,
  'metadata.genres': 1,
  'metadata.cast': 1,
  'metadata.poster_path': 1,
  'metadata.trailer_url': 1,
}

export const tvShowProjectionFields = {
  _id: 1,
  posterURL: 1,
  posterBlurhash: 1,
  backdrop: 1,
  backdropBlurhash: 1,
  title: 1,
  posterSource: 1,
  posterBlurhashSource: 1,
  backdropBlurhashSource: 1,
  dimensions: 1,
  mediaQuality: 1,
  'metadata.id': 1,
  'metadata.overview': 1,
  'metadata.last_air_date': 1,
  'metadata.first_air_date': 1,
  'metadata.networks': 1,
  'metadata.genres': 1,
  'metadata.cast': 1,
  'metadata.status': 1,
  'metadata.poster_path': 1,
  'metadata.trailer_url': 1,
  seasons: 1,
}

// Helper function to get the latest modified date for both movies and TV shows
export function getModifiedDate(media) {
  if (media.mediaLastModified) {
    // Return the movie's mediaLastModified if it exists
    return new Date(media.mediaLastModified).getTime()
  } else if (media.seasons && Array.isArray(media.seasons)) {
    // Return the most recent episode's mediaLastModified date for TV shows
    const latestEpisodeDate = getLatestEpisodeModifiedDate(media)
    return latestEpisodeDate ? new Date(latestEpisodeDate).getTime() : 0
  }
  return 0 // Default to 0 if no date is found
}

// Helper function to get the latest modified date for TV shows
export function getLatestEpisodeModifiedDate(tvShow) {
  if (!tvShow.seasons || !Array.isArray(tvShow.seasons)) return null

  const episodes = tvShow.seasons.flatMap((season) => season.episodes || [])
  const latestEpisode = episodes.reduce((latest, episode) => {
    const episodeModifiedDate = new Date(episode.mediaLastModified).getTime()
    return episodeModifiedDate > latest ? episodeModifiedDate : latest
  }, 0)

  return latestEpisode || 0 // Return 0 if no valid date is found
}

/**
 * Helper function to arrange media regardless of type by the latest modification date
 * @param {Array} moviesWithUrl - Array of movies with URL
 * @param {Array} tvShowsWithUrl - Array of TV shows with URL
 * @returns {Array} - Combined and sorted media array
 */
export const arrangeMediaByLatestModification = (moviesWithUrl, tvShowsWithUrl) => {
  // Merge and sort
  const combinedMedia = [...moviesWithUrl, ...tvShowsWithUrl].sort((a, b) => {
    const aModified = getModifiedDate(a)
    const bModified = getModifiedDate(b)

    // Sort in descending order
    return bModified - aModified
  })
  return combinedMedia
}

/**
 * Extract detailed TV show information using the TV details.
 *
 * @param {Object} tvDetails - The pre-fetched TV show details.
 * @param {string} videoId - The video URL.
 * @returns {Promise<Object|null>} The detailed TV show information or null if not found.
 */
async function extractTVShowDetailsFromMap(tvDetails, videoId) {
  if (process.env.DEBUG === 'true') {
    console.time('extractTVShowDetailsFromMap:total');
    console.log(`[EXTRACT_DEBUG] Starting extraction for videoId: ${videoId}`);
  }
  try {
    if (process.env.DEBUG === 'true') {
      console.time('extractTVShowDetailsFromMap:processing');
    }

    // Destructure required fields from tvDetails.
    const { title: showTitle, seasons, metadata } = tvDetails;
    
    if (process.env.DEBUG === 'true') {
      console.log(`[EXTRACT_DEBUG] Show: ${showTitle}, Seasons count: ${seasons?.length || 0}`);
    }

    // Use the episode info provided in tvDetails.
    const episodeFromTv = tvDetails.episode;
    if (!episodeFromTv) {
      if (process.env.DEBUG === 'true') {
        console.log('[EXTRACT_DEBUG] No episode info found in tvDetails');
        console.timeEnd('extractTVShowDetailsFromMap:processing');
        console.timeEnd('extractTVShowDetailsFromMap:total');
      }
      return null;
    }

    const seasonNumber = episodeFromTv.seasonNumber;
    if (process.env.DEBUG === 'true') {
      console.log(`[EXTRACT_DEBUG] Episode season: ${seasonNumber}, episode: ${episodeFromTv.episodeNumber}`);
      console.log(`[EXTRACT_DEBUG] Episode videoURL: ${episodeFromTv.videoURL}`);
      console.log(`[EXTRACT_DEBUG] Episode normalizedVideoId: ${episodeFromTv.normalizedVideoId}`);
    }
    
    // Find the season using the seasonNumber from tvDetails.
    const season = seasons.find((s) => s.seasonNumber === seasonNumber);
    if (!season) {
      if (process.env.DEBUG === 'true') {
        console.log(`[EXTRACT_DEBUG] Season ${seasonNumber} not found in available seasons: ${seasons.map(s => s.seasonNumber).join(', ')}`);
        console.timeEnd('extractTVShowDetailsFromMap:processing');
        console.timeEnd('extractTVShowDetailsFromMap:total');
      }
      return null;
    }

    // Verify that the passed videoId matches the episode in tvDetails.
    let episode;
    
    if (process.env.DEBUG === 'true') {
      console.log(`[EXTRACT_DEBUG] Attempting to match videoId: ${videoId}`);
      console.log(`[EXTRACT_DEBUG] Against episodeFromTv.videoURL: ${episodeFromTv.videoURL}`);
      console.log(`[EXTRACT_DEBUG] Against episodeFromTv.normalizedVideoId: ${episodeFromTv.normalizedVideoId}`);
    }
    
    // First, try direct match with videoId (direct URL)
    if (videoId && episodeFromTv.videoURL === videoId) {
      episode = episodeFromTv;
      if (process.env.DEBUG === 'true') {
        console.log(`[EXTRACT_DEBUG] Match found: Direct URL match`);
      }
    }
    // Try with normalized IDs if available
    else if (episodeFromTv.normalizedVideoId && videoId === episodeFromTv.normalizedVideoId) {
      episode = episodeFromTv;
      if (process.env.DEBUG === 'true') {
        console.log(`[EXTRACT_DEBUG] Match found: Normalized ID match`);
      }
    }
    // Fallback: search the season's episodes for the matching video
    else {
      if (process.env.DEBUG === 'true') {
        console.log(`[EXTRACT_DEBUG] No direct match, searching season episodes (${season.episodes?.length || 0} episodes)`);
      }
      
      // Try direct URL match first
      episode = season.episodes.find((e) => e.videoURL === videoId);
      
      if (episode && process.env.DEBUG === 'true') {
        console.log(`[EXTRACT_DEBUG] Match found: Season episode direct URL match`);
      }
      
      // If not found by direct URL, try normalized ID match
      if (!episode) {
        episode = season.episodes.find((e) =>
          e.normalizedVideoId && e.normalizedVideoId === videoId
        );
        
        if (episode && process.env.DEBUG === 'true') {
          console.log(`[EXTRACT_DEBUG] Match found: Season episode normalized ID match`);
        }
      }
      
      // If still not found, the episode doesn't exist in this season
      if (!episode) {
        if (process.env.DEBUG === 'true') {
          console.log(`[EXTRACT_DEBUG] NO MATCH FOUND for videoId ${videoId} in season ${seasonNumber}`);
          console.log(`[EXTRACT_DEBUG] Available episodes in season:`, season.episodes?.map(e => ({
            videoURL: e.videoURL,
            normalizedVideoId: e.normalizedVideoId,
            episodeNumber: e.episodeNumber
          })) || []);
          console.timeEnd('extractTVShowDetailsFromMap:processing');
          console.timeEnd('extractTVShowDetailsFromMap:total');
        }
        return null;
      }
    }

    // Optionally attach episode metadata if available.
    let episodeMetadata = null;
    if (season.metadata && season.metadata.episodes) {
      episodeMetadata = season.metadata.episodes.find(
        (epMeta) =>
          epMeta.season_number === seasonNumber &&
          epMeta.episode_number === episode.episodeNumber
      );
    }
    if (episodeMetadata) {
      episode.metadata = episodeMetadata;
    }

    // Format the title using the show title and episode numbers.
    const showTitleFormatted = `${showTitle} S${seasonNumber
      .toString()
      .padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`;

    const returnData = {
      id: tvDetails._id,
      title: tvDetails.title,
      showTitleFormatted,
      seasonNumber,
      seasons,
      posterURL: episode.thumbnail ?? '/sorry-image-not-available.jpg',
      backdrop: tvDetails.backdrop ?? null,
      metadata,
      episode,
    };

    // Include additional optional properties.
    if (tvDetails.logo) returnData.logo = tvDetails.logo;
    if (tvDetails.posterBlurhash) returnData.posterBlurhash = tvDetails.posterBlurhash;
    if (episode.thumbnailBlurhash) returnData.thumbnailBlurhash = episode.thumbnailBlurhash;
    if (episode.thumbnailSource) returnData.thumbnailSource = episode.thumbnailSource;
    if (episode.hdr) returnData.hdr = episode.hdr;
    if (tvDetails.backdropBlurhash) returnData.backdropBlurhash = tvDetails.backdropBlurhash;
    if (tvDetails.posterBlurhashSource) returnData.posterBlurhashSource = tvDetails.posterBlurhashSource;
    if (tvDetails.backdropBlurhashSource) returnData.backdropBlurhashSource = tvDetails.backdropBlurhashSource;

    if (process.env.DEBUG === 'true') {
      console.timeEnd('extractTVShowDetailsFromMap:processing');
      console.timeEnd('extractTVShowDetailsFromMap:total');
    }
    return returnData;
  } catch (error) {
    console.error(`[PERF] Error in extractTVShowDetailsFromMap: ${error.message}`);
    if (process.env.DEBUG === 'true') {
      console.timeEnd('extractTVShowDetailsFromMap:total');
    }
    return null;
  }
}

export async function processWatchedDetails(lastWatched, movieMap, tvMap, limit, context = {}) {
  if (Boolean(process.env.DEBUG) == true) {
    console.time('processWatchedDetails:total');
    console.log(`[PERF] Starting processWatchedDetails with ${lastWatched[0].videosWatched.length} videos, limit: ${limit}`);
  }
  const results = []
  const processingErrors = []
  
  for (let i = 0; i < lastWatched[0].videosWatched.length; i++) {
    const video = lastWatched[0].videosWatched[i]
    // Process all videos - pagination was already handled upstream in getFlatRecentlyWatchedForUser
    // Removing the early break to ensure consistent pagination results

    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[ENHANCED_DEBUG] Processing video ${i+1}: ${video.videoId}`);
    }
    
    // Try direct video ID first
    let movie = movieMap.get(video.videoId)
    let tvDetails = null
    
    // If direct lookup failed, try with normalizedVideoId if available
    if (!movie && video.normalizedVideoId) {
      if (Boolean(process.env.DEBUG) == true) {
        console.log(`[PERF] Trying normalizedVideoId lookup for ${video.videoId}`);
      }
      movie = movieMap.get(video.normalizedVideoId)
    }
    
    // Process movie if found
    if (movie) {
      if (Boolean(process.env.DEBUG) == true) {
        console.time(`processWatchedDetails:sanitizeMovie:${results.length}`);
      }
      // Pass the context to sanitizeRecord
      const mergedContext = { ...context, lastWatchedVideo: video };
      const sanitizedMovie = await sanitizeRecord(movie, 'movie', mergedContext)
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd(`processWatchedDetails:sanitizeMovie:${results.length}`);
      }

      if (sanitizedMovie) {
        results.push(sanitizedMovie)
      }
      continue // Move to the next video
    }

    // Try direct TV lookup
    tvDetails = tvMap.get(video.videoId)
    
    // If direct lookup failed, try with normalizedVideoId
    if (!tvDetails && video.normalizedVideoId) {
      if (Boolean(process.env.DEBUG) == true) {
        console.log(`[PERF] Trying normalizedVideoId TV lookup for ${video.videoId}`);
      }
      tvDetails = tvMap.get(video.normalizedVideoId)
    }
    
    // Process TV details if found
    if (tvDetails) {
      if (Boolean(process.env.DEBUG) == true) {
        console.time(`processWatchedDetails:extractTVDetails:${results.length}`);
        console.log(`[ENHANCED_DEBUG] Found TV details for ${video.videoId}, attempting extraction...`);
      }
      
      // Determine which ID to try first based on how we found the TV details
      let primaryId = video.videoId;
      let fallbackId = video.normalizedVideoId;
      
      // If we found TV details using normalized ID, prioritize that for extraction
      if (video.normalizedVideoId && tvMap.get(video.normalizedVideoId) === tvDetails) {
        primaryId = video.normalizedVideoId;
        fallbackId = video.videoId;
        if (Boolean(process.env.DEBUG) == true) {
          console.log(`[ENHANCED_DEBUG] TV details found by normalized ID, trying normalized ID first: ${primaryId}`);
        }
      } else if (Boolean(process.env.DEBUG) == true) {
        console.log(`[ENHANCED_DEBUG] TV details found by direct videoId, trying direct videoId first: ${primaryId}`);
      }
      
      // First try with the primary ID
      let detailedTVShow = await extractTVShowDetailsFromMap(tvDetails, primaryId)
      
      // If that fails, try with the fallback ID
      if (!detailedTVShow && fallbackId) {
        if (Boolean(process.env.DEBUG) == true) {
          console.log(`[ENHANCED_DEBUG] Primary ID failed, trying fallback ID: ${fallbackId}`);
        }
        detailedTVShow = await extractTVShowDetailsFromMap(tvDetails, fallbackId)
      }
      
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd(`processWatchedDetails:extractTVDetails:${results.length}`);
        console.log(`[ENHANCED_DEBUG] extractTVShowDetailsFromMap result: ${detailedTVShow ? 'SUCCESS' : 'FAILED'}`);
      }

      if (detailedTVShow) {
        // Ensure we preserve the original videoId for consistency
        if (detailedTVShow.episode) {
          detailedTVShow.episode.videoURL = video.videoId;
        }
        
        if (Boolean(process.env.DEBUG) == true) {
          console.time(`processWatchedDetails:sanitizeTV:${results.length}`);
        }
        // Pass the context to sanitizeRecord
        const mergedContext = { ...context, lastWatchedVideo: video };
        const sanitizedData = await sanitizeRecord(detailedTVShow, 'tv', mergedContext)
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd(`processWatchedDetails:sanitizeTV:${results.length}`);
          console.log(`[ENHANCED_DEBUG] sanitizeRecord result: ${sanitizedData ? 'SUCCESS' : 'FAILED'}`);
        }

        if (sanitizedData) {
          results.push(sanitizedData)
        } else if (Boolean(process.env.DEBUG) == true) {
          console.warn(`[ENHANCED_DEBUG] sanitizeRecord returned null for ${video.videoId}`);
        }
      } else if (Boolean(process.env.DEBUG) == true) {
        console.warn(`[ENHANCED_DEBUG] extractTVShowDetailsFromMap failed for ${video.videoId} despite finding TV details`);
      }
    } else if (Boolean(process.env.DEBUG) == true) {
      // Debug info about missed videos
      if (video.normalizedVideoId) {
        console.log(`[PERF] Video not found despite normalized ID: ${video.videoId} (normalized: ${video.normalizedVideoId})`);
      } else {
        console.log(`[PERF] Video not found and no normalized ID available: ${video.videoId}`);
      }
    }
  }
  
  // Log processing errors summary
  if (processingErrors.length > 0) {
    console.warn(`[ENHANCED_DEBUG] Processing completed with ${processingErrors.length} errors:`);
    processingErrors.forEach((error, index) => {
      console.warn(`[ENHANCED_DEBUG] Error ${index + 1}: ${error.videoId} (${error.type}): ${error.error}`);
    });
  }
  
  if (Boolean(process.env.DEBUG) == true) {
    console.log(`[PERF] Completed processWatchedDetails with ${results.length} results`);
    console.timeEnd('processWatchedDetails:total');
  }
  return results
}

/**
 * Sanitize record to a consistent format for frontend use
 * @param {Object} record - The media record
 * @param {string} type - The type of media (movie or TV)
 * @param {Object} [context] - Optional context with additional data
 * @returns {Object} The sanitized record
 */
export async function sanitizeRecord(record, type, context = {}) {
  if (Boolean(process.env.DEBUG) == true) {
    console.time('sanitizeRecord:total');
  }
  try {
    // Extract shouldExposeAdditionalData from context for TV device handling
    const shouldExposeAdditionalData = context.shouldExposeAdditionalData || false;
    
    // Initialize an object to hold different types of dates
    let dateValues = {};
    
    // Determine which dates to include based on context
    
    // Last watched date - from watch history
    if (context.dateContext === 'watchHistory' || context.dateTypes?.includes('lastWatched')) {
      if (context.lastWatchedVideo?.lastUpdated && context.lastWatchedVideo?.playbackTime) {
        dateValues.lastWatchedDate = formatDateToEST(context.lastWatchedVideo.lastUpdated);
        dateValues.playbackTime = context.lastWatchedVideo.playbackTime;
      }
    }
    
    // Extract device info from lastWatchedVideo if available
    let deviceInfo = null;
    if (context.lastWatchedVideo?.deviceInfo && context.lastWatchedVideo.deviceInfo.type) {
      deviceInfo = {
        deviceType: context.lastWatchedVideo.deviceInfo.type,
        userAgentTruncated: context.lastWatchedVideo.deviceInfo.userAgent,
        lastUpdated: context.lastWatchedVideo.deviceInfo.lastUsed
      };
    }
    
    // Added date - for recently added media
    if (context.dateContext === 'recentlyAdded' || context.dateTypes?.includes('added')) {
      if (record.mediaLastModified) {
        dateValues.addedDate = formatDateToEST(record.mediaLastModified);
      } else if (record?.episode?.mediaLastModified) {
        dateValues.addedDate = formatDateToEST(record.episode.mediaLastModified);
      }
    }
    
    // Release date - from metadata
    if (context.dateContext === 'recommendations' || context.dateTypes?.includes('release')) {
      if (record.metadata?.release_date) {
        dateValues.releaseDate = formatDateToEST(record.metadata.release_date);
      } else if (type === 'tv' && record.metadata?.first_air_date) {
        dateValues.releaseDate = formatDateToEST(record.metadata.first_air_date);
      }
    }
    
    // If no context is specified, try to determine the most appropriate date
    if (!context.dateContext && !context.dateTypes) {
      // For watched history
      if (context.lastWatchedVideo?.lastUpdated) {
        dateValues.lastWatchedDate = formatDateToEST(context.lastWatchedVideo.lastUpdated);
      }
      // For recently added
      else if (record.mediaLastModified || record?.episode?.mediaLastModified) {
        dateValues.addedDate = formatDateToEST(record.mediaLastModified || record?.episode?.mediaLastModified);
      }
      // For everything else
      else if (record.metadata?.release_date || (type === 'tv' && record.metadata?.first_air_date)) {
        dateValues.releaseDate = formatDateToEST(record.metadata?.release_date || record.metadata?.first_air_date);
      }
    }
    if (Boolean(process.env.DEBUG) == true) {
      console.time('sanitizeRecord:initialProcessing');
    }
    let poster = record.posterURL || getFullImageUrl(record.metadata?.poster_path)
    if (!poster) {
      poster = `/sorry-image-not-available.jpg`
      delete record.posterBlurhash;
    }
    if (record._id ?? record.id) {
      record.id = record._id ? record._id.toString() : record.id.toString()
      delete record?._id
    }
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('sanitizeRecord:initialProcessing');
      console.time('sanitizeRecord:createReturnObject');
    }

    let result;
    if (type === 'tv' && record.episode) {
      // For TV devices, use episode title as main title and add showTitle field
      // For web clients, maintain backward compatibility with show title as main title
      const mainTitle = shouldExposeAdditionalData && record.episode.title ? record.episode.title : record.title;
      
      result = {
        id: record.id,
        normalizedVideoId: record.episode.normalizedVideoId,
        ...dateValues, // Spread all date values (lastWatchedDate, addedDate, releaseDate)
        link: `${record.title}/${record.seasonNumber}/${record.episode.episodeNumber}`,
        duration: record.duration ?? record.episode.duration ?? 0,
        posterURL: poster,
        posterBlurhash: record.posterBlurhash || null,
        backdrop: record.backdrop || getFullImageUrl(record.metadata?.backdrop_path) || null,
        backdropBlurhash: record.backdropBlurhash || null,
        title: mainTitle || null,
        showTitleFormatted: record.showTitleFormatted || null,
        showId: record.showId || null,
        showTmdbId: record.showTmdbId || null,
        logo: record.logo || getFullImageUrl(record.metadata?.logo_path) || null,
        type: type,
        metadata: record.metadata || null,
        hdr: record.hdr || record.episode?.hdr || record.mediaQuality?.isHDR || null,
        dimensions: record.dimensions || record.episode?.dimensions || null,
        seasons: record.seasons,
        // Add season/episode data at top level for UI components
        seasonNumber: record.seasonNumber ?? record.episode.seasonNumber,
        episodeNumber: record.episode.episodeNumber,
        videoSource: record.videoSource || record.episode.videoSource || null,
        thumbnail: record.episode.thumbnail,
        thumbnailBlurhash: record.episode.thumbnailBlurhash || null,
        // Add device info if available
        deviceInfo: deviceInfo,
      }
      
      // Add showTitle field for TV devices to provide easy access to show title
      if (shouldExposeAdditionalData) {
        result.showTitle = record.title;
      }
    } else {
      result = {
        id: record.id,
        normalizedVideoId: record.normalizedVideoId,
        ...dateValues, // Spread all date values (lastWatchedDate, addedDate, releaseDate)
        link: encodeURIComponent(record.title),
        duration: record.duration ?? 0,
        posterURL: poster,
        posterBlurhash: record.posterBlurhash || null,
        backdrop: record.backdrop || getFullImageUrl(record.metadata?.backdrop_path) || null,
        backdropBlurhash: record.backdropBlurhash || null,
        title: record.title || record.metadata?.title || null,
        type: type,
        metadata: record.metadata || null,
        hdr: record.hdr || record.mediaQuality?.isHDR || null,
        dimensions: record.dimensions || null,
        // Add device info if available
        deviceInfo: deviceInfo,
      }
    }
  // Conditionally add url property if it exists in the data passed to the function
  if (record.url) {
    result.url = record.url;
  }
  // Preserve matchType for search result grouping
  if (record.matchType) {
    result.matchType = record.matchType;
  }
  if (Boolean(process.env.DEBUG) == true) {
    console.timeEnd('sanitizeRecord:createReturnObject');
    console.timeEnd('sanitizeRecord:total');
  }
  // For additional safety, if this is a TV show with episode info in the media property,
  // ensure the seasonNumber and episodeNumber are at top level
  if (result?.media?.seasonNumber && !result.seasonNumber) {
    result.seasonNumber = result.media.seasonNumber;
  }
  
  if (result?.media?.episode?.episodeNumber && !result.episodeNumber) {
    result.episodeNumber = result.media.episode.episodeNumber;
  }
  
  return result;
  } catch (e) {
    console.error(`Error in sanitizeRecord: ${e.message}`);
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('sanitizeRecord:total');
    }
    return null
  }
}

/**
 * Sanitizes a single media item to include only the required fields for the Card component.
 *
 * @param {Object} item - The media item to sanitize.
 * @param {boolean} popup - Whether the item is being used in a popup.
 * @param {Object} context - Context parameters to pass through to sanitizeRecord.
 * @returns {Object|null} - The sanitized media item or null if the item is falsy.
 */
export function sanitizeCardData(item, popup = false, context = {}) {
  if (!item) return null

  try {
    const {
      _id, // MongoDB ID
      id,
      normalizedVideoId,
      title,
      originalTitle,
      posterURL,
      posterBlurhash,
      backdrop,
      backdropBlurhash,
      type,
      // Date fields - using our new semantic naming
      lastWatchedDate,
      addedDate,
      releaseDate,
      link,
      logo,
      metadata,
      cast,
      // tv
      media,
      episodeNumber, // it may not exist on the record if it's not an specific episode
      seasonNumber, // it may not exist on the record if it's not an specific episode
      // Availability flags for TMDB-only items
      isAvailable,
      comingSoon,
      comingSoonDate,
      // TMDB snake_case fields and nested blurhash object
      poster_blurhash,
      backdrop_blurhash,
      blurhash,
      thumbnailBlurhash,
    } = item

    // Normalize blurhash fields from different sources (TMDB snake_case, nested object, existing camelCase)
    const normalizedPosterBlurhash = posterBlurhash || poster_blurhash || blurhash?.poster || thumbnailBlurhash || null;
    const normalizedBackdropBlurhash = backdropBlurhash || backdrop_blurhash || blurhash?.backdrop || null;

    const sanitized = {}
    
    // Handle TV episode title separation for TV devices
    let finalTitle = title;
    let finalShowTitle = title;
    
    // Check if this is a TV episode and we should expose additional data (TV device mode)
    if (type === 'tv' && context.isTVdevice && item.media?.episode?.title) {
      // For TV devices, use episode title as main title and show title as showTitle
      finalTitle = item.media.episode.title;
      finalShowTitle = item.media.showTitle || title;
    }

    // Basic properties that should always be included
    if (id || _id) sanitized.id = id ?? _id
    if (normalizedVideoId) sanitized.normalizedVideoId = normalizedVideoId
    if (finalTitle) sanitized.title = finalTitle
    if (posterURL) sanitized.posterURL = posterURL
    if (type) sanitized.type = type
    
    // CRITICAL: Preserve availability flags for TMDB-only items (must always be included)
    // Default to true if not explicitly set (backward compatibility with library items)
    sanitized.isAvailable = typeof isAvailable === 'boolean' ? isAvailable : true
    sanitized.comingSoon = comingSoon || false
    sanitized.comingSoonDate = comingSoonDate || null
    
    // CRITICAL: Always preserve metadata for TMDB-only items (moved from try block)
    if (metadata) {
      sanitized.metadata = metadata
    }
    
    // Add showTitle for TV devices when we have episode data
    if (finalShowTitle && type === 'tv' && popup) {
      sanitized.showTitle = finalShowTitle;
    }
    
    // Properties that are safe to include if they exist
    try {
      if (normalizedPosterBlurhash) sanitized.posterBlurhash = normalizedPosterBlurhash
      if (backdrop) sanitized.backdrop = backdrop
      
      // Ensure backdropBlurhash is properly preserved with its source
      if (normalizedBackdropBlurhash) {
        sanitized.backdropBlurhash = normalizedBackdropBlurhash
        // Also preserve backdropBlurhashSource if available in the original item
        if (item.backdropBlurhashSource) sanitized.backdropBlurhashSource = item.backdropBlurhashSource
        if (item.backdropSource) sanitized.backdropSource = item.backdropSource
      }
      
      // Handle the different date types
      if (lastWatchedDate) sanitized.lastWatchedDate = lastWatchedDate
      if (addedDate) sanitized.addedDate = addedDate
      if (releaseDate) sanitized.releaseDate = releaseDate
      if (link) sanitized.link = link
      if (logo) sanitized.logo = logo
      
      // TV specific properties
      if (episodeNumber) sanitized.episodeNumber = episodeNumber
      if (seasonNumber) sanitized.seasonNumber = seasonNumber
      // Episode specific handling, preserve showTmdbId if available for watchlist
      if (item.showTmdbId) sanitized.showTmdbId = item.showTmdbId;
      if (item.showId) sanitized.showId = item.showId;
      // Cast information
      if (cast) sanitized.cast = cast

      // General properties
      if (item?.hdr) sanitized.hdr = item?.hdr
    } catch (nonCriticalError) {
      if (Boolean(process.env.DEBUG) == true) {
        console.warn('Non-critical error in sanitizeCardData:', nonCriticalError.message);
      }
      // Continue processing - these are non-critical properties
    }

    // Additional properties for popup cards
    if (popup) {
      try {
        if (metadata?.trailer_url) sanitized.trailer_url = metadata?.trailer_url
        if (item?.thumbnail) sanitized.thumbnail = item?.thumbnail
        
        // Use thumbnailBlurhash directly from the database
        if (item?.thumbnailBlurhash) {
          sanitized.thumbnailBlurhash = item.thumbnailBlurhash;
        }
        
        // Description and title
        if (metadata?.overview) sanitized.description = metadata?.overview
        if (metadata?.name && !sanitized.title) sanitized.title = metadata?.name
        
        // Video clip URL - check multiple locations for videoURL
        const videoURL = item.videoURL || item.media?.videoURL || item.episode?.videoURL || item.media?.episode?.videoURL
        if (videoURL) {
          try {
            // Create a copy of item with videoURL at top level for generateClipVideoURL
            const itemForClipGeneration = {
              ...item,
              videoURL: videoURL,
              // Ensure duration is available for clip generation
              duration: item.duration || item.media?.duration || item.episode?.duration || item.media?.episode?.duration || 0,
              // Ensure season/episode numbers are available for TV shows
              seasonNumber: item.seasonNumber || item.media?.seasonNumber,
              episodeNumber: item.episodeNumber || item.media?.episode?.episodeNumber
            }
            // Use original video quality for TV devices
            const useOriginalVideo = context.isTVdevice === true;
            sanitized.clipVideoURL = generateClipVideoURL(itemForClipGeneration, type, originalTitle || title, useOriginalVideo);
          } catch (clipError) {
            if (Boolean(process.env.DEBUG) == true) {
              console.warn(`Error generating clip URL for ${title}:`, clipError.message);
            }
            // Continue without the clip URL
          }
        }
      } catch (popupError) {
        console.error('Error processing popup data:', popupError.message);
        // Return basic card data without popup-specific enhancements
      }
    }
    
    return sanitized;
  } catch (error) {
    console.error(`Error in sanitizeCardData for ${item?.title || 'unknown item'}:`, error);
    
    // Return minimal data to prevent complete failure
    return {
      id: item?.id,
      title: item?.title || 'Unknown Title',
      type: item?.type,
      posterURL: item?.posterURL || '/sorry-image-not-available.jpg',
      error: 'Error processing media data'
    };
  }
}

/**
 * Generates a clip video URL with adjusted start and end times.
 *
 * @param {Object} item - The media item containing video information.
 * @param {string} type - The type of media.
 * @param {string} title - The title of the media (use the originalTitle)
 * @param {boolean} useOriginalVideo - Whether to preserve original video quality
 * @returns {string|null} - The generated clip video URL or null if videoURL is missing.
 */
export const generateClipVideoURL = cache((item, type, title, useOriginalVideo = false) => {
  if (!item?.videoURL) return null

    const maxDuration = 50 // 50 seconds
    const videoLength = Math.floor(item['duration'] / 1000) // Convert ms to seconds
    let start = 3200 // Default start time
    let end = start + maxDuration // Default end time

    // Adjust start/end if video is shorter than default timings
    if (videoLength <= end || start >= videoLength - 300) {
      // Ensure at least 5 minutes for credits if possible
      const oneThirdLength = Math.floor(videoLength / 3)
      start = Math.max(
        Math.min(oneThirdLength, videoLength - maxDuration - 300), // Avoid credits
        0
      )
      end = Math.min(start + maxDuration, videoLength)

      // Ensure valid range and minimum difference
      if (end - start < 2 || end >= videoLength) {
        start = 0 // Fallback to the beginning of the video
        end = Math.min(maxDuration, videoLength) // Clip to max duration or video length
      }
    }

    // Generate sanitized URL with adjusted start and end times
    const nodeJSURL = getServer(
      item?.videoSource || item?.videoInfoSource || 'default'
    ).syncEndpoint
    
    // For TV shows, check for season/episode data in multiple locations
    let seasonEpisodePath = ''
    if (type === 'tv') {
      // Check for season/episode data at top level (from horizontal-list API)
      const seasonNumber = item?.seasonNumber || item?.metadata?.season_number
      const episodeNumber = item?.episodeNumber || item?.episode?.episodeNumber
      
      if (seasonNumber && episodeNumber) {
        seasonEpisodePath = `/${seasonNumber}/${episodeNumber}`
      }
    }
    
    // Build the base URL with start and end parameters
    let clipURL = `${nodeJSURL}/videoClip/${type}/${title}${seasonEpisodePath}?start=${start}&end=${end}`
    
    // Add useOriginalVideo parameter if requested
    if (useOriginalVideo) {
      clipURL += '&useOriginalVideo=true'
    }
    
    return clipURL
})

/**
 * Sanitizes an array of media items.
 *
 * @param {Array} items - The array of media items to sanitize.
 * @param {Object} context - Context parameters to pass through to sanitizeRecord.
 * @param {boolean} shouldExposeAdditionalData - Whether to include additional data like video URLs.
 * @returns {Array} - The array of sanitized media items.
 */
export function sanitizeCardItems(items, context = {}, shouldExposeAdditionalData = false) {
  if (!Array.isArray(items)) return []
  return items.map((item) => sanitizeCardData(item, shouldExposeAdditionalData, context)).filter(Boolean)
}

/**
 * Fetches a queue using the provided fetch function and handles any errors.
 *
 * @param {Function} fetchFunction - The function to fetch the queue data.
 * @param {string} queueName - The name of the queue for error reporting.
 * @returns {Promise<any>} The queue data if successful.
 * @throws {Error} Throws an error with statusCode 501 if fetch fails.
 */
export async function handleQueueFetch(fetchFunction, queueName) {
  try {
    const queueData = await fetchFunction()
    return queueData
  } catch (error) {
    console.error(`Error fetching ${queueName} queue:`, error)
    // You can set a custom status code if needed
    error.statusCode = 501 // Not Implemented
    throw error
  }
}

/**
 * Validates a URL by initiating a simple network request.
 *
 * @param {string} url - The URL to validate.
 * @returns {Promise<boolean>} - Resolves to true if the URL is valid, false otherwise.
 */
export async function validateURL(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' })
    return response.ok
  } catch (error) {
    console.error(`Error validating URL: ${url}`, error)
    return false
  }
}

/**
 * Sanitizes media data specifically for TV devices (React Native Expo TV app).
 * Optimizes data structure for TV navigation and removes web-specific features.
 *
 * @param {Object} media - The media object from getFlatRequestedMedia
 * @param {Object} options - Configuration options for TV data processing
 * @param {boolean} options.includeEpisodeList - Whether to include full episode list for seasons
 * @param {boolean} options.includeNavigation - Whether to include navigation helpers
 * @param {string} options.mediaType - The media type ('movie' or 'tv')
 * @param {string} options.seasonNumber - Current season number (if applicable)
 * @param {string} options.episodeNumber - Current episode number (if applicable)
 * @returns {Object} TV-optimized media data
 */
export function sanitizeTVData(media, options = {}) {
  if (!media) return null

  const {
    includeEpisodeList = false,
    includeNavigation = true,
    mediaType,
    seasonNumber,
    episodeNumber
  } = options

  try {
    // Base TV data structure
    const tvData = {
      id: media.id || media._id?.toString(),
      title: media.title,
      type: media.type || mediaType,
      
      // TV-optimized images (higher quality for TV screens)
      posterURL: media.posterURL || getFullImageUrl(media.metadata?.poster_path, 'w780'),
      backdrop: media.backdrop || getFullImageUrl(media.metadata?.backdrop_path, 'original'),
      
      // Preserve blurhash data for smooth loading
      posterBlurhash: media.posterBlurhash || null,
      backdropBlurhash: media.backdropBlurhash || null,
      
      // Essential metadata for TV
      metadata: {
        overview: media.metadata?.overview,
        genres: media.metadata?.genres,
        rating: media.metadata?.rating,
        vote_average: media.metadata?.vote_average,
        runtime: media.metadata?.runtime || media.duration,
        releaseDate: media.metadata?.release_date || media.metadata?.first_air_date,
        trailer_url: media.metadata?.trailer_url
      }
    }

    // Add show title for TV shows/episodes
    if (mediaType === 'tv' || media.type === 'tv') {
      // For episodes, use showTitle if available, otherwise fall back to originalTitle
      tvData.showTitle = media.showTitle || media.originalTitle
    }

    // Preserve additional TV-specific fields
    if (media.availableSeasons) {
      tvData.availableSeasons = media.availableSeasons
    }
    if (media.totalSeasons) {
      tvData.totalSeasons = media.totalSeasons
    }
    if (media.first_air_date) {
      tvData.first_air_date = media.first_air_date
    }
    if (media.airDate) {
      tvData.airDate = media.airDate
    }

    // Add logo if available
    if (media.logo) {
      tvData.logo = media.logo
    }

    if (media.watchHistory) {
      // Add watch history data if available
      tvData.watchHistory = media.watchHistory
    }

    // Handle TV show specific data
    if (mediaType === 'tv' || media.type === 'tv') {
      // Add season/episode context
      if (seasonNumber) {
        tvData.seasonNumber = parseInt(seasonNumber.replace('Season ', ''))
      }
      if (episodeNumber) {
        tvData.episodeNumber = parseInt(episodeNumber.replace('Episode ', ''))
      }

      // For specific episodes, include episode details
      if (media.episodeNumber || episodeNumber) {
        tvData.episode = {
          episodeNumber: media.episodeNumber || parseInt(episodeNumber?.replace('Episode ', '')),
          title: media.title,
          thumbnail: media.thumbnail,
          thumbnailBlurhash: media.thumbnailBlurhash,
          duration: media.duration,
          videoURL: media.videoURL,
          description: media.metadata?.overview,
          normalizedVideoId: media.normalizedVideoId,
          hdr: media.hdr || false,
          mediaQuality: media.mediaQuality || null,
          dimensions: media.dimensions
        }

        // Also add HDR and dimensions at top level for TV episodes
        tvData.hdr = media.hdr || false
        tvData.dimensions = media.dimensions
        tvData.duration = media.duration
        tvData.mediaQuality = media.mediaQuality || null
        tvData.createdAt = media.createdAt || null

        // Include next episode info if available
        if (media.hasNextEpisode) {
          tvData.nextEpisode = {
            episodeNumber: media.nextEpisodeNumber,
            title: media.nextEpisodeTitle,
            thumbnail: media.nextEpisodeThumbnail,
            thumbnailBlurhash: media.nextEpisodeThumbnailBlurhash
          }
        }
      }

      // Include episode list for season requests (TV navigation)
      if (includeEpisodeList && media.episodes && Array.isArray(media.episodes)) {
        tvData.episodes = media.episodes.map(episode => ({
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          thumbnail: episode.thumbnail,
          thumbnailBlurhash: episode.thumbnailBlurhash,
          duration: episode.duration,
          description: episode.metadata?.overview,
          // TV-specific: Include video URL for direct playback
          videoURL: episode.videoURL,
          // TV-specific: Include HDR info for quality indicators
          hdr: episode.hdr || false,
          dimensions: episode.dimensions,
          normalizedVideoId: episode.normalizedVideoId,
          watchHistory: episode.watchHistory || null
        }))
      }

      // Add navigation helpers for TV interface
      if (includeNavigation) {
        tvData.navigation = generateTVNavigation(media, {
          currentSeason: tvData.seasonNumber,
          currentEpisode: tvData.episodeNumber,
          totalSeasons: media.seasons?.length || 0
        })
      }
    }

    // For movies, add movie-specific TV data
    if (mediaType === 'movie' || media.type === 'movie') {
      tvData.duration = media.duration
      tvData.videoURL = media.videoURL
      tvData.hdr = media.hdr || false
      tvData.dimensions = media.dimensions
      
      // Add cast information for TV browsing
      if (media.cast) {
        tvData.cast = media.cast
      }
    }

    // Add cast and guest stars information for TV shows/episodes (for TV browsing)
    if (mediaType === 'tv' || media.type === 'tv') {
      if (media.cast) {
        tvData.cast = media.cast
      }
      if (media.guestStars) {
        tvData.guestStars = media.guestStars
      }
    }

    return tvData

  } catch (error) {
    console.error(`Error in sanitizeTVData for ${media?.title || 'unknown media'}:`, error)
    
    // Return minimal TV data to prevent complete failure
    return {
      id: media?.id || media?._id?.toString(),
      title: media?.title || 'Unknown Title',
      type: media?.type || mediaType,
      posterURL: media?.posterURL || '/sorry-image-not-available.jpg',
      error: 'Error processing TV data'
    }
  }
}

/**
 * Generates navigation helpers for TV interface
 * @param {Object} media - The media object
 * @param {Object} context - Navigation context
 * @returns {Object} Navigation data for TV interfaceonst video: any
 */
function generateTVNavigation(media, context = {}) {
  const { currentSeason, currentEpisode, totalSeasons } = context
  
  const navigation = {
    seasons: {
      current: currentSeason || 1,
      total: totalSeasons,
      hasPrevious: currentSeason > 1,
      hasNext: currentSeason < totalSeasons
    }
  }

  // Add episode navigation if we're viewing a specific episode
  if (currentEpisode && media.episodes) {
    const totalEpisodes = media.episodes.length
    navigation.episodes = {
      current: currentEpisode,
      total: totalEpisodes,
      hasPrevious: currentEpisode > 1,
      hasNext: currentEpisode < totalEpisodes
    }
  }

  return navigation
}
