'use client'

import { useState, useEffect, useSyncExternalStore } from 'react'
import throttle from 'lodash.throttle'

// Global state for items per page calculation
let globalItemsPerPage = null
let globalListeners = new Set()

// Subscribe to window resize events
const subscribe = (callback) => {
  globalListeners.add(callback)
  return () => globalListeners.delete(callback)
}

// Get current items per page value
const getSnapshot = () => globalItemsPerPage

// Layout constants (matching Card.js and HorizontalScroll.js)
const CARD_WIDTHS = {
  mobile: 128,   // < 640px (matches Card.js getCollapsedWidth)
  tablet: 144,   // 640-1023px
  desktop: 192   // >= 1024px
}

const GAP = 16           // gap-x-4 = 16px
const PEEK_WIDTH = 50    // From HorizontalScroll PEEK_WIDTH constant
const ARROW_WIDTH = 64   // w-16 = 64px per arrow

// Calculate items per page based on precise mathematical calculation
const calculateItemsPerPage = () => {
  if (typeof window === 'undefined') return 2
  
  const screenWidth = window.innerWidth
  
  // Determine card size based on breakpoint (matching Card.js logic)
  let cardWidth
  if (screenWidth < 640) {
    cardWidth = CARD_WIDTHS.mobile
  } else if (screenWidth < 1024) {
    cardWidth = CARD_WIDTHS.tablet
  } else {
    cardWidth = CARD_WIDTHS.desktop
  }
  
  // Calculate available width for cards
  let availableWidth = screenWidth
  
  // Subtract arrows (both sides)
  availableWidth -= (ARROW_WIDTH * 2)
  
  // Subtract peek widths (not on mobile)
  if (screenWidth >= 768) {
    availableWidth -= (PEEK_WIDTH * 2)
  }
  
  // Calculate how many cards fit
  // Formula: (availableWidth + gap) / (cardWidth + gap)
  // The +gap accounts for no trailing gap after the last card
  const items = Math.floor((availableWidth + GAP) / (cardWidth + GAP))
  
  return Math.max(1, items) // Ensure at least 1 card
}

// Throttled window resize handler
const handleResize = throttle(() => {
  const newItemsPerPage = calculateItemsPerPage()
  if (newItemsPerPage !== globalItemsPerPage) {
    console.log(`Global itemsPerPage changed from ${globalItemsPerPage} to ${newItemsPerPage}`)
    globalItemsPerPage = newItemsPerPage
    // Notify all subscribers
    globalListeners.forEach(listener => listener())
  }
}, 100)

// Initialize global state and listeners
if (typeof window !== 'undefined') {
  globalItemsPerPage = calculateItemsPerPage()
  window.addEventListener('resize', handleResize)
}

/**
 * Hook that provides items per page calculation shared across all HorizontalScroll components
 * Calculates once per page load and updates only on window resize
 */
export function useItemsPerPage() {
  // Use React's useSyncExternalStore for proper SSR handling and state sharing
  const itemsPerPage = useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => 2 // SSR fallback
  )
  
  // Initialize if not set (for SSR hydration)
  useEffect(() => {
    if (globalItemsPerPage === null) {
      globalItemsPerPage = calculateItemsPerPage()
      globalListeners.forEach(listener => listener())
    }
  }, [])
  
  return itemsPerPage || 2
}
