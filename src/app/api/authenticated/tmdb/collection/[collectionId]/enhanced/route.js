import { isAuthenticatedEither } from '@src/utils/routeAuth'
import { getFlatMoviesByCollectionId, mergeCollectionWithOwnership } from '@src/utils/flatDatabaseUtils'
import { getCollectionDetails } from '@src/utils/tmdb/client'

/**
 * GET /api/authenticated/tmdb/collection/[collectionId]/enhanced
 * 
 * Provides enhanced collection data with aggregated statistics, contributor data,
 * and other enriched metadata. This endpoint combines local ownership data with
 * comprehensive TMDB data including cast, crew, videos, and images.
 * 
 * Features:
 * - Top cast and directors aggregated across the collection
 * - Collection-wide statistics (avg rating, runtime, genres, etc.)
 * - Featured trailers and artwork
 * - Graceful fallback to basic collection data on partial failures
 * 
 * @param {Request} request - The incoming request
 * @param {Object} params - Route parameters containing collectionId
 * @returns {Response} Enhanced collection data or error response
 */
export async function GET(request, { params }) {
  try {
    // Check authentication
    const authResult = await isAuthenticatedEither(request)
    if (authResult instanceof Response) {
      return authResult
    }
    
    const { collectionId } = await params

    // Validate collection ID
    if (!collectionId) {
      return Response.json(
        { error: 'Missing required parameter: collectionId' },
        { status: 400 }
      )
    }

    const collectionIdInt = parseInt(collectionId)
    if (isNaN(collectionIdInt) || collectionIdInt <= 0) {
      return Response.json(
        { error: 'Invalid collection ID' },
        { status: 400 }
      )
    }

    console.log(`[ENHANCED_COLLECTION] Starting enhanced data fetch for collection ${collectionIdInt}`)

    // Step 1: Fetch local owned movies
    let ownedMovies = []
    try {
      ownedMovies = await getFlatMoviesByCollectionId(collectionIdInt)
      console.log(`[ENHANCED_COLLECTION] Found ${ownedMovies.length} owned movies for collection ${collectionIdInt}`)
    } catch (error) {
      console.warn(`[ENHANCED_COLLECTION] Failed to fetch owned movies: ${error.message}`)
      // Continue without owned movies - we can still provide TMDB-only data
    }

    // Step 2: Fetch enhanced TMDB collection data (backend handles aggregation)
    let enhancedCollection = null
    try {
      enhancedCollection = await getCollectionDetails(collectionIdInt, { enhanced: true })
      console.log(`[ENHANCED_COLLECTION] Successfully fetched enhanced TMDB data for collection ${collectionIdInt}`)
    } catch (tmdbError) {
      console.error(`[ENHANCED_COLLECTION] TMDB enhancement failed for collection ${collectionIdInt}:`, tmdbError)
      
      // If enhancement completely fails, return error
      // The client can fall back to the basic collection endpoint
      return Response.json(
        {
          error: 'Enhanced collection data unavailable',
          details: tmdbError.message,
          collectionId: collectionIdInt,
          fallbackEndpoint: `/api/authenticated/tmdb/collection/${collectionIdInt}`
        },
        { status: 503 }
      )
    }

    // Step 3: Merge enhanced TMDB data with local ownership
    let finalCollection
    try {
      finalCollection = mergeCollectionWithOwnership(ownedMovies, enhancedCollection)
      
      // Add enhancement metadata
      finalCollection.enhanced = true
      finalCollection.enhancementTimestamp = new Date().toISOString()
      finalCollection.enhancementStats = {
        ownedMoviesFound: ownedMovies.length,
        tmdbMoviesFound: enhancedCollection.parts?.length || 0,
        enhancedMoviesCount: enhancedCollection.enhancedParts?.filter(m => m.credits).length || 0,
        aggregatedDataAvailable: !!enhancedCollection.aggregatedData
      }
      
      console.log(`[ENHANCED_COLLECTION] Successfully merged data for collection ${collectionIdInt}`)
      console.log(`[ENHANCED_COLLECTION] Enhancement stats:`, finalCollection.enhancementStats)
      
    } catch (mergeError) {
      console.error(`[ENHANCED_COLLECTION] Merge failed for collection ${collectionIdInt}:`, mergeError)
      
      // If merge fails, return the enhanced TMDB data without ownership info
      finalCollection = {
        ...enhancedCollection,
        enhanced: true,
        enhancementTimestamp: new Date().toISOString(),
        ownershipStats: {
          owned: 0,
          total: enhancedCollection.parts?.length || 0,
          percentage: 0
        },
        enhancementStats: {
          ownedMoviesFound: 0,
          tmdbMoviesFound: enhancedCollection.parts?.length || 0,
          enhancedMoviesCount: enhancedCollection.enhancedParts?.filter(m => m.credits).length || 0,
          aggregatedDataAvailable: !!enhancedCollection.aggregatedData,
          mergeError: mergeError.message
        }
      }
    }

    // Step 4: Add response metadata
    const responseData = {
      ...finalCollection,
      meta: {
        endpoint: 'enhanced',
        version: '1.0',
        fetchedAt: new Date().toISOString(),
        cacheRecommendation: {
          ttl: 24 * 60 * 60, // 24 hours in seconds
          key: `collection:enhanced:${collectionIdInt}`
        }
      }
    }

    console.log(`[ENHANCED_COLLECTION] Successfully returning enhanced data for collection ${collectionIdInt}`)

    return Response.json(responseData, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400', // 1 hour cache, 24 hour stale
        'X-Collection-Enhanced': 'true',
        'X-Enhancement-Stats': JSON.stringify(finalCollection.enhancementStats)
      }
    })

  } catch (error) {
    console.error(`[ENHANCED_COLLECTION] Unexpected error for collection ${params?.collectionId}:`, error)
    
    return Response.json(
      {
        error: 'Internal server error during collection enhancement',
        details: error.message,
        collectionId: params?.collectionId,
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    )
  }
}

/**
 * OPTIONS handler for CORS preflight requests
 */
export async function OPTIONS(request) {
  return new Response(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  })
}