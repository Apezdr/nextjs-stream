import axios from 'axios'
import { buildURL, getFullImageUrl } from '@src/utils'
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
        buildURL(`/sorry-image-not-available.jpg`)

      return {
        id: movie._id.toString(),
        posterURL: poster,
        title:
          movie.title === movie.metadata?.title
            ? movie.metadata?.title
            : movie.title + ` (${movie.metadata?.title})` || movie.title,
        genre: movie.metadata?.genres.map((genre) => genre.name).join(', '),
        year: movie.metadata?.release_date ? movie.metadata.release_date.getFullYear() : 'N/A',
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
 * Normalizes a metadata URL using the appropriate server configuration
 * @param {string} url - The metadata URL to normalize
 * @param {Object} serverConfig - Server configuration
 * @returns {string} The normalized URL
 */
function normalizeMetadataURL(url, serverConfig) {
  if (!url) return ''
  
  const handler = multiServerHandler.getHandler(serverConfig.id)
  
  // First strip any existing prefix paths or base URLs
  const strippedPath = handler.stripPrefixPath(url)
  
  // Remove any leading slashes
  const cleanPath = strippedPath.replace(/^\/+/, '')
  
  // Create the full URL with the correct prefix path
  return handler.createFullURL(cleanPath)
}

/**
 * Cache implementation for metadata
 */
class MetadataCache {
  constructor() {
    this.cache = new Map()
  }

  getKey(type, url, serverId) {
    return `${serverId}:${type}:${url}`
  }

  get(type, url, serverId) {
    return this.cache.get(this.getKey(type, url, serverId))
  }

  set(type, url, serverId, value) {
    this.cache.set(this.getKey(type, url, serverId), value)
  }

  has(type, url, serverId) {
    return this.cache.has(this.getKey(type, url, serverId))
  }

  clear() {
    this.cache.clear()
  }
}

// Create a singleton instance of the cache
export const metadataCache = new MetadataCache()

/**
 * When using multiple file servers, this version of fetchMetadata can be used
 * @param {string} serverId - The ID of the file server to fetch from
 * @param {string} metadataUrl - The URL to fetch metadata from
 * @param {'file'|'blurhash'} type - The type of metadata being fetched
 * @param {'tv'|'movie'} mediaType - The type of media
 * @param {string} title - The title of the media
 */
export async function fetchMetadataMultiServer(serverId, metadataUrl, type = 'file', mediaType, title) {
  if (!metadataUrl) {
    return {}
  }

  try {
    const cacheKey = `${serverId}:${type}:${metadataUrl}`
    const lastUpdated = await getLastUpdatedTimestamp({ type: mediaType, title })

    // Check cache
    if (metadataCache.has(cacheKey)) {
      const cachedData = metadataCache.get(cacheKey)
      if (cachedData.lastUpdated === lastUpdated) {
        return cachedData.data
      }
    }

    // Get the URL handler for this server
    const handler = multiServerHandler.getHandler(serverId)
    
    // Strip any existing paths and create the full URL
    const strippedPath = handler.stripPrefixPath(metadataUrl)
    const normalizedUrl = handler.createFullURL(strippedPath)

    // Fetch the data
    const response = await axios.get(normalizedUrl)
    const data = type === 'blurhash' ? response.data.trim() : response.data

    // Cache the result
    metadataCache.set(cacheKey, { data, lastUpdated })

    return data
  } catch (error) {
    console.error('Error fetching metadata:', {
      serverId,
      url: metadataUrl,
      error: error.message,
      mediaType,
      title
    })
    return false
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
