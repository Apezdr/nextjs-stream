'use client'

import {
  useState,
  useRef,
  useCallback,
  useMemo,
  memo,
  useEffect,
  Fragment,
  useSyncExternalStore,
  useId,
  useReducer,
  useEffectEvent,
} from 'react'
import { createPortal } from 'react-dom'
import useSWR, { useSWRConfig, preload } from 'swr'
import { classNames, fetcher } from '@src/utils'
import { ChevronDoubleLeftIcon, ChevronDoubleRightIcon } from '@heroicons/react/20/solid'
import Card from './Card'
import { motion, AnimatePresence } from 'framer-motion'
import debounce from 'lodash/debounce'
import { useSwipeable } from 'react-swipeable'
import SkeletonList from './SkeletonList'
import SkeletonCard from './SkeletonCard'
import { useItemsPerPage, useCardWidth, CARD_GAP } from '@src/hooks/useItemsPerPage'
import { useLandingPagePopup } from '@src/contexts/LandingPagePopupContext'
import RailScrubber from './scrubber/RailScrubber'
import RailDatePicker from './scrubber/RailDatePicker'
import ScrubCard from './scrubber/ScrubCard'
import { BlockLoader, BLOCK_SIZE, pageFromBlocks } from './scrubber/blockLoader'
import { buildTimeline, dayAt, describeRange, monthNames } from './scrubber/timeline'

// Define Peek Width
const PEEK_WIDTH = 50 // Adjust based on design

const subscribeNever = () => () => {}

// False on the server and in the hydration render, true from the render after
const useIsHydrated = () => useSyncExternalStore(subscribeNever, () => true, () => false)

const RAIL_SWR_OPTIONS = {
  refreshInterval: 10000, // OPTIMIZATION: Reduced from 10s to 30s to prevent excessive requests
  errorRetryCount: 3,     // OPTIMIZATION: Reduced from 4 to 3 retries
  errorRetryInterval: 3000, // OPTIMIZATION: Increased retry interval
  revalidateOnFocus: true, // Refetch when the tab regains focus so a returning user
                           // promptly picks up sync/admin cache busts (ETag → 304 when
                           // unchanged, so this is cheap; deduped within dedupingInterval).
  revalidateOnReconnect: false,
  dedupingInterval: 10000, // OPTIMIZATION: Increased from 5s to 10s for better deduplication
  revalidateIfStale: false, // OPTIMIZATION: Don't revalidate if data exists and is fresh
}

// Past this many pages the Watch History row trades its page dots for the date
// strip. Dots stop being a way to get anywhere, and at a few hundred pages
// they shrink to nothing.
const SCRUB_MIN_PAGES = 10
// How long the strip's handle rests on a page before the page's real cards
// (posters and all) take the place of the lightweight ones
const SCRUB_REST_MS = 140
const TIMELINE_SWR_OPTIONS = {
  refreshInterval: 60000,
  revalidateOnFocus: true,
  revalidateOnReconnect: false,
  dedupingInterval: 10000,
  errorRetryCount: 3,
}

/**
 * The cards the row shows while the strip's handle is over a page it has not
 * settled on: the page's positions and the card each has so far. `landed`
 * (how many blocks have arrived) is not read. The loader's cards are not React
 * state, and passing it is what says they changed.
 */
function previewOf(loader, landed, first, perPage, total) {
  const entries = []
  const add = (position, isPeek) =>
    entries.push({
      position,
      isPeek,
      item: loader.cards.get(position),
      waiting: !loader.loaded.has(loader.blockOf(position)),
    })
  if (first > 0) add(first - 1, true)
  for (let position = first; position < Math.min(total, first + perPage); position++) add(position, false)
  if (first + perPage < total) add(first + perPage, true)
  return entries
}

/**
 * One page of a rail, fetched once the real page size is known. Until the
 * hydration render is over, useItemsPerPage reports its server fallback (2),
 * so a fetch would be for a page size about to change: every rail used to
 * request limit=2, plus a limit=2 page-1 prefetch, and throw both away.
 */
function useRailPage(apiEndpoint) {
  const isHydrated = useIsHydrated()
  const { data, error, isLoading } = useSWR(isHydrated ? apiEndpoint : null, fetcher, RAIL_SWR_OPTIONS)
  return {
    data,
    isHydrated,
    // Skeleton while loading, and before the first fetch is allowed, so the
    // hydration render matches the server's
    isPending: !data && (isLoading || !isHydrated),
    failed: Boolean(error) && !data,
  }
}

// PaginationIndicators Component
const PaginationIndicators = memo(
  ({ totalPages, currentPage, goToPage, isAnimating, prefetchPageData }) => {
    // SSR-safe client detection
    const isClient = useIsHydrated()

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
// A direction of 0 is the date strip putting a page where it was already
// showing that page's cards: no slide and no fade.
const variants = {
  enter: (direction) =>
    direction === 0 ? { x: 0, opacity: 1 } : { x: direction > 0 ? 400 : -400, opacity: 0 },
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction) =>
    direction === 0
      ? { x: 0, opacity: 0, transition: { duration: 0 } }
      : { x: direction < 0 ? 400 : -400, opacity: 0 },
}

// HorizontalScroll Component
const HorizontalScroll = memo(({ numberOfItems, listType, sort = 'id', sortOrder = 'desc', playlistId = null }) => {
  const [currentPage, setCurrentPage] = useState(0)
  // Use shared popup context instead of local state for single popup per page
  const { expandedCardId, expandCard, collapseCard } = useLandingPagePopup()
  const [direction, setDirection] = useState(0) // Track direction
  const [isAnimating, setIsAnimating] = useState(false) // Track animation state
  const uniqueId = useId() // Unique ID for this instance
  const cardsContainerRef = useRef(null)
  const cardRef = useRef(null)
  const leftArrowRef = useRef(null)
  const rightArrowRef = useRef(null)

  const { cache, mutate } = useSWRConfig()

  // Use shared hook for items per page calculation (eliminates redundant calculations)
  const itemsPerPage = useItemsPerPage()

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
  const buildPrefetchURL = useCallback((pageIndex) => {
    const params = new URLSearchParams()
    if (listType) params.append('type', listType)
    if (listType === 'playlist' && playlistId) params.append('playlistId', playlistId)
    if (sort) params.append('sort', sort)
    if (itemsPerPage) params.append('limit', itemsPerPage)
    if (sortOrder) params.append('sortOrder', sortOrder)
    params.append('page', pageIndex)
    // Only the Continue Watching rail carries the watchHistory object. It is
    // volatile (lastWatched moves every heartbeat), and this list already
    // re-polls every 10 s, so a rail that carried it would re-download its
    // whole payload while anything on it is being watched. Every other rail
    // stays ETag-stable; its cards and popups read progress from the
    // positions store instead (useLiveProgress).
    if (listType === 'recentlyWatched') params.append('includeWatchHistory', 'true')
    return `/api/authenticated/horizontal-list?${params.toString()}`
  }, [itemsPerPage, listType, sort, sortOrder, playlistId])

  // ex. /api/authenticated/horizontal-list?type=movie&sort=id&limit=6&sortOrder=desc&page=0
  const apiEndpoint = buildPrefetchURL(currentPage)

  const { data, isHydrated, isPending, failed } = useRailPage(apiEndpoint)

  // The date strip: Watch History only, once the dots stop being useful
  const cardWidth = useCardWidth()
  const isNarrow = cardWidth === 128
  const scrubbable = listType === 'recentlyWatched' && totalPages > SCRUB_MIN_PAGES
  // A day is the viewer's own, so the counts are asked for in their time zone
  const timeZone = isHydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : null
  const { data: timelineData } = useSWR(
    scrubbable && timeZone
      ? `/api/authenticated/horizontal-list/timeline?tz=${encodeURIComponent(timeZone)}`
      : null,
    fetcher,
    TIMELINE_SWR_OPTIONS
  )
  const timeline = useMemo(
    () => (Array.isArray(timelineData?.days) ? buildTimeline(timelineData.days, timelineData.total) : null),
    [timelineData]
  )

  // The cards a drag of the strip has fetched, in blocks, by list position
  const [blocksLanded, blockLanded] = useReducer((count) => count + 1, 0)
  const [loader] = useState(
    () =>
      new BlockLoader({
        fetchBlock: async (block) => {
          const params = new URLSearchParams({
            type: 'recentlyWatched',
            sort,
            sortOrder,
            limit: String(BLOCK_SIZE),
            page: String(block),
            includeWatchHistory: 'true',
            positions: 'true',
          })
          const page = await fetcher(`/api/authenticated/horizontal-list?${params}`)
          if (!page || page.error || !Array.isArray(page.currentItems)) {
            throw new Error('The list did not answer')
          }
          return [page.previousItem, ...page.currentItems, page.nextItem]
        },
        onChange: blockLanded,
      })
  )
  // List position of the first card under the strip's handle while it is dragged
  const [scrubFirst, setScrubFirst] = useState(null)
  const scrubState = useRef({ first: null, travel: 0, restTimer: null, restingPage: null })

  // New counts mean the list moved: a card's position no longer holds
  useEffect(() => {
    loader.clear()
  }, [loader, timelineData])
  useEffect(() => {
    const state = scrubState.current
    return () => {
      clearTimeout(state.restTimer)
      loader.clear()
    }
  }, [loader])

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
    [cache, currentPage, totalPages, buildPrefetchURL]
  )

  // Debounced version of prefetchPageData to prevent rapid calls
  const debouncedPrefetchRef = useRef(null)
  
  useEffect(() => {
    debouncedPrefetchRef.current = debounce(prefetchPageData, 200)
    return () => {
      debouncedPrefetchRef.current?.cancel()
    }
  }, [prefetchPageData])
  
  const debouncedPrefetchPageData = useCallback((pageIndex) => {
    debouncedPrefetchRef.current?.(pageIndex)
  }, [])

  useEffect(() => {
    // Only prefetch once the real page size is known, and if we have valid pages
    // Not during a drag of the date strip: it passes hundreds of pages, and
    // the page it settles on is put together from the cards already fetched
    if (isHydrated && totalPages > 0 && scrubFirst === null) {
      // Prefetch previous page (if exists)
      if (currentPage > 0) {
        prefetchPageData(currentPage - 1)
      }
      // Prefetch next page (if exists)
      if (currentPage < totalPages - 1) {
        prefetchPageData(currentPage + 1)
      }
    }
  }, [currentPage, prefetchPageData, totalPages, isHydrated, scrubFirst])
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

  const handleCardExpand = useCallback((id) => {
    expandCard(id)
  }, [expandCard])

  const handleCardCollapse = useCallback(() => {
    collapseCard()
  }, [collapseCard])

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

  // --- The date strip's side of the row ---
  const lastPage = Math.max(0, totalPages - 1)
  const pageAt = (position) => Math.min(lastPage, Math.max(0, Math.floor(position / itemsPerPage)))

  // A page of real cards for SWR, put together from the cards a drag fetched.
  // A page SWR already holds is left as the server gave it.
  const seedPage = (pageIndex) => {
    if (!timeline || pageIndex < 0 || pageIndex > lastPage) return false
    const url = buildPrefetchURL(pageIndex)
    if (cache.get(url)?.data) return true
    const page = pageFromBlocks(loader, pageIndex * itemsPerPage, itemsPerPage, timeline.total)
    if (!page) return false
    mutate(url, page, { revalidate: false })
    return true
  }

  // The real cards of a page take the place of the lightweight ones. While the
  // handle is only resting (not `final`), a page whose cards have not arrived
  // waits for them; when the drag ends, the row's own request fetches it.
  const showPage = (pageIndex, final) => {
    const state = scrubState.current
    if (!seedPage(pageIndex) && !final) {
      state.restingPage = pageIndex
      return
    }
    state.restingPage = null
    seedPage(pageIndex - 1)
    seedPage(pageIndex + 1)
    setDirection(0)
    setCurrentPage(pageIndex)
  }

  const showRestingPage = useEffectEvent(() => {
    const resting = scrubState.current.restingPage
    if (resting !== null) showPage(resting, false)
  })
  useEffect(() => {
    showRestingPage()
  }, [blocksLanded])

  const handleScrubStart = () => {
    scrubState.current.travel = 0
  }

  // Every move of the handle: show the page under it, and tell the loader
  const handleScrub = (position) => {
    const state = scrubState.current
    const pageIndex = pageAt(position)
    const first = pageIndex * itemsPerPage
    if (state.first !== null && first !== state.first) state.travel = first > state.first ? 1 : -1
    state.first = first
    setScrubFirst(first)

    const lead = loader.blockOf(first)
    const needed = loader.blocksFor(Math.max(0, first - 1), Math.min(timeline.total - 1, first + itemsPerPage))
    const next = lead + state.travel
    loader.aim({
      lead,
      wanted: [lead, ...needed.filter((block) => block !== lead)],
      ahead: state.travel !== 0 && next >= 0 && next * BLOCK_SIZE < timeline.total ? next : null,
      paced: true,
    })

    clearTimeout(state.restTimer)
    state.restingPage = null
    state.restTimer = setTimeout(() => showPage(pageIndex, false), SCRUB_REST_MS)
  }

  const handleScrubEnd = (position) => {
    const state = scrubState.current
    clearTimeout(state.restTimer)
    loader.release()
    showPage(pageAt(position), true)
    state.first = null
    state.travel = 0
    setScrubFirst(null)
  }

  const isScrubbing = scrubFirst !== null
  // The handle is over a page the row has not settled on: lightweight cards
  const previewing = isScrubbing && scrubFirst !== currentPage * itemsPerPage
  const preview =
    previewing && timeline ? previewOf(loader, blocksLanded, scrubFirst, itemsPerPage, timeline.total) : []
  const shownFirst = isScrubbing ? scrubFirst : currentPage * itemsPerPage
  const rangeLabel = timeline
    ? describeRange(timeline, shownFirst, Math.min(timeline.total - 1, shownFirst + itemsPerPage - 1))
    : ''
  const scrubDay = isScrubbing && timeline ? dayAt(timeline, scrubFirst) : null
  // Where the row's date button goes: beside its title (LandingPage)
  const headSlot = scrubbable && isHydrated ? document.getElementById(`rail-head-${listType}`) : null
  // As wide as the full cards, so the strip reads as theirs; a phone gets the whole width
  const stripWidth = isNarrow ? undefined : itemsPerPage * cardWidth + (itemsPerPage - 1) * CARD_GAP

  // Handle error state
  if (failed) {
    return (
      <div className="py-12 flex flex-col gap-2 text-center">
        <span className="text-2xl">⚠️</span>
        <strong>Error loading media. Please try again later.</strong>
      </div>
    )
  }

  return (
    <div
      className={classNames(
        scrubbable ? 'mt-8 mb-2' : 'my-8',
        'relative w-full flex flex-col justify-center overflow-hidden max-w-[100vw]'
      )}
    >
      {/* Carousel Container. A swipe pages the row; the date strip under it takes its own drags */}
      <div className="flex flex-row items-center w-full relative" {...swipeHandlers}>
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
          {previewing ? (
            <div
              className={classNames(
                scrubFirst === 0 ? 'ml-3' : '',
                'absolute inset-0 flex gap-x-4 justify-center items-start'
              )}
            >
              {preview.map(({ position, isPeek, item, waiting }) => {
                if (item) return <ScrubCard key={position} item={item} isPeek={isPeek} />
                // Its block arrived without it: the library no longer holds this title
                return waiting ? <SkeletonCard key={position} /> : null
              })}
            </div>
          ) : null}
          {/* A finger covers the strip: say the month over the cards */}
          {isScrubbing && isNarrow && scrubDay ? (
            <div className="pointer-events-none absolute left-1/2 top-2 z-30 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-4 py-1.5 text-base font-semibold text-[#060916] shadow-lg">
              {monthNames(undefined, 'long')[scrubDay.month]} {scrubDay.year}
            </div>
          ) : null}
          {/* AnimatePresence allows components to animate out when removed */}
          <AnimatePresence custom={direction} initial={false}>
            <motion.div
              key={`${uniqueId}-${currentPage}`}
              className={classNames(
                currentPage === 0 ? 'ml-3' : '',
                previewing ? 'invisible' : '',
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
              {isPending ? (
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
                        thumbnail={item.thumbnail}
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
                        libraryMissing={item.libraryMissing}
                        metadata={item.metadata}
                        // Trailer/external video flag
                        isTrailer={item.isTrailer}
                        // Watch progress (server-attached; duration in ms)
                        watchHistory={item.watchHistory}
                        duration={item.duration}
                        durableMediaId={item.mediaId}
                        normalizedVideoId={item.normalizedVideoId ?? null}
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
      {areItems && totalPages > 1 && !scrubbable && (
        <PaginationIndicators
          totalPages={totalPages}
          currentPage={currentPage}
          goToPage={goToPage}
          isAnimating={isAnimating}
          prefetchPageData={debouncedPrefetchPageData}
        />
      )}
      {/* The date strip, in the dots' place */}
      {scrubbable && timeline ? (
        <RailScrubber
          timeline={timeline}
          first={shownFirst}
          width={stripWidth}
          page={pageAt(shownFirst)}
          pageCount={totalPages}
          valueText={rangeLabel}
          onScrubStart={handleScrubStart}
          onScrub={handleScrub}
          onScrubEnd={handleScrubEnd}
          onStep={(delta) => moveScroll(delta > 0 ? 'right' : 'left')}
          onJump={(position) => goToPage(pageAt(position))}
        />
      ) : null}
      {scrubbable && timeline && headSlot
        ? createPortal(
            <>
              <RailDatePicker
                timeline={timeline}
                first={shownFirst}
                label={rangeLabel}
                compact={isNarrow}
                onJump={(position) => goToPage(pageAt(position))}
              />
              {currentPage > 0 ? (
                <button
                  type="button"
                  onClick={() => goToPage(0)}
                  className="rounded-full px-3 py-1 text-sm font-medium text-blue-300 hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 max-sm:py-2"
                >
                  {isNarrow ? 'Today' : 'Back to today'}
                </button>
              ) : null}
            </>,
            headSlot
          )
        : null}
    </div>
  )
})

HorizontalScroll.displayName = 'HorizontalScroll'

export default HorizontalScroll
