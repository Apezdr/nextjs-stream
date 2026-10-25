import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { LIBRARY_LOOKUP_MAX, findLibraryTitlesByTmdbId } from '@src/utils/media/libraryByTmdbId'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const isTitle = (item) =>
  item !== null &&
  typeof item === 'object' &&
  Number.isInteger(item.tmdbId) &&
  item.tmdbId > 0 &&
  (item.mediaType === 'movie' || item.mediaType === 'tv')

/**
 * POST /api/authenticated/media/in-library
 * Body: { items: [{ tmdbId, mediaType }] }, at most LIBRARY_LOOKUP_MAX.
 * Answers { items } with the ones the library holds: id, title, posterURL and
 * link for each. The watchlist's search asks about the TMDB results it shows,
 * so a library title is offered as library media, not as a TMDB-only one.
 */
export const POST = async (req) => {
  const authResult = await isAuthenticatedAndApproved(req)
  if (authResult instanceof Response) return authResult

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'The body must be JSON' }, 400)
  }
  const items = body?.items
  if (!Array.isArray(items) || !items.every(isTitle)) {
    return json({ error: 'items must be a list of { tmdbId: positive integer, mediaType: "movie" | "tv" }' }, 400)
  }
  if (items.length > LIBRARY_LOOKUP_MAX) {
    return json({ error: `At most ${LIBRARY_LOOKUP_MAX} items per request` }, 400)
  }
  if (items.length === 0) return json({ items: [] })

  try {
    return json({ items: await findLibraryTitlesByTmdbId(items) })
  } catch (error) {
    console.error('Error looking up library titles by TMDB id:', error)
    return json({ error: 'Internal Server Error' }, 500)
  }
}
