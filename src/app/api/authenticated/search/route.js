import clientPromise from '@src/lib/mongodb'
import { addCustomUrlToFlatMedia, getFlatRecentlyAddedMedia } from '@src/utils/flatDatabaseUtils'
import { visibleMovieFilter, visibleShowFilter } from '@src/utils/mediaVisibility'
import { movieProjectionFields, tvShowProjectionFields, sanitizeRecord } from '@src/utils/auth_utils'
import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { escapeRegex } from '@src/utils/escapeRegex'
import { TITLE_COLLATION } from '@src/utils/mediaListUtils/listOrder'
import { SEARCH_TYPES, matchRanks, pageParams, searchTypes } from '@src/utils/search/searchQuery'

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// Paging, the Movies/TV filter and the ranking: utils/search/searchQuery.js

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
  const types = searchTypes(body?.types)
  if (!types) {
    return json({ error: `types must list one or both of ${SEARCH_TYPES.join(', ')}` }, 400)
  }
  const { page, limit } = pageParams(body?.page, body?.limit)

  try {
    const typed = query.trim()
    const { results, total } = typed
      ? await searchTitles(typed, types, page, limit, Boolean(isTVdevice))
      : await recentlyAdded(types, page, limit, Boolean(isTVdevice))
    return json({ results, total, hasNextPage: (page + 1) * limit < total })
  } catch (error) {
    console.error('Error during search:', error)
    return json({ error: 'Internal Server Error' }, 500)
  }
}

const SIDES = {
  movie: { collection: 'FlatMovies', filter: visibleMovieFilter, projection: movieProjectionFields },
  tv: { collection: 'FlatTVShows', filter: visibleShowFilter, projection: tvShowProjectionFields },
}

/**
 * One page of the movies and shows whose title contains the query, matched
 * literally and case-insensitively. The kinds asked for are merged and
 * ranked in one aggregation (best match first, then A-Z, then _id), so
 * movies and shows sit side by side and the pages never repeat or skip one.
 */
async function searchTitles(query, types, page, limit, isTVdevice) {
  const client = await clientPromise
  const db = client.db('Media')
  const pattern = escapeRegex(query)

  const titles = (type) => [
    // $and because the visibility fragments carry a top-level $or
    { $match: { $and: [{ title: { $regex: pattern, $options: 'i' } }, SIDES[type].filter()] } },
    { $project: SIDES[type].projection },
    { $addFields: { searchType: type } },
  ]
  const [first, ...others] = types
  const ranks = matchRanks(pattern)
  const [{ items, total }] = await db
    .collection(SIDES[first].collection)
    .aggregate(
      [
        ...titles(first),
        ...others.map((type) => ({ $unionWith: { coll: SIDES[type].collection, pipeline: titles(type) } })),
        {
          $addFields: {
            matchRank: {
              $switch: {
                branches: ranks.map((regex, rank) => ({
                  case: { $regexMatch: { input: '$title', regex, options: 'i' } },
                  then: rank,
                })),
                default: ranks.length,
              },
            },
          },
        },
        { $sort: { matchRank: 1, title: 1, _id: 1 } },
        {
          $facet: {
            items: [{ $skip: page * limit }, { $limit: limit }, { $project: { matchRank: 0 } }],
            total: [{ $count: 'count' }],
          },
        },
      ],
      // Ties are A-Z ignoring case, numbers in numeric order, like the lists
      { collation: TITLE_COLLATION }
    )
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
async function recentlyAdded(types, page, limit, isTVdevice) {
  const [results, total] = await Promise.all([
    getFlatRecentlyAddedMedia({ page, limit, shouldExposeAdditionalData: isTVdevice, types }),
    getFlatRecentlyAddedMedia({ countOnly: true, types }),
  ])
  return { results, total }
}
