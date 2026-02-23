// Collection Page Progressive Server Components  
// Phase 2: Streaming & Suspense - Server components that render independently

import React from 'react'
import { getCachedCollectionDetails, getCachedOwnedMovies, getCachedEnhancedCollectionDetails } from '@src/app/(styled)/list/collection/[collectionId]/page'
import { mergeCollectionWithOwnership } from '@src/utils/flatDatabaseUtils'

// *** VERCEL BEST PRACTICE: streaming-server-components ***
// Break down into small, independent server components for better streaming

// *** TRUE STREAMING: Header fetches its own data independently ***
export async function CollectionHeaderServerComponent({ collectionId }) {
  console.log(`[STREAMING] Loading collection header for ${collectionId}`)
  
  // *** CRITICAL: Fetch data independently for true streaming ***
  // This component is wrapped in its own Suspense boundary
  let collectionWithOwnership = null
  let hasError = false
  
  try {
    const [ownedMoviesResult, tmdbResult] = await Promise.allSettled([
      getCachedOwnedMovies(collectionId),
      getCachedCollectionDetails(collectionId)
    ])
    
    const ownedMovies = ownedMoviesResult.status === 'fulfilled' ? ownedMoviesResult.value : []
    const tmdbCollection = tmdbResult.status === 'fulfilled' ? tmdbResult.value : null
    
    if (tmdbCollection) {
      collectionWithOwnership = mergeCollectionWithOwnership(ownedMovies, tmdbCollection);
    } else {
      // Local-only fallback
      collectionWithOwnership = {
        id: collectionId,
        name: `Movie Collection ${collectionId}`,
        overview: `Collection of ${ownedMovies.length} movie${ownedMovies.length !== 1 ? 's' : ''} from your library.`,
        parts: ownedMovies,
        ownershipStats: {
          owned: ownedMovies.length,
          total: ownedMovies.length,
          percentage: 100
        },
        backdrop: ownedMovies[0]?.backdrop || null,
        posterURL: ownedMovies[0]?.posterURL || null
      };
    }
  } catch (error) {
    console.error(`[STREAMING] Error loading collection header:`, error)
    hasError = true
  }

  if (hasError || !collectionWithOwnership) {
    // Fallback header
    return (
      <div className="relative min-h-96 bg-gray-900">
        <div className="relative min-h-96 flex items-end">
          <div className="w-full px-4 md:px-8 py-6 pt-24 pb-8">
            <div className="max-w-7xl mx-auto text-center md:text-left">
              <h1 className="font-bold text-white text-4xl md:text-6xl mb-4">
                Collection {collectionId}
              </h1>
              <p className="text-gray-400">Loading collection details...</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const { name, overview, backdrop, ownershipStats } = collectionWithOwnership

  return (
    <div className="relative min-h-96">
      {/* Static Backdrop */}
      {backdrop && (
        <div className="absolute inset-0 overflow-hidden">
          <img
            src={backdrop}
            alt={`${name} backdrop`}
            className="w-full h-full object-cover"
          />
          {/* Gradient overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-gray-950/50 via-transparent to-gray-950/50" />
          <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-gray-950 to-transparent" />
        </div>
      )}

      {/* Header Content */}
      <div className="relative min-h-96 flex items-end">
        <div className="w-full px-4 md:px-8 py-6 pt-24 pb-8">
          <div className="max-w-7xl mx-auto">
            {/* Breadcrumb */}
            <nav className="mb-6">
              <div className="flex items-center text-sm">
                <a
                  href="/list/movie"
                  className="inline-flex items-center text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  <svg
                    className="w-4 h-4 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                  Movies
                </a>
                
                <svg
                  className="w-4 h-4 mx-3 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
                
                <span className="text-gray-300 font-medium">
                  {name}
                </span>
              </div>
            </nav>

            <div className="text-center md:text-left">
              <h1 className="font-bold text-white text-4xl md:text-6xl mb-4">
                {name}
              </h1>

              {/* Stats */}
              <div className="flex flex-wrap justify-center md:justify-start gap-4 mb-6">
                <div className="bg-gray-800/60 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-700/50">
                  <span className="text-white font-semibold">{ownershipStats?.total || 0}</span>
                  <span className="text-gray-400 ml-1">Movies</span>
                </div>

                <div className="flex items-center gap-3 bg-gray-800/60 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-700/50">
                  <span className="text-green-400 font-semibold">
                    {ownershipStats?.owned || 0}/{ownershipStats?.total || 0}
                  </span>
                  <span className="text-gray-400">Available</span>
                </div>
              </div>

              {/* Overview */}
              {overview && (
                <div className="max-w-3xl mx-auto md:mx-0">
                  <p className="text-lg leading-relaxed text-gray-300">
                    {overview.length > 300 ? `${overview.substring(0, 300)}...` : overview}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Collection Summary Strip Server Component - rich metadata like original
export async function CollectionSummaryStripServerComponent({ collectionId }) {
  console.log(`[STREAMING] Loading collection summary strip for ${collectionId}`)
  
  try {
    // OPTIMIZED: Fetch data using the enhanced endpoint that already has aggregated director data
    const [ownedMoviesResult, enhancedResult] = await Promise.allSettled([
      getCachedOwnedMovies(collectionId),
      getCachedEnhancedCollectionDetails(collectionId)
    ])
    
    const ownedMovies = ownedMoviesResult.status === 'fulfilled' ? ownedMoviesResult.value : []
    const enhancedData = enhancedResult.status === 'fulfilled' ? enhancedResult.value : null
    
    // Extract both standard collection data and enhanced aggregated data  
    const tmdbCollection = enhancedData
    const aggregatedData = enhancedData?.aggregatedData || {}
    
    // Import and render the client summary strip
    const { default: CollectionSummaryStrip } = await import('./CollectionSummaryStrip')
    
    // Calculate REAL rich statistics for the metadata strip
    const statistics = tmdbCollection ? {
      // Real average rating from TMDB collection parts
      averageRating: tmdbCollection.parts?.length > 0 
        ? tmdbCollection.parts.reduce((acc, movie) => acc + (movie.vote_average || 0), 0) / tmdbCollection.parts.length
        : null,
      
      // Total runtime from all movies in collection  
      totalRuntime: tmdbCollection.parts?.reduce((acc, movie) => {
        const runtime = movie.runtime || 0
        return acc + runtime
      }, 0) || 0,
      
      movieCount: tmdbCollection.parts?.length || 0,
      
      // Real release span from actual movie dates
      releaseSpan: tmdbCollection.parts?.length > 0 ? {
        earliest: tmdbCollection.parts.sort((a, b) => new Date(a.release_date) - new Date(b.release_date))[0]?.release_date,
        latest: tmdbCollection.parts.sort((a, b) => new Date(b.release_date) - new Date(a.release_date))[0]?.release_date
      } : null,
      
      // Real genre breakdown from all movies
      genreBreakdown: tmdbCollection.parts?.length > 0 ? (() => {
        const genreMap = new Map()
        const totalMovies = tmdbCollection.parts.length
        
        tmdbCollection.parts.forEach(movie => {
          movie.genre_ids?.forEach(genreId => {
            const genreName = getGenreName(genreId) // You'll need to map genre IDs to names
            if (genreName) {
              const count = genreMap.get(genreName) || 0
              genreMap.set(genreName, count + 1)
            }
          })
        })
        
        return Array.from(genreMap.entries())
          .map(([name, count]) => ({
            id: name,
            name,
            count,
            percentage: Math.round((count / totalMovies) * 100)
          }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 6) // Top 6 genres
      })() : []
    } : null
    
    // Use REAL directors from enhanced endpoint aggregated data (no placeholders!)
    const topDirectors = aggregatedData.topDirectors || []
    
    console.log(`[STREAMING] Enhanced collection data loaded:`, {
      hasAggregatedData: !!aggregatedData,
      topDirectorsCount: topDirectors.length,
      topCastCount: aggregatedData.topCast?.length || 0,
      directorNames: topDirectors.map(d => d.name)
    })

    // Helper function to map genre IDs to names (common TMDB genre IDs)
    function getGenreName(genreId) {
      const genreMap = {
        28: 'Action', 12: 'Adventure', 16: 'Animation', 35: 'Comedy', 80: 'Crime',
        99: 'Documentary', 18: 'Drama', 10751: 'Family', 14: 'Fantasy', 36: 'History',
        27: 'Horror', 10402: 'Music', 9648: 'Mystery', 10749: 'Romance', 878: 'Science Fiction',
        10770: 'TV Movie', 53: 'Thriller', 10752: 'War', 37: 'Western'
      }
      return genreMap[genreId]
    }
    
    const ownershipStats = {
      owned: ownedMovies.length,
      total: tmdbCollection?.parts?.length || ownedMovies.length,
      percentage: tmdbCollection?.parts?.length 
        ? (ownedMovies.length / tmdbCollection.parts.length) * 100
        : 100
    }
    
    return (
      <CollectionSummaryStrip
        collectionId={collectionId}
        statistics={statistics}
        topDirectors={topDirectors}
        ownershipStats={ownershipStats}
      />
    )
  } catch (error) {
    console.error(`[STREAMING] Error loading collection summary strip:`, error)
    
    // Graceful fallback
    return (
      <div className="bg-gray-900/95 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
          <div className="text-center text-gray-500 py-2">
            Collection details loading...
          </div>
        </div>
      </div>
    )
  }
}

// Progressive stats component - can error independently
export async function CollectionStatsServerComponent({ collectionId }) {
  console.log(`[STREAMING] Loading collection stats for ${collectionId}`)
  
  // *** VERCEL BEST PRACTICE: error-handling-server ***
  // Move data fetching outside JSX to avoid ESLint errors with try/catch
  let stats = null
  let totalRuntime = 0
  let hasError = false

  try {
    // Fetch stats independently - cached from main page data
    const [ownedMoviesResult, tmdbResult] = await Promise.allSettled([
      getCachedOwnedMovies(collectionId),
      getCachedCollectionDetails(collectionId)
    ])
    
    const ownedMovies = ownedMoviesResult.status === 'fulfilled' ? ownedMoviesResult.value : []
    const tmdbCollection = tmdbResult.status === 'fulfilled' ? tmdbResult.value : null
    
    let collectionWithOwnership;
    if (tmdbCollection) {
      collectionWithOwnership = mergeCollectionWithOwnership(ownedMovies, tmdbCollection);
    } else {
      // Fallback stats when TMDB unavailable
      collectionWithOwnership = {
        ownershipStats: {
          owned: ownedMovies.length,
          total: ownedMovies.length,
          percentage: 100
        }
      };
    }

    stats = collectionWithOwnership.ownershipStats || {}
    totalRuntime = ownedMovies.reduce((acc, movie) => {
      const runtime = movie.metadata?.runtime || movie.tmdbData?.runtime || 0
      return acc + runtime
    }, 0)
  } catch (error) {
    console.error(`[STREAMING] Error loading collection stats:`, error)
    hasError = true
  }

  // Render JSX outside try/catch to follow React best practices
  if (hasError || !stats) {
    return (
      <div className="bg-gray-900/50 border-y border-gray-800">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
          <div className="text-center text-gray-500">
            Stats temporarily unavailable
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-gray-900/50 border-y border-gray-800">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        <div className="flex flex-wrap justify-center gap-8">
          <div className="text-center">
            <div className="text-2xl font-bold text-white mb-1">
              {stats.total || 0}
            </div>
            <div className="text-sm text-gray-400">Total Movies</div>
          </div>

          <div className="text-center">
            <div className="text-2xl font-bold text-green-400 mb-1">
              {stats.owned || 0}
            </div>
            <div className="text-sm text-gray-400">Available</div>
          </div>

          <div className="text-center">
            <div className="text-2xl font-bold text-indigo-400 mb-1">
              {Math.round(((stats.owned || 0) / (stats.total || 1)) * 100)}%
            </div>
            <div className="text-sm text-gray-400">Complete</div>
          </div>

          {totalRuntime > 0 && (
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-400 mb-1">
                {Math.round(totalRuntime / 60)}h
              </div>
              <div className="text-sm text-gray-400">Total Runtime</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Progressive movies component - main content that streams in
export async function CollectionMoviesServerComponent({ collectionId, defaultFilter = 'all', defaultSort = 'release_date' }) {
  try {
    console.log(`[STREAMING] Loading movies for collection ${collectionId}`)
    
    // Use cached data from main page
    const [ownedMoviesResult, tmdbResult] = await Promise.allSettled([
      getCachedOwnedMovies(collectionId),
      getCachedCollectionDetails(collectionId)
    ])
    
    const ownedMovies = ownedMoviesResult.status === 'fulfilled' ? ownedMoviesResult.value : []
    const tmdbCollection = tmdbResult.status === 'fulfilled' ? tmdbResult.value : null
    
    let collectionWithOwnership;
    if (tmdbCollection) {
      collectionWithOwnership = mergeCollectionWithOwnership(ownedMovies, tmdbCollection);
    } else {
      // Local-only fallback
      collectionWithOwnership = {
        id: collectionId,
        name: `Movie Collection ${collectionId}`,
        parts: ownedMovies,
        ownershipStats: {
          owned: ownedMovies.length,
          total: ownedMovies.length,
          percentage: 100
        }
      };
    }

    // *** VERCEL BEST PRACTICE: server-client-import ***
    // Server components can directly import client components
    // The client component will handle its own code splitting with dynamic imports
    const CollectionMoviesClient = (await import('./CollectionMoviesClient')).default

    return (
      <CollectionMoviesClient
        collection={collectionWithOwnership}
        defaultFilter={defaultFilter}
        defaultSort={defaultSort}
      />
    )
  } catch (error) {
    console.error(`[STREAMING] Error loading collection movies:`, error)
    throw error // Let error boundary handle this
  }
}

// Featured Contributors Server Component - only cast/crew, no duplicate metadata
export async function FeaturedContributorsServerComponent({ collectionId }) {
  try {
    console.log(`[STREAMING] Loading featured contributors for ${collectionId}`)
    
    // Import just the contributors component
    const { default: FeaturedContributorsCarousel } = await import('./FeaturedContributorsCarouselEnhanced')

    return (
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        <FeaturedContributorsCarousel collectionId={collectionId} />
      </div>
    )
  } catch (error) {
    console.error(`[STREAMING] Error loading featured contributors:`, error)
    
    // Graceful fallback
    return null
  }
}

// Progressive extras component - non-critical features (KEPT FOR BACKWARD COMPATIBILITY)
export async function CollectionExtrasServerComponent({ collectionId }) {
  try {
    console.log(`[STREAMING] Loading collection extras for ${collectionId}`)
    
    // Simulate additional processing for extras like contributors, timeline etc
    // These are non-critical and can load last
    await new Promise(resolve => setTimeout(resolve, 100)) // Small delay to showcase streaming
    
    // *** VERCEL BEST PRACTICE: bundle-dynamic-imports ***
    // Dynamic imports for progressive enhancement components with correct paths
    const [
      { default: CollectionSummaryStrip }, 
      { default: FeaturedContributorsCarousel }
    ] = await Promise.all([
      import('./CollectionSummaryStrip'),
      import('./FeaturedContributorsCarouselEnhanced')
    ])

    return (
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6 space-y-6">
        {/* Collection Summary - meta details, runtime info etc */}
        <div className="animate-fade-in animation-delay-200">
          <CollectionSummaryStrip collectionId={collectionId} />
        </div>
        
        {/* Featured Contributors - cast/crew details */}
        <div className="animate-fade-in animation-delay-300">
          <FeaturedContributorsCarousel collectionId={collectionId} />
        </div>
      </div>
    )
  } catch (error) {
    console.error(`[STREAMING] Error loading collection extras:`, error)
    console.error('Import paths attempted:', [
      './CollectionSummaryStrip',
      './FeaturedContributorsCarouselEnhanced'
    ])
    
    // Graceful fallback - at least show we tried to load extras
    return (
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-6">
        <div className="text-center text-gray-500 py-8">
          <p className="text-sm">Collection details and contributors will be available soon.</p>
          <p className="text-xs mt-2 opacity-75">Error loading enhancement features: {error.message}</p>
        </div>
      </div>
    )
  }
}

// Note: Error boundaries moved to separate client component
// Server components cannot use class-based error boundaries
