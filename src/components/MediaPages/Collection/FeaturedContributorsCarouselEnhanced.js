'use client'

import { useState, useRef, useEffect, memo, startTransition } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import VirtualizedHorizontalList, { useScrollContext } from './VirtualizedHorizontalList'
import { CarouselErrorBoundary, ContributorCardErrorBoundary, VirtualizedListErrorBoundary } from './CarouselErrorBoundary'

/**
 * Enhanced FeaturedContributorsCarousel - High-performance carousel with virtualization
 * Uses the new VirtualizedHorizontalList for optimal performance and smooth scrolling
 * 
 * Features:
 * - All original functionality preserved
 * - Virtualized rendering for better performance
 * - Smooth momentum-based scrolling
 * - Touch gestures and keyboard navigation
 * - Responsive design with automatic breakpoints
 * - Accessibility compliant
 */

const FeaturedContributorsCarouselEnhanced = ({
  collectionId,
  topCast: propTopCast = [],
  topDirectors: propTopDirectors = [],
  className = ""
}) => {
  // State for autonomous data fetching (preserved from original)
  const [enhancedData, setEnhancedData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('cast')

  // Fetch enhanced data if collectionId provided but no prop data (preserved from original)
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
        startTransition(() => {
          setEnhancedData(data)
        })
      } catch (err) {
        console.error(`[FeaturedContributorsCarousel] Failed to fetch enhanced collection data:`, err)
        setError(err)
      } finally {
        setLoading(false)
      }
    }

    fetchEnhancedData()
  }, [collectionId, propTopCast.length, propTopDirectors.length])

  // Use either prop data or fetched data (preserved from original)
  const topCast = propTopCast.length > 0 ? propTopCast : (enhancedData?.aggregatedData?.topCast || [])
  const topDirectors = propTopDirectors.length > 0 ? propTopDirectors : (enhancedData?.aggregatedData?.topDirectors || [])

  // Show loading skeleton if currently fetching
  if (loading) {
    return <FeaturedContributorsCarouselSkeleton className={className} />
  }

  // Don't render if no contributors (either from props or fetch)
  if (topCast.length === 0 && topDirectors.length === 0) {
    return null
  }

  const currentContributors = activeTab === 'cast' ? topCast : topDirectors

  // Handle tab switching with optimistic updates
  const handleTabSwitch = (tab) => {
    startTransition(() => {
      setActiveTab(tab)
    })
  }

  return (
    <CarouselErrorBoundary onRetry={() => window.location.reload()}>
      <div className={`mt-8 ${className}`}>
      
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Featured Contributors</h2>
        
        {/* Tab Switcher */}
        <div className="flex gap-2">
          <button 
            onClick={() => handleTabSwitch('cast')}
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${
              activeTab === 'cast' 
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25' 
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
            aria-pressed={activeTab === 'cast'}
          >
            Cast ({topCast.length})
          </button>
          <button 
            onClick={() => handleTabSwitch('directors')}
            className={`px-4 py-2 rounded-lg transition-all duration-300 ${
              activeTab === 'directors' 
                ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/25' 
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
            aria-pressed={activeTab === 'directors'}
          >
            Directors ({topDirectors.length})
          </button>
        </div>
      </div>
      
      {/* Enhanced Virtualized Carousel */}
      <div className="relative min-h-[280px]">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
          >
            <VirtualizedListErrorBoundary onRetry={() => window.location.reload()}>
              <VirtualizedHorizontalList
                items={currentContributors}
                renderItem={(contributor, index, { isVisible, onClick }) => (
                  <ContributorCardErrorBoundary contributor={contributor}>
                    <ContributorCard
                      contributor={contributor}
                      type={activeTab === 'cast' ? 'actor' : 'director'}
                      isVisible={isVisible}
                      onClick={onClick}
                    />
                  </ContributorCardErrorBoundary>
                )}
                itemWidth={160}
                gap={16}
                className="h-[280px]"
                containerClassName="pb-2"
                showNavigation={true}
                keyboardNavigation={true}
                touchGestures={true}
                persistScroll={true}
                scrollKey={`contributors-${activeTab}-${collectionId || 'default'}`}
                aria-label={`Featured ${activeTab === 'cast' ? 'cast members' : 'directors'}`}
                onItemClick={(contributor, index) => {
                  console.log(`Clicked ${contributor.name} at index ${index}`)
                  // Add any click handling logic here
                }}
              />
            </VirtualizedListErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </div>
      
      </div>
    </CarouselErrorBoundary>
  )
}

/**
 * Enhanced ContributorCard with virtualization awareness
 */
const ContributorCard = memo(({ contributor, type, isVisible = true, onClick }) => {
  const [isHovered, setIsHovered] = useState(false)
  const [imageLoaded, setImageLoaded] = useState(false)

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
      onClick={onClick}
    >
      
      {/* Profile Image Container */}
      <div className="relative mb-3 overflow-hidden rounded-lg">
        {isVisible ? (
          <Image
            src={contributor.profile_path
              ? `https://image.tmdb.org/t/p/w185${contributor.profile_path}`
              : '/sorry-image-not-available.jpg'
            }
            alt={contributor.name}
            width={185}
            height={278}
            className={`w-full h-48 object-cover transition-all duration-300 group-hover:scale-105 ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            }`}
            loading="lazy"
            onLoad={() => setImageLoaded(true)}
            onError={(e) => {
              e.target.src = '/sorry-image-not-available.jpg'
              setImageLoaded(true)
            }}
          />
        ) : (
          /* Placeholder when not visible */
          <div className="w-full h-48 bg-gray-700 animate-pulse rounded-lg" />
        )}
        
        {/* Loading placeholder */}
        {isVisible && !imageLoaded && (
          <div className="absolute inset-0 bg-gray-700 animate-pulse" />
        )}
        
        {/* Hover Overlay with Details */}
        <AnimatePresence>
          {isHovered && details && isVisible && imageLoaded && (
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
})

ContributorCard.displayName = 'ContributorCard'

/**
 * Enhanced loading skeleton with virtualization
 */
export const FeaturedContributorsCarouselSkeleton = memo(({ className = "" }) => {
  // Generate skeleton items for virtualized display
  const skeletonItems = Array.from({ length: 6 }, (_, i) => ({ id: `skeleton-${i}` }))

  return (
    <div className={`mt-8 ${className}`}>
      <div className="animate-pulse">
        
        {/* Header Skeleton */}
        <div className="flex items-center justify-between mb-6">
          <div className="w-48 h-8 bg-gray-700 rounded" />
          <div className="flex gap-2">
            <div className="w-20 h-10 bg-gray-700 rounded" />
            <div className="w-24 h-10 bg-gray-700 rounded" />
          </div>
        </div>
        
        {/* Carousel Skeleton using VirtualizedHorizontalList */}
        <div className="relative min-h-[280px]">
          <VirtualizedHorizontalList
            items={skeletonItems}
            renderItem={(_, index) => (
              <div className="flex-shrink-0 w-40">
                <div className="w-full h-48 bg-gray-700 rounded-lg mb-3" />
                <div className="w-32 h-4 bg-gray-700 rounded mb-1" />
                <div className="w-20 h-3 bg-gray-700 rounded" />
              </div>
            )}
            itemWidth={160}
            gap={16}
            className="h-[280px]"
            showNavigation={false}
            keyboardNavigation={false}
            touchGestures={false}
            aria-label="Loading contributors"
          />
        </div>
        
      </div>
    </div>
  )
})

FeaturedContributorsCarouselSkeleton.displayName = 'FeaturedContributorsCarouselSkeleton'

export default memo(FeaturedContributorsCarouselEnhanced)