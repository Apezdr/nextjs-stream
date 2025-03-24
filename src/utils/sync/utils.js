import { getServer, multiServerHandler } from '@src/utils/config'
import { sortSubtitleEntries } from './captions'

export const MediaType = {
  TV: 'tv',
  MOVIE: 'movie',
  MOVIES: 'movies',
}

// File Pattern Constants
const EPISODE_FILENAME_PATTERNS = [
  /S(\d+)E(\d+)(?:\s*-\s*(.+?))?(?:\s*-\s*.+?)?\.([^.]+)$/i, // Matches 'S01E01 - Title - Extra.mp4'
  /(\d+)(?:\s*-\s*(.+?))?\.([^.]+)$/i, // Matches '01 - Title.mp4'
  /(.+?)\s*-\s*S(\d+)E(\d+)(?:\s*-\s*(.+?))?(?:\s*-\s*.+?)?\.([^.]+)$/i, // Matches '1923 - S01E01 - Title - Extra.mp4'
]

/**
 * Creates a full URL by combining a file path with a server configuration.
 * @param {string} path - File path
 * @param {Object} serverConfig - Server configuration
 * @returns {string} Full URL
 */
export function createFullUrl(path, serverConfig) {
  const handler = multiServerHandler.getHandler(serverConfig.id)
  return handler.createFullURL(path, false)
}

/**
 * Filters locked fields from update data.
 * @param {Object} existingDoc - Existing document
 * @param {Object} updateData - Update data
 * @returns {Object} Filtered update data
 */
export function filterLockedFields(existingDoc, updateData) {
  const lockedFields = existingDoc.lockedFields || {}
  const result = {}

  function isFieldLocked(fieldPath) {
    const parts = fieldPath.split('.')
    let current = lockedFields

    for (const part of parts) {
      if (current[part] === true) {
        return true
      } else if (typeof current[part] === 'object' && current[part] !== null) {
        current = current[part]
      } else {
        return false
      }
    }
    return false
  }

  function process(obj, path = '', existingObj = existingDoc) {
    for (const key in obj) {
      const value = obj[key]
      const fullPath = path ? `${path}.${key}` : key

      if (isFieldLocked(fullPath)) continue

      const existingValue = existingObj ? existingObj[key] : undefined

      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value) &&
        (existingValue === null || typeof existingValue !== 'object')
      ) {
        result[fullPath] = value
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        process(value, fullPath, existingValue)
      } else {
        result[fullPath] = value
      }
    }
  }

  process(updateData)
  return result
}

/**
 * Checks if source matches server.
 * @param {Object} item - Media item
 * @param {string} sourceKey - Source key
 * @param {Object} serverConfig - Server configuration
 * @returns {boolean} True if source matches
 */
export const isSourceMatchingServer = (item, sourceKey, serverConfig) => {
  if (!item || !sourceKey || !serverConfig?.id) {
    return false
  }

  return item[sourceKey] && item[sourceKey] === serverConfig.id
}

/**
 * Checks if current server has highest priority for field.
 * @param {Object} fieldAvailability - Field availability
 * @param {string} mediaType - Media type
 * @param {string} mediaTitle - Media title
 * @param {string} fieldPath - Field path
 * @param {Object} serverConfig - Server configuration
 * @returns {boolean} True if highest priority
 */
export function isCurrentServerHighestPriorityForField(
  fieldAvailability,
  mediaType,
  mediaTitle,
  fieldPath,
  serverConfig
) {
  const serversWithData = fieldAvailability[mediaType][mediaTitle]?.[fieldPath] || []
  if (serversWithData.length === 0) {
    return true
  }

  const highestPriority = serversWithData.reduce((minPriority, serverId) => {
    const server = getServer(serverId)
    if (!server) return minPriority
    return Math.min(minPriority, server.priority)
  }, Infinity)

  return serverConfig.priority <= highestPriority
}

/**
 * Checks if a field exists across any servers for a specific media item.
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {string} mediaType - Media type (tv, movie)
 * @param {string} mediaTitle - Media title identifier
 * @param {string} fieldPath - Field path to check
 * @returns {boolean} True if field exists on any server
 */
export function doesFieldExistAcrossServers(
  fieldAvailability,
  mediaType,
  mediaTitle,
  fieldPath
) {
  const serversWithData = fieldAvailability[mediaType][mediaTitle]?.[fieldPath] || []
  return serversWithData.length > 0 ? true : false
}

/**
 * Finds episode filename matching season and episode numbers.
 * @param {string[]} fileNames - File names
 * @param {number} seasonNumber - Season number
 * @param {number} episodeNumber - Episode number
 * @returns {string|null} Matching filename or null
 */
export function findEpisodeFileName(fileNames, seasonNumber, episodeNumber) {
  return fileNames.find((fileName) => {
    const episodeNumberRegex = new RegExp(
      `(S?${seasonNumber.toString().padStart(2, '0')}E${episodeNumber.toString().padStart(2, '0')})|^${episodeNumber.toString().padStart(2, '0')}\\s?-`,
      'i'
    )
    return episodeNumberRegex.test(fileName)
  })
}

/**
 * Matches episode filename against patterns.
 * @param {string} filename - Filename
 * @returns {RegExpMatchArray|null} Match result or null
 */
export function matchEpisodeFileName(filename) {
  for (const pattern of EPISODE_FILENAME_PATTERNS) {
    const match = filename.match(pattern)
    if (match) return match
  }
  return null
}

/**
 * Extracts episode details from filename match.
 * @param {RegExpMatchArray|null} match - Match result
 * @returns {Object|null} Episode details or null
 */
export function extractEpisodeDetails(match) {
  if (!match) return null

  // Pattern 1: SxxExx
  if (match.length === 5 && match[1] && match[2]) {
    return {
      seasonNumber: parseInt(match[1]),
      episodeNumber: parseInt(match[2]),
      title: cleanEpisodeTitle(match[3]),
      extension: match[4],
    }
  }

  // Pattern 2: xx - Title
  if (match.length === 4 && match[1] && match[2]) {
    return {
      seasonNumber: null,
      episodeNumber: parseInt(match[1]),
      title: cleanEpisodeTitle(match[2]),
      extension: match[3],
    }
  }

  // Pattern 3: Title - SxxExx - Title - Extra
  if (match.length === 6 && match[2] && match[3]) {
    return {
      seasonNumber: parseInt(match[2]),
      episodeNumber: parseInt(match[3]),
      title: cleanEpisodeTitle(match[4]),
      extension: match[5],
    }
  }

  return null
}

/**
 * Cleans episode title.
 * @param {string} title - Episode title
 * @returns {string} Cleaned title
 */
function cleanEpisodeTitle(title) {
  return title ? title.replace(/(WEBRip|WEBDL|HDTV|Bluray|\d{3,4}p).*$/i, '').trim() : ''
}

/**
 * Processes caption URLs.
 * @param {Object} subtitlesData - Subtitles data
 * @param {Object} serverConfig - Server configuration
 * @returns {Object|null} Processed caption URLs or null
 */
export function processCaptionURLs(subtitlesData, serverConfig) {
  if (!subtitlesData) return null

  const subtitleURLs = Object.entries(subtitlesData).reduce((acc, [langName, subtitleData]) => {
    acc[langName] = {
      srcLang: subtitleData.srcLang,
      url: createFullUrl(subtitleData.url, serverConfig),
      lastModified: subtitleData.lastModified,
      sourceServerId: serverConfig.id,
    }
    return acc
  }, {})

  return Object.fromEntries(sortSubtitleEntries(Object.entries(subtitleURLs)))
}
