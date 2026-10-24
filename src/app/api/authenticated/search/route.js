import clientPromise from '@src/lib/mongodb'
import { addCustomUrlToFlatMedia, getFlatRecentlyAddedMedia } from '@src/utils/flatDatabaseUtils'
import { visibleMovieFilter, visibleShowFilter } from '@src/utils/mediaVisibility'
import { movieProjectionFields, tvShowProjectionFields, sanitizeRecord } from '@src/utils/auth_utils'
import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { escapeRegex } from '@src/utils/escapeRegex'

/**
 * Search pages through its results like the lists do. A typed query used to
 * return every match at once: "the" was 336 results and 3.8 MB on the owner's
 * server, downloaded again on every pause while typing. Clients ask for
 * `page` (0-based) and `limit`, and get `total` and `hasNextPage` beside
 * `results`.
 */
export const SEARCH_LIMIT_DEFAULT = 30
export const SEARCH_LIMIT_MAX = 50
const PAGE_MAX = 10000

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Clamp instead of rejecting, as horizontal-list does, so a client with an odd value still gets a page.
function pageParams(page, limit) {
  const parsedPage = Number.parseInt(page, 10)
  const parsedLimit = Number.parseInt(limit, 10)
  return {
    page: Number.isNaN(parsedPage) ? 0 : Math.min(Math.max(parsedPage, 0), PAGE_MAX),
    limit: Number.isNaN(parsedLimit) ? SEARCH_LIMIT_DEFAULT : Math.min(Math.max(parsedLimit, 1), SEARCH_LIMIT_MAX),
  }
}

export const POST = async (req) => {
  const authResult = await isAuthenticatedAndApproved(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  let body
  try {
    body = await req.json()
  } catch {
    return json({ error: 'The body must be JSON' }, 400)
  }
  const { query = '', isTVdevice = false } = body ?? {}
  if (typeof query !== 'string') {
    return json({ error: 'query must be a string' }, 400)
  }
  const { page, limit } = pageParams(body?.page, body?.limit)

  try {
    const typed = query.trim()
    const { results, total } = typed
      ? await searchTitles(typed, page, limit, Boolean(isTVdevice))
      : await recentlyAdded(page, limit, Boolean(isTVdevice))
    return json({ results, total, hasNextPage: (page + 1) * limit < total })
  } catch (error) {
    console.error('Error during search:', error)
    return json({ error: 'Internal Server Error' }, 500)
  }
}

/**
 * One page of the movies and shows whose title contains the query, matched
 * literally and case-insensitively. Both collections are merged and ordered in
 * the database (titles that start with the query first, then A-Z, then _id),
 * so the pages never repeat or skip a title.
 */
async function searchTitles(query, page, limit, isTVdevice) {
  const client = await clientPromise
  const db = client.db('Media')
  const pattern = escapeRegex(query)

  const titles = (visibleFilter, projection, type) => [
    // $and because the visibility fragments carry a top-level $or
    { $match: { $and: [{ title: { $regex: pattern, $options: 'i' } }, visibleFilter] } },
    { $project: projection },
    { $addFields: { searchType: type } },
  ]
  const [{ items, total }] = await db
    .collection('FlatMovies')
    .aggregate([
      ...titles(visibleMovieFilter(), movieProjectionFields, 'movie'),
      { $unionWith: { coll: 'FlatTVShows', pipeline: titles(visibleShowFilter(), tvShowProjectionFields, 'tv') } },
      {
        $addFields: {
          startsWithQuery: { $regexMatch: { input: '$title', regex: `^${pattern}`, options: 'i' } },
          sortTitle: { $toLower: '$title' },
        },
      },
      { $sort: { startsWithQuery: -1, sortTitle: 1, _id: 1 } },
      {
        $facet: {
          items: [{ $skip: page * limit }, { $limit: limit }, { $project: { startsWithQuery: 0, sortTitle: 0 } }],
          total: [{ $count: 'count' }],
        },
      },
    ])
    .toArray()

  // Build context for TV devices to expose additional data
  const context = { shouldExposeAdditionalData: isTVdevice, isTVdevice }
  const results = await Promise.all(
    items.map(async ({ searchType, ...item }) => {
      const [withUrl] = await addCustomUrlToFlatMedia([item], searchType)
      return sanitizeRecord(withUrl, searchType, context)
    })
  )
  return { results: results.filter(Boolean), total: total[0]?.count ?? 0 }
}

/** The empty query: one page of Recently Added, which the library caps at 100 titles. */
async function recentlyAdded(page, limit, isTVdevice) {
  const [results, total] = await Promise.all([
    getFlatRecentlyAddedMedia({ page, limit, shouldExposeAdditionalData: isTVdevice }),
    getFlatRecentlyAddedMedia({ countOnly: true }),
  ])
  return { results, total }
}
