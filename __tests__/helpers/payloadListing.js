/**
 * A frozen copy of the listing the sync built from whole payloads before it
 * read manifests (run/listing's listingOfPayload, slice 1 of T4b). The tests
 * keep it as the reference the manifest listings are compared with: it applies
 * the processor's manifest rule (tvManifestKeys) to a payload body.
 */

const LIST_VERSION_KEY = 'version'

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

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

/** One server's payloads (`{ movies, tv }`) → `{ movies: Set, tv: Map<show, Map<season, episodeKeys>> }`. */
function listingOfPayload(fileServer) {
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

/** Every server's listing, in the order of `fileServers`. */
function listingsOfFileServers(fileServers) {
  return new Map(Object.entries(fileServers || {}).map(([serverId, fileServer]) => [serverId, listingOfPayload(fileServer)]))
}

module.exports = { listingOfPayload, listingsOfFileServers, seasonKeysOf }
