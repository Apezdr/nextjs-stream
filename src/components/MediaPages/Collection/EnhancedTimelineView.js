'use client'

import { memo, useState, useEffect } from 'react'
import Link from 'next/link'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { getFormattedDuration } from '@src/utils/tmdb/client'

const WatchlistButton = dynamic(() => import('@components/WatchlistButton'), { ssr: false })

/**
 * EnhancedTimelineView - Timeline view with contributor callouts and enhanced movie information
 * Shows movies in chronological order with cast/crew highlights when enhanced data is available
 *
 * Can work in two modes:
 * 1. With provided data (enhanced, aggregatedData props)
 * 2. With collectionId for autonomous data fetching (progressive enhancement)
 */
const EnhancedTimelineView = ({
  movies = [],
  collectionId,
  enhanced: propEnhanced = false,
  aggregatedData: propAggregatedData = null
}) => {
  // State for autonomous data fetching
  const [enhancedData, setEnhancedData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Fetch enhanced data if collectionId provided but no prop data
  useEffect(() => {
    const shouldFetch = collectionId && !propEnhanced && !propAggregatedData
    
    if (!shouldFetch) return

    const fetchEnhancedData = async () => {
      setLoading(true)
      setError(null)

      try {
        console.log(`[EnhancedTimelineView] Fetching enhanced data for collection ${collectionId}`)
        const response = await fetch(`/api/authenticated/tmdb/collection/${collectionId}/enhanced`)
        
        if (!response.ok) {
          console.warn(`[EnhancedTimelineView] Enhanced collection data not available (status: ${response.status})`)
          return
        }
        
        const data = await response.json()
        console.log(`[EnhancedTimelineView] Received enhanced data:`, data)
        setEnhancedData(data)
      } catch (err) {
        console.error(`[EnhancedTimelineView] Failed to fetch enhanced collection data:`, err)
        setError(err)
      } finally {
        setLoading(false)
      }
    }

    fetchEnhancedData()
  }, [collectionId, propEnhanced, propAggregatedData])

  // Use either prop data or fetched data (fix data structure access)
  const enhanced = propEnhanced || !!enhancedData
  const aggregatedData = propAggregatedData || enhancedData?.aggregatedData
  
  // Merge enhanced parts data with basic movies when enhanced data is available
  const enhancedParts = enhancedData?.enhancedParts || enhancedData?.parts
  const enhancedMovies = enhancedParts ? movies.map(movie => {
    const enhancedPart = enhancedParts.find(part =>
      part.id === movie.tmdbId ||
      part.id === movie.id ||
      part.title === movie.title
    )
    
    if (enhancedPart) {
      return {
        ...movie,
        credits: enhancedPart.credits,
        videos: enhancedPart.videos,
        images: enhancedPart.images,
        enhancedMetadata: enhancedPart
      }
    }
    
    return movie
  }) : movies

  // Show loading skeleton if currently fetching
  if (loading) {
    return <EnhancedTimelineViewSkeleton count={enhancedMovies.length || 5} />
  }
  return (
    <div className="relative">
      {/* Timeline line */}
      <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-indigo-600 via-indigo-500 to-indigo-600" />

      <AnimatePresence mode="popLayout">
        {enhancedMovies.map((movie, index) => (
          <motion.div
            key={`timeline-${movie.id || movie.title}-${index}`}
            layout
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{
              opacity: { duration: 0.3 },
              x: { duration: 0.3 },
              layout: { duration: 0.4 }
            }}
            className="relative flex items-center mb-8"
          >
            <EnhancedTimelineMovieCard 
              movie={movie} 
              enhanced={enhanced}
              aggregatedData={aggregatedData}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

/**
 * EnhancedTimelineMovieCard - Individual movie card for timeline with contributor callouts
 */
const EnhancedTimelineMovieCard = memo(({ movie, enhanced, aggregatedData }) => {
  const releaseDate = movie.metadata?.release_date || movie.tmdbData?.release_date
  const year = releaseDate ? new Date(releaseDate).getFullYear() : 'Unknown'
  const rating = movie.metadata?.vote_average || movie.tmdbData?.vote_average

  // Get contributor highlights for this movie
  const getContributorHighlights = () => {
    if (!enhanced || !movie.credits || !aggregatedData) return null

    const highlights = {
      directors: [],
      topCast: []
    }

    // Find directors that are in the collection's top directors
    if (movie.credits.crew && aggregatedData.topDirectors) {
      const movieDirectors = movie.credits.crew.filter(member => member.job === 'Director')
      highlights.directors = movieDirectors.filter(director => 
        aggregatedData.topDirectors.some(topDirector => topDirector.id === director.id)
      ).slice(0, 2) // Limit to 2 directors
    }

    // Find cast that are in the collection's top cast
    if (movie.credits.cast && aggregatedData.topCast) {
      highlights.topCast = movie.credits.cast.filter(actor =>
        aggregatedData.topCast.some(topActor => topActor.id === actor.id)
      ).slice(0, 4) // Limit to 4 top cast members
    }

    return highlights
  }

  const contributorHighlights = getContributorHighlights()

  return (
    <>
      {/* Year label */}
      <div className="absolute -left-4 sm:-left-6 text-sm font-medium text-indigo-400 w-10 text-right">
        {year}
      </div>
      
      {/* Timeline dot */}
      <div className="absolute left-6 w-4 h-4 bg-indigo-600 rounded-full border-4 border-gray-950 z-10" />

      <div className="ml-16 flex-1">
        <div className={`bg-gray-900/50 backdrop-blur-sm rounded-xl p-6 border border-gray-800 hover:bg-gray-900/70 transition-all duration-300 ${
          movie.isOwned ? '' : 'opacity-75'
        }`}>
          
          <div className="flex gap-6">
            {/* Movie Poster */}
            <div className="flex-shrink-0">
              <img
                src={movie.posterURL || '/sorry-image-not-available.jpg'}
                alt={movie.title}
                className={`w-24 h-36 object-cover rounded-lg transition-all duration-300 ${
                  movie.isOwned ? '' : 'filter grayscale hover:grayscale-0'
                }`}
                loading="lazy"
              />
            </div>

            {/* Movie Info */}
            <div className="flex-1">
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-xl font-bold text-white pr-4">{movie.title}</h3>
                <span className="text-indigo-400 font-semibold whitespace-nowrap">{year}</span>
              </div>

              {/* Enhanced: Contributor Callouts */}
              {enhanced && contributorHighlights && (contributorHighlights.directors.length > 0 || contributorHighlights.topCast.length > 0) && (
                <div className="flex flex-wrap gap-2 mb-4">
                  
                  {/* Director Callouts */}
                  {contributorHighlights.directors.map(director => (
                    <motion.div 
                      key={director.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-purple-600/20 text-purple-300 rounded-full text-sm border border-purple-600/30"
                    >
                      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                      </svg>
                      <span className="font-medium">Director:</span>
                      <span>{director.name}</span>
                    </motion.div>
                  ))}
                  
                  {/* Top Cast Callouts */}
                  {contributorHighlights.topCast.map(actor => (
                    <motion.div 
                      key={actor.id}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-blue-600/20 text-blue-300 rounded-full text-sm border border-blue-600/30"
                      title={actor.character || 'Actor'}
                    >
                      <span>{actor.name}</span>
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Movie Overview (if available) */}
              {(movie.metadata?.overview || movie.tmdbData?.overview) && (
                <p className="text-gray-300 text-sm mb-4 line-clamp-2 leading-relaxed">
                  {movie.metadata?.overview || movie.tmdbData?.overview}
                </p>
              )}

              {/* Movie Details Row */}
              <div className="flex items-center gap-4 mb-4">
                {rating && rating > 0 && (
                  <div className="flex items-center gap-1">
                    <span className="text-yellow-400">★</span>
                    <span className="text-white font-medium">{rating.toFixed(1)}</span>
                  </div>
                )}
                
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  movie.isOwned
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-gray-700/50 text-gray-400 border border-gray-600'
                }`}>
                  {movie.isOwned ? 'In Library' : 'Not Available'}
                </span>

                {/* Runtime - prioritizing database duration over TMDB */}
                {(() => {
                  const duration = getFormattedDuration(movie);
                  return duration && (
                    <div className="flex items-center gap-1 text-gray-400 text-sm">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{duration}</span>
                    </div>
                  );
                })()}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3">
                {movie.isOwned && (
                  <Link
                    href={movie.url || `/list/movie/${encodeURIComponent(movie.title)}`}
                    className="inline-flex items-center text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
                  >
                    Watch Now
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )}

                {(movie.tmdbId || movie.id) && (
                  <WatchlistButton
                    mediaId={movie.mediaId}
                    tmdbId={movie.tmdbId}
                    mediaType="movie"
                    title={movie.title}
                    posterURL={movie.posterURL}
                    variant={movie.isOwned ? 'icon-only' : 'default'}
                    className={movie.isOwned
                      ? 'text-gray-400 hover:text-gray-300 transition-colors bg-transparent border-0 p-1'
                      : 'text-gray-400 hover:text-gray-300 transition-colors bg-transparent border-0 p-0'
                    }
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
})

EnhancedTimelineMovieCard.displayName = 'EnhancedTimelineMovieCard'

/**
 * Loading skeleton for EnhancedTimelineView
 */
export const EnhancedTimelineViewSkeleton = ({ count = 5 }) => {
  return (
    <div className="relative">
      <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-indigo-600 via-indigo-500 to-indigo-600" />
      
      <div className="animate-pulse">
        {[...Array(count)].map((_, index) => (
          <div key={index} className="relative flex items-center mb-8">
            {/* Year placeholder */}
            <div className="absolute -left-4 sm:-left-6 w-10 h-5 bg-gray-700 rounded" />
            
            <div className="absolute left-6 w-4 h-4 bg-gray-700 rounded-full" />
            
            <div className="ml-16 flex-1">
              <div className="bg-gray-800/50 rounded-xl p-6 border border-gray-700">
                <div className="flex gap-6">
                  <div className="w-24 h-36 bg-gray-700 rounded-lg flex-shrink-0" />
                  
                  <div className="flex-1">
                    <div className="flex justify-between mb-3">
                      <div className="w-48 h-6 bg-gray-700 rounded" />
                      <div className="w-12 h-6 bg-gray-700 rounded" />
                    </div>
                    
                    <div className="flex gap-2 mb-4">
                      <div className="w-24 h-6 bg-gray-700 rounded-full" />
                      <div className="w-20 h-6 bg-gray-700 rounded-full" />
                      <div className="w-16 h-6 bg-gray-700 rounded-full" />
                    </div>
                    
                    <div className="w-full h-4 bg-gray-700 rounded mb-2" />
                    <div className="w-3/4 h-4 bg-gray-700 rounded mb-4" />
                    
                    <div className="flex gap-4 mb-4">
                      <div className="w-12 h-6 bg-gray-700 rounded" />
                      <div className="w-20 h-6 bg-gray-700 rounded-full" />
                    </div>
                    
                    <div className="flex gap-3">
                      <div className="w-20 h-8 bg-gray-700 rounded" />
                      <div className="w-8 h-8 bg-gray-700 rounded" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default EnhancedTimelineView