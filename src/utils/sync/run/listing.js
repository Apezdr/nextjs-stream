/**
 * What each file server has, by key only: its movie titles, its show titles
 * and, per show, every season key with its episode keys. No entry data.
 *
 * Pre-tag, post-sync cleanup's no-server-data guard and the missing-media
 * report need to know WHICH titles, seasons and episodes a server has, never
 * what is in them. Reading those keys from a listing instead of from the
 * payloads lets a tick hand the pass only the titles it has to sync, while
 * these three still see the whole library of every server that answered.
 * Listings come from the manifests (listingOfManifests below).
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
 * folder of the same name, which has therefore never been synced; the manifest
 * reader (run/manifestSource) leaves that name out too, until Step P removes
 * the payload route.
 */
export const LIST_VERSION_KEY = 'version'

/**
 * The listing of one server from its two manifests (run/manifestSource), which
 * already hold every title with its season and episode keys.
 *
 * @param {{ titles: Map<string, Object> }} tvManifest
 * @param {{ titles: Map<string, Object> }} moviesManifest
 * @returns {ServerListing}
 */
export function listingOfManifests(tvManifest, moviesManifest) {
  return {
    movies: new Set(moviesManifest.titles.keys()),
    tv: new Map([...tvManifest.titles].map(([title, record]) => [title, record.seasons])),
  }
}

