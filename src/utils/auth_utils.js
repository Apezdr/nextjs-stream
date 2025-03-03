import { formatDateToEST, getFullImageUrl } from '@src/utils'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
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
export const arrangeMediaByLatestModification = cache((moviesWithUrl, tvShowsWithUrl) => {
  // Merge and sort
  const combinedMedia = [...moviesWithUrl, ...tvShowsWithUrl].sort((a, b) => {
    const aModified = getModifiedDate(a)
    const bModified = getModifiedDate(b)

    // Sort in descending order
    return bModified - aModified
  })
  return combinedMedia
})

/**
 * Extract detailed TV show information from the pre-fetched data.
 *
 * @param {Object} tvDetails - The pre-fetched TV show details.
 * @param {string} videoId - The video URL.
 * @returns {Promise<Object|null>} The detailed TV show information or null if not found.
 */
async function extractTVShowDetailsFromMap(tvDetails, videoId) {
  if (Boolean(process.env.DEBUG) == true) {
    console.time('extractTVShowDetailsFromMap:total');
  }
  try {
    if (Boolean(process.env.DEBUG) == true) {
      console.time('extractTVShowDetailsFromMap:parsing');
    }
    const { title: showTitle, seasons, metadata } = tvDetails
    const [_, showPath] = videoId?.split('/tv/') ?? [null, null]
    const parts = showPath?.split('/')
    let returnData = {}

    if (parts?.length < 3) {
      if (Boolean(process.env.DEBUG) == true) {
        console.log('[PERF] Invalid TV show path structure');
        console.timeEnd('extractTVShowDetailsFromMap:parsing');
        console.timeEnd('extractTVShowDetailsFromMap:total');
      }
      return null
    }

    const showTitleDecoded = decodeURIComponent(parts[0].replace(/_/g, ' '))
    const seasonPartDecoded = decodeURIComponent(parts[1])
    const episodeFileNameDecoded = decodeURIComponent(parts[2])

    const seasonNumber = parseInt(seasonPartDecoded.match(/\d+/)[0])
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('extractTVShowDetailsFromMap:parsing');

      console.time('extractTVShowDetailsFromMap:findSeasonAndEpisode');
    }
    const season = seasons.find((s) => s.seasonNumber === seasonNumber)
    if (!season) {
      if (Boolean(process.env.DEBUG) == true) {
        console.log(`[PERF] Season ${seasonNumber} not found`);
        console.timeEnd('extractTVShowDetailsFromMap:findSeasonAndEpisode');
        console.timeEnd('extractTVShowDetailsFromMap:total');
      }
      return null
    }

    const episode = season.episodes.find((e) => e.videoURL === videoId)
    if (!episode) {
      if (Boolean(process.env.DEBUG) == true) {
        console.log(`[PERF] Episode with videoId ${videoId} not found`);
        console.timeEnd('extractTVShowDetailsFromMap:findSeasonAndEpisode');
        console.timeEnd('extractTVShowDetailsFromMap:total');
      }
      return null
    }
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('extractTVShowDetailsFromMap:findSeasonAndEpisode');

      console.time('extractTVShowDetailsFromMap:findEpisodeMetadata');
    }
    // Find the episode metadata matching seasonNumber and episodeNumber
    let episodeMetadata = null
    if (season.metadata && season.metadata.episodes) {
      episodeMetadata = season.metadata.episodes.find(
        (epMeta) =>
          epMeta.season_number === seasonNumber && epMeta.episode_number === episode.episodeNumber
      )
    }

    // Attach the metadata to the episode object
    if (episodeMetadata) {
      episode.metadata = episodeMetadata
    }
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('extractTVShowDetailsFromMap:findEpisodeMetadata');

      console.time('extractTVShowDetailsFromMap:buildReturnData');
    }
    returnData = {
      id: tvDetails._id,
      title: showTitleDecoded,
      showTitleFormatted: `${showTitleDecoded} S${seasonNumber
        .toString()
        .padStart(2, '0')}E${episode.episodeNumber.toString().padStart(2, '0')}`,
      seasonNumber,
      seasons: seasons,
      posterURL: episode.thumbnail ?? '/sorry-image-not-available.jpg',
      backdrop: tvDetails.backdrop ?? null,
      metadata: metadata,
      episode,
    }

    if (tvDetails.logo) {
      returnData.logo = tvDetails.logo
    }

    if (tvDetails.posterBlurhash) {
      returnData.posterBlurhash = tvDetails.posterBlurhash
    }

    if (episode.thumbnailBlurhash) {
      returnData.thumbnailBlurhash = episode.thumbnailBlurhash
    }

    if (episode.thumbnailSource) {
      returnData.thumbnailSource = episode.thumbnailSource
    }

    if (episode.hdr) {
      returnData.hdr = episode.hdr
    }

    if (tvDetails.backdropBlurhash) {
      returnData.backdropBlurhash = tvDetails.backdropBlurhash
    }

    if (tvDetails.posterBlurhashSource) {
      returnData.posterBlurhashSource = tvDetails.posterBlurhashSource
    }

    if (tvDetails.backdropBlurhashSource) {
      returnData.backdropBlurhashSource = tvDetails.backdropBlurhashSource
    }
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('extractTVShowDetailsFromMap:buildReturnData');

      console.timeEnd('extractTVShowDetailsFromMap:total');
    }
    return returnData
  } catch (error) {
    console.error(`[PERF] Error in extractTVShowDetailsFromMap: ${error.message}`);
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('extractTVShowDetailsFromMap:total');
    }
    return null;
  }
}

export async function processWatchedDetails(lastWatched, movieMap, tvMap, limit) {
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
      const sanitizedMovie = await sanitizeRecord(movie, 'movie', video)
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
        const sanitizedData = await sanitizeRecord(detailedTVShow, 'tv', video)
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
 * Sanitize record to a consistent format
 * @param {Object} record - The media record
 * @param {string} type - The type of media (movie or TV)
 * @returns {Object} The sanitized record
 */
export async function sanitizeRecord(record, type, lastWatchedVideo) {
  if (Boolean(process.env.DEBUG) == true) {
    console.time('sanitizeRecord:total');
  }
  try {
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
    }

    // Optimize blurhash handling - only fetch what's needed for display
    // and use a more efficient approach with better error handling
    if (Boolean(process.env.DEBUG) == true) {
      console.time('sanitizeRecord:prepareBlurhashPromises');
    }
    
    // Create an object to track which blurhash types we need to fetch
    const blurhashesToFetch = {
      poster: record.posterBlurhash ? {
        source: record.posterBlurhashSource,
        hash: record.posterBlurhash
      } : null,
      backdrop: record.backdropBlurhash ? {
        source: record.backdropBlurhashSource,
        hash: record.backdropBlurhash
      } : null,
      thumbnail: record?.episode?.thumbnailBlurhash ? {
        source: record?.episode?.thumbnailSource,
        hash: record?.episode?.thumbnailBlurhash
      } : null
    };
    
    // Clean up original blurhash fields to avoid duplication
    if (record.posterBlurhash) delete record.posterBlurhash;
    if (record.backdropBlurhash) delete record.backdropBlurhash;
    if (record?.episode?.thumbnailBlurhash) delete record.episode.thumbnailBlurhash;
      
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('sanitizeRecord:prepareBlurhashPromises');
    }

    // Create a map to store the results
    const blurhashResults = {
      poster: null,
      backdrop: null,
      thumbnail: null
    };

    // Only fetch blurhashes if they exist
    if (Boolean(process.env.DEBUG) == true) {
      console.time('sanitizeRecord:fetchBlurhashData');
    }
    
    // Create an array of promises for the blurhashes we need to fetch
    const fetchPromises = [];
    const blurhashTypes = [];
    
    if (blurhashesToFetch.poster) {
      fetchPromises.push(
        fetchMetadataMultiServer(
          blurhashesToFetch.poster.source,
          blurhashesToFetch.poster.hash,
          'blurhash',
          record.title,
          type
        ).catch(err => {
          console.error(`Error fetching poster blurhash: ${err.message}`);
          return null;
        })
      );
      blurhashTypes.push('poster');
    }
    
    if (blurhashesToFetch.backdrop) {
      fetchPromises.push(
        fetchMetadataMultiServer(
          blurhashesToFetch.backdrop.source,
          blurhashesToFetch.backdrop.hash,
          'blurhash',
          record.title,
          type
        ).catch(err => {
          console.error(`Error fetching backdrop blurhash: ${err.message}`);
          return null;
        })
      );
      blurhashTypes.push('backdrop');
    }
    
    if (blurhashesToFetch.thumbnail) {
      fetchPromises.push(
        fetchMetadataMultiServer(
          blurhashesToFetch.thumbnail.source,
          blurhashesToFetch.thumbnail.hash,
          'blurhash',
          record.title,
          type
        ).catch(err => {
          console.error(`Error fetching thumbnail blurhash: ${err.message}`);
          return null;
        })
      );
      blurhashTypes.push('thumbnail');
    }
    
    if (Boolean(process.env.DEBUG) == true) {
      console.log(`[PERF] Number of blurhash promises: ${fetchPromises.length}`);
    }

    // Fetch all blurhashes in parallel
    if (fetchPromises.length > 0) {
      const results = await Promise.all(fetchPromises);
      
      // Map results back to their types
      results.forEach((result, index) => {
        blurhashResults[blurhashTypes[index]] = result;
      });
    }
    
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('sanitizeRecord:fetchBlurhashData');

      console.time('sanitizeRecord:createReturnObject');
    }
    let result;
    if (type === 'tv' && record.episode) {
      result = {
        id: record.id,
        date: formatDateToEST(lastWatchedVideo.lastUpdated),
        link: `${record.title}/${record.seasonNumber}/${record.episode.episodeNumber}`,
        length: record.length ?? 0,
        posterURL: poster,
        posterBlurhash: blurhashResults.poster || null,
        backdrop: record.backdrop || getFullImageUrl(record.metadata?.backdrop_path) || null,
        backdropBlurhash: blurhashResults.backdrop || null,
        title: record.showTitleFormatted || null,
        logo: record.logo || getFullImageUrl(record.metadata?.logo_path) || null,
        type: type,
        metadata: record.metadata || null,
        seasons: record.seasons,
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
            thumbnailBlurhash: blurhashResults.thumbnail,
            captionURLs: record.episode.captionURLs,
            metadata: record.episode.metadata,
            hdr: record.episode.hdr,
          },
        },
      }
    } else {
      result = {
        id: record.id,
        date: formatDateToEST(lastWatchedVideo.lastUpdated),
        link: encodeURIComponent(record.title),
        length: record.length ?? 0,
        posterURL: poster,
        posterBlurhash: blurhashResults.poster || null,
        backdrop: record.backdrop || getFullImageUrl(record.metadata?.backdrop_path) || null,
        backdropBlurhash: blurhashResults.backdrop || null,
        title: record.title || record.metadata?.title || null,
        type: type,
        metadata: record.metadata || null,
        hdr: record.hdr || null,
        media: record,
      }
    }
    if (Boolean(process.env.DEBUG) == true) {
      console.timeEnd('sanitizeRecord:createReturnObject');
      console.timeEnd('sanitizeRecord:total');
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
 * @returns {Object|null} - The sanitized media item or null if the item is falsy.
 */
export async function sanitizeCardData(item, popup = false) {
  if (!item) return null

  try {
    const {
      id,
      title,
      posterURL,
      posterBlurhash,
      backdrop,
      backdropBlurhash,
      type,
      date,
      link,
      logo,
      metadata,
      cast,
      // tv
      media,
      episodeNumber, // it may not exist on the record if it's not an specific episode
      seasonNumber, // it may not exist on the record if it's not an specific episode
    } = item

    const sanitized = {}

    // Basic properties that should always be included
    if (id) sanitized.id = id
    if (title) sanitized.title = title
    if (posterURL) sanitized.posterURL = posterURL
    if (type) sanitized.type = type
    
    // Properties that are safe to include if they exist
    try {
      if (posterBlurhash) sanitized.posterBlurhash = posterBlurhash
      if (backdrop) sanitized.backdrop = backdrop
      if (backdropBlurhash) sanitized.backdropBlurhash = backdropBlurhash
      if (date) sanitized.date = date
      if (link) sanitized.link = link
      if (logo) sanitized.logo = logo
      
      // TV specific properties
      if (media?.seasonNumber) sanitized.seasonNumber = media?.seasonNumber
      if (media?.episode?.episodeNumber) sanitized.episodeNumber = media?.episode?.episodeNumber
      if (episodeNumber) sanitized.episodeNumber = episodeNumber
      if (seasonNumber) sanitized.seasonNumber = seasonNumber
      
      // Cast information
      if (cast) sanitized.cast = cast

      // General properties
      if (media?.hdr || item?.hdr) sanitized.hdr = media?.hdr ?? item?.hdr
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
        
        // Safely fetch thumbnailBlurhash with timeout and fallback
        if (item?.thumbnailBlurhash) {
          try {
            // Add a timeout to prevent hanging
            const blurhashPromise = Promise.race([
              fetchMetadataMultiServer(
                item?.thumbnailBlurhashSource, 
                item?.thumbnailBlurhash, 
                'blurhash', 
                type || 'tv', 
                title
              ),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Blurhash fetch timeout')), 5000)
              )
            ]);
            
            sanitized.thumbnailBlurhash = await blurhashPromise;
          } catch (blurhashError) {
            if (Boolean(process.env.DEBUG) == true) {
              console.warn(`Blurhash fetch error for ${title}:`, blurhashError.message);
            }
            // Continue without the blurhash - it's not critical
          }
        }
        
        // Description and title
        if (metadata?.overview) sanitized.description = metadata?.overview
        if (metadata?.name) sanitized.title = metadata?.name
        
        // Video clip URL
        if (item.videoURL) {
          try {
            sanitized.clipVideoURL = generateClipVideoURL(item, type, title)
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
 * @returns {Array} - The array of sanitized media items.
 */
export async function sanitizeCardItems(items) {
  if (!Array.isArray(items)) return []
  const sanitizedItems = await Promise.all(items.map((item) => sanitizeCardData(item)))
  return sanitizedItems.filter(Boolean)
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
