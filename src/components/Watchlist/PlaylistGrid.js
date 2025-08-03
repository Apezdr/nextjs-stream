'use client'

import { useState, useCallback, useTransition } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import WatchlistCard from './WatchlistCard'
import SkeletonCard from '@components/SkeletonCard'
import { classNames } from '@src/utils'

export default function PlaylistGrid({
  items,
  loading,
  viewMode,
  selectedItems,
  onItemSelect,
  onRefresh,
  onItemRemoved,
  onItemMoved,
  onShowMoveModal,
  currentPlaylist,
  playlists,
  onCustomReorder,
  api,
  sortBy,
  sortLocked,
  canEditPlaylist,
  navigationLoadingItemId,
  onNavigationStart
}) {
  const [draggedItem, setDraggedItem] = useState(null)
  const [draggedIndex, setDraggedIndex] = useState(null)
  const [dragOverIndex, setDragOverIndex] = useState(null)
  
  const [reorderError, setReorderError] = useState(null)

  const handleDragStart = useCallback((e, item, index) => {
    setDraggedItem(item)
    setDraggedIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    
    // Add some visual feedback to the drag image
    e.dataTransfer.setDragImage(e.target, e.target.offsetWidth / 2, e.target.offsetHeight / 2)
  }, [])

  const handleDragOver = useCallback((e, index) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    
    // Only update drag over index if it's different and we're actually dragging
    if (draggedIndex !== null && index !== dragOverIndex) {
      setDragOverIndex(index)
      
      // For drag over, we'll just show visual feedback without optimistic updates
      // The optimistic update will happen on drop via the action
    }
  }, [draggedIndex, dragOverIndex])

  const handleDragLeave = useCallback((e) => {
    // Only clear drag over index if we're leaving the container entirely
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverIndex(null)
    }
  }, [])

  const handleDrop = useCallback(async (e, targetIndex) => {
    e.preventDefault()
    setDragOverIndex(null)
    
    if (!draggedItem || !onCustomReorder || draggedIndex === null) {
      setDraggedItem(null)
      setDraggedIndex(null)
      return
    }

    // If the item is being dropped in the same position, do nothing
    if (draggedIndex === targetIndex) {
      setDraggedItem(null)
      setDraggedIndex(null)
      return
    }

    // Store the indices for the reorder operation
    const fromIndex = draggedIndex
    const toIndex = targetIndex

    // Clean up drag state immediately for smooth UX
    setDraggedItem(null)
    setDraggedIndex(null)

    // Call the parent's reorder handler with the indices
    // The parent (WatchlistPage) will handle the optimistic update
    try {
      await onCustomReorder(fromIndex, toIndex)
      setReorderError(null)
    } catch (error) {
      console.error('Failed to reorder items:', error)
      setReorderError(error.message)
    }
  }, [draggedItem, draggedIndex, onCustomReorder])

  const handleDragEnd = useCallback(() => {
    setDraggedItem(null)
    setDraggedIndex(null)
    setDragOverIndex(null)
  }, [])

  if (loading) {
    if (viewMode === 'list') {
      return (
        <div className="space-y-4">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="bg-gray-800 rounded-lg p-4 flex items-center space-x-4 animate-pulse">
              {/* Checkbox skeleton */}
              <div className="flex-shrink-0">
                <div className="w-4 h-4 bg-gray-700 rounded"></div>
              </div>
              
              {/* Poster skeleton */}
              <div className="flex-shrink-0 w-16 h-24 bg-gray-700 rounded"></div>
              
              {/* Content skeleton */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    {/* Title skeleton */}
                    <div className="h-5 bg-gray-700 rounded w-3/4 mb-2"></div>
                    
                    {/* Metadata skeleton */}
                    <div className="flex items-center space-x-4 mb-2">
                      <div className="h-3 bg-gray-700 rounded w-20"></div>
                      <div className="h-3 bg-gray-700 rounded w-16"></div>
                      <div className="h-3 bg-gray-700 rounded w-24"></div>
                    </div>
                    
                    {/* Description skeleton */}
                    <div className="space-y-1">
                      <div className="h-3 bg-gray-700 rounded w-full"></div>
                      <div className="h-3 bg-gray-700 rounded w-5/6"></div>
                    </div>
                    
                    {/* Genres skeleton */}
                    <div className="h-3 bg-gray-700 rounded w-2/3 mt-2"></div>
                  </div>
                  
                  {/* Actions button skeleton */}
                  <div className="flex-shrink-0 ml-4">
                    <div className="w-8 h-8 bg-gray-700 rounded"></div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )
    }
    
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
        {Array.from({ length: 12 }, (_, i) => (
          <SkeletonCard
            key={i}
            heightClass="h-[400px]"
          />
        ))}
      </div>
    )
  }

  if (!loading && items.length === 0) {
    return (
      <div className="text-center py-12">
        <div className="mx-auto w-24 h-24 bg-gray-700 rounded-full flex items-center justify-center mb-4">
          <svg className="w-12 h-12 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-white mb-2">
          {currentPlaylist?.name === 'My Watchlist' ? 'Your watchlist is empty' : 'This playlist is empty'}
        </h3>
        <p className="text-gray-400 mb-6">
          {currentPlaylist?.name === 'My Watchlist'
            ? 'Start adding movies and TV shows to your watchlist'
            : 'Add some items to this playlist to get started'
          }
        </p>
        <div className="space-y-2">
          <p className="text-sm text-gray-500">
            You can add items by:
          </p>
          <ul className="text-sm text-gray-400 space-y-1">
            <li>• Browsing your media library</li>
            <li>• Searching for external content</li>
            <li>• Using the search feature above</li>
          </ul>
        </div>
      </div>
    )
  }

  if (viewMode === 'list') {
    return (
      <div className="space-y-4">
        {/* Error display - only shown if optimistic update fails */}
        {reorderError && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-red-400 text-sm font-medium">Failed to reorder items: {reorderError}</span>
              </div>
              <button
                onClick={() => setReorderError(null)}
                className="text-red-400 hover:text-red-300 text-xs underline"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}
        <AnimatePresence mode="popLayout">
          {items.map((item, index) => {
            const isDragging = draggedIndex === index
            const isDropTarget = dragOverIndex === index && !isDragging
            const isNavigating = navigationLoadingItemId === item.id
            const isOtherNavigating = navigationLoadingItemId && navigationLoadingItemId !== item.id
            
            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: 20 }}
                animate={{
                  opacity: isDragging ? 0.3 : isOtherNavigating ? 0.4 : 1,
                  y: 0,
                  scale: isDropTarget ? 1.05 : 1
                }}
                exit={{ opacity: 0, y: -10 }}
                transition={{
                  opacity: { duration: 0.2 },
                  scale: { duration: 0.2 },
                  y: { duration: 0.3 }
                }}
                className={classNames(
                  'relative',
                  isDropTarget && 'ring-2 ring-green-400 ring-opacity-50',
                  selectedItems.has(item.id) && 'ring-2 ring-indigo-500 rounded-lg',
                  isOtherNavigating && 'pointer-events-none'
                )}
                draggable={currentPlaylist?.isOwner !== false && !sortLocked}
                onDragStart={(e) => handleDragStart(e, item, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
              >
              {/* Skeleton/dotted outline when this item is being dragged */}
              {isDragging && (
                <div className="absolute inset-0 border-2 border-dashed border-indigo-400 bg-indigo-900/20 rounded-lg z-10 flex items-center justify-center backdrop-blur-sm">
                  <div className="text-indigo-400 text-sm font-medium bg-indigo-900/80 px-3 py-1 rounded-md shadow-lg">
                    <svg className="w-4 h-4 inline-block mr-2 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                    </svg>
                    Reordering...
                  </div>
                </div>
              )}
              
              
              {/* Drop zone indicator */}
              {isDropTarget && (
                <div className="absolute inset-0 border-2 border-green-400 bg-green-900/10 rounded-lg z-5 flex items-center justify-center">
                  <div className="text-green-400 text-xs font-medium bg-green-900/80 px-2 py-1 rounded-md">
                    Drop here
                  </div>
                </div>
              )}
              <WatchlistCard
                item={item}
                viewMode="list"
                selected={selectedItems.has(item.id)}
                onSelect={(selected) => onItemSelect(item.id, selected)}
                onRefresh={onRefresh}
                onItemRemoved={onItemRemoved}
                onItemMoved={onItemMoved}
                onShowMoveModal={onShowMoveModal}
                currentPlaylist={currentPlaylist}
                playlists={playlists}
                api={api}
                isNavigating={isNavigating}
                isOtherNavigating={isOtherNavigating}
                onNavigationStart={onNavigationStart}
              />
          </motion.div>
        )})}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
      {/* Error display - only shown if optimistic update fails */}
      {reorderError && (
        <div className="col-span-full bg-red-900/20 border border-red-500/50 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-red-400 text-sm font-medium">Failed to reorder items: {reorderError}</span>
            </div>
            <button
              onClick={() => setReorderError(null)}
              className="text-red-400 hover:text-red-300 text-xs underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <AnimatePresence mode="popLayout">
        {items.map((item, index) => {
          const isDragging = draggedIndex === index
          const isDropTarget = dragOverIndex === index && !isDragging
          const isNavigating = navigationLoadingItemId === item.id
          const isOtherNavigating = navigationLoadingItemId && navigationLoadingItemId !== item.id
          
          return (
            <motion.div
              key={item.id}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{
                opacity: isDragging ? 0.3 : isOtherNavigating ? 0.4 : 1,
                scale: isDropTarget ? 1.05 : 1
              }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{
                opacity: { duration: 0.2 },
                scale: { duration: 0.2 }
              }}
              className={classNames(
                'relative',
                isDropTarget && 'ring-2 ring-green-400 ring-opacity-50',
                selectedItems.has(item.id) && 'ring-2 ring-indigo-500 rounded-lg',
                isOtherNavigating && 'pointer-events-none'
              )}
              draggable={currentPlaylist?.isOwner !== false && !sortLocked}
              onDragStart={(e) => handleDragStart(e, item, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
            >
            {/* Skeleton/dotted outline when this item is being dragged */}
            {isDragging && (
              <div className="absolute inset-0 border-2 border-dashed border-indigo-400 bg-indigo-900/20 rounded-lg z-10 flex items-center justify-center backdrop-blur-sm">
                <div className="text-indigo-400 text-sm font-medium bg-indigo-900/80 px-3 py-1 rounded-md shadow-lg">
                  <svg className="w-4 h-4 inline-block mr-2 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                  Reordering...
                </div>
              </div>
            )}
            
            
            {/* Drop zone indicator */}
            {isDropTarget && (
              <div className="absolute inset-0 border-2 border-green-400 bg-green-900/10 rounded-lg z-5 flex items-center justify-center">
                <div className="text-green-400 text-xs font-medium bg-green-900/80 px-2 py-1 rounded-md">
                  Drop here
                </div>
              </div>
            )}
            
            <WatchlistCard
              item={item}
              viewMode="grid"
              selected={selectedItems.has(item.id)}
              onSelect={(selected) => onItemSelect(item.id, selected)}
              onRefresh={onRefresh}
              onItemRemoved={onItemRemoved}
              onItemMoved={onItemMoved}
              onShowMoveModal={onShowMoveModal}
              currentPlaylist={currentPlaylist}
              playlists={playlists}
              api={api}
              isNavigating={isNavigating}
              isOtherNavigating={isOtherNavigating}
              onNavigationStart={onNavigationStart}
            />
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}