import { getServer, multiServerHandler } from '@src/utils/config'

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
