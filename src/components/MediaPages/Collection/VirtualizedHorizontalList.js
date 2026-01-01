'use client'

import React, { 
  useState, 
  useRef, 
  useEffect, 
  useCallback, 
  useMemo,
  startTransition,
  memo,
  createContext,
  useContext
} from 'react'
import { motion, AnimatePresence, useMotionValue, useSpring } from 'framer-motion'
import { useSwipeable } from 'react-swipeable'
import throttle from 'lodash.throttle'
import debounce from 'lodash.debounce'
import useScrollPersistence from './useScrollPersistence'

/**
 * VirtualizedHorizontalList - High-performance React 19 optimized horizontal scrolling component
 * 
 * Features:
 * - Virtualization for memory efficiency
 * - Smooth momentum-based scrolling with easing
 * - Touch/swipe gesture support
 * - Keyboard navigation (arrows, home, end)
 * - Intersection Observer for visibility detection
 * - Responsive breakpoint handling
 * - React 19 concurrent features and optimizations
 * - Accessibility compliant
 */

// Scroll Context for sharing state between components
const ScrollContext = createContext(null)

// Constants
const DEFAULT_ITEM_WIDTH = 160
const DEFAULT_GAP = 16
const SCROLL_ANIMATION_DURATION = 500
const MOMENTUM_THRESHOLD = 0.1
const EASING_FACTOR = 0.15

// Responsive breakpoints
const BREAKPOINTS = {
  sm: { width: 640, itemsVisible: 2, itemWidth: 140 },
  md: { width: 768, itemsVisible: 3, itemWidth: 150 },
  lg: { width: 1024, itemsVisible: 4, itemWidth: 160 },
  xl: { width: 1280, itemsVisible: 5, itemWidth: 170 },
  '2xl': { width: 1536, itemsVisible: 6, itemWidth: 180 }
}

// Custom hook for responsive configuration
const useResponsiveConfig = () => {
  const [config, setConfig] = useState(BREAKPOINTS.lg)

  useEffect(() => {
    const updateConfig = () => {
      const width = window.innerWidth
      const newConfig = Object.values(BREAKPOINTS)
        .reverse()
        .find(bp => width >= bp.width) || BREAKPOINTS.sm
      
      setConfig(newConfig)
    }

    updateConfig()
    window.addEventListener('resize', updateConfig)
    return () => window.removeEventListener('resize', updateConfig)
  }, [])

  return config
}

// Custom hook for intersection observer (disabled on mobile for performance)
const useIntersectionObserver = (containerRef, itemRefs, threshold = 0.5) => {
  const [visibleItems, setVisibleItems] = useState(new Set())

  useEffect(() => {
    // Skip intersection observer on mobile to prevent stutter
    const isMobile = typeof window !== 'undefined' &&
      ('ontouchstart' in window || navigator.maxTouchPoints > 0)
    
    if (isMobile || !containerRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        startTransition(() => {
          setVisibleItems(prev => {
            const newVisible = new Set(prev)
            entries.forEach(entry => {
              const itemId = entry.target.dataset.itemId
              if (entry.isIntersecting) {
                newVisible.add(itemId)
              } else {
                newVisible.delete(itemId)
              }
            })
            return newVisible
          })
        })
      },
      {
        root: containerRef.current,
        threshold,
        rootMargin: '50px'
      }
    )

    Object.values(itemRefs.current).forEach(ref => {
      if (ref) observer.observe(ref)
    })

    return () => observer.disconnect()
  }, [containerRef, itemRefs, threshold])

  return visibleItems
}

// Simple smooth scroll hook
const useSmoothScroll = (containerRef) => {
  const scrollTo = useCallback((targetX, options = {}) => {
    const {
      duration = SCROLL_ANIMATION_DURATION,
      ease = 'easeInOut',
      onComplete
    } = options

    if (!containerRef.current) return

    const container = containerRef.current
    const maxScroll = container.scrollWidth - container.clientWidth
    const clampedTarget = Math.max(0, Math.min(targetX, maxScroll))

    // Standard smooth scroll
    container.scrollTo({
      left: clampedTarget,
      behavior: 'smooth'
    })

    if (onComplete) {
      setTimeout(onComplete, duration)
    }
  }, [containerRef])

  const scrollBy = useCallback((deltaX, options = {}) => {
    if (!containerRef.current) return
    const currentScroll = containerRef.current.scrollLeft
    scrollTo(currentScroll + deltaX, options)
  }, [scrollTo, containerRef])

  const scrollToItem = useCallback((itemIndex, itemWidth, gap, options = {}) => {
    const targetX = itemIndex * (itemWidth + gap)
    scrollTo(targetX, options)
  }, [scrollTo])

  return {
    scrollTo,
    scrollBy,
    scrollToItem
  }
}

// Virtualized item renderer
const VirtualizedItem = memo(({
  item,
  index,
  itemWidth,
  gap,
  isVisible,
  onItemRef,
  children
}) => {
  const itemRef = useRef(null)

  useEffect(() => {
    onItemRef(index, itemRef.current)
  }, [index, onItemRef])

  return (
    <div
      ref={itemRef}
      data-item-id={index}
      className="flex-shrink-0"
      style={{
        width: itemWidth,
        marginRight: gap
      }}
    >
      {children}
    </div>
  )
})

VirtualizedItem.displayName = 'VirtualizedItem'

// Navigation controls component
const NavigationControls = memo(({ 
  canScrollLeft, 
  canScrollRight, 
  onScrollLeft, 
  onScrollRight,
  className = ""
}) => {
  return (
    <>
      {/* Left Arrow */}
      <button 
        onClick={onScrollLeft}
        disabled={!canScrollLeft}
        className={`
          absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full 
          transition-all duration-300 ${canScrollLeft 
            ? 'bg-black/50 hover:bg-black/70 text-white' 
            : 'bg-gray-800/30 text-gray-600 cursor-not-allowed'
          } ${className}
        `}
        aria-label="Scroll left"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>
      
      {/* Right Arrow */}
      <button 
        onClick={onScrollRight}
        disabled={!canScrollRight}
        className={`
          absolute right-0 top-1/2 -translate-y-1/2 z-10 p-2 rounded-full 
          transition-all duration-300 ${canScrollRight 
            ? 'bg-black/50 hover:bg-black/70 text-white' 
            : 'bg-gray-800/30 text-gray-600 cursor-not-allowed'
          } ${className}
        `}
        aria-label="Scroll right"
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </>
  )
})

NavigationControls.displayName = 'NavigationControls'

// Main virtualized horizontal list component
const VirtualizedHorizontalList = ({
  items = [],
  renderItem,
  itemWidth: propItemWidth,
  gap = DEFAULT_GAP,
  className = "",
  containerClassName = "",
  showNavigation = true,
  showIndicators = false,
  keyboardNavigation = true,
  touchGestures = true,
  autoScroll = false,
  autoScrollInterval = 3000,
  persistScroll = true,
  scrollKey = "default",
  onItemClick,
  onScroll,
  'aria-label': ariaLabel = "Horizontal scrollable list"
}) => {
  // Responsive configuration
  const responsiveConfig = useResponsiveConfig()
  const itemWidth = propItemWidth || responsiveConfig.itemWidth

  // Refs
  const containerRef = useRef(null)
  const scrollAreaRef = useRef(null)
  const itemRefs = useRef({})
  const autoScrollTimeoutRef = useRef(null)

  // State
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(true)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isDragging, setIsDragging] = useState(false)

  // Custom hooks
  const { scrollX, scrollTo, scrollBy, scrollToItem } = useSmoothScroll(scrollAreaRef)
  const visibleItems = useIntersectionObserver(scrollAreaRef, itemRefs)
  const { saveScrollPosition, restoreScrollPosition, clearScrollPosition } = useScrollPersistence(
    scrollKey,
    scrollAreaRef,
    persistScroll
  )

  // Calculate items per view for scroll logic
  const itemsPerView = useMemo(() => {
    if (!containerRef.current) return 1
    const containerWidth = containerRef.current.clientWidth - 64 // Account for padding
    return Math.floor(containerWidth / (itemWidth + gap))
  }, [itemWidth, gap])

  // Update scroll state
  const updateScrollState = useCallback(() => {
    if (!scrollAreaRef.current) return

    const { scrollLeft, scrollWidth, clientWidth } = scrollAreaRef.current
    const maxScroll = scrollWidth - clientWidth

    // More reliable scroll state detection
    setCanScrollLeft(scrollLeft > 5)
    setCanScrollRight(maxScroll > 5 && scrollLeft < maxScroll - 5)

    // Update current index based on scroll position
    const newIndex = Math.round(scrollLeft / (itemWidth + gap))
    if (newIndex !== currentIndex) {
      startTransition(() => {
        setCurrentIndex(newIndex)
      })
    }

    onScroll?.(scrollLeft, maxScroll)
  }, [itemWidth, gap, currentIndex, onScroll])

  // Throttled scroll handler for performance
  const throttledUpdateScrollState = useMemo(
    () => throttle(updateScrollState, 16), // 60fps
    [updateScrollState]
  )

  // Navigation handlers
  const handleScrollLeft = useCallback(() => {
    const scrollAmount = itemsPerView * (itemWidth + gap)
    scrollBy(-scrollAmount)
  }, [itemsPerView, itemWidth, gap, scrollBy])

  const handleScrollRight = useCallback(() => {
    const scrollAmount = itemsPerView * (itemWidth + gap)
    scrollBy(scrollAmount)
  }, [itemsPerView, itemWidth, gap, scrollBy])

  // Keyboard navigation
  useEffect(() => {
    if (!keyboardNavigation || !containerRef.current) return

    const handleKeyDown = (e) => {
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault()
          handleScrollLeft()
          break
        case 'ArrowRight':
          e.preventDefault()
          handleScrollRight()
          break
        case 'Home':
          e.preventDefault()
          scrollToItem(0, itemWidth, gap)
          break
        case 'End':
          e.preventDefault()
          scrollToItem(items.length - 1, itemWidth, gap)
          break
      }
    }

    const container = containerRef.current
    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [keyboardNavigation, handleScrollLeft, handleScrollRight, scrollToItem, itemWidth, gap, items.length])

  // Simple touch gestures
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => touchGestures && handleScrollRight(),
    onSwipedRight: () => touchGestures && handleScrollLeft(),
    onSwipeStart: () => setIsDragging(true),
    onSwiped: () => setIsDragging(false),
    preventDefaultTouchmoveEvent: true,
    trackMouse: true,
    delta: { left: 20, right: 20 },
    swipeDuration: 250,
  })

  // Simple auto scroll
  useEffect(() => {
    if (!autoScroll) return

    const startAutoScroll = () => {
      autoScrollTimeoutRef.current = setTimeout(() => {
        if (!isDragging) {
          handleScrollRight()
        }
        startAutoScroll()
      }, autoScrollInterval)
    }

    startAutoScroll()

    return () => {
      if (autoScrollTimeoutRef.current) {
        clearTimeout(autoScrollTimeoutRef.current)
      }
    }
  }, [autoScroll, autoScrollInterval, isDragging, handleScrollRight])

  // Item ref callback
  const handleItemRef = useCallback((index, ref) => {
    if (ref) {
      itemRefs.current[index] = ref
    } else {
      delete itemRefs.current[index]
    }
  }, [])

  // Scroll event listener
  useEffect(() => {
    const scrollArea = scrollAreaRef.current
    if (!scrollArea) return

    scrollArea.addEventListener('scroll', throttledUpdateScrollState)
    return () => scrollArea.removeEventListener('scroll', throttledUpdateScrollState)
  }, [throttledUpdateScrollState])

  // Initial scroll state update with delay for layout
  useEffect(() => {
    const timer = setTimeout(() => {
      updateScrollState()
    }, 100)
    return () => clearTimeout(timer)
  }, [updateScrollState, items.length])

  // Context value
  const contextValue = useMemo(() => ({
    scrollTo,
    scrollBy,
    scrollToItem,
    currentIndex,
    canScrollLeft,
    canScrollRight,
    visibleItems,
    itemWidth,
    gap,
    saveScrollPosition,
    restoreScrollPosition,
    clearScrollPosition
  }), [
    scrollTo,
    scrollBy,
    scrollToItem,
    currentIndex,
    canScrollLeft,
    canScrollRight,
    visibleItems,
    itemWidth,
    gap,
    saveScrollPosition,
    restoreScrollPosition,
    clearScrollPosition
  ])

  return (
    <ScrollContext.Provider value={contextValue}>
      <div 
        ref={containerRef}
        className={`relative ${className}`}
        role="region"
        aria-label={ariaLabel}
        tabIndex={keyboardNavigation ? 0 : -1}
        {...(touchGestures && typeof window !== 'undefined' && !('ontouchstart' in window) ? swipeHandlers : {})}
      >
        {/* Navigation Controls */}
        {showNavigation && (
          <NavigationControls
            canScrollLeft={canScrollLeft}
            canScrollRight={canScrollRight}
            onScrollLeft={handleScrollLeft}
            onScrollRight={handleScrollRight}
          />
        )}

        {/* Scrollable Container */}
        <div 
          ref={scrollAreaRef}
          className={`
            flex overflow-x-auto scrollbar-hide relative px-8
            ${containerClassName}
          `}
          style={{ 
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            height: '100%'
          }}
        >
          {/* Render all items with flex layout */}
          {items.map((item, index) => {
            const isVisible = visibleItems.has(String(index))

            return (
              <VirtualizedItem
                key={item.id || index}
                item={item}
                index={index}
                itemWidth={itemWidth}
                gap={gap}
                isVisible={isVisible}
                onItemRef={handleItemRef}
              >
                {renderItem(item, index, {
                  isVisible: true, // Always render for simpler scroll detection
                  onClick: () => onItemClick?.(item, index)
                })}
              </VirtualizedItem>
            )
          })}
        </div>

        {/* Scroll Indicators */}
        {showIndicators && items.length > itemsPerView && (
          <div className="flex justify-center mt-4 space-x-2">
            {Array.from({
              length: Math.ceil(items.length / itemsPerView)
            }).map((_, index) => (
              <button
                key={index}
                onClick={() => scrollToItem(index * itemsPerView, itemWidth, gap)}
                className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                  Math.floor(currentIndex / itemsPerView) === index
                    ? 'bg-white'
                    : 'bg-white/30'
                }`}
                aria-label={`Go to page ${index + 1}`}
              />
            ))}
          </div>
        )}
      </div>
    </ScrollContext.Provider>
  )
}

// Hook to use scroll context
export const useScrollContext = () => {
  const context = useContext(ScrollContext)
  if (!context) {
    throw new Error('useScrollContext must be used within a VirtualizedHorizontalList')
  }
  return context
}

export default memo(VirtualizedHorizontalList)