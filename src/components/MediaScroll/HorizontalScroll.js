'use client'

import {
  useState,
  useRef,
  useCallback,
  useMemo,
  memo,
  useLayoutEffect,
  useEffect,
  Fragment,
} from 'react'
import useSWR, { useSWRConfig, preload } from 'swr'
import { classNames, fetcher } from '@src/utils'
import { ChevronDoubleLeftIcon, ChevronDoubleRightIcon } from '@heroicons/react/20/solid'
import Card from './Card'
import { motion, AnimatePresence } from 'framer-motion'
import { v7 as uuidv7 } from 'uuid'
import throttle from 'lodash.throttle'
import debounce from 'lodash.debounce'
import { useSwipeable } from 'react-swipeable'
import SkeletonList from './SkeletonList'

// Define Peek Width
const PEEK_WIDTH = 50 // Adjust based on design

// PaginationIndicators Component
const PaginationIndicators = memo(
  ({ totalPages, currentPage, goToPage, isAnimating, prefetchPageData }) => {
    const [isClient, setIsClient] = useState(false)
  
    useEffect(() => {
      setIsClient(true)
    }, [])
    return (
      isClient ?
      <div className="flex justify-center mt-4 space-x-2">
        {Array.from({ length: totalPages }).map((_, pageIndex) => (
          <button
            key={pageIndex}
            onMouseEnter={() => {
              if (pageIndex !== currentPage) prefetchPageData(pageIndex)
            }}
            onClick={() => goToPage(pageIndex)}
            className={classNames(
              'w-3 h-3 rounded-full focus:outline-none',
              pageIndex === currentPage ? 'bg-gray-800' : 'bg-gray-400'
            )}
            aria-label={`Go to page ${pageIndex + 1}`}
          />
        ))}
      </div>
      : null
    )
  }
)

PaginationIndicators.displayName = 'PaginationIndicators'

// Animation Variants
const variants = {
  enter: (direction) => ({
    x: direction > 0 ? 400 : -400,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) => ({
    x: direction < 0 ? 400 : -400,
    opacity: 0,
  }),
}

// HorizontalScroll Component
const HorizontalScroll = memo(({ numberOfItems, listType, sort = 'id', sortOrder = 'desc', playlistId = null }) => {
  const [currentPage, setCurrentPage] = useState(0)
  const [expandedCardId, setExpandedCardId] = useState(null)
  const [direction, setDirection] = useState(0) // Track direction
  const [isAnimating, setIsAnimating] = useState(false) // Track animation state
  const uniqueId = useRef(uuidv7()) // Unique ID for this instance
  const containerRef = useRef(null)
  const cardsContainerRef = useRef(null)
  const cardRef = useRef(null)
  const leftArrowRef = useRef(null)
  const rightArrowRef = useRef(null)

  const { cache } = useSWRConfig()

  const getDefaultItemsPerPage = () => {
    if (typeof window !== 'undefined') {
      const screenWidth = window.innerWidth
      if (screenWidth >= 1200) return 6
      if (screenWidth >= 768) return 4
    }
    return 2
  }

  const [itemsPerPage, setItemsPerPage] = useState(getDefaultItemsPerPage())

  const areItems = numberOfItems > 0

  const totalPages = useMemo(
    () => {
      // Ensure we always have at least 0 pages, handle edge cases
      if (numberOfItems <= 0 || itemsPerPage <= 0) return 0
      return Math.ceil(numberOfItems / itemsPerPage)
    },
    [numberOfItems, itemsPerPage]
  )

  // Centralized URL Builder
  const buildPrefetchURL = (pageIndex) => {
    const params = new URLSearchParams()
    if (listType) params.append('type', listType)
    if (listType === 'playlist' && playlistId) params.append('playlistId', playlistId)
    if (sort) params.append('sort', sort)
    if (itemsPerPage) params.append('limit', itemsPerPage)
    if (sortOrder) params.append('sortOrder', sortOrder)
    params.append('page', pageIndex)
    return `/api/authenticated/horizontal-list?${params.toString()}`
  }

  // ex. /api/authenticated/horizontal-list?type=movie&sort=id&limit=6&sortOrder=desc&page=0
  const apiEndpoint = buildPrefetchURL(currentPage)

  const { data, error, isLoading } = useSWR(apiEndpoint, fetcher, {
    refreshInterval: 10000,
    errorRetryCount: 4,
    errorRetryInterval: 2000,
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5000, // Adjust as needed
  })

  const ongoingPrefetches = useRef(new Set())

  const prefetchPageData = useCallback(
    (pageIndex) => {
      // Validate pageIndex
      if (pageIndex < 0 || pageIndex >= totalPages) {
        console.warn(`Attempted to prefetch invalid page index: ${pageIndex}`)
        return
      }

      // Avoid prefetching the current page
      if (pageIndex === currentPage) {
        console.log(`Prefetch skipped for current page: ${pageIndex}`)
        return
      }

      // Avoid duplicate prefetches
      if (ongoingPrefetches.current.has(pageIndex)) {
        console.log(`Prefetch already in progress for page: ${pageIndex}`)
        return
      }

      const prefetchUrl = buildPrefetchURL(pageIndex)

      // Check if data is already cached
      if (cache.get(prefetchUrl)) {
        console.log(`Data for page ${pageIndex} is already cached.`)
        return
      }

      console.log(`Prefetching data for page ${pageIndex} with URL: ${prefetchUrl}`)

      // Mark as prefetching
      ongoingPrefetches.current.add(pageIndex)

      // Use preload to fetch and cache the data
      preload(prefetchUrl, fetcher)
        .then(() => {
          console.log(`Prefetch successful for page ${pageIndex}`)
          ongoingPrefetches.current.delete(pageIndex)
        })
        .catch((error) => {
          console.error(`Prefetch failed for page ${pageIndex}:`, error)
          ongoingPrefetches.current.delete(pageIndex)
        })
    },
    [cache, currentPage, totalPages]
  )

  // Debounced version of prefetchPageData to prevent rapid calls
  const debouncedPrefetchPageData = useMemo(
    () => debounce(prefetchPageData, 200),
    [prefetchPageData]
  )

  useEffect(() => {
    // Only prefetch if we have valid pages
    if (totalPages > 0) {
      // Prefetch previous page (if exists)
      if (currentPage > 0) {
        prefetchPageData(currentPage - 1)
      }
      // Prefetch next page (if exists)
      if (currentPage < totalPages - 1) {
        prefetchPageData(currentPage + 1)
      }
    }
  }, [currentPage, prefetchPageData, totalPages])
  // Prepare items including previous and next peek items
  const itemsToRender = useMemo(() => {
    if (!data) return []
    
    // Safely destructure with defaults to prevent undefined errors
    const { previousItem, currentItems = [], nextItem } = data || {}
    
    // Validate that currentItems is an array
    const safeCurrentItems = Array.isArray(currentItems) ? currentItems : []
    
    const items = []
    if (previousItem) items.push({ item: previousItem, isPeek: 'previous' })
    items.push(...safeCurrentItems.map((item) => ({ item, isPeek: false })))
    if (nextItem) items.push({ item: nextItem, isPeek: 'next' })
    return items
  }, [data])

  // Determine the number of peeks based on the current page
  const numberOfPeeks = useMemo(() => {
    if (!data) return 0
    if (totalPages === 1) return 0
    if (currentPage === 0 && data.nextItem) return 1
    if (currentPage === totalPages - 1 && data.previousItem) return 1
    if (currentPage > 0 && currentPage < totalPages - 1) return 2
    return 0
  }, [currentPage, totalPages, data])

  const calculateItemsPerPage = useCallback(() => {
    if (cardsContainerRef.current && cardRef.current && data) {
      const containerWidth = cardsContainerRef.current.clientWidth
      const cardWidth = cardRef.current.clientWidth

      const flexContainer = cardsContainerRef.current.querySelector('.cards-row')
      const gap = parseFloat(getComputedStyle(flexContainer).columnGap) || 0

      let availableWidth = containerWidth

      // Determine if the device is mobile based on screen width
      const isMobile = typeof window !== 'undefined' && window.innerWidth < 768

      if (!isMobile) {
        // Subtract the peek width based on the number of peeks
        availableWidth -= PEEK_WIDTH * numberOfPeeks
      }

      let possibleItems = Math.floor((availableWidth + gap) / (cardWidth + gap))
      const newItemsPerPage = possibleItems > 0 ? possibleItems : 1

      // Round to nearest integer to avoid floating point issues
      const roundedItemsPerPage = Math.round(newItemsPerPage)

      console.log(
        `Calculating itemsPerPage: roundedItemsPerPage=${roundedItemsPerPage}, current itemsPerPage=${itemsPerPage}`
      )

      if (roundedItemsPerPage !== itemsPerPage) {
        console.log(
          `itemsPerPage changed from ${itemsPerPage} to ${roundedItemsPerPage}. Updating itemsPerPage.`
        )
        setItemsPerPage(roundedItemsPerPage)

        // After setting itemsPerPage, ensure currentPage is within new bounds
        const newTotalPages = Math.ceil(numberOfItems / roundedItemsPerPage)
        if (currentPage >= newTotalPages) {
          console.log(`Adjusting currentPage from ${currentPage} to ${newTotalPages - 1}`)
          setCurrentPage(newTotalPages - 1 >= 0 ? newTotalPages - 1 : 0)
        }
      }
    }
  }, [itemsPerPage, numberOfPeeks, data, currentPage, numberOfItems])

  // Throttled version of calculateItemsPerPage to avoid frequent triggering
  const throttledCalculateItemsPerPage = useMemo(
    () => throttle(calculateItemsPerPage, 50),
    [calculateItemsPerPage]
  )

  useLayoutEffect(() => {
    const handleResize = () => {
      throttledCalculateItemsPerPage()
    }

    window.addEventListener('resize', handleResize)

    // Use ResizeObserver to recalculate the items per page
    const resizeObserver = new ResizeObserver(() => {
      throttledCalculateItemsPerPage()
    })

    if (cardsContainerRef.current) {
      resizeObserver.observe(cardsContainerRef.current)
    }
    if (cardRef.current) {
      resizeObserver.observe(cardRef.current)
    }

    // Initial calculation
    calculateItemsPerPage()

    return () => {
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
    }
  }, [throttledCalculateItemsPerPage, calculateItemsPerPage, data, currentPage])

  // Run the calculation when the component first mounts to ensure accurate value
  useEffect(() => {
    calculateItemsPerPage()
  }, [calculateItemsPerPage])

  // useEffect(() => {
  //   if (totalPages === 0) {
  //     setCurrentPage(0)
  //     return
  //   }

  //   // If currentPage is out of bounds, set it to the last valid page
  //   if (currentPage >= totalPages) {
  //     console.log(`Adjusting currentPage from ${currentPage} to ${totalPages - 1}`)
  //     setCurrentPage(totalPages - 1)
  //   }
  // }, [totalPages, currentPage])

  const handleCardExpand = useCallback((id) => {
    setExpandedCardId(id)
  }, [])

  const handleCardCollapse = useCallback(() => {
    setExpandedCardId(null)
  }, [])

  const moveScroll = useCallback(
    (direction) => {
      console.log(`Scrolling ${direction}`)
      setDirection(direction === 'left' ? -1 : 1) // Set direction based on movement
      setCurrentPage((prev) => {
        const newPage =
          direction === 'left' ? Math.max(prev - 1, 0) : Math.min(prev + 1, totalPages - 1)
        console.log(`Changing page from ${prev} to ${newPage}`)
        return newPage
      })
      setIsAnimating(true)
    },
    [totalPages]
  )

  const goToPage = useCallback(
    (pageIndex) => {
      if (pageIndex === currentPage) return // No action if the same page is clicked
      console.log(`Navigating from page ${currentPage} to page ${pageIndex}`)
      const newDirection = pageIndex > currentPage ? 1 : -1
      setDirection(newDirection)
      setCurrentPage(pageIndex)
      setIsAnimating(true)
    },
    [currentPage]
  )

  // Handle swipe gestures
  const handleSwipe = useCallback(
    (direction) => {
      if (direction === 'LEFT') {
        moveScroll('right') // Swiping left navigates to the next page (right)
      } else if (direction === 'RIGHT') {
        moveScroll('left') // Swiping right navigates to the previous page (left)
      }
    },
    [moveScroll]
  )

  // Configure swipe handlers
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => handleSwipe('LEFT'),
    onSwipedRight: () => handleSwipe('RIGHT'),
    preventDefaultTouchmoveEvent: true,
    preventScrollOnSwipe: true,
    trackMouse: true,
    delta: { left: 20, right: 20 },
    swipeDuration: 250,
  })

  // Handle error state
  if (error && !data) {
    return (
      <div className="py-12 flex flex-col gap-2 text-center">
        <span className="text-2xl">⚠️</span>
        <strong>Error loading media. Please try again later.</strong>
      </div>
    )
  }

  return (
    <div className="relative my-8 w-full flex flex-col justify-center overflow-hidden max-w-[100vw]" {...swipeHandlers}>
      {/* Carousel Container */}
      <div className="flex flex-row items-center w-full relative" ref={containerRef}>
        {/* Left Arrow */}
        {areItems && totalPages > 1 && currentPage > 0 ? (
          <button
            ref={leftArrowRef}
            onClick={() => moveScroll('left')}
            onMouseEnter={() => debouncedPrefetchPageData(currentPage - 1)}
            className="text-white p-2 rounded-sm z-10 w-16 h-full flex items-center justify-center hover:bg-gray-700 transition-colors"
            aria-label="Previous Page"
          >
            <ChevronDoubleLeftIcon className="w-6 h-6" />
          </button>
        ) : (
          // Render empty div to maintain layout consistency
          <div className="w-16 h-full"></div>
        )}

        {/* Cards Container with Framer Motion */}
        <div
          ref={cardsContainerRef}
          className={classNames(
            'relative flex flex-grow overflow-visible h-[22rem]',
            itemsToRender.length < itemsPerPage + numberOfPeeks && data && itemsToRender.length > 0
              ? 'justify-start'
              : 'justify-center'
          )}
        >
          {/* AnimatePresence allows components to animate out when removed */}
          <AnimatePresence custom={direction} initial={false}>
            <motion.div
              key={`${uniqueId.current}-${currentPage}`}
              className={classNames(
                currentPage === 0 ? 'ml-3' : '',
                'absolute inset-0 flex gap-x-4 justify-center items-start cards-row'
              )}
              variants={variants}
              custom={direction}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{
                x: { type: 'spring', stiffness: 300, damping: 30 },
                opacity: { duration: 0.2 },
              }}
              style={{ willChange: 'transform, opacity' }}
              onAnimationComplete={() => setIsAnimating(false)}
            >
              {!data && isLoading ? (
                // Render SkeletonCards during loading
                <SkeletonList numberOfItems={numberOfItems} itemsPerPage={itemsPerPage} numberOfPeeks={numberOfPeeks} />
              ) : (
                // Render actual Cards when data is loaded
                itemsToRender.map(({ item, isPeek }, index) => {
                  // if (!item) {
                  //   return (
                  //     <div
                  //       key={`empty-${index}`}
                  //       className="w-32 md:w-36 lg:w-48 flex-shrink-0 h-full"
                  //     />
                  //   )
                  // }

                  const uniqueIdItem = `${item.id}-${currentPage * itemsPerPage + index}`
                  const videoURL = item?.metadata?.trailer_url || item?.videoURL || null

                  const onCardClick = isPeek
                    ? () => moveScroll(isPeek === 'previous' ? 'left' : 'right')
                    : () => handleCardExpand(uniqueIdItem)

                  return (
                    <div
                      ref={index === (data.previousItem ? 1 : 0) ? cardRef : null}
                      key={uniqueIdItem}
                    >
                      <Card
                        title={item.title}
                        showTitleFormatted={item.showTitleFormatted}
                        itemId={uniqueIdItem}
                        mediaId={item.id}
                        type={item.type}
                        posterURL={item.posterURL}
                        posterBlurhash={item.posterBlurhash}
                        backdrop={item.backdrop}
                        backdropBlurhash={item.backdropBlurhash}
                        videoURL={videoURL}
                        // Pass all date fields
                        date={item.date}
                        lastWatchedDate={item.lastWatchedDate}
                        addedDate={item.addedDate}
                        releaseDate={item.releaseDate}
                        //
                        link={item.link}
                        logo={item.logo}
                        listType={listType}
                        isExpanded={expandedCardId === uniqueIdItem}
                        onExpand={() => handleCardExpand(uniqueIdItem)}
                        onCollapse={handleCardCollapse}
                        isPeek={isPeek}
                        onCardClick={onCardClick}
                        // tv
                        episodeNumber={item?.episodeNumber}
                        seasonNumber={item?.seasonNumber}
                        showId={item?.showId}
                        showTmdbId={item?.showTmdbId}
                        // Availability flags for TMDB-only/Coming Soon items
                        isAvailable={item.isAvailable}
                        comingSoon={item.comingSoon}
                        comingSoonDate={item.comingSoonDate}
                        metadata={item.metadata}
                      />
                    </div>
                  )
                })
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Right Arrow */}
        {areItems && totalPages > 1 && currentPage < totalPages - 1 ? (
          <button
            ref={rightArrowRef}
            onClick={() => moveScroll('right')}
            onMouseEnter={() => debouncedPrefetchPageData(currentPage + 1)}
            className="text-white p-2 rounded-sm z-10 w-16 h-full flex items-center justify-center hover:bg-gray-700 transition-colors"
            aria-label="Next Page"
          >
            <ChevronDoubleRightIcon className="w-6 h-6" />
          </button>
        ) : (
          // Render empty div to maintain layout consistency
          <div className="w-16 h-full"></div>
        )}
      </div>
      {/* Pagination Indicators */}
      {areItems && totalPages > 1 && (
        <PaginationIndicators
          totalPages={totalPages}
          currentPage={currentPage}
          goToPage={goToPage}
          isAnimating={isAnimating}
          prefetchPageData={debouncedPrefetchPageData}
        />
      )}
    </div>
  )
})

HorizontalScroll.displayName = 'HorizontalScroll'

export default HorizontalScroll
