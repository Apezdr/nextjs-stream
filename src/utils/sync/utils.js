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

      if (value instanceof Date) {
        result[fullPath] = value
      } else if (
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
 * Filters locked fields from update data while preserving object structure.
 * Unlike filterLockedFields, this function preserves the nested structure of objects
 * instead of flattening them with dot notation, making it suitable for MongoDB $set operations
 * that need to replace entire objects.
 * 
 * @param {Object} existingDoc - Existing document
 * @param {Object} updateData - Update data
 * @returns {Object} Filtered update data with preserved structure
 */
export function filterLockedFieldsPreserveStructure(existingDoc, updateData) {
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

  function processStructured(obj, path = '') {
    const resultObj = {}
    let hasValues = false

    for (const key in obj) {
      const value = obj[key]
      const fullPath = path ? `${path}.${key}` : key

      if (isFieldLocked(fullPath)) continue

      // Special handling for Date objects - treat them as primitive values
      if (value instanceof Date) {
        resultObj[key] = value
        hasValues = true
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const processedChild = processStructured(value, fullPath)
        if (Object.keys(processedChild).length > 0) {
          resultObj[key] = processedChild
          hasValues = true
        }
      } else {
        resultObj[key] = value
        hasValues = true
      }
    }

    return hasValues ? resultObj : {}
  }

  return processStructured(updateData)
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
  // Handle edge case where mediaTitle is undefined (for legacy sync compatibility)
  if (!mediaTitle) {
    console.warn(`⚠️ isCurrentServerHighestPriorityForField: mediaTitle is undefined for ${fieldPath}, returning false`)
    return false
  }
  
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
 * The servers that reported a field for a title this run.
 *
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {string} mediaType - 'movies' or 'tv'
 * @param {string} mediaTitle - originalTitle (the filesystem key)
 * @param {string} fieldPath - Exact leaf path, as collectFieldAvailability builds it
 * @returns {string[]} Server ids; empty when no server reported it
 */
export function getServersReportingField(fieldAvailability, mediaType, mediaTitle, fieldPath) {
  const reporters = fieldAvailability?.[mediaType]?.[mediaTitle]?.[fieldPath]
  return Array.isArray(reporters) ? reporters : []
}

/**
 * Every server that reported anything at all for a title this run.
 *
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {string} mediaType - 'movies' or 'tv'
 * @param {string} mediaTitle - originalTitle (the filesystem key)
 * @returns {string[]} Server ids; empty when no server has the title
 */
export function getServersReportingTitle(fieldAvailability, mediaType, mediaTitle) {
  const bucket = fieldAvailability?.[mediaType]?.[mediaTitle]
  if (!bucket || typeof bucket !== 'object') return []
  const servers = new Set()
  for (const reporters of Object.values(bucket)) {
    if (Array.isArray(reporters)) for (const id of reporters) servers.add(id)
  }
  return [...servers]
}

/**
 * Whether a server is the one that owns a value, given the servers that have it.
 *
 * The owner is the server with the lowest priority number AMONG THOSE THAT HAVE
 * THE VALUE. A server that is not in the list never owns it, whatever its
 * priority: `isCurrentServerHighestPriorityForField` above answers true for a
 * higher-priority server that does not have the field at all, which let a
 * folder with no video on the main server wipe the video another server
 * supplies, on every run.
 *
 * Two servers configured with the same priority are separated by id, so the
 * answer never depends on which of them syncs first.
 *
 * @param {string[]} serverIds - Servers that have the value
 * @param {{id: string, priority: number}} serverConfig - The server being synced
 * @returns {boolean}
 */
export function isHighestPriorityAmongServers(serverIds, serverConfig) {
  if (!serverConfig?.id || !Array.isArray(serverIds) || !serverIds.includes(serverConfig.id)) {
    return false
  }

  for (const serverId of serverIds) {
    if (serverId === serverConfig.id) continue
    let other
    try {
      other = getServer(serverId)
    } catch {
      other = null
    }
    // A reporter that is not a configured server cannot outrank one that is.
    if (!other || !Number.isFinite(other.priority)) continue
    if (other.priority < serverConfig.priority) return false
    if (other.priority === serverConfig.priority && String(serverId) < String(serverConfig.id)) {
      return false
    }
  }
  return true
}

/**
 * Whether the server being synced outranks another server: a lower priority
 * number, or the same number and the lower id. False for an id that is not a
 * configured server (a removed server, or a marker such as 'backfill').
 *
 * @param {{id: string, priority: number}} serverConfig - The server being synced
 * @param {string} otherServerId
 * @returns {boolean}
 */
export function serverOutranks(serverConfig, otherServerId) {
  if (!serverConfig?.id || !otherServerId || otherServerId === serverConfig.id) return false
  let other
  try {
    other = getServer(otherServerId)
  } catch {
    other = null
  }
  if (!other || !Number.isFinite(other.priority)) return false
  if (serverConfig.priority !== other.priority) return serverConfig.priority < other.priority
  return String(serverConfig.id) < String(otherServerId)
}

/**
 * A short, stable fingerprint of WHO HAS WHAT for one title this run: every
 * field path any server reported for it, the servers reporting each, and those
 * servers' priorities.
 *
 * It is the second half of the skip decision. A server's payload hash says
 * whether that server's own data changed. What the server must write also
 * depends on which fields it owns, and that changes when ANOTHER server gains
 * or loses a field: the server that owned the video deletes its file, and the
 * one that now has to supply it has a payload that did not change at all.
 * Skipping on the payload hash alone left that title without a video until the
 * second server's own data happened to change.
 *
 * Not cryptographic; it only has to change when the picture does.
 *
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {string} mediaType - 'movies' or 'tv'
 * @param {string} mediaTitle - originalTitle (the filesystem key)
 * @returns {string} 16 hex characters
 */
export function availabilityFingerprint(fieldAvailability, mediaType, mediaTitle) {
  const bucket = fieldAvailability?.[mediaType]?.[mediaTitle]
  if (!bucket || typeof bucket !== 'object') return fingerprintPaths({}, [])
  return fingerprintPaths(bucket, sortedPathsOf(bucket))
}

/**
 * The same fingerprint for the part of a title under one path prefix — one
 * episode of a show (`seasons.Season 1.episodes.S01E03.`). An episode's gate
 * must not move because a different episode of the show was added or removed.
 *
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {string} mediaType - 'movies' or 'tv'
 * @param {string} mediaTitle - originalTitle (the filesystem key)
 * @param {string} prefix - Path prefix, including its trailing dot
 * @returns {string} 16 hex characters
 */
export function availabilityFingerprintForPrefix(fieldAvailability, mediaType, mediaTitle, prefix) {
  const bucket = fieldAvailability?.[mediaType]?.[mediaTitle]
  if (!bucket || typeof bucket !== 'object' || !prefix) return fingerprintPaths({}, [])

  // The paths are sorted once per title per run; an episode's slice is the run
  // of paths starting at its prefix.
  const paths = sortedPathsOf(bucket)
  let low = 0
  let high = paths.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (paths[mid] < prefix) low = mid + 1
    else high = mid
  }
  const slice = []
  for (let i = low; i < paths.length && paths[i].startsWith(prefix); i++) slice.push(paths[i])
  return fingerprintPaths(bucket, slice)
}

/**
 * A short fingerprint of a piece of file-server payload, exactly as it was
 * received and applied.
 *
 * The third part of the skip decision. The file server's own hash for a title
 * is fetched separately from the payload — for episodes, minutes later — and a
 * scan can commit in between. The sync then stamps the NEW hash on documents
 * built from the OLD payload, and the next run, seeing that hash again, skips
 * the title: it stays on the old data until something else changes it. Keeping
 * a fingerprint of the payload that was actually applied closes that: the next
 * run's payload is different, so it is not skipped. It also covers any field a
 * file server publishes but leaves out of its hash.
 *
 * The payload is built from stored rows with nothing time-dependent in it, so
 * an unchanged title serialises identically from one request to the next.
 *
 * @param {unknown} payload
 * @returns {string} 16 hex characters
 */
export function payloadFingerprint(payload) {
  const text = JSON.stringify(payload === undefined ? null : payload)
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ code, 0x811c9dc5) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/**
 * The same fingerprint over several prefixes at once. One episode has several
 * when two servers name its season folder differently ("Season 1" on one,
 * "Season 01" on the other): each server's leaves sit under its own folder
 * name, and together they are the picture for that episode.
 *
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {string} mediaType - 'movies' or 'tv'
 * @param {string} mediaTitle - originalTitle (the filesystem key)
 * @param {string[]} prefixes - Path prefixes, each including its trailing dot
 * @returns {string} 16 hex characters
 */
export function availabilityFingerprintForPrefixes(fieldAvailability, mediaType, mediaTitle, prefixes) {
  const bucket = fieldAvailability?.[mediaType]?.[mediaTitle]
  if (!bucket || typeof bucket !== 'object' || !Array.isArray(prefixes) || prefixes.length === 0) {
    return fingerprintPaths({}, [])
  }
  const paths = sortedPathsOf(bucket)
  const slice = []
  for (const prefix of [...new Set(prefixes)].sort()) {
    let low = 0
    let high = paths.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (paths[mid] < prefix) low = mid + 1
      else high = mid
    }
    for (let i = low; i < paths.length && paths[i].startsWith(prefix); i++) slice.push(paths[i])
  }
  return fingerprintPaths(bucket, slice)
}

/**
 * A show's seasons as the servers report them: for each season NUMBER, the
 * literal season keys in use (one per distinct folder name) and the episode
 * keys seen under any of them.
 *
 * Ownership of a season's or an episode's field has to be ranked across every
 * server that has that season, and two servers do not have to agree on what
 * its folder is called. Read from the availability map, whose paths begin with
 * the literal key each server sent.
 *
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {string} showTitle - The show's originalTitle
 * @returns {Map<number, {keys: string[], episodes: Set<string>}>}
 */
export function seasonsAcrossServers(fieldAvailability, showTitle) {
  const bucket = fieldAvailability?.tv?.[showTitle]
  if (!bucket || typeof bucket !== 'object') return new Map()
  let index = seasonIndexCache.get(bucket)
  if (index) return index

  index = new Map()
  const SEASON_FIELD = /\.(episodes|lengths|dimensions|season_poster|seasonPosterBlurhash|seasonNumber)(\.|$)/
  for (const path of sortedPathsOf(bucket)) {
    if (!path.startsWith('seasons.')) continue
    const rest = path.slice('seasons.'.length)
    const end = rest.search(SEASON_FIELD)
    if (end <= 0) continue
    const seasonKey = rest.slice(0, end)
    const number = seasonKey.match(/(?:season_?|s)?(\d+)/i)
    if (!number) continue
    const seasonNumber = parseInt(number[1], 10)

    let season = index.get(seasonNumber)
    if (!season) {
      season = { keys: [], episodes: new Set() }
      index.set(seasonNumber, season)
    }
    if (!season.keys.includes(seasonKey)) season.keys.push(seasonKey)

    const afterKey = rest.slice(end + 1)
    if (afterKey.startsWith('episodes.')) {
      const episodeKey = afterKey.slice('episodes.'.length).split('.')[0]
      if (episodeKey) season.episodes.add(episodeKey)
    }
  }
  seasonIndexCache.set(bucket, index)
  return index
}
const seasonIndexCache = new WeakMap()

// One sorted path list per availability bucket. The bucket is built once per
// run and never mutated afterwards, so it can key the cache.
const sortedPathsCache = new WeakMap()
function sortedPathsOf(bucket) {
  let paths = sortedPathsCache.get(bucket)
  if (!paths) {
    paths = Object.keys(bucket).sort()
    sortedPathsCache.set(bucket, paths)
  }
  return paths
}

function fingerprintPaths(bucket, paths) {
  const serverIds = new Set()

  // Two independent 32-bit FNV-1a passes (different offsets) → 64 bits.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const mix = (text) => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
      h2 = Math.imul(h2 ^ code, 0x811c9dc5) >>> 0
    }
  }

  for (const path of paths) {
    const reporters = Array.isArray(bucket[path]) ? [...bucket[path]].map(String).sort() : []
    for (const id of reporters) serverIds.add(id)
    mix(`${path}=>${reporters.join(',')};`)
  }
  for (const id of [...serverIds].sort()) {
    let priority
    try {
      priority = getServer(id)?.priority
    } catch {
      priority = undefined
    }
    mix(`${id}@${priority};`)
  }

  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/**
 * Checks priority only when the availability map confirms that the current
 * server reported the exact field path. Unlike the legacy helper above, a
 * missing path fails closed instead of being treated as unclaimed data.
 */
export function isCurrentServerHighestPriorityForReportedField(
  fieldAvailability,
  mediaType,
  mediaTitle,
  fieldPath,
  serverConfig
) {
  if (!mediaTitle || !serverConfig?.id) return false
  return isHighestPriorityAmongServers(
    getServersReportingField(fieldAvailability, mediaType, mediaTitle, fieldPath),
    serverConfig
  )
}

/**
 * Check one logical field that can be represented by several equivalent leaf
 * paths. The current server must report at least one exact path; ownership is
 * then calculated across every server reporting any equivalent path.
 */
export function isCurrentServerHighestPriorityForReportedFieldGroup(
  fieldAvailability,
  mediaType,
  mediaTitle,
  fieldPaths,
  serverConfig
) {
  if (!mediaTitle || !serverConfig?.id || !Array.isArray(fieldPaths)) return false
  const reporters = [
    ...new Set(
      fieldPaths.flatMap((fieldPath) =>
        getServersReportingField(fieldAvailability, mediaType, mediaTitle, fieldPath)
      )
    ),
  ]
  return isHighestPriorityAmongServers(reporters, serverConfig)
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
      // Auto-generated caption URLs come from the processor as absolute URLs
      // (in both pending and completed states), so skip createFullUrl for them
      // — otherwise the server baseURL gets prepended to an already-absolute URL.
      url: subtitleData.autoGenerated
        ? subtitleData.url
        : createFullUrl(subtitleData.url, serverConfig),
      lastModified: subtitleData.lastModified,
      sourceServerId: serverConfig.id,
      ...(subtitleData.autoGenerated ? { autoGenerated: true } : {}),
      ...(subtitleData.pending ? { pending: true } : {}),
    }
    return acc
  }, {})

  return Object.fromEntries(sortSubtitleEntries(Object.entries(subtitleURLs)))
}

/**
 * Extracts the ?hash= query parameter from a file server URL.
 *
 * File server image URLs carry a content hash for cache-busting and change detection,
 * e.g. /tv/Show/Season 1/poster.jpg?hash=7536e29eee
 *
 * Used to skip blurhash fetches when the underlying image file has not changed:
 * if extractUrlHash(newImageUrl) === extractUrlHash(existingEntityUrl) → image unchanged.
 *
 * @param {string} url - Full URL or relative path including optional query string
 * @returns {string|null} Value of the ?hash= param, or null if absent/invalid
 */
export function extractUrlHash(url) {
  if (!url) return null
  try {
    return new URL(url).searchParams.get('hash')
  } catch {
    return null
  }
}
