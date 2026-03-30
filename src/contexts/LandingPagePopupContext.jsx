'use client'

import { createContext, useContext, useState, useCallback } from 'react'

/**
 * LandingPagePopupContext - Page-scoped context for managing popup state
 * 
 * Ensures only one PopupCard can be open at a time across all HorizontalScroll
 * instances on the Landing Page. This follows Vercel's React composition patterns
 * and prevents multiple popups from overlapping.
 * 
 * Benefits:
 * - Single source of truth for popup state
 * - Minimal re-renders (only HorizontalScroll consumers update)
 * - Bundle optimized (only loaded on Landing Page)
 * - No prop drilling needed
 */
const LandingPagePopupContext = createContext(null)

/**
 * Hook to access the landing page popup state
 * Must be used within LandingPagePopupProvider component tree
 */
export function useLandingPagePopup() {
  const context = useContext(LandingPagePopupContext)
  if (!context) {
    throw new Error('useLandingPagePopup must be used within LandingPagePopupProvider')
  }
  return context
}

/**
 * Provider component that provides popup state management
 * for the entire Landing Page
 */
export function LandingPagePopupProvider({ children }) {
  const [expandedCardId, setExpandedCardId] = useState(null)

  const expandCard = useCallback((cardId) => {
    setExpandedCardId(cardId)
  }, [])

  const collapseCard = useCallback(() => {
    setExpandedCardId(null)
  }, [])

  return (
    <LandingPagePopupContext.Provider value={{ expandedCardId, expandCard, collapseCard }}>
      {children}
    </LandingPagePopupContext.Provider>
  )
}
