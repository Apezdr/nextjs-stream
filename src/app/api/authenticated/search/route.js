import clientPromise from '@src/lib/mongodb'
import { addCustomUrlToMedia, fetchRecentlyAdded } from '@src/utils/auth_database'
import {
  arrangeMediaByLatestModification,
  movieProjectionFields,
  tvShowProjectionFields,
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
        .collection('Movies')
        .find({ title: { $regex: query, $options: 'i' } }, { projection: movieProjectionFields })
        .toArray(),
      db
        .collection('TV')
        .find({ title: { $regex: query, $options: 'i' } }, { projection: tvShowProjectionFields })
        .toArray(),
    ])
  } else {
    // Fetch recently added media if query is empty
    ;[movies, tvShows] = await Promise.all([
      fetchRecentlyAdded({ db: db, collectionName: 'Movies' }),
      fetchRecentlyAdded({ db: db, collectionName: 'TV' }),
    ])
    recentlyAddedMediaQuery = true
  }

  const [moviesWithUrl, tvShowsWithUrl] = await Promise.all([
    addCustomUrlToMedia(movies, 'movie'),
    addCustomUrlToMedia(tvShows, 'tv'),
  ])

  if (recentlyAddedMediaQuery) {
    // Merge and sort based on the latest modification date
    return arrangeMediaByLatestModification(moviesWithUrl, tvShowsWithUrl)
  }

  return [...moviesWithUrl, ...tvShowsWithUrl]
}
