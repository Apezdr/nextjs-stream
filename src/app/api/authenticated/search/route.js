import clientPromise from '@src/lib/mongodb'
import { addCustomUrlToFlatMedia, getFlatRecentlyAddedMedia } from '@src/utils/flatDatabaseUtils'
import {
  arrangeMediaByLatestModification,
  movieProjectionFields,
  tvShowProjectionFields,
  sanitizeRecord
} from '@src/utils/auth_utils'
import isAuthenticated, { isAuthenticatedEither } from '@src/utils/routeAuth'

export const POST = async (req) => {
  const authResult = await isAuthenticatedEither(req)
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

  if (!query) {
    // Fetch recently added media if query is empty
    const recentlyAddedMedia = await getFlatRecentlyAddedMedia({ limit: 15 })
    return recentlyAddedMedia
  }

  // Execute searches for each match type in parallel
  const [
    titleMatches,
    genreMatches,
    castMatches,
    castNameMatches,
    yearMatches,
    hdrMatches,
    resolutionMatches
  ] = await Promise.all([
    searchByTitle(db, query),
    searchByGenre(db, query),
    searchByCast(db, query),
    searchByCastNames(db, query),
    searchByYear(db, query),
    searchByHDR(db, query),
    searchByResolution(db, query)
  ])

  // Tag each result with its matchType
  const taggedResults = [
    ...titleMatches.map(r => ({ ...r, matchType: 'title' })),
    ...genreMatches.map(r => ({ ...r, matchType: 'genre' })),
    ...castMatches.map(r => ({ ...r, matchType: 'cast' })),
    ...castNameMatches.map(r => ({ ...r, matchType: 'castName' })),
    ...yearMatches.map(r => ({ ...r, matchType: 'year' })),
    ...hdrMatches.map(r => ({ ...r, matchType: 'hdr' })),
    ...resolutionMatches.map(r => ({ ...r, matchType: 'resolution' }))
  ]

  // Remove duplicates while preserving the best matchType
  const deduplicatedResults = deduplicateResults(taggedResults)
  
  // Separate cast names from media for processing
  const castNameResults = deduplicatedResults.filter(r => r.type === 'castName')
  const mediaResults = deduplicatedResults.filter(r => r.type !== 'castName')
  
  // Add URLs and sanitize media items
  const [moviesWithUrl, tvShowsWithUrl] = await Promise.all([
    addCustomUrlToFlatMedia(
      mediaResults.filter(r => r.type === 'movie'),
      'movie'
    ),
    addCustomUrlToFlatMedia(
      mediaResults.filter(r => r.type === 'tv'),
      'tv'
    ),
  ])

  const sanitizedMedia = await Promise.all(
    [...moviesWithUrl, ...tvShowsWithUrl].map(item =>
      sanitizeRecord(item, item.type)
    )
  )

  // Process cast name results with their nested media
  const processedCastNames = await Promise.all(
    castNameResults.map(async (castMember) => {
      // Add URLs to nested media items
      const [nestedMoviesWithUrl, nestedTVWithUrl] = await Promise.all([
        addCustomUrlToFlatMedia(
          castMember.media.filter(m => m.type === 'movie'),
          'movie'
        ),
        addCustomUrlToFlatMedia(
          castMember.media.filter(m => m.type === 'tv'),
          'tv'
        ),
      ])
      
      // Sanitize nested media items
      const sanitizedNestedMedia = await Promise.all(
        [...nestedMoviesWithUrl, ...nestedTVWithUrl].map(item =>
          sanitizeRecord(item, item.type)
        )
      )
      
      return {
        ...castMember,
        media: sanitizedNestedMedia.filter(Boolean)
      }
    })
  )

  return [...sanitizedMedia.filter(Boolean), ...processedCastNames]
}

// Search by title (existing functionality)
async function searchByTitle(db, query) {
  const [movies, tvShows] = await Promise.all([
    db.collection('FlatMovies')
      .find({ title: { $regex: query, $options: 'i' } }, { projection: movieProjectionFields })
      .toArray(),
    db.collection('FlatTVShows')
      .find({ title: { $regex: query, $options: 'i' } }, { projection: tvShowProjectionFields })
      .toArray(),
  ])
  return [...movies.map(m => ({ ...m, type: 'movie' })), ...tvShows.map(t => ({ ...t, type: 'tv' }))]
}

// Search by genre
async function searchByGenre(db, query) {
  const [movies, tvShows] = await Promise.all([
    db.collection('FlatMovies')
      .find({ 'metadata.genres.name': { $regex: query, $options: 'i' } }, { projection: movieProjectionFields })
      .toArray(),
    db.collection('FlatTVShows')
      .find({ 'metadata.genres.name': { $regex: query, $options: 'i' } }, { projection: tvShowProjectionFields })
      .toArray(),
  ])
  return [...movies.map(m => ({ ...m, type: 'movie' })), ...tvShows.map(t => ({ ...t, type: 'tv' }))]
}

// Search by cast member name
async function searchByCast(db, query) {
  const [movies, tvShows] = await Promise.all([
    db.collection('FlatMovies')
      .find({ 'metadata.cast.name': { $regex: query, $options: 'i' } }, { projection: movieProjectionFields })
      .toArray(),
    db.collection('FlatTVShows')
      .find({ 'metadata.cast.name': { $regex: query, $options: 'i' } }, { projection: tvShowProjectionFields })
      .toArray(),
  ])
  return [...movies.map(m => ({ ...m, type: 'movie' })), ...tvShows.map(t => ({ ...t, type: 'tv' }))]
}

// Search by release year
async function searchByYear(db, query) {
  // Only search if query is a 4-digit year
  if (!/^\d{4}$/.test(query.trim())) return []
  
  const year = parseInt(query.trim())
  const startDate = new Date(year, 0, 1)
  const endDate = new Date(year + 1, 0, 1)
  
  const [movies, tvShows] = await Promise.all([
    db.collection('FlatMovies')
      .find({
        'metadata.release_date': {
          $gte: startDate,
          $lt: endDate
        }
      }, { projection: movieProjectionFields })
      .toArray(),
    db.collection('FlatTVShows')
      .find({
        'metadata.first_air_date': {
          $gte: startDate,
          $lt: endDate
        }
      }, { projection: tvShowProjectionFields })
      .toArray(),
  ])
  return [...movies.map(m => ({ ...m, type: 'movie' })), ...tvShows.map(t => ({ ...t, type: 'tv' }))]
}

// Search for HDR content
async function searchByHDR(db, query) {
  // Only search if query is "HDR" (case-insensitive)
  if (!/^hdr$/i.test(query.trim())) return []
  
  const [movies, tvShows] = await Promise.all([
    db.collection('FlatMovies')
      .find({
        $or: [
          { hdr: { $exists: true, $nin: [false, null, ''] } },
          { 'mediaQuality.isHDR': true }
        ]
      }, { projection: movieProjectionFields })
      .toArray(),
    db.collection('FlatTVShows')
      .find({
        $or: [
          { hdr: { $exists: true, $nin: [false, null, ''] } },
          { 'mediaQuality.isHDR': true }
        ]
      }, { projection: tvShowProjectionFields })
      .toArray(),
  ])
  return [...movies.map(m => ({ ...m, type: 'movie' })), ...tvShows.map(t => ({ ...t, type: 'tv' }))]
}

// Search by resolution (4K, 1080p, 720p)
async function searchByResolution(db, query) {
  const trimmed = query.trim().toLowerCase()
  let dimensionPattern = null
  
  if (trimmed === '4k') {
    dimensionPattern = /^(3840|4096)/ // 4K UHD or DCI 4K
  } else if (trimmed === '1080p' || trimmed === '1080') {
    dimensionPattern = /^1920x1080/
  } else if (trimmed === '720p' || trimmed === '720') {
    dimensionPattern = /^1280x720/
  } else {
    return []
  }
  
  const [movies, tvShows] = await Promise.all([
    db.collection('FlatMovies')
      .find({ dimensions: { $regex: dimensionPattern } }, { projection: movieProjectionFields })
      .toArray(),
    db.collection('FlatTVShows')
      .find({ dimensions: { $regex: dimensionPattern } }, { projection: tvShowProjectionFields })
      .toArray(),
  ])
  return [...movies.map(m => ({ ...m, type: 'movie' })), ...tvShows.map(t => ({ ...t, type: 'tv' }))]
}

// Search for cast members by name with their associated media
async function searchByCastNames(db, query) {
  if (query.length < 2) return []
  
  const [movieResults, tvResults] = await Promise.all([
    db.collection('FlatMovies').aggregate([
      { $match: { 'metadata.cast.name': { $regex: query, $options: 'i' } } },
      {
        $addFields: {
          matchedCast: {
            $filter: {
              input: '$metadata.cast',
              cond: { $regexMatch: { input: '$$this.name', regex: query, options: 'i' } }
            }
          }
        }
      },
      { $unwind: '$matchedCast' },
      {
        $group: {
          _id: {
            id: '$matchedCast.id',
            name: '$matchedCast.name'
          },
          profile_path: { $first: '$matchedCast.profile_path' },
          media: {
            $push: {
              _id: '$_id',
              title: '$title',
              posterURL: '$posterURL',
              posterBlurhash: '$posterBlurhash',
              backdrop: '$backdrop',
              backdropBlurhash: '$backdropBlurhash',
              dimensions: '$dimensions',
              hdr: '$hdr',
              mediaQuality: '$mediaQuality',
              metadata: '$metadata',
              type: 'movie'
            }
          }
        }
      },
      {
        $project: {
          _id: 1,
          profile_path: 1,
          media: { $slice: ['$media', 50] }, // Limit to 50 media items per actor
          count: { $size: '$media' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 50 }
    ]).toArray(),
    
    db.collection('FlatTVShows').aggregate([
      { $match: { 'metadata.cast.name': { $regex: query, $options: 'i' } } },
      {
        $addFields: {
          matchedCast: {
            $filter: {
              input: '$metadata.cast',
              cond: { $regexMatch: { input: '$$this.name', regex: query, options: 'i' } }
            }
          }
        }
      },
      { $unwind: '$matchedCast' },
      {
        $group: {
          _id: {
            id: '$matchedCast.id',
            name: '$matchedCast.name'
          },
          profile_path: { $first: '$matchedCast.profile_path' },
          media: {
            $push: {
              _id: '$_id',
              title: '$title',
              posterURL: '$posterURL',
              posterBlurhash: '$posterBlurhash',
              backdrop: '$backdrop',
              backdropBlurhash: '$backdropBlurhash',
              dimensions: '$dimensions',
              hdr: '$hdr',
              mediaQuality: '$mediaQuality',
              metadata: '$metadata',
              type: 'tv'
            }
          }
        }
      },
      {
        $project: {
          _id: 1,
          profile_path: 1,
          media: { $slice: ['$media', 50] },
          count: { $size: '$media' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 50 }
    ]).toArray()
  ])
  
  // Merge cast members and their media
  const allCast = [...movieResults, ...tvResults]
  const uniqueCast = new Map()
  
  for (const cast of allCast) {
    const castId = cast._id.id
    const existing = uniqueCast.get(castId)
    
    if (!existing) {
      uniqueCast.set(castId, {
        _id: castId,
        type: 'castName',
        name: cast._id.name,
        profile_path: cast.profile_path,
        media: cast.media,  // Include all media items
        count: cast.count,
        // Add properties expected by frontend
        title: cast._id.name,
        posterURL: cast.profile_path || '/sorry-image-not-available.jpg',
        posterBlurhash: null,
        url: null
      })
    } else {
      existing.media.push(...cast.media)
      existing.count += cast.count
    }
  }
  
  return Array.from(uniqueCast.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 50)
}

// Remove duplicates, keeping the result with the highest priority matchType
function deduplicateResults(results) {
  const mediaResults = []
  const castNameResults = []
  const seen = new Map()
  const matchTypePriority = {
    title: 1,
    cast: 2,
    genre: 3,
    year: 4,
    hdr: 5,
    resolution: 6
  }
  
  for (const result of results) {
    // Cast names are separate entities, don't deduplicate with media
    if (result.matchType === 'castName') {
      castNameResults.push(result)
      continue
    }
    
    // Deduplicate media items
    const key = result._id.toString()
    const existing = seen.get(key)
    
    if (!existing || matchTypePriority[result.matchType] < matchTypePriority[existing.matchType]) {
      seen.set(key, result)
    }
  }
  
  mediaResults.push(...Array.from(seen.values()))
  
  return [...mediaResults, ...castNameResults]
}
