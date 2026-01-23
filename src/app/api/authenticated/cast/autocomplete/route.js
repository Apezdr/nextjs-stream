import clientPromise from '@src/lib/mongodb'
import { isAuthenticatedEither } from '@src/utils/routeAuth'

export const POST = async (req) => {
  const authResult = await isAuthenticatedEither(req)
  if (authResult instanceof Response) {
    return authResult
  }

  try {
    const { query } = await req.json()
    
    if (!query || query.length < 2) {
      return new Response(JSON.stringify({ suggestions: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const suggestions = await getCastSuggestions(query)
    
    return new Response(JSON.stringify({ suggestions }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Error fetching cast suggestions:', error)
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

async function getCastSuggestions(query) {
  const client = await clientPromise
  const db = client.db('Media')
  
  // Aggregate to get unique cast names with counts
  const [movieCast, tvCast] = await Promise.all([
    db.collection('FlatMovies').aggregate([
      {
        $match: {
          'metadata.cast.name': { $regex: query, $options: 'i' }
        }
      },
      { $unwind: '$metadata.cast' },
      {
        $match: {
          'metadata.cast.name': { $regex: query, $options: 'i' }
        }
      },
      {
        $group: {
          _id: '$metadata.cast.name',
          count: { $sum: 1 },
          profile_path: { $first: '$metadata.cast.profile_path' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]).toArray(),
    
    db.collection('FlatTVShows').aggregate([
      {
        $match: {
          'metadata.cast.name': { $regex: query, $options: 'i' }
        }
      },
      { $unwind: '$metadata.cast' },
      {
        $match: {
          'metadata.cast.name': { $regex: query, $options: 'i' }
        }
      },
      {
        $group: {
          _id: '$metadata.cast.name',
          count: { $sum: 1 },
          profile_path: { $first: '$metadata.cast.profile_path' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]).toArray()
  ])
  
  // Merge and deduplicate
  const allCast = [...movieCast, ...tvCast]
  const uniqueCast = new Map()
  
  for (const cast of allCast) {
    const existing = uniqueCast.get(cast._id)
    if (!existing || cast.count > existing.count) {
      uniqueCast.set(cast._id, {
        name: cast._id,
        count: existing ? existing.count + cast.count : cast.count,
        profile_path: cast.profile_path
      })
    }
  }
  
  // Sort by count and return top 10
  return Array.from(uniqueCast.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
}
