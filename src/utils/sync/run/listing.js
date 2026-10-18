/**
 * What each file server has, by key only: its movie titles, its show titles
 * and, per show, every season key with its episode keys. No entry data.
 *
 * Pre-tag, post-sync cleanup's no-server-data guard and the missing-media
 * report need to know WHICH titles, seasons and episodes a server has, never
 * what is in them. Reading those keys from a listing instead of from the
 * payloads lets a tick hand the pass only the titles it has to sync, while
 * these three still see the whole library of every server that answered.
 *
 * Every title-keyed structure here is a Set or a Map, so any folder name is a
 * key (`__proto__`, `constructor` included). A listing never reaches the pass
 * or fieldAvailability: it has no entries to sync.
 *
 * @typedef {Object} ServerListing
 * @property {Set<string>} movies - Movie folder names
 * @property {Map<string, Map<string, string[]>>} tv - Show folder name → season
 *   key → episode keys, as the server sends them
 */

/**
 * The key of the list version in a `GET /media/<kind>` body. It shadows a
 * folder of the same name, which is therefore not synced (fetchAllServerData
 * deletes the key); a listing leaves that name out too.
 */
const LIST_VERSION_KEY = 'version'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * A show's season keys, each with its episode keys, by the processor's own
 * rule for its manifest (tvManifestKeys in the processor's lib/mediaManifest):
 * a season whose value is not an object, or has no `episodes` object, lists no
 * episodes; `seasons` that is not an object lists no seasons.
 *
 * @param {Object} showData - One show's payload entry
 * @returns {Map<string, string[]>}
 */
function seasonKeysOf(showData) {
  const seasons = new Map()
  const raw = showData?.seasons
  if (!isPlainObject(raw)) return seasons
  for (const [seasonKey, season] of Object.entries(raw)) {
    if (season === undefined) continue
    const episodes = isPlainObject(season) ? season.episodes : undefined
    seasons.set(
      seasonKey,
      isPlainObject(episodes) ? Object.keys(episodes).filter((episodeKey) => episodes[episodeKey] !== undefined) : []
    )
  }
  return seasons
}

/**
 * The listing of one server's payloads (`{ movies, tv }`, as fetchAllServerData
 * returns them).
 *
 * @param {Object} fileServer
 * @returns {ServerListing}
 */
export function listingOfPayload(fileServer) {
  const movies = new Set()
  for (const title of Object.keys(fileServer?.movies || {})) {
    if (title !== LIST_VERSION_KEY) movies.add(title)
  }
  const tv = new Map()
  for (const [title, showData] of Object.entries(fileServer?.tv || {})) {
    if (title !== LIST_VERSION_KEY) tv.set(title, seasonKeysOf(showData))
  }
  return { movies, tv }
}

/**
 * Every answering server's listing, in the order of `fileServers`.
 *
 * @param {Object} fileServers - Server id → `{ config, movies, tv }`
 * @returns {Map<string, ServerListing>}
 */
export function listingsOfFileServers(fileServers) {
  return new Map(Object.entries(fileServers || {}).map(([serverId, fileServer]) => [serverId, listingOfPayload(fileServer)]))
}
