import axios from 'axios'
import { getFullImageUrl } from '@src/utils'
import { getLastUpdatedTimestamp } from '@src/utils/database'
import {
  radarrAPIKey,
  radarrURL,
  sabnzbdAPIKey,
  sabnzbdURL,
  sonarrAPIKey,
  sonarrURL,
  tdarrAPIKey,
  tdarrURL,
} from '@src/utils/ssr_config'
import { multiServerHandler } from './config'
//import axiosInstance from './axiosInstance'
import pLimit from 'p-limit'
import { httpGet } from '@src/lib/httpHelper'
import { getCache, setCache } from '@src/lib/cache'

// Define concurrency limit - reduced to prevent resource exhaustion
const CONCURRENCY_LIMIT = 10;
const limit = pLimit(CONCURRENCY_LIMIT);

// Cache TTLs for different types of data (in seconds)
const CACHE_TTL = {
  blurhash: 86400 * 7, // 7 days for blurhash data (rarely changes)
  file: 3600,          // 1 hour for regular files
  default: 3600        // Default 1 hour
};

export function processMediaData(jsonResponseString) {
  const { movies, tv } = jsonResponseString

  // Prepare headers for the tables
  const movieHeaders = ['Poster', 'Title', 'Genre', 'Year']
  const tvHeaders = ['Poster', 'Title', 'Seasons', 'Year']

  let result = {}

  // Process movies if present
  if (movies && movies.length > 0) {
    const movieData = movies.map((movie) => {
      let poster =
        movie.posterURL ||
        getFullImageUrl(movie.metadata?.poster_path) ||
        `/sorry-image-not-available.jpg`

      return {
        id: movie._id.toString(),
        posterURL: poster,
        title:
          movie.title === movie.metadata?.title
            ? movie.metadata?.title
            : movie.title + ` (${movie.metadata?.title})` || movie.title,
        genre: movie.metadata?.genres.map((genre) => genre.name).join(', '),
        year: typeof movie.metadata?.release_date?.getFullYear === 'function' ? movie.metadata.release_date.getFullYear() : 'N/A',
      }
    })

    result.movies = {
      headers: movieHeaders,
      data: movieData,
    }
  }

  // Process TV shows if present
  if (tv && tv.length > 0) {
    const tvData = tv.map((show) => {
      let poster = show.posterURL || getFullImageUrl(show.metadata?.poster_path, 'w185')
      if (!poster) {
        poster = null
      }
      const startYear = getYearFromDate(show.metadata?.first_air_date)
      const endYear = getYearFromDate(show.metadata?.last_air_date)

      let released
      if (startYear && endYear && startYear !== endYear) {
        released = `${startYear}–${endYear}`
      } else {
        released = startYear ? startYear.toString() : ''
      }

      if (!released) {
        released = show.metadata?.release_date.getFullYear()
      }
      return {
        id: show._id.toString(),
        posterURL: poster,
        title: show.title,
        seasons: show.seasons.length,
        year: released,
      }
    })

    result.tvShows = {
      headers: tvHeaders,
      data: tvData,
    }
  }

  return result
}

export function processUserData(jsonResponse) {
  // Assuming jsonResponse is an array of user records
  const users = jsonResponse

  // Prepare headers for the user table
  const userHeaders = ['Name', 'Email', 'Image', 'Limited Access', 'Approved', 'Actions']

  // Transform data for users
  const userData = users.map((user) => ({
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    imageUrl: user.image, // Add image URL
    limitedAccess: user.limitedAccess ? true : false, // If the user is approved to view content
    approved: user.approved.toString(), // If the user is approved to view content
  }))

  return {
    headers: userHeaders,
    data: userData,
  }
}

function getYearFromDate(dateString) {
  return dateString ? new Date(dateString).getFullYear() : null
}

// Function to fetch

/**
 * Retry function with exponential backoff
 */
async function fetchWithRetry(fetchFunction, retries = 3, delay = 200) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetchFunction();
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      console.warn(`Fetch attempt ${attempt} failed. Retrying in ${delay}ms...`);
      await new Promise(res => setTimeout(res, delay));
      delay *= 2; // Exponential backoff
    }
  }
}

/**
 * Enhanced fetchMetadataMultiServer with Redis caching, conditional requests, controlled concurrency, and retry logic
 * @param {string} serverId - The ID of the file server to fetch from
 * @param {string} metadataUrl - The URL to fetch metadata from
 * @param {'file'|'blurhash'} type - The type of metadata being fetched
 * @param {'tv'|'movie'} mediaType - The type of media
 * @param {string} title - The title of the media
 * @param {Object} headers - Conditional request headers
 * @param {string} cacheKey - The Redis cache key
 * @returns {Object|null} - The fetched metadata or null if not modified
 */
export async function fetchMetadataMultiServer(
  serverId,
  metadataUrl,
  type = 'file',
  mediaType,
  title,
  headers = {},
  cacheKey = `${serverId}:${type}:${metadataUrl}`
) {
  // Early return if no metadata URL is provided
  if (!metadataUrl) {
    return {};
  }

    // First, try to get from cache to avoid unnecessary processing
    try {
      const cachedEntry = await getCache(cacheKey);
      if (cachedEntry && cachedEntry.data) {
        // For blurhash data, we can use the cached version but still allow for periodic refresh
        // We'll check the cache age and only refresh if it's older than a certain threshold
        if (type === 'blurhash') {
          // Check if the cache entry has a timestamp
          const cacheAge = cachedEntry.timestamp 
            ? (Date.now() - new Date(cachedEntry.timestamp).getTime()) / 1000 
            : Infinity;
            
          // If the cache is less than 1 day old for blurhash, use it directly
          // This provides a balance between performance and freshness
          if (cacheAge < 86400) {
            return cachedEntry.data;
          }
          // Otherwise, continue with the fetch but use cached data as fallback
        }
        
        // Set conditional headers if available
        if (cachedEntry?.etag) {
          headers['If-None-Match'] = cachedEntry.etag;
        }
        if (cachedEntry.lastModified) {
          headers['If-Modified-Since'] = cachedEntry.lastModified;
        }
      }

    // Get the URL handler for this server
    const handler = multiServerHandler.getHandler(serverId);
    if (!handler) {
      throw new Error(`No handler found for server ID: ${serverId}`);
    }
    
    // Strip any existing paths and create the full URL
    const strippedPath = handler.stripPrefixPath(metadataUrl);
    const normalizedUrl = handler.createFullURL(strippedPath);

    // Validate URL format
    const matches = normalizedUrl.match(/https?:\/\//g);
    if (matches && matches.length > 1) {
      throw new Error(`URL is incorrectly normalized: ${normalizedUrl}`);
    }

    // Define the fetch function with a timeout
    const fetchFunction = async () => {
      try {
        // Create a promise that rejects after the timeout
        const timeoutPromise = new Promise((_, reject) => {
          const timeoutMs = type === 'blurhash' ? 3000 : 5000; // Shorter timeout for blurhash
          setTimeout(() => reject(new Error(`Fetch timeout after ${timeoutMs}ms`)), timeoutMs);
        });
        
        // Race the fetch against the timeout
        const fetchPromise = httpGet(normalizedUrl, {
          headers,
          timeout: type === 'blurhash' ? 3000 : 5000, // Shorter timeout for blurhash
          responseType: type === 'blurhash' ? 'text' : 'json',
          http2: true,
        });
        
        const { data, headers: responseHeaders } = await Promise.race([fetchPromise, timeoutPromise]);

        // Handle 304 Not Modified
        if (data === null && cachedEntry) {
          return cachedEntry.data;
        }

        // Process the data based on type
        const processedData = type === 'blurhash' ? (data ? data.trim() : null) : data;
        
        if (!processedData) {
          throw new Error('Empty or null response data');
        }

        // Use different TTLs based on the type of data
        const ttl = CACHE_TTL[type] || CACHE_TTL.default;
        
        // Update the cache with the new data
        await setCache(
          cacheKey,
          processedData,
          responseHeaders?.etag ?? cachedEntry?.etag ?? null,
          responseHeaders['last-modified'] || cachedEntry?.lastModified,
          ttl
        );      

        return processedData;
      } catch (fetchError) {
        // If we have cached data, return it as a fallback
        if (cachedEntry && cachedEntry.data) {
          if (Boolean(process.env.DEBUG) == true) {
            console.warn(`Fetch failed, using cached data for ${metadataUrl}: ${fetchError.message}`);
          }
          return cachedEntry.data;
        }
        throw fetchError; // Re-throw if no cached data
      }
    };

    // Use concurrency limiter and retry logic
    const data = await limit(() => fetchWithRetry(fetchFunction, 2, 300)); // Reduced retries for faster failure

    return data;
  } catch (error) {
    if (Boolean(process.env.DEBUG) == true) {
      console.error('Error fetching metadata:', {
        serverId,
        url: metadataUrl,
        error: error.message,
        mediaType,
        title
      });
    }
    
    // For blurhash, return an empty string as fallback
    if (type === 'blurhash') {
      return '';
    }
    
    return null;
  }
}

// End of utilities for syncing media

export async function fetchRadarrQueue() {
  if (!radarrURL || !radarrAPIKey) {
    throw new Error('Radarr URL or API key not configured')
  }
  try {
    const radarrQueue = await axios.get(`${radarrURL}/api/v3/queue?apikey=${radarrAPIKey}`)
    return radarrQueue.data
  } catch (error) {
    console.error(
      'Failed to fetch Radarr queue:',
      `${radarrURL}/api/v3/queue?apikey=${radarrAPIKey}`,
      error
    )
    throw new Error('Failed to fetch Radarr queue')
  }
}

export async function fetchSonarrQueue() {
  if (!sonarrURL || !sonarrAPIKey) {
    throw new Error('Sonarr URL or API key not configured')
  }
  try {
    const sonarrQueue = await axios.get(`${sonarrURL}/api/v3/queue?apikey=${sonarrAPIKey}`)
    return sonarrQueue.data
  } catch (error) {
    console.error('Failed to fetch Sonarr queue:', error)
    throw new Error('Failed to fetch Sonarr queue')
  }
}

export async function fetchTdarrQueue() {
  if (!tdarrURL || !tdarrAPIKey) {
    throw new Error('Tdarr URL or API key not configured')
  }
  try {
    const tdarrQueue = await axios.get(`${tdarrURL}/api/v2/get-nodes?apikey=${tdarrAPIKey}`)
    return tdarrQueue.data
  } catch (error) {
    console.error('Failed to fetch Tdarr queue:', error)
    throw new Error('Failed to fetch Tdarr queue')
  }
}

export async function fetchSABNZBDQueue() {
  if (!sabnzbdURL || !sabnzbdAPIKey) {
    throw new Error('SABNZBD URL or API key not configured')
  }
  try {
    const sabnzbdQueue = await axios.get(`${sabnzbdURL}/api?mode=queue&apikey=${sabnzbdAPIKey}`)
    return sabnzbdQueue.data
  } catch (error) {
    console.error('Failed to fetch SABNZBD queue:', error)
    throw new Error('Failed to fetch SABNZBD queue')
  }
}
