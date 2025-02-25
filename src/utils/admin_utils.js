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

// Define concurrency limit
const CONCURRENCY_LIMIT = 900; // Adjust based on your system's capacity
const limit = pLimit(CONCURRENCY_LIMIT);

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
  if (!metadataUrl) {
    return {};
  }

  try {
    const cachedEntry = await getCache(cacheKey);

    if (cachedEntry) {
      if (cachedEntry?.etag) {
        headers['If-None-Match'] = cachedEntry.etag;
      }
      if (cachedEntry.lastModified) {
        headers['If-Modified-Since'] = cachedEntry.lastModified;
      }
    }

    // Get the URL handler for this server
    const handler = multiServerHandler.getHandler(serverId);
    
    // Strip any existing paths and create the full URL
    const strippedPath = handler.stripPrefixPath(metadataUrl);
    const normalizedUrl = handler.createFullURL(strippedPath);

    // If it's incorrectly normalized we can tell by two http in the URL ex. http://test.com/media/http://
    const matches = normalizedUrl.match(/https?:\/\//g);
    if (matches && matches.length > 1) {
      throw new Error('URL is incorrectly normalized; likely caused by incorrect server source in sync.', normalizedUrl);
    }

    // Define the fetch function using the httpGet helper
    const fetchFunction = async () => {
      const { data, headers: responseHeaders } = await httpGet(normalizedUrl, {
        headers,
        timeout: 5000, // Customize as needed
        responseType: type === 'blurhash' ? 'text' : 'json',
      });

      if (headers['If-None-Match'] === responseHeaders?.etag && data !== null) {
        console.warn('Potential Configuration issue on file host: ETag did not change but full data was returned.')
      }

      if (data === null && cachedEntry) {
        // Not Modified; return cached data
        return cachedEntry.data;
      }

      const processedData = type === 'blurhash' ? data.trim() : data;

      // Update cache with new ETag and Last-Modified
      // const newCacheEntry = {
      //   lastUpdated: new Date(data?.last_updated || '1970-01-01'),
      // };
      
      await setCache(
        cacheKey,
        processedData, // Pass only the actual metadata here
        responseHeaders?.etag ?? cachedEntry?.etag ?? null, // Use the new ETag if available
        responseHeaders['last-modified'] || cachedEntry?.lastModified,
        3600 // TTL of 1 hour
      );      

      return processedData;
    };

    // Use concurrency limiter and retry logic
    const data = await limit(() => fetchWithRetry(fetchFunction));

    return data;
  } catch (error) {
    console.error('Error fetching metadata:', {
      serverId,
      url: metadataUrl,
      error: error.message,
      mediaType,
      title
    });
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
