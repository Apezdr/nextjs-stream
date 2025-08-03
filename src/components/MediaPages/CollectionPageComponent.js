'use client'

import { useState, useMemo, useEffect, memo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence, animate } from 'framer-motion'
import { classNames } from '@src/utils'
const WatchlistButton = dynamic(() => import('@components/WatchlistButton'), { ssr: false })

/**
 * ExpandableText - shows a truncated preview with "Read more" and animates expansion.
 */
function ExpandableText({ text, collapseAfter = 300 }) {
  const [expanded, setExpanded] = useState(false)
  const hasOverflow = useMemo(() => text.length > collapseAfter, [text, collapseAfter])

  return (
    <motion.div layout="size" className="max-w-3xl relative">
      <motion.div
        layout="size"
        initial={false}
        className={classNames(
          "relative p-2",
          expanded ? "overflow-hidden rounded-2xl" : ""
        )}
      >
        {/* Glow pulse when expanded */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="glow"
              className="absolute inset-0 rounded-2xl pointer-events-none"
              style={{
                background:
                  'linear-gradient(90deg, rgba(167,139,250,0.2), rgba(129,140,248,0.2))'
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.6 }}
              exit={{ opacity: 0 }}
              transition={{
                animate: { duration: 0.6, delay: 0.8 },
                exit: { duration: 0.3 }
              }}
            />
          )}
        </AnimatePresence>

        <motion.p
          layout="position"
          className={`text-lg leading-relaxed relative z-10 transition-colors duration-500 ${
            !expanded && hasOverflow ? 'line-clamp-3' : ''
          }`}
        >
          {text}
        </motion.p>
      </motion.div>

      {hasOverflow && (
        <div className="mt-4">
          <motion.button
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="relative inline-flex items-center gap-2 text-sm font-medium px-4 py-2 rounded-full bg-gray-900/80 backdrop-blur-sm border border-indigo-400/30 hover:bg-indigo-900/50 transition-all duration-300 text-indigo-400 hover:text-indigo-300"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            layout
          >
            <span>{expanded ? 'Show less' : 'Read more'}</span>
            <motion.svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              animate={{ rotate: expanded ? 180 : 0, scale: expanded ? 1.1 : 1 }}
              transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </motion.svg>

            <AnimatePresence>
              {expanded && (
                <motion.div
                  key="pulse"
                  className="absolute inset-0 rounded-full"
                  aria-hidden="true"
                  initial={{ scale: 1, opacity: 0.4 }}
                  animate={{ scale: [1, 1.08, 1], opacity: [0.4, 0.7, 0.4] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  style={{
                    background:
                      'radial-gradient(circle at 30% 50%, rgba(167,139,250,0.2), transparent 60%), radial-gradient(circle at 70% 50%, rgba(129,140,248,0.2), transparent 60%)'
                  }}
                />
              )}
            </AnimatePresence>
          </motion.button>
        </div>
      )}
    </motion.div>
  )
}

// Collection Header Component - static expanded header
const CollectionHeader = ({ collection, completionPercentage }) => {
  const { name, overview, backdrop, ownershipStats } = collection

  return (
    <div className={classNames(
      "relative min-h-96",
      backdrop ? 'min-h-[34rem]' : 'min-h-96'
    )}> 
      {/* Animated Backdrop */}
      {backdrop && (
        <>
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={backdrop}
              alt={`${name} backdrop`}
              className="w-full h-full object-cover transform scale-110 animate-slow-zoom"
            />
            {/* Multiple gradient overlays for depth */}
            <div className="absolute inset-0 bg-gradient-to-t from-gray-950 via-gray-950/50 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-gray-950/50 via-transparent to-gray-950/50" />
            <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-gray-950 to-transparent" />
          </div>

          {/* Animated particles overlay */}
          <div className="absolute inset-0 overflow-hidden">
            {[...Array(20)].map((_, i) => (
              <div
                key={i}
                className="absolute w-1 h-1 bg-white/20 rounded-full animate-float"
                style={{
                  left: `${Math.random() * 100}%`,
                  top: `${Math.random() * 100}%`,
                  animationDelay: `${Math.random() * 5}s`,
                  animationDuration: `${15 + Math.random() * 10}s`
                }}
              />
            ))}
          </div>
        </>
      )}

      {/* Header Content */}
      <div className="relative min-h-96 flex items-end">
        <div className="w-full px-4 md:px-8 py-6 pt-24 pb-8">
          <div className="max-w-7xl mx-auto">
            {/* Breadcrumb */}
            <nav className={classNames("mb-6 animate-fade-in", backdrop ? "mb-32" : "mb-6")}>
              <Link
                href="/list/movie"
                className="inline-flex items-center text-indigo-400 hover:text-indigo-300 transition-all duration-300 group"
              >
                <svg
                  className="w-4 h-4 mr-2 transform group-hover:-translate-x-1 transition-transform"
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
                Back to Movies
              </Link>
            </nav>

            <div className="text-center md:text-left">
              {/* Title and Info */}
              <div className="w-full">
                <h1 className="font-bold text-white text-4xl md:text-6xl mb-4 animate-fade-in-up">
                  {name}
                </h1>

                {/* Enhanced Stats with Progress Bar */}
                <div className="flex flex-wrap justify-center md:justify-start gap-4 mb-6 animate-fade-in-up animation-delay-100">
                  <div className="bg-gray-800/60 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-700/50 hover:bg-gray-800/80 transition-all duration-300">
                    <span className="text-white font-semibold">{(ownershipStats && ownershipStats.total) || 0}</span>
                    <span className="text-gray-400 ml-1">Movies</span>
                  </div>

                  {/* Progress indicator */}
                  <div className="flex items-center gap-3 bg-gray-800/60 backdrop-blur-sm px-4 py-2 rounded-full border border-gray-700/50">
                    <span className="text-green-400 font-semibold">
                      {(ownershipStats && ownershipStats.owned) || 0}/{(ownershipStats && ownershipStats.total) || 0}
                    </span>
                    <span className="text-gray-400">Available</span>
                  </div>
                </div>

                {/* Overview with ExpandableText */}
                {overview && (
                  <motion.div
                    className="max-w-3xl mx-auto md:mx-0 animate-fade-in-up animation-delay-200"
                    layout="size"
                    transition={{ duration: 0.3 }}
                  >
                    <ExpandableText text={overview} collapseAfter={300} />
                  </motion.div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const CollectionPageComponent = ({ collection, collectionId }) => {
  const [filter, setFilter] = useState('all')
  const [sortBy, setSortBy] = useState('release_date')
  const [viewMode, setViewMode] = useState('grid') // 'grid' or 'timeline'

  // Add global styles on mount
  useEffect(() => {
    const styleId = 'collection-page-animations'
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style')
      style.id = styleId
      style.innerHTML = `
        @keyframes fade-in-up {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes fade-in-left {
          from {
            opacity: 0;
            transform: translateX(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }

        @keyframes slow-zoom {
          0%, 100% {
            transform: scale(1.1);
          }
          50% {
            transform: scale(1.15);
          }
        }

        @keyframes float {
          0%, 100% {
            transform: translateY(0) translateX(0);
          }
          33% {
            transform: translateY(-10px) translateX(5px);
          }
          66% {
            transform: translateY(5px) translateX(-5px);
          }
        }

        .animate-fade-in-up {
          animation: fade-in-up 0.6s ease-out forwards;
          opacity: 0;
        }

        .animate-fade-in-left {
          animation: fade-in-left 0.6s ease-out forwards;
          opacity: 0;
        }

        .animate-fade-in {
          animation: fade-in-up 0.6s ease-out forwards;
          opacity: 0;
        }

        .animate-slow-zoom {
          animation: slow-zoom 20s ease-in-out infinite;
        }

        .animate-float {
          animation: float 15s ease-in-out infinite;
        }

        .animation-delay-100 {
          animation-delay: 100ms;
        }

        .animation-delay-200 {
          animation-delay: 200ms;
        }

        .line-clamp-3 {
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .line-clamp-4 {
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .line-clamp-6 {
          display: -webkit-box;
          -webkit-line-clamp: 6;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `
      document.head.appendChild(style)
    }

    return () => {
      const existingStyle = document.getElementById(styleId)
      if (existingStyle) {
        existingStyle.remove()
      }
    }
  }, [])

  if (!collection) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center space-y-4">
          <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-400 animate-pulse">Loading collection...</p>
        </div>
      </div>
    )
  }

  const parts = (collection.parts || [])
  const ownershipStats = collection.ownershipStats || {}

  // Filter and sort movies
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
        case 'rating':
          const ratingA = (a.metadata?.vote_average || a.tmdbData?.vote_average) || 0
          const ratingB = (b.metadata?.vote_average || b.tmdbData?.vote_average) || 0
          return ratingB - ratingA
        case 'release_date':
        default:
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
    })
  }, [parts, filter, sortBy])

  const completionPercentage = ((ownershipStats.owned || 0) / (ownershipStats.total || 1)) * 100

  return (
    <div className="min-h-screen bg-gray-950">
      {/* Static Collection Header */}
      <CollectionHeader
        collection={collection}
        completionPercentage={completionPercentage}
      />

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
                    <MemoizedMovieCard movie={movie} index={index} />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ) : (
            <MemoizedTimelineView movies={filteredAndSortedMovies} />
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
    </div>
  )
}

// Enhanced Movie Card Component - Memoized for performance
const MovieCard = memo(({ movie, index }) => {
  const isOwned = movie.isOwned
  const releaseYear = movie.metadata?.release_date || movie.tmdbData?.release_date
    ? new Date(movie.metadata?.release_date || movie.tmdbData?.release_date).getFullYear()
    : null
  const rating = movie.metadata?.vote_average || movie.tmdbData?.vote_average

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
          <img
            src={movie.posterURL || '/sorry-image-not-available.jpg'}
            alt={movie.title}
            className={`w-full h-full object-cover transition-all duration-700 ${
              isOwned ? '' : 'filter grayscale hover:grayscale-0'
            }`}
            loading="lazy"
          />

          {/* Gradient Overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-90" />

          {/* Top badges */}
          <div className="absolute top-3 left-3 right-3 flex justify-between items-start">
            {rating && rating > 0 && (
              <div className="bg-black/70 backdrop-blur-sm text-white text-xs px-2.5 py-1.5 rounded-full font-medium flex items-center gap-1">
                <span className="text-yellow-400">★</span>
                {rating.toFixed(1)}
              </div>
            )}

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

          {/* Always-present buttons (hidden by default, shown on hover) */}
          <div className="absolute inset-0 pointer-events-none">
            {isOwned && (
              <div className="absolute bottom-4 left-4 right-4 flex gap-2 transition-opacity duration-300 pointer-events-auto opacity-0 group-hover:opacity-100">
                {(movie.tmdbId || movie.id) && (
                  <WatchlistButton
                    mediaId={movie.id ?? null}
                    tmdbId={movie.tmdbId ?? null}
                    mediaType="movie"
                    title={movie.title}
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
                  mediaId={movie.id ?? null}
                  tmdbId={movie.tmdbId ?? null}
                  mediaType="movie"
                  title={movie.title}
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
const MemoizedMovieCard = memo(MovieCard)

// Timeline Movie Card Content
const TimelineMovieCardContent = memo(({ movie }) => {
  const releaseDate = movie.metadata?.release_date || movie.tmdbData?.release_date
  const year = releaseDate ? new Date(releaseDate).getFullYear() : 'Unknown'
  const rating = movie.metadata?.vote_average || movie.tmdbData?.vote_average

  return (
    <>
      <div className="absolute left-6 w-4 h-4 bg-indigo-600 rounded-full border-4 border-gray-950 z-10" />

      <div className="ml-16 flex-1">
        <div className={`bg-gray-900/50 backdrop-blur-sm rounded-xl p-6 border border-gray-800 hover:bg-gray-900/70 transition-all duration-300 ${
          movie.isOwned ? '' : 'opacity-75'
        }`}>
          <div className="flex gap-6">
            <div className="flex-shrink-0">
              <img
                src={movie.posterURL || '/sorry-image-not-available.jpg'}
                alt={movie.title}
                className={`w-24 h-36 object-cover rounded-lg ${
                  movie.isOwned ? '' : 'filter grayscale'
                }`}
                loading="lazy"
              />
            </div>

            <div className="flex-1">
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-xl font-bold text-white">{movie.title}</h3>
                <span className="text-indigo-400 font-semibold">{year}</span>
              </div>

              <div className="flex items-center gap-4 mb-4">
                {rating && (
                  <div className="flex items-center gap-1">
                    <span className="text-yellow-400">★</span>
                    <span className="text-white">{rating.toFixed(1)}</span>
                  </div>
                )}
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                  movie.isOwned
                    ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                    : 'bg-gray-700/50 text-gray-400 border border-gray-600'
                }`}>
                  {movie.isOwned ? 'In Library' : 'Not Available'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                {movie.isOwned && (
                  <Link
                    href={movie.url || `/list/movie/${encodeURIComponent(movie.title)}`}
                    className="inline-flex items-center text-indigo-400 hover:text-indigo-300 transition-colors"
                  >
                    Watch Now
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                )}

                {(movie.tmdbId || movie.id) && (
                  <WatchlistButton
                    mediaId={movie.id ?? null}
                    tmdbId={movie.tmdbId ?? null}
                    mediaType="movie"
                    title={movie.title}
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

TimelineMovieCardContent.displayName = 'TimelineMovieCardContent'

// Timeline View Component
const TimelineView = ({ movies }) => {
  return (
    <div className="relative">
      <div className="absolute left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-indigo-600 via-indigo-500 to-indigo-600" />

      <AnimatePresence mode="popLayout">
        {movies.map((movie, index) => (
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
            <TimelineMovieCardContent movie={movie} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

const MemoizedTimelineView = memo(TimelineView)

export default CollectionPageComponent
