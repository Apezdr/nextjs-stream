import clientPromise from '@src/lib/mongodb'
import { addCustomUrlToFlatMedia, getFlatRecentlyAddedMedia } from '@src/utils/flatDatabaseUtils'
import {
  arrangeMediaByLatestModification,
  movieProjectionFields,
  tvShowProjectionFields,
  sanitizeRecord
} from '@src/utils/auth_utils'
import isAuthenticated from '@src/utils/routeAuth'

export const POST = async (req) => {
  const authResult = await isAuthenticated(req)
  if (authResult instanceof Response) {
    return authResult // Stop execution and return the unauthorized response
  }

  try {
    const body = await req.json()
    const { query } = body

    // Assuming 'query' is a string you want to search for
    try {
      const results = await searchMedia(query)
      return new Response(JSON.stringify({ results }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } catch (error) {
      console.error('Error during query:', error)
      return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (error) {
    console.error('Error during search:', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

async function searchMedia(query) {
  const client = await clientPromise
  const db = client.db('Media')
  let recentlyAddedMediaQuery = false

  let movies, tvShows

  if (query) {
    // Perform search if query is provided
    ;[movies, tvShows] = await Promise.all([
      db
        .collection('FlatMovies')
        .find({ title: { $regex: query, $options: 'i' } }, { projection: movieProjectionFields })
        .toArray(),
      db
        .collection('FlatTVShows')
        .find({ title: { $regex: query, $options: 'i' } }, { projection: tvShowProjectionFields })
        .toArray(),
    ])
  } else {
    // Fetch recently added media if query is empty
    const recentlyAddedMedia = await getFlatRecentlyAddedMedia({ limit: 15 })
    return recentlyAddedMedia
  }

  // First add custom URLs (without fetching blurhash data)
  const [moviesWithUrl, tvShowsWithUrl] = await Promise.all([
    addCustomUrlToFlatMedia(movies, 'movie'),
    addCustomUrlToFlatMedia(tvShows, 'tv'),
  ])

  // Now sanitize each item to ensure proper blurhash processing
  const sanitizedResults = await Promise.all(
    [...moviesWithUrl, ...tvShowsWithUrl].map(item => 
      sanitizeRecord(item, item.type)
    )
  );

  return sanitizedResults.filter(Boolean); // Filter out any null results
}
