// Collection Movies Client Component
// Phase 2: Streaming & Suspense - Optimized client component for interactive features

'use client'

import { useState, useMemo, memo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getFormattedDuration } from '@src/utils/tmdb/client'
import Image from 'next/image'
import Link from 'next/link'
import dynamic from 'next/dynamic'

// *** VERCEL BEST PRACTICE: code-splitting ***
// Dynamic import for non-critical components to reduce bundle size
const WatchlistButton = dynamic(() => import('@components/WatchlistButton'), { 
  ssr: false,
  loading: () => <div className="w-8 h-8 bg-gray-700 rounded animate-pulse" />
})

const EnhancedTimelineView = dynamic(() => 
  import('../Collection').then(m => ({ default: m.EnhancedTimelineView })), 
  { 
    ssr: false,
    loading: () => (
      <div className="space-y-8">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-32 bg-gray-800 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }
)

// *** VERCEL BEST PRACTICE: component-memoization ***
// Optimized movie card with React.memo for performance
const MovieCard = memo(({ movie, index }) => {
  const isOwned = movie.isOwned
  const releaseYear = movie.metadata?.release_date || movie.tmdbData?.release_date
    ? new Date(movie.metadata?.release_date || movie.tmdbData?.release_date).getFullYear()
    : null
  const rating = movie.metadata?.vote_average || movie.tmdbData?.vote_average
  const duration = getFormattedDuration(movie)

  return (
    <div
      className="group animate-fade-in-up relative"
      style={{ animationDelay: `${Math.min(index * 50, 1000)}ms` }}
    >
      <div className={`relative rounded-xl overflow-hidden transition-all duration-500 transform group-hover:scale-105 group-hover:z-10 ${
        isOwned ? '' : 'opacity-75 group-hover:opacity-100'
      }`}>
        {/* Enhanced Shadow */}
        <div className="absolute inset-0 rounded-xl transition-all duration-500 pointer-events-none shadow-lg shadow-black/50 group-hover:shadow-2xl group-hover:shadow-indigo-500/20" />

        {/* Poster Container */}
        <div className="aspect-[2/3] relative bg-gray-900">
          {/* Poster Image */}
          <Image
            src={movie.posterURL || '/sorry-image-not-available.jpg'}
            alt={movie.title}
            fill
            className={`object-cover transition-all duration-700 ${
              isOwned ? '' : 'filter grayscale hover:grayscale-0'
            }`}
            sizes="(max-width: 640px) 50vw, (max-width: 768px) 33vw, (max-width: 1024px) 25vw, (max-width: 1280px) 20vw, 16vw"
          />

          {/* Gradient Overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-90" />

          {/* Top badges */}
          <div className="absolute top-3 left-3 right-3 flex justify-between items-start">
            <div className="flex flex-col gap-2">
              {rating && rating > 0 && (
                <div className="bg-black/70 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-full font-medium flex items-center gap-1">
                  <span className="text-yellow-400">★</span>
                  {rating.toFixed(1)}
                </div>
              )}
              {duration && (
                <div className="bg-black/70 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-full font-medium flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {duration}
                </div>
              )}
            </div>

            <div className={`text-white text-xs px-3 py-1.5 rounded-full font-medium backdrop-blur-sm ${
              isOwned
                ? 'bg-green-500/80 shadow-lg shadow-green-500/25'
                : 'bg-gray-600/80'
            }`}>
              {isOwned ? 'In Library' : 'Not Available'}
            </div>
          </div>

          {/* Movie Info */}
          <div className="absolute bottom-0 left-0 right-0 p-4">
            <h3 className="font-bold text-white text-base mb-1 line-clamp-2 drop-shadow-lg">
              {movie.title}
            </h3>
            {releaseYear && (
              <p className="text-sm text-gray-300 drop-shadow-lg">
                {releaseYear}
              </p>
            )}
          </div>

          {/* Hover Overlay Background */}
          <div className="absolute inset-0 bg-gradient-to-t from-indigo-900/90 via-indigo-900/50 to-transparent transition-opacity duration-300 pointer-events-none opacity-0 group-hover:opacity-100" />

          {/* Interactive buttons (shown on hover) */}
          <div className="absolute inset-0 pointer-events-none">
            {isOwned && (
              <div className="absolute bottom-4 left-4 right-4 flex gap-2 transition-opacity duration-300 pointer-events-auto opacity-0 group-hover:opacity-100">
                {(movie.tmdbId || movie.id) && (
                  <WatchlistButton
                    mediaId={movie.mediaId}
                    tmdbId={movie.tmdbId}
                    mediaType="movie"
                    title={movie.title}
                    posterURL={movie.posterURL}
                    variant="icon-only"
                    className="bg-gray-700/80 hover:bg-gray-600 text-white p-2 rounded-lg transition-colors duration-300"
                  />
                )}
                <Link
                  href={movie.url || `/list/movie/${encodeURIComponent(movie.title)}`}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white text-center py-2 rounded-lg font-medium transition-colors duration-300"
                >
                  Watch Now
                </Link>
              </div>
            )}

            {!isOwned && (movie.tmdbId || movie.id) && (
              <div className="absolute bottom-4 left-4 right-4 transition-opacity duration-300 pointer-events-auto opacity-0 group-hover:opacity-100">
                <WatchlistButton
                  mediaId={movie.mediaId}
                  tmdbId={movie.tmdbId}
                  mediaType="movie"
                  title={movie.title}
                  posterURL={movie.posterURL}
                  variant="default"
                  className="w-full bg-gray-700 hover:bg-gray-600 hover:text-white py-2 rounded-lg font-medium transition-colors duration-300 border-0"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})

MovieCard.displayName = 'MovieCard'

export default function CollectionMoviesClient({ 
  collection, 
  defaultFilter = 'all', 
  defaultSort = 'release_date' 
}) {
  const [filter, setFilter] = useState(defaultFilter)
  const [sortBy, setSortBy] = useState(defaultSort)
  const [viewMode, setViewMode] = useState('grid') // 'grid' or 'timeline'

  const parts = collection.parts || []
  const ownershipStats = collection.ownershipStats || {}

  // *** VERCEL BEST PRACTICE: expensive-computation-memo ***
  // Memoize expensive filtering and sorting operations
  const filteredAndSortedMovies = useMemo(() => {
    let filtered = [...parts]

    switch (filter) {
      case 'owned':
        filtered = parts.filter((movie) => movie.isOwned)
        break
      case 'not-owned':
        filtered = parts.filter((movie) => !movie.isOwned)
        break
      default:
        filtered = [...parts]
    }

    return filtered.sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title)
        case 'rating': {
          const ratingA = (a.metadata?.vote_average || a.tmdbData?.vote_average) || 0
          const ratingB = (b.metadata?.vote_average || b.tmdbData?.vote_average) || 0
          return ratingB - ratingA
        }
        case 'release_date':
        default: {
          const dateStringA = a.metadata?.release_date || a.tmdbData?.release_date
          const dateStringB = b.metadata?.release_date || b.tmdbData?.release_date

          if (!dateStringA && !dateStringB) return 0
          if (!dateStringA) return 1
          if (!dateStringB) return -1

          const dateA = new Date(dateStringA)
          const dateB = new Date(dateStringB)

          const isValidA = !isNaN(dateA.getTime())
          const isValidB = !isNaN(dateB.getTime())

          if (!isValidA && !isValidB) return 0
          if (!isValidA) return 1
          if (!isValidB) return -1

          return dateA - dateB
        }
      }
    })
  }, [parts, filter, sortBy])

  return (
    <>
      {/* Enhanced Filter and Sort Controls */}
      <div className="sticky top-16 z-20 bg-gray-900/95 backdrop-blur-xl border-b border-gray-800">
        <div className="max-w-7xl mx-auto px-4 md:px-8 py-4">
          <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
            {/* Filter Pills */}
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'all', label: 'Show All', count: parts.length, color: 'indigo' },
                { id: 'owned', label: 'In Library', count: ownershipStats.owned || 0, color: 'green' },
                { id: 'not-owned', label: 'Not Available', count: (ownershipStats.total || 0) - (ownershipStats.owned || 0), color: 'gray' }
              ].map((filterOption) => (
                <button
                  key={filterOption.id}
                  onClick={() => setFilter(filterOption.id)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all duration-300 transform hover:scale-105 ${
                    filter === filterOption.id
                      ? filterOption.color === 'indigo'
                        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25'
                        : filterOption.color === 'green'
                        ? 'bg-green-600 text-white shadow-lg shadow-green-600/25'
                        : 'bg-gray-600 text-white shadow-lg shadow-gray-600/25'
                      : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                  }`}
                >
                  {filterOption.label} ({filterOption.count})
                </button>
              ))}
            </div>

            {/* Controls */}
            <div className="flex items-center gap-4">
              {/* View Mode Toggle */}
              <div className="flex bg-gray-800 rounded-lg p-1">
                <button
                  onClick={() => setViewMode('grid')}
                  className={`p-2 rounded transition-all duration-300 ${
                    viewMode === 'grid' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                  aria-label="Grid view"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
                  </svg>
                </button>
                <button
                  onClick={() => setViewMode('timeline')}
                  className={`p-2 rounded transition-all duration-300 ${
                    viewMode === 'timeline' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:text-white'
                  }`}
                  aria-label="Timeline view"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </button>
              </div>

              {/* Sort Dropdown */}
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="bg-gray-800 text-white border border-gray-700 rounded-lg px-4 pl-2 pr-8 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all duration-300"
              >
                <option value="release_date">Release Date</option>
                <option value="title">Title</option>
                <option value="rating">Rating</option>
              </select>
            </div>
          </div>

          {/* Results count */}
          <div className="mt-4 text-sm text-gray-400">
            Showing {filteredAndSortedMovies.length} of {parts.length} movies
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8">
        {filteredAndSortedMovies.length > 0 ? (
          viewMode === 'grid' ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6">
              <AnimatePresence mode="popLayout">
                {filteredAndSortedMovies.map((movie, index) => (
                  <motion.div
                    key={`${movie.id || movie.title}-${index}`}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={{
                      opacity: { duration: 0.2 },
                      scale: { duration: 0.2 },
                      layout: { duration: 0.3 }
                    }}
                  >
                    <MovieCard movie={movie} index={index} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <EnhancedTimelineView
              movies={filteredAndSortedMovies}
              collectionId={collection.id}
            />
          )
        ) : (
          <div className="text-center py-16">
            <div className="text-gray-400 text-lg mb-4">
              No movies found for the selected filter.
            </div>
            <button
              onClick={() => setFilter('all')}
              className="text-indigo-400 hover:text-indigo-300 underline transition-colors"
            >
              Show all movies
            </button>
          </div>
        )}
      </div>
    </>
  )
}