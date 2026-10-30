/**
 * The credits catalog: what the "Credits & licenses" menu item and page show
 * (CREDITS_SIDECAR.md, section 8).
 *
 *  - The library's credits: each enabled server's library-root file
 *    (run/libraryCredits), in server priority order, shared files once.
 *  - The credited titles: every movie, show and episode with credits it can
 *    show, among the titles the lists show (src/utils/mediaVisibility). A
 *    show is listed when it has credits of its own or any of its episodes
 *    does, with those episodes named, so episode-only credits can be found.
 *    Only titles: the credits themselves stay on the title pages.
 *
 * A user with limited access sees no titles anywhere, so they get the
 * library's credits only: no title, and no count of titles.
 *
 * Read on every menu render, so it is kept in memory for a short while (the
 * same for every user of one access level). A failed read is never kept and
 * never reads as "no credits": it throws.
 */

import clientPromise from '@src/lib/mongodb'
import { getAllServers } from '@src/utils/config'
import { visibleEpisodeFilter, visibleMovieFilter, visibleShowFilter } from '@src/utils/mediaVisibility'
import { LIBRARY_CREDITS_COLLECTION } from './constants'
import { resolveEpisodeCredits, resolveLibraryCredits, resolveTitleCredits } from './resolve'

/** How long a catalog is reused, in milliseconds. */
export const CATALOG_TTL_MS = 30_000

/** Documents with a credits file (the repositories' partial `credits_index`). */
const HAS_CREDITS = { 'credits.schemaVersion': 1 }

const cache = new Map()

/**
 * The catalog for a user's access level.
 *
 * @param {{ includeTitles: boolean }} access - false for a user with limited access
 * @returns {Promise<{ library: object|null, titles: Array<object> }>}
 */
export async function getCreditsCatalog({ includeTitles }) {
  const key = includeTitles ? 'full' : 'library'
  const held = cache.get(key)
  if (held && (held.pending || Date.now() - held.at < CATALOG_TTL_MS)) return held.pending ?? held.value

  const pending = (async () => {
    const db = (await clientPromise).db('Media')
    const [library, titles] = await Promise.all([loadLibraryCredits(db), includeTitles ? loadCreditedTitles(db) : []])
    return { library, titles }
  })()
  cache.set(key, { pending })
  try {
    const value = await pending
    cache.set(key, { value, at: Date.now() })
    return value
  } catch (error) {
    cache.delete(key)
    throw error
  }
}

/**
 * Whether the menu item shows, and why, without any title: cheap enough for
 * every page.
 *
 * @param {{ includeTitles: boolean }} access
 * @returns {Promise<{ available: boolean, library: boolean, titles: number }>}
 */
export async function getCreditsAvailability(access) {
  const { library, titles } = await getCreditsCatalog(access)
  return { available: Boolean(library) || titles.length > 0, library: Boolean(library), titles: titles.length }
}

/**
 * Each server's library credits record, for admins: what is stored and, while
 * the last attempt failed, why. Read fresh, never kept.
 *
 * @returns {Promise<Array<{ _id: string, credits?: object, creditsSource?: string, creditsHash?: string, creditsStatus?: object }>>}
 */
export async function getLibraryCreditsRecords() {
  const db = (await clientPromise).db('Media')
  return db
    .collection(LIBRARY_CREDITS_COLLECTION)
    .find({}, { projection: { credits: 1, creditsSource: 1, creditsHash: 1, creditsStatus: 1 } })
    .toArray()
}

/** Forget the kept catalogs (tests). */
export function clearCreditsCatalogCache() {
  cache.clear()
}

/** The enabled servers' library credits, in priority order (ties on id). */
async function loadLibraryCredits(db) {
  const servers = getAllServers()
    .filter((server) => server && server.enabled !== false)
    .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity) || String(a.id).localeCompare(String(b.id)))
  if (servers.length === 0) return null
  const order = new Map(servers.map((server, index) => [server.id, index]))
  const docs = await db
    .collection(LIBRARY_CREDITS_COLLECTION)
    .find({ _id: { $in: [...order.keys()] }, ...HAS_CREDITS }, { projection: { credits: 1, creditsHash: 1 } })
    .toArray()
  docs.sort((a, b) => order.get(a._id) - order.get(b._id))
  return resolveLibraryCredits(docs)
}

/**
 * Every visible movie and show with credits to show, by display title: a
 * show with its credited episodes (their own files; inherited credits are
 * the show's, found on the show).
 */
async function loadCreditedTitles(db) {
  const titleProjection = { projection: { title: 1, originalTitle: 1, credits: 1 } }
  const [movies, shows, episodes] = await Promise.all([
    db.collection('FlatMovies').find({ $and: [HAS_CREDITS, visibleMovieFilter()] }, titleProjection).toArray(),
    db.collection('FlatTVShows').find({ $and: [HAS_CREDITS, visibleShowFilter()] }, titleProjection).toArray(),
    db
      .collection('FlatEpisodes')
      .find(
        { $and: [HAS_CREDITS, visibleEpisodeFilter()] },
        { projection: { showId: 1, seasonNumber: 1, episodeNumber: 1, title: 1, credits: 1 } }
      )
      .toArray(),
  ])

  const episodesByShow = new Map()
  // Each show id as stored (an ObjectId), by its string, to look a show up by.
  const storedShowIds = new Map()
  for (const episode of episodes) {
    if (!episode.showId || !resolveEpisodeCredits(null, episode.credits)) continue
    const key = String(episode.showId)
    storedShowIds.set(key, episode.showId)
    if (!episodesByShow.has(key)) episodesByShow.set(key, [])
    episodesByShow.get(key).push({
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      title: episode.title || null,
    })
  }

  const showsById = new Map(shows.map((show) => [String(show._id), show]))
  // The shows of credited episodes that have no credits of their own
  const missing = [...storedShowIds].filter(([key]) => !showsById.has(key)).map(([, id]) => id)
  if (missing.length > 0) {
    const more = await db
      .collection('FlatTVShows')
      .find({ $and: [{ _id: { $in: missing } }, visibleShowFilter()] }, { projection: { title: 1, originalTitle: 1 } })
      .toArray()
    for (const show of more) showsById.set(String(show._id), show)
  }

  const items = []
  for (const movie of movies) {
    if (!resolveTitleCredits(movie.credits)) continue
    items.push({ type: 'movie', id: String(movie._id), title: movie.title || movie.originalTitle, originalTitle: movie.originalTitle })
  }
  for (const [id, show] of showsById) {
    const hasCredits = Boolean(resolveTitleCredits(show.credits))
    const credited = (episodesByShow.get(id) ?? []).sort(
      (a, b) => (a.seasonNumber ?? 0) - (b.seasonNumber ?? 0) || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)
    )
    if (!hasCredits && credited.length === 0) continue
    items.push({ type: 'tv', id, title: show.title || show.originalTitle, originalTitle: show.originalTitle, hasCredits, episodes: credited })
  }
  return items.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }))
}
