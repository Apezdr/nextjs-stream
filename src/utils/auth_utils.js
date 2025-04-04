import { formatDateToEST, getFullImageUrl } from '@src/utils'
import { getServer } from './config'
import { cache } from 'react'

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
  'metadata.overview': 1,
  'metadata.release_date': 1,
  'metadata.genres': 1,
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
  'metadata.overview': 1,
  'metadata.last_air_date': 1,
  'metadata.networks': 1,
  'metadata.genres': 1,
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
  }
  try {
    if (process.env.DEBUG === 'true') {
      console.time('extractTVShowDetailsFromMap:processing');
    }

    // Destructure required fields from tvDetails.
    const { title: showTitle, seasons, metadata } = tvDetails;

    // Use the episode info provided in tvDetails.
    const episodeFromTv = tvDetails.episode;
    if (!episodeFromTv) {
      if (process.env.DEBUG === 'true') {
        console.log('[PERF] No episode info found in tvDetails');
        console.timeEnd('extractTVShowDetailsFromMap:processing');
        console.timeEnd('extractTVShowDetailsFromMap:total');
      }
      return null;
    }

    const seasonNumber = episodeFromTv.seasonNumber;
    // Find the season using the seasonNumber from tvDetails.
    const season = seasons.find((s) => s.seasonNumber === seasonNumber);
    if (!season) {
      if (process.env.DEBUG === 'true') {
        console.log(`[PERF] Season ${seasonNumber} not found`);
        console.timeEnd('extractTVShowDetailsFromMap:processing');
        console.timeEnd('extractTVShowDetailsFromMap:total');
      }
      return null;
    }

    // Optionally verify that the passed videoId matches the episode in tvDetails.
    let episode;
    if (videoId && episodeFromTv.videoURL === videoId) {
      episode = episodeFromTv;
    } else {
      // Fallback: search the season's episodes for the matching video URL.
      episode = season.episodes.find((e) => e.videoURL === videoId);
      if (!episode) {
        if (process.env.DEBUG === 'true') {
          console.log(`[PERF] Episode with videoId ${videoId} not found in season ${seasonNumber}`);
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
  for (const video of lastWatched[0].videosWatched) {
    // If we've reached the limit, break out of the loop
    if (results.length >= limit) break

    const movie = movieMap.get(video.videoId)
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

    const tvDetails = tvMap.get(video.videoId)
    if (tvDetails) {
      if (Boolean(process.env.DEBUG) == true) {
          console.time(`processWatchedDetails:extractTVDetails:${results.length}`);
      }
      const detailedTVShow = await extractTVShowDetailsFromMap(tvDetails, video.videoId)
      if (Boolean(process.env.DEBUG) == true) {
        console.timeEnd(`processWatchedDetails:extractTVDetails:${results.length}`);
      }

      if (detailedTVShow) {
        if (Boolean(process.env.DEBUG) == true) {
          console.time(`processWatchedDetails:sanitizeTV:${results.length}`);
        }
        // Pass the context to sanitizeRecord
        const mergedContext = { ...context, lastWatchedVideo: video };
        const sanitizedData = await sanitizeRecord(detailedTVShow, 'tv', mergedContext)
        if (Boolean(process.env.DEBUG) == true) {
          console.timeEnd(`processWatchedDetails:sanitizeTV:${results.length}`);
        }

        if (sanitizedData) {
          results.push(sanitizedData)
        }
      }
    }
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
    // Initialize an object to hold different types of dates
    let dateValues = {};
    
    // Determine which dates to include based on context
    
    // Last watched date - from watch history
    if (context.dateContext === 'watchHistory' || context.dateTypes?.includes('lastWatched')) {
      if (context.lastWatchedVideo?.lastUpdated) {
        dateValues.lastWatchedDate = formatDateToEST(context.lastWatchedVideo.lastUpdated);
      }
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
      result = {
        id: record.id,
        ...dateValues, // Spread all date values (lastWatchedDate, addedDate, releaseDate)
        link: `${record.title}/${record.seasonNumber}/${record.episode.episodeNumber}`,
        length: record.length ?? 0,
        posterURL: poster,
        posterBlurhash: record.posterBlurhash || null,
        backdrop: record.backdrop || getFullImageUrl(record.metadata?.backdrop_path) || null,
        backdropBlurhash: record.backdropBlurhash || null,
        title: record.title || null,
        showTitleFormatted: record.showTitleFormatted || null,
        logo: record.logo || getFullImageUrl(record.metadata?.logo_path) || null,
        type: type,
        metadata: record.metadata || null,
        seasons: record.seasons,
        // Add season/episode data at top level for UI components
        seasonNumber: record.seasonNumber,
        episodeNumber: record.episode.episodeNumber,
        thumbnail: record.episode.thumbnail,
        thumbnailBlurhash: record.episode.thumbnailBlurhash || null,
        // Keep media object for API compatibility
        media: {
          showTitle: record.title,
          seasonNumber: record.seasonNumber,
          episode: {
            episodeNumber: record.episode.episodeNumber,
            title: record.episode.title,
            videoURL: record.episode.videoURL,
            mediaLastModified: record.episode.mediaLastModified,
            length: record.episode.length,
            dimensions: record.episode.dimensions,
            thumbnail: record.episode.thumbnail,
            thumbnailBlurhash: record.episode.thumbnailBlurhash || null,
            captionURLs: record.episode.captionURLs,
            metadata: record.episode.metadata,
            hdr: record.episode.hdr,
          },
        },
      }
    } else {
      result = {
        id: record.id,
        ...dateValues, // Spread all date values (lastWatchedDate, addedDate, releaseDate)
        link: encodeURIComponent(record.title),
        length: record.length ?? 0,
        posterURL: poster,
        posterBlurhash: record.posterBlurhash || null,
        backdrop: record.backdrop || getFullImageUrl(record.metadata?.backdrop_path) || null,
        backdropBlurhash: record.backdropBlurhash || null,
        title: record.title || record.metadata?.title || null,
        type: type,
        metadata: record.metadata || null,
        hdr: record.hdr || null,
        media: record,
      }
    }
  // Conditionally add url property if it exists in the data passed to the function
  if (record.url) {
    result.url = record.url;
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
      showTitle,
      episodeNumber, // it may not exist on the record if it's not an specific episode
      seasonNumber, // it may not exist on the record if it's not an specific episode
    } = item

    const sanitized = {}

    // Basic properties that should always be included
    if (id || _id) sanitized.id = id ?? _id
    if (title) sanitized.title = title
    if (posterURL) sanitized.posterURL = posterURL
    if (type) sanitized.type = type
    
    // Properties that are safe to include if they exist
    try {
      if (posterBlurhash) sanitized.posterBlurhash = posterBlurhash
      if (backdrop) sanitized.backdrop = backdrop
      
      // Ensure backdropBlurhash is properly preserved with its source
      if (backdropBlurhash) {
        sanitized.backdropBlurhash = backdropBlurhash
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
        if (metadata?.name) sanitized.title = metadata?.name
        
        // Video clip URL
        if (item.videoURL) {
          try {
            sanitized.clipVideoURL = generateClipVideoURL(item, type, originalTitle || title);
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
 * @param {string} title - The title of the media.
 * @returns {string|null} - The generated clip video URL or null if videoURL is missing.
 */
export const generateClipVideoURL = cache((item, type, title) => {
  if (!item?.videoURL) return null

    const maxDuration = 50 // 50 seconds
    const videoLength = Math.floor(item['length'] / 1000) // Convert ms to seconds
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
    return `${nodeJSURL}/videoClip/${type}/${title}${item?.metadata?.season_number ? `/${item?.metadata.season_number}${item?.episodeNumber ? `/${item?.episodeNumber}` : ''}` : ''}?start=${start}&end=${end}`
})

/**
 * Sanitizes an array of media items.
 *
 * @param {Array} items - The array of media items to sanitize.
 * @param {Object} context - Context parameters to pass through to sanitizeRecord.
 * @returns {Array} - The array of sanitized media items.
 */
export function sanitizeCardItems(items, context = {}) {
  if (!Array.isArray(items)) return []
  return items.map((item) => sanitizeCardData(item, false, context)).filter(Boolean)
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
