import React, { memo, useMemo, useCallback } from 'react'
import { FixedSizeList as List } from 'react-window'
import SearchResultItem from './SearchResultItem'

/**
 * Virtualized search results using react-window
 * Only renders visible items in viewport for better performance with large lists
 *
 * Following React 18/19.2 best practices:
 * - useMemo for expensive calculations
 * - useCallback for stable function references
 * - memo for component optimization
 */
const VirtualizedSearchResults = memo(({
  results,
  onClose,
  containerHeight = 600,
  itemHeight = 64
}) => {
  // Memoize filtered results to avoid recalculation
  const validResults = useMemo(() =>
    results.filter(Boolean),
    [results]
  )

  // Stable callback reference for row rendering
  const Row = useCallback(({ index, style }) => {
    const media = validResults[index]
    if (!media) return null

    return (
      <div style={style} className="-mx-2">
        <SearchResultItem
          media={media}
          onClose={onClose}
          index={index}
        />
      </div>
    )
  }, [validResults, onClose])

  // Don't render if no results
  if (validResults.length === 0) {
    return null
  }

  // Calculate appropriate height
  const listHeight = Math.min(
    containerHeight,
    validResults.length * itemHeight
  )

  return (
    <div className="-mx-2 text-sm text-gray-700">
      <List
        height={listHeight}
        itemCount={validResults.length}
        itemSize={itemHeight}
        width="100%"
        className="scrollbar-thin scrollbar-thumb-gray-300 scrollbar-track-gray-100"
        style={{
          // Ensure smooth scrolling
          overflowY: 'auto',
          overflowX: 'hidden'
        }}
        // Add stable key to prevent recreation on query changes
        key="search-results-list"
      >
        {Row}
      </List>
    </div>
  )
}, (prevProps, nextProps) => {
  // Simple comparison - let react-window handle the rest
  // Only prevent re-render if literally nothing changed
  return (
    prevProps.results === nextProps.results &&
    prevProps.containerHeight === nextProps.containerHeight &&
    prevProps.itemHeight === nextProps.itemHeight
  )
})

VirtualizedSearchResults.displayName = 'VirtualizedSearchResults'

export default VirtualizedSearchResults