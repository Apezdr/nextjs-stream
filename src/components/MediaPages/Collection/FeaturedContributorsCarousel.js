'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'

/**
 * FeaturedContributorsCarousel - Interactive horizontal carousel displaying top cast and directors
 * Features tabbed interface, smooth scrolling, hover details, and responsive design
 *
 * Can work in two modes:
 * 1. With provided data (topCast, topDirectors props)
 * 2. With collectionId for autonomous data fetching (progressive enhancement)
 */
const FeaturedContributorsCarousel = ({
  collectionId,
  topCast: propTopCast = [],
  topDirectors: propTopDirectors = [],
  className = ""
}) => {
  // State for autonomous data fetching
  const [enhancedData, setEnhancedData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('cast')
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)
  const scrollRef = useRef(null)

  // Fetch enhanced data if collectionId provided but no prop data
  useEffect(() => {
    const shouldFetch = collectionId && propTopCast.length === 0 && propTopDirectors.length === 0
    
    if (!shouldFetch) return

    const fetchEnhancedData = async () => {
      setLoading(true)
      setError(null)

      try {
        console.log(`[FeaturedContributorsCarousel] Fetching enhanced data for collection ${collectionId}`)
        const response = await fetch(`/api/authenticated/tmdb/collection/${collectionId}/enhanced`)
        
        if (!response.ok) {
          console.warn(`[FeaturedContributorsCarousel] Enhanced collection data not available (status: ${response.status})`)
          return
        }
        
        const data = await response.json()
        console.log(`[FeaturedContributorsCarousel] Received enhanced data:`, data)
        setEnhancedData(data)
      } catch (err) {
        console.error(`[FeaturedContributorsCarousel] Failed to fetch enhanced collection data:`, err)
        setError(err)
      } finally {
        setLoading(false)
      }
    }

    fetchEnhancedData()
  }, [collectionId, propTopCast.length, propTopDirectors.length])

  // Use either prop data or fetched data (fix data structure access)
  const topCast = propTopCast.length > 0 ? propTopCast : (enhancedData?.aggregatedData?.topCast || [])
  const topDirectors = propTopDirectors.length > 0 ? propTopDirectors : (enhancedData?.aggregatedData?.topDirectors || [])

  // Update scroll buttons state
  const updateScrollButtons = () => {
    if (scrollRef.current) {
      const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current
      setCanScrollLeft(scrollLeft > 0)
      setCanScrollRight(scrollLeft < scrollWidth - clientWidth - 1)
    }
  }

  // Handle scroll navigation
  const scroll = (direction) => {
    if (scrollRef.current) {
      const scrollAmount = 320 // Approximately 2 cards
      const newScrollLeft = direction === 'left'
        ? scrollRef.current.scrollLeft - scrollAmount
        : scrollRef.current.scrollLeft + scrollAmount
      
      scrollRef.current.scrollTo({
        left: newScrollLeft,
        behavior: 'smooth'
      })
    }
  }

  // Update scroll buttons on mount and when content changes
  useEffect(() => {
    updateScrollButtons()
  }, [activeTab, topCast, topDirectors])

  // Show loading skeleton if currently fetching
  if (loading) {
    return <FeaturedContributorsCarouselSkeleton className={className} />
  }

  // Don't render if no contributors (either from props or fetch)
  if (topCast.length === 0 && topDirectors.length === 0) {
    return null
  }

  const currentContributors = activeTab === 'cast' ? topCast : topDirectors

  return (
    <div className={`mt-8 ${className}`}>
      
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Featured Contributors</h2>
        
        {/* Tab Switcher */}
        <div className="flex gap-2">
          <button 
            onClick={() => setActiveTab('cast')}
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${
              activeTab === 'cast' 
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25' 
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Cast ({topCast.length})
          </button>
          <button 
            onClick={() => setActiveTab('directors')}
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${
              activeTab === 'directors' 
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25' 
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            Directors ({topDirectors.length})
          </button>
        </div>
      </div>
      
      {/* Carousel Container */}
      <div className="relative">
        
        {/* Navigation Buttons */}
        <button 
          onClick={() => scroll('left')}
          disabled={!canScrollLeft}
          className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full transition-all duration-300 ${
            canScrollLeft 
              ? 'bg-black/50 hover:bg-black/70 text-white' 
              : 'bg-gray-800/30 text-gray-600 cursor-not-allowed'
          }`}
          aria-label="Scroll left"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        
        <button 
          onClick={() => scroll('right')}
          disabled={!canScrollRight}
          className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full transition-all duration-300 ${
            canScrollRight 
              ? 'bg-black/50 hover:bg-black/70 text-white' 
              : 'bg-gray-800/30 text-gray-600 cursor-not-allowed'
          }`}
          aria-label="Scroll right"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        
        {/* Scrollable Content */}
        <div 
          ref={scrollRef}
          className="flex gap-4 overflow-x-auto scrollbar-hide pb-2 px-8"
          onScroll={updateScrollButtons}
          style={{ 
            scrollbarWidth: 'none',
            msOverflowStyle: 'none'
          }}
        >
          <AnimatePresence mode="wait">
            {currentContributors.map((contributor) => (
              <motion.div
                key={`${activeTab}-${contributor.id}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.3 }}
              >
                <ContributorCard 
                  contributor={contributor}
                  type={activeTab === 'cast' ? 'actor' : 'director'}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
        
      </div>
      
    </div>
  )
}

/**
 * ContributorCard - Individual card component for cast/director
 */
const ContributorCard = ({ contributor, type }) => {
  const [isHovered, setIsHovered] = useState(false)

  const getDisplayInfo = () => {
    if (type === 'actor') {
      return {
        subtitle: `${contributor.appearances} appearance${contributor.appearances > 1 ? 's' : ''}`,
        details: contributor.movies?.slice(0, 3).join(', ') || '',
        moreCount: Math.max(0, (contributor.movies?.length || 0) - 3)
      }
    } else {
      return {
        subtitle: `${contributor.movieCount} movie${contributor.movieCount > 1 ? 's' : ''}`,
        details: contributor.movieTitles?.slice(0, 3).join(', ') || '',
        moreCount: Math.max(0, (contributor.movieTitles?.length || 0) - 3)
      }
    }
  }

  const { subtitle, details, moreCount } = getDisplayInfo()

  return (
    <div 
      className="flex-shrink-0 w-40 group cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      
      {/* Profile Image Container */}
      <div className="relative mb-3 overflow-hidden rounded-lg">
        <Image
          src={contributor.profile_path
            ? `https://image.tmdb.org/t/p/w185${contributor.profile_path}`
            : '/sorry-image-not-available.jpg'
          }
          alt={contributor.name}
          width={185}
          height={278}
          className="w-full h-48 object-cover transition-transform duration-300 group-hover:scale-105"
          loading="lazy"
          onError={(e) => {
            e.target.src = '/sorry-image-not-available.jpg'
          }}
        />
        
        {/* Hover Overlay with Details */}
        <AnimatePresence>
          {isHovered && details && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/80 flex items-center justify-center p-3"
            >
              <div className="text-center text-white">
                <p className="text-sm font-medium mb-2">
                  {subtitle}
                </p>
                <p className="text-xs text-gray-300 line-clamp-3 leading-relaxed">
                  {details}
                  {moreCount > 0 && (
                    <span className="text-gray-400"> +{moreCount} more</span>
                  )}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        
      </div>
      
      {/* Contributor Info */}
      <div className="text-center">
        <h3 className="font-medium text-white text-sm mb-1 line-clamp-2 leading-tight">
          {contributor.name}
        </h3>
        <p className="text-xs text-gray-400">
          {subtitle}
        </p>
      </div>
      
    </div>
  )
}

/**
 * Loading skeleton for FeaturedContributorsCarousel
 */
export const FeaturedContributorsCarouselSkeleton = () => {
  return (
    <div className="mt-8">
      <div className="animate-pulse">
        
        {/* Header Skeleton */}
        <div className="flex items-center justify-between mb-6">
          <div className="w-48 h-8 bg-gray-700 rounded" />
          <div className="flex gap-2">
            <div className="w-20 h-10 bg-gray-700 rounded" />
            <div className="w-24 h-10 bg-gray-700 rounded" />
          </div>
        </div>
        
        {/* Carousel Skeleton */}
        <div className="flex gap-4 px-8">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex-shrink-0 w-40">
              <div className="w-full h-48 bg-gray-700 rounded-lg mb-3" />
              <div className="w-32 h-4 bg-gray-700 rounded mb-1" />
              <div className="w-20 h-3 bg-gray-700 rounded" />
            </div>
          ))}
        </div>
        
      </div>
    </div>
  )
}

export default FeaturedContributorsCarousel