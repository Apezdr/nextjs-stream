'use client'

import { useEffect, useRef, useCallback } from 'react'

/**
 * Custom hook for persisting and restoring scroll positions
 * Uses sessionStorage to maintain scroll state across component re-renders
 */
export const useScrollPersistence = (key, scrollRef, enabled = true) => {
  const persistenceKey = `scroll_${key}`
  const restoreTimeoutRef = useRef(null)

  // Save scroll position to sessionStorage
  const saveScrollPosition = useCallback((scrollLeft) => {
    if (!enabled) return
    
    try {
      sessionStorage.setItem(persistenceKey, scrollLeft.toString())
    } catch (error) {
      console.warn('Failed to save scroll position:', error)
    }
  }, [persistenceKey, enabled])

  // Restore scroll position from sessionStorage
  const restoreScrollPosition = useCallback(() => {
    if (!enabled || !scrollRef.current) return

    try {
      const savedPosition = sessionStorage.getItem(persistenceKey)
      if (savedPosition !== null) {
        const scrollLeft = parseInt(savedPosition, 10)
        if (!isNaN(scrollLeft)) {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            if (scrollRef.current) {
              scrollRef.current.scrollLeft = scrollLeft
            }
          })
        }
      }
    } catch (error) {
      console.warn('Failed to restore scroll position:', error)
    }
  }, [persistenceKey, enabled, scrollRef])

  // Clear stored scroll position
  const clearScrollPosition = useCallback(() => {
    if (!enabled) return
    
    try {
      sessionStorage.removeItem(persistenceKey)
    } catch (error) {
      console.warn('Failed to clear scroll position:', error)
    }
  }, [persistenceKey, enabled])

  // Auto-save scroll position on scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    
    const scrollLeft = scrollRef.current.scrollLeft
    
    // Debounce saves to avoid excessive writes
    if (restoreTimeoutRef.current) {
      clearTimeout(restoreTimeoutRef.current)
    }
    
    restoreTimeoutRef.current = setTimeout(() => {
      saveScrollPosition(scrollLeft)
    }, 100)
  }, [saveScrollPosition, scrollRef])

  // Setup scroll listener and restore position on mount
  useEffect(() => {
    if (!enabled || !scrollRef.current) return

    const scrollElement = scrollRef.current

    // Restore position on mount
    restoreScrollPosition()

    // Add scroll listener
    scrollElement.addEventListener('scroll', handleScroll, { passive: true })

    return () => {
      scrollElement.removeEventListener('scroll', handleScroll)
      if (restoreTimeoutRef.current) {
        clearTimeout(restoreTimeoutRef.current)
      }
    }
  }, [enabled, restoreScrollPosition, handleScroll, scrollRef])

  return {
    saveScrollPosition,
    restoreScrollPosition,
    clearScrollPosition
  }
}

export default useScrollPersistence