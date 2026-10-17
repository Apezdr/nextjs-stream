import { getServer } from '@src/utils/config'

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
  fieldAvailability: any,
  mediaType: string,
  mediaTitle: string | undefined,
  fieldPath: string,
  serverConfig: any
): boolean {
  // Handle edge case where mediaTitle is undefined (for legacy sync compatibility)
  if (!mediaTitle) {
    console.warn(`⚠️ isCurrentServerHighestPriorityForField: mediaTitle is undefined for ${fieldPath}, returning false`)
    return false
  }
  
  const serversWithData = fieldAvailability[mediaType][mediaTitle]?.[fieldPath] || []
  if (serversWithData.length === 0) {
    return true
  }

  const highestPriority = serversWithData.reduce((minPriority: number, serverId: string) => {
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
export function getServersReportingField(fieldAvailability: any, mediaType: string, mediaTitle: string, fieldPath: string): string[] {
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
export function getServersReportingTitle(fieldAvailability: any, mediaType: string, mediaTitle: string): string[] {
  const bucket = fieldAvailability?.[mediaType]?.[mediaTitle]
  if (!bucket || typeof bucket !== 'object') return []
  const servers = new Set<string>()
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
export function isHighestPriorityAmongServers(serverIds: string[], serverConfig: any): boolean {
  if (!serverConfig?.id || !Array.isArray(serverIds) || !serverIds.includes(serverConfig.id)) {
    return false
  }

  for (const serverId of serverIds) {
    if (serverId === serverConfig.id) continue
    let other: any
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
export function serverOutranks(serverConfig: any, otherServerId: string): boolean {
  if (!serverConfig?.id || !otherServerId || otherServerId === serverConfig.id) return false
  let other: any
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
export function seasonsAcrossServers(
  fieldAvailability: any,
  showTitle: string
): Map<number, { keys: string[]; episodes: Set<string> }> {
  const bucket = fieldAvailability?.tv?.[showTitle]
  if (!bucket || typeof bucket !== 'object') return new Map()
  let index = seasonIndexCache.get(bucket)
  if (index) return index

  index = new Map<number, { keys: string[]; episodes: Set<string> }>()
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
const seasonIndexCache = new WeakMap<object, Map<number, { keys: string[]; episodes: Set<string> }>>()

// One sorted path list per availability bucket. The bucket is built once per
// run and never mutated afterwards, so it can key the cache.
const sortedPathsCache = new WeakMap<object, string[]>()
export function sortedPathsOf(bucket: any): string[] {
  let paths = sortedPathsCache.get(bucket)
  if (!paths) {
    paths = Object.keys(bucket).sort()
    sortedPathsCache.set(bucket, paths)
  }
  return paths
}

/**
 * Checks priority only when the availability map confirms that the current
 * server reported the exact field path. Unlike the legacy helper above, a
 * missing path fails closed instead of being treated as unclaimed data.
 */
export function isCurrentServerHighestPriorityForReportedField(
  fieldAvailability: any,
  mediaType: string,
  mediaTitle: string | undefined,
  fieldPath: string,
  serverConfig: any
): boolean {
  if (!mediaTitle || !serverConfig?.id) return false
  return isHighestPriorityAmongServers(
    getServersReportingField(fieldAvailability, mediaType, mediaTitle, fieldPath),
    serverConfig
  )
}
