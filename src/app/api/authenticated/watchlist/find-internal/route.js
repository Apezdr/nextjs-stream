import { isAuthenticatedEither } from '@src/utils/routeAuth'
import clientPromise from '@src/lib/mongodb'
import { ObjectId } from 'mongodb'

/**
 * POST /api/authenticated/watchlist/find-internal
 * Find internal media by TMDB ID for watchlist functionality
 */
export async function POST(req) {
  // Check authentication
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    const body = await req.json()
    const { tmdbId, mediaType } = body

    if (!tmdbId || !mediaType) {
      return new Response(
        JSON.stringify({ error: 'tmdbId and mediaType are required' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    if (!['movie', 'tv'].includes(mediaType)) {
      return new Response(
        JSON.stringify({ error: 'mediaType must be "movie" or "tv"' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }

    const client = await clientPromise
    const db = client.db('Media')
    const collection = mediaType === 'movie' ? 'FlatMovies' : 'FlatTVShows'

    // Search for media with matching TMDB ID
    const tmdbIdInt = parseInt(tmdbId)
    
    const media = await db.collection(collection).findOne({
      'metadata.id': tmdbIdInt
    }, {
      projection: {
        _id: 1,
        title: 1,
        'metadata.id': 1
      }
    })

    return new Response(
      JSON.stringify({
        success: true,
        media: media ? {
          _id: media._id.toString(),
          id: media._id.toString(),
          title: media.title,
          tmdbId: media.metadata?.id
        } : null
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error finding media by TMDB ID:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
}