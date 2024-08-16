import clientPromise from 'src/lib/mongodb'
import { fetchMetadata } from 'src/utils/admin_utils'
import isAuthenticated from 'src/utils/routeAuth'

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

const movieProjectionFields = {
  _id: 0,
  posterURL: 1,
  posterBlurhash: 1,
  title: 1,
  dimensions: 1,
  'metadata.overview': 1,
  'metadata.release_date': 1,
  'metadata.genres': 1,
}

const tvShowProjectionFields = {
  _id: 0,
  posterURL: 1,
  posterBlurhash: 1,
  title: 1,
  'metadata.overview': 1,
  'metadata.last_air_date': 1,
  'metadata.networks': 1,
  'metadata.genres': 1,
  'metadata.status': 1,
  seasons: 1,
}

async function searchMedia(query) {
  const client = await clientPromise
  const db = client.db('Media')

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
      fetchRecentlyAdded(db, 'Movies'),
      fetchRecentlyAdded(db, 'TV'),
    ])
  }

  const [moviesWithUrl, tvShowsWithUrl] = await Promise.all([
    addCustomUrlToMedia(movies, 'movie'),
    addCustomUrlToMedia(tvShows, 'tv'),
  ])

  return [...moviesWithUrl, ...tvShowsWithUrl]
}

async function addCustomUrlToMedia(mediaArray, type) {
  return await Promise.all(
    mediaArray.map(async (media) => {
      let returnObj = {
        ...media,
        url: `/list/${type}/${encodeURIComponent(media.title)}`,
        description: media.metadata?.overview,
        type,
      }
      if (media.posterBlurhash) {
        returnObj.posterBlurhash = await fetchMetadata(
          media.posterBlurhash,
          'blurhash',
          type,
          media.title
        )
      }
      return returnObj
    })
  )
}

async function fetchRecentlyAdded(db, collectionName) {
  let sortField = { _id: -1 }
  let projectionFields = {}

  if (collectionName === 'Movies') {
    projectionFields = movieProjectionFields
  } else if (collectionName === 'TV') {
    projectionFields = tvShowProjectionFields
  }

  return await db
    .collection(collectionName)
    .find({}, { projection: projectionFields })
    .sort(sortField)
    .limit(3) // limit to 3 recent items, adjust as needed
    .toArray()
}
