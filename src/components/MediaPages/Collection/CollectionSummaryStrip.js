'use client'

import { useMemo, useState, useEffect } from 'react'
import { formatRuntime } from '@src/utils/tmdb/collectionClientUtils'
import Image from 'next/image'

/**
 * CollectionSummaryStrip - Displays compact collection metadata in a horizontal strip
 * Shows aggregated statistics like average rating, runtime, genres, directors, and ownership progress
 *
 * Can work in two modes:
 * 1. With provided data (statistics, topDirectors, ownershipStats props)
 * 2. With collectionId for autonomous data fetching (progressive enhancement)
 */
const CollectionSummaryStrip = ({
  collectionId,
  statistics: propStatistics,
  topDirectors: propTopDirectors = [],
  ownershipStats: propOwnershipStats = {}
}) => {
  // State for autonomous data fetching
  const [enhancedData, setEnhancedData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  
  // State for expandable genres
  const [genresExpanded, setGenresExpanded] = useState(false)

  // Fetch enhanced data if collectionId provided but no prop data
  useEffect(() => {
    const shouldFetch = collectionId && !propStatistics && !propTopDirectors.length && !propOwnershipStats.total
    
    if (!shouldFetch) return

    const fetchEnhancedData = async () => {
      setLoading(true)
      setError(null)

      try {
        console.log(`[CollectionSummaryStrip] Fetching enhanced data for collection ${collectionId}`)
        const response = await fetch(`/api/authenticated/tmdb/collection/${collectionId}/enhanced`)
        
        if (!response.ok) {
          console.warn(`[CollectionSummaryStrip] Enhanced collection data not available (status: ${response.status})`)
          return
        }
        
        const data = await response.json()
        console.log(`[CollectionSummaryStrip] Received enhanced data:`, data)
        setEnhancedData(data)
      } catch (err) {
        console.error(`[CollectionSummaryStrip] Failed to fetch enhanced collection data:`, err)
        setError(err)
      } finally {
        setLoading(false)
      }
    }

    fetchEnhancedData()
  }, [collectionId, propStatistics, propTopDirectors.length, propOwnershipStats.total])

  // Use either prop data or fetched data (fix data structure access)
  const statistics = propStatistics || enhancedData?.aggregatedData?.statistics
  const topDirectors = propTopDirectors.length > 0 ? propTopDirectors : (enhancedData?.aggregatedData?.topDirectors || [])
  const ownershipStats = propOwnershipStats.total > 0 ? propOwnershipStats : (enhancedData?.ownershipStats || {})
  // Memoize computed values for performance
  const { 
    averageRating, 
    totalRuntime, 
    genreBreakdown = [], 
    releaseSpan,
    movieCount
  } = statistics || {}

  const { owned = 0, total = 0, percentage = 0 } = ownershipStats

  const formattedReleaseSpan = useMemo(() => {
    if (!releaseSpan?.earliest || !releaseSpan?.latest) return null
    
    const startYear = new Date(releaseSpan.earliest).getFullYear()
    const endYear = new Date(releaseSpan.latest).getFullYear()
    
    return startYear === endYear ? startYear.toString() : `${startYear} - ${endYear}`
  }, [releaseSpan])

  // Show loading skeleton if currently fetching
  if (loading) {
    return <CollectionSummaryStripSkeleton />
  }

  // Don't render if no statistics available (either from props or fetch)
  if (!statistics) {
    return null
  }

  return (
    <div className="bg-gray-900/95 backdrop-blur-xl border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
        
        {/* Main Stats Row */}
        <div className="flex flex-wrap items-center gap-6 mb-3">
          
          {/* Average Rating */}
          {averageRating && (
            <div className="flex items-center gap-2">
              <span className="text-yellow-400">★</span>
              <span className="text-white font-semibold">{averageRating.toFixed(1)}</span>
              <span className="text-gray-400 text-sm">avg rating</span>
            </div>
          )}
          
          {/* Release Span */}
          {formattedReleaseSpan && (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="text-white">{formattedReleaseSpan}</span>
              <span className="text-gray-400 text-sm">span</span>
            </div>
          )}
          
          {/* Total Runtime */}
          {totalRuntime > 0 && (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-white">{formatRuntime(totalRuntime)}</span>
              <span className="text-gray-400 text-sm">total runtime</span>
            </div>
          )}

          {/* Movie Count */}
          {movieCount > 0 && (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2h4a1 1 0 011 1v16a1 1 0 01-1 1H3a1 1 0 01-1-1V5a1 1 0 011-1h4zM9 6h6v2H9V6z" />
              </svg>
              <span className="text-white">{movieCount}</span>
              <span className="text-gray-400 text-sm">movie{movieCount !== 1 ? 's' : ''}</span>
            </div>
          )}
          
          {/* Ownership Progress */}
          {total > 0 && (
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-green-400 font-semibold">{owned}/{total}</span>
                <span className="text-gray-400 text-sm">in library</span>
              </div>
              <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-green-400 transition-all duration-500 ease-out"
                  style={{ width: `${Math.min(percentage, 100)}%` }}
                />
              </div>
              <span className="text-green-400 text-sm font-medium">{Math.round(percentage)}%</span>
            </div>
          )}
          
        </div>
        
        {/* Secondary Info Row */}
        <div className="flex flex-wrap items-center gap-4">
          
          {/* Top Genres */}
          {genreBreakdown.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">Genres:</span>
              <div className="flex gap-2 flex-wrap items-center">
                <div
                  className={`flex gap-2 flex-wrap transition-all duration-300 ease-out ${
                    genresExpanded
                      ? 'max-h-96 opacity-100'
                      : genreBreakdown.length > 3
                        ? 'max-h-8 opacity-100'
                        : 'max-h-96 opacity-100'
                  }`}
                  style={{
                    overflow: genresExpanded ? 'visible' : 'hidden'
                  }}
                >
                  {(genresExpanded ? genreBreakdown : genreBreakdown.slice(0, 3)).map(genre => (
                    <span
                      key={genre.id || genre.name}
                      className="px-2 py-1 bg-indigo-600/30 text-indigo-300 text-xs rounded-full transition-all duration-200"
                      title={`${genre.name} (${genre.percentage}% of collection)`}
                    >
                      {genre.name}
                    </span>
                  ))}
                </div>
                {genreBreakdown.length > 3 && (
                  <button
                    onClick={() => setGenresExpanded(!genresExpanded)}
                    className="text-gray-400 hover:text-gray-300 text-xs px-2 py-1 rounded transition-all duration-200 hover:bg-gray-800/50 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    aria-label={genresExpanded ? 'Show fewer genres' : `Show ${genreBreakdown.length - 3} more genres`}
                    aria-expanded={genresExpanded}
                  >
                    {genresExpanded
                      ? 'Show less ↑'
                      : `+${genreBreakdown.length - 3} more ↓`
                    }
                  </button>
                )}
              </div>
            </div>
          )}
          
          {/* Top Directors */}
          {topDirectors.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm">Directors:</span>
              <div className="flex items-center gap-2">
                {topDirectors.slice(0, 2).map((director, index) => (
                  <div key={director.id} className="flex items-center gap-1">
                    {index > 0 && <span className="text-gray-600">,</span>}
                    {director.profile_path && (
                      <Image
                        src={director.profile_path ? `https://image.tmdb.org/t/p/w45${director.profile_path}` : '/sorry-image-not-available.jpg'}
                        alt={director.name}
                        width={45}
                        height={45}
                        className="w-6 h-6 rounded-full object-cover"
                        loading="lazy"
                        onError={(e) => {
                          e.target.src = '/sorry-image-not-available.jpg'
                        }}
                      />
                    )}
                    <span className="text-white text-sm">{director.name}</span>
                    {director.movieCount > 1 && (
                      <span 
                        className="text-gray-400 text-xs"
                        title={`Directed ${director.movieCount} movies: ${director.movieTitles?.join(', ')}`}
                      >
                        ({director.movieCount})
                      </span>
                    )}
                  </div>
                ))}
                {topDirectors.length > 2 && (
                  <span className="text-gray-500 text-xs ml-1">
                    +{topDirectors.length - 2} more
                  </span>
                )}
              </div>
            </div>
          )}
          
        </div>
        
      </div>
    </div>
  )
}

/**
 * Loading skeleton for CollectionSummaryStrip
 */
export const CollectionSummaryStripSkeleton = () => {
  return (
    <div className="bg-gray-900/95 backdrop-blur-xl border-b border-gray-800">
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
        <div className="animate-pulse">
          
          {/* Main Stats Row Skeleton */}
          <div className="flex gap-6 mb-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-4 h-4 bg-gray-700 rounded" />
                <div className="w-16 h-4 bg-gray-700 rounded" />
                <div className="w-12 h-3 bg-gray-700 rounded" />
              </div>
            ))}
            
            {/* Progress bar skeleton */}
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-gray-700 rounded-full" />
              <div className="w-12 h-4 bg-gray-700 rounded" />
              <div className="w-16 h-2 bg-gray-700 rounded-full" />
            </div>
          </div>
          
          {/* Secondary Info Row Skeleton */}
          <div className="flex gap-4">
            <div className="flex items-center gap-2">
              <div className="w-12 h-3 bg-gray-700 rounded" />
              <div className="flex gap-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="w-16 h-6 bg-gray-700 rounded-full" />
                ))}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <div className="w-16 h-3 bg-gray-700 rounded" />
              <div className="flex gap-1">
                <div className="w-6 h-6 bg-gray-700 rounded-full" />
                <div className="w-20 h-4 bg-gray-700 rounded" />
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  )
}

export default CollectionSummaryStrip