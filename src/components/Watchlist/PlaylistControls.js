'use client'

import { useState, useCallback, useRef, useEffect, useOptimistic, useTransition } from 'react'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'
import { formatForWatchlistWithInternalCheck } from '@src/utils/tmdb/client'
import MoveToPlaylistModal from './MoveToPlaylistModal'
import Image from 'next/image'

export default function PlaylistControls({
  searchQuery,
  onSearchChange,
  onSearch,
  searchResults,
  setSearchResults,
  isSearching,
  selectedItems,
  onSelectAll,
  onClearSelection,
  onItemSelect,
  viewMode,
  onViewModeChange,
  sortBy,
  onSortChange,
  sortOrder,
  filterType,
  onFilterTypeChange,
  currentPlaylist,
  currentItems,
  playlists,
  setPlaylists,
  onRefresh,
  onItemAdded,
  onItemsRemoved,
  onItemsMoved,
  onCustomReorder,
  api,
  sortError,
  sortLocked,
  canEditPlaylist,
  onToggleSortLock
}) {
  const [showSearchResults, setShowSearchResults] = useState(false)
  const [showBulkActions, setShowBulkActions] = useState(false)
  const [showMoveMenu, setShowMoveMenu] = useState(false)
  const [showCopyMenu, setShowCopyMenu] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)
  const searchRef = useRef(null)
  const searchTimeout = useRef(null)
  
  // React 19 optimistic updates for adding items
  const [addError, setAddError] = useState(null)
  const [isPendingAdd, startAddTransition] = useTransition()
  const [addingItems, setAddingItems] = useState(new Set())

  // Handle search with debouncing
  const handleSearchInput = useCallback((value) => {
    onSearchChange(value)
    
    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current)
    }
    
    searchTimeout.current = setTimeout(() => {
      onSearch(value)
      setShowSearchResults(!!value.trim())
    }, 300)
  }, [onSearchChange, onSearch])

  // Close search results when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (searchRef.current && !searchRef.current.contains(event.target)) {
        setShowSearchResults(false)
        onSearchChange('') // Clear search text when clicking outside
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [onSearchChange])

  const handleAddFromTMDB = useCallback(async (tmdbItem) => {
    const itemKey = `external-${tmdbItem.media_type}-${tmdbItem.id}`
    
    // Prevent duplicate additions
    if (addingItems.has(itemKey)) {
      return
    }
    
    // Clear any previous errors
    setAddError(null)
    
    // Apply optimistic update immediately
    startAddTransition(() => {
      setAddingItems(prev => new Set([...prev, itemKey]))
    })
    
    try {
      // Use enhanced formatting that checks for internal media first
      const watchlistItem = await formatForWatchlistWithInternalCheck(tmdbItem)
      if (currentPlaylist && currentPlaylist.id !== 'default') {
        watchlistItem.playlistId = currentPlaylist.id
      }
      
      const result = await api.addToWatchlist(watchlistItem)
      const itemType = watchlistItem.isExternal ? 'external' : 'internal'
      toast.success(`Added "${tmdbItem.title || tmdbItem.name}" to watchlist (${itemType} media)`)
      
      // Clear optimistic state
      setAddingItems(prev => {
        const newSet = new Set(prev)
        newSet.delete(itemKey)
        return newSet
      })
      
      // Debug logging
      console.log('Add result:', result)
      console.log('onItemAdded available:', !!onItemAdded)
      console.log('result.item available:', !!result?.item)
      
      // Use optimistic update instead of full refresh
      if (onItemAdded && result?.item) {
        console.log('Using optimistic update')
        onItemAdded(result.item)
        
        // Move item from tmdbExternal to watchlist in search results
        if (setSearchResults && searchResults) {
          setSearchResults(prevResults => ({
            ...prevResults,
            watchlist: [...(prevResults.watchlist || []), {
              id: result.item.id,
              title: result.item.title,
              posterURL: result.item.posterURL,
              mediaType: result.item.mediaType
            }],
            tmdbExternal: (prevResults.tmdbExternal || []).filter(item => item.id !== tmdbItem.id)
          }))
        }
      } else {
        console.log('Falling back to refresh')
        // Fallback to refresh if optimistic update not available
        onRefresh()
      }
      
      setAddError(null)
    } catch (error) {
      console.error('Error adding item:', error)
      
      // Clear optimistic state
      setAddingItems(prev => {
        const newSet = new Set(prev)
        newSet.delete(itemKey)
        return newSet
      })
      
      if (error.message.includes('already exists')) {
        toast.warning('Item already exists in this playlist')
      } else {
        setAddError(error.message)
        toast.error('Failed to add item to watchlist')
      }
    }
  }, [currentPlaylist, onRefresh, onSearchChange, api, addingItems])

  const handleAddInternalMedia = useCallback(async (tmdbItem) => {
    const itemKey = `internal-${tmdbItem.media_type}-${tmdbItem.id}`
    
    // Prevent duplicate additions
    if (addingItems.has(itemKey)) {
      return
    }
    
    // Clear any previous errors
    setAddError(null)
    
    // Apply optimistic update immediately
    startAddTransition(() => {
      setAddingItems(prev => new Set([...prev, itemKey]))
    })
    
    try {
      // For internal media, we know it exists in the database
      const watchlistItem = {
        mediaId: tmdbItem.internalMediaId,
        tmdbId: tmdbItem.id,
        mediaType: tmdbItem.media_type,
        title: tmdbItem.title || tmdbItem.name,
        isExternal: false
      }
      
      if (currentPlaylist && currentPlaylist.id !== 'default') {
        watchlistItem.playlistId = currentPlaylist.id
      }
      
      const result = await api.addToWatchlist(watchlistItem)
      toast.success(`Added "${tmdbItem.title || tmdbItem.name}" to watchlist (internal media)`)
      
      // Clear optimistic state
      setAddingItems(prev => {
        const newSet = new Set(prev)
        newSet.delete(itemKey)
        return newSet
      })
      
      // Debug logging
      console.log('Add internal result:', result)
      console.log('onItemAdded available:', !!onItemAdded)
      console.log('result.item available:', !!result?.item)
      
      // Use optimistic update instead of full refresh
      if (onItemAdded && result?.item) {
        console.log('Using optimistic update for internal')
        onItemAdded(result.item)
        
        // Move item from tmdbInternal to watchlist in search results
        if (setSearchResults && searchResults) {
          setSearchResults(prevResults => ({
            ...prevResults,
            watchlist: [...(prevResults.watchlist || []), {
              id: result.item.id,
              title: result.item.title,
              posterURL: result.item.posterURL,
              mediaType: result.item.mediaType
            }],
            tmdbInternal: (prevResults.tmdbInternal || []).filter(item => item.id !== tmdbItem.id)
          }))
        }
      } else {
        console.log('Falling back to refresh for internal')
        // Fallback to refresh if optimistic update not available
        onRefresh()
      }
      
      setAddError(null)
    } catch (error) {
      console.error('Error adding internal media:', error)
      
      // Clear optimistic state
      setAddingItems(prev => {
        const newSet = new Set(prev)
        newSet.delete(itemKey)
        return newSet
      })
      
      if (error.message.includes('already exists')) {
        toast.warning('Item already exists in this playlist')
      } else {
        setAddError(error.message)
        toast.error('Failed to add item to watchlist')
      }
    }
  }, [currentPlaylist, onRefresh, onSearchChange, api, addingItems])

  const handleBulkRemove = useCallback(async () => {
    if (selectedItems.size === 0) return
    
    if (window.confirm(`Remove ${selectedItems.size} selected items from ${currentPlaylist?.name || 'watchlist'}?`)) {
      setBulkLoading(true)
      const itemIds = Array.from(selectedItems)
      
      try {
        // Use optimistic update if available
        if (onItemsRemoved) {
          onItemsRemoved(itemIds)
        }
        
        await api.bulkRemove(itemIds)
        toast.success(`Removed ${selectedItems.size} items from watchlist`)
        
        // Only refresh if optimistic update not available
        if (!onItemsRemoved) {
          onRefresh()
          onSelectAll() // Clear selection
        }
      } catch (error) {
        console.error('Error removing items:', error)
        toast.error('Failed to remove items')
        
        // On error, refresh to revert optimistic changes
        if (onItemsRemoved) {
          onRefresh()
        }
      } finally {
        setBulkLoading(false)
        setShowBulkActions(false)
      }
    }
  }, [selectedItems, currentPlaylist?.name, onRefresh, onSelectAll, onItemsRemoved, api])

  const handleBulkMove = useCallback(async (targetPlaylistId) => {
    if (selectedItems.size === 0) return
    
    setBulkLoading(true)
    const itemIds = Array.from(selectedItems)
    
    try {
      // Use optimistic update if available
      if (onItemsMoved) {
        onItemsMoved(itemIds, targetPlaylistId)
      }
      
      await api.moveItems(itemIds, targetPlaylistId)
      const targetPlaylist = playlists.find(p => p.id === targetPlaylistId)
      toast.success(`Moved ${selectedItems.size} items to ${targetPlaylist?.name || 'My Watchlist'}`)
      
      // Only refresh if optimistic update not available
      if (!onItemsMoved) {
        onRefresh()
        onSelectAll() // Clear selection
      }
    } catch (error) {
      console.error('Error moving items:', error)
      toast.error('Failed to move items')
      
      // On error, refresh to revert optimistic changes
      if (onItemsMoved) {
        onRefresh()
      }
    } finally {
      setBulkLoading(false)
      setShowBulkActions(false)
    }
  }, [selectedItems, playlists, onRefresh, onSelectAll, onItemsMoved, api])

  const handleBulkCopy = useCallback(async (targetPlaylistId) => {
    if (selectedItems.size === 0) return
    
    setBulkLoading(true)
    const itemIds = Array.from(selectedItems)
    
    try {
      // Use currentItems prop to find selected items (no extra API call needed)
      const itemsToCopy = currentItems.filter(item => itemIds.includes(item.id))
      
      if (itemsToCopy.length === 0) {
        toast.error('No items found to copy')
        return
      }
      
      let copiedCount = 0
      let skippedCount = 0
      let failedCount = 0
      const failedItems = []
      
      // Add each item to the target playlist
      for (const item of itemsToCopy) {
        // Prepare complete item data
        const watchlistItem = {
          mediaType: item.mediaType,
          title: item.title,
          isExternal: item.isExternal || false,
          playlistId: targetPlaylistId
        }
        
        // Add IDs based on what's available
        if (item.mediaId) {
          watchlistItem.mediaId = item.mediaId
        }
        if (item.tmdbId) {
          watchlistItem.tmdbId = item.tmdbId
        }
        
        // For external items, include TMDB metadata
        if (item.isExternal) {
          watchlistItem.tmdbData = {
            overview: item.overview,
            release_date: item.releaseDate,
            first_air_date: item.releaseDate,
            poster_path: item.posterPath,
            backdrop_path: item.backdropPath,
            genres: item.genres,
            original_language: item.originalLanguage,
            vote_average: item.voteAverage,
            vote_count: item.voteCount
          }
          
          if (item.posterURL) {
            watchlistItem.posterURL = item.posterURL
          }
        }
        
        try {
          await api.addToWatchlist(watchlistItem)
          copiedCount++
        } catch (error) {
          // Continue with other items even if one fails
          if (error.message?.includes('already exists')) {
            skippedCount++
          } else {
            console.error(`Failed to copy "${item.title}":`, error)
            failedCount++
            failedItems.push(item.title)
          }
        }
      }
      
      // Refresh playlists from server to get accurate counts from database
      // This ensures sidebar shows true item counts instead of optimistic guesses
      if (copiedCount > 0) {
        await onRefresh()
      }
      
      // Build success message
      const targetPlaylist = playlists.find(p => p.id === targetPlaylistId)
      const targetName = targetPlaylist?.name || 'My Watchlist'
      
      if (copiedCount > 0) {
        let message = `Copied ${copiedCount} item${copiedCount !== 1 ? 's' : ''} to ${targetName}`
        if (skippedCount > 0) {
          message += ` (${skippedCount} already existed)`
        }
        if (failedCount > 0) {
          message += ` (${failedCount} failed)`
        }
        toast.success(message)
      } else if (skippedCount > 0) {
        toast.info(`All ${skippedCount} items already exist in ${targetName}`)
      } else if (failedCount > 0) {
        toast.error(`Failed to copy ${failedCount} items: ${failedItems.join(', ')}`)
      }
      
      // Clear selection after copy
      onClearSelection()
    } catch (error) {
      console.error('Error in bulk copy operation:', error)
      toast.error('Failed to copy items')
    } finally {
      setBulkLoading(false)
      setShowBulkActions(false)
      setShowCopyMenu(false)
    }
  }, [selectedItems, playlists, onClearSelection, api, currentItems, onRefresh])

  return (
    <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
      {/* Add Error Display */}
      {addError && (
        <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3 mb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="text-red-400 text-sm font-medium">Failed to add item: {addError}</span>
            </div>
            <button
              onClick={() => setAddError(null)}
              className="text-red-400 hover:text-red-300 text-xs underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
        {/* Search */}
        <div className="relative flex-1 max-w-md" ref={searchRef}>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchInput(e.target.value)}
              placeholder={canEditPlaylist ? "Search watchlist or add from TMDB..." : "Search watchlist (read-only)"}
              disabled={!canEditPlaylist}
              className={classNames(
                "w-full pl-10 pr-4 py-2 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent",
                canEditPlaylist
                  ? "bg-gray-700"
                  : "bg-gray-600 cursor-not-allowed opacity-75"
              )}
              title={!canEditPlaylist ? "You don't have permission to add items to this playlist" : ""}
            />
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              {isSearching ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-500"></div>
              ) : (
                <svg className="h-5 w-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              )}
            </div>
          </div>

          {/* Search Results - only show add options if user can edit */}
          {showSearchResults && canEditPlaylist && (searchResults?.watchlist?.length > 0 || searchResults?.tmdbInternal?.length > 0 || searchResults?.tmdbExternal?.length > 0) && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-gray-700 border border-gray-600 rounded-md shadow-lg z-20 max-h-96 overflow-y-auto">
              {/* Watchlist Results */}
              {searchResults.watchlist?.length > 0 && (
                <div className="p-2">
                  <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center">
                    <svg className="w-4 h-4 mr-2 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                    In Your Watchlist
                  </h4>
                  {searchResults.watchlist.map((item) => (
                    <div key={item.id} className="flex items-center space-x-3 p-2 hover:bg-gray-600 rounded">
                      <Image
                        src={item.posterURL}
                        alt={item.title}
                        width={32}
                        height={48}
                        className="w-8 h-12 object-cover rounded"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{item.title}</p>
                        <p className="text-xs text-gray-400">{item.mediaType === 'movie' ? 'Movie' : 'TV Show'}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Internal Media Results */}
              {searchResults.tmdbInternal?.length > 0 && (
                <div className={`p-2 ${searchResults.watchlist?.length > 0 ? 'border-t border-gray-600' : ''}`}>
                  <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center">
                    <svg className="w-4 h-4 mr-2 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                    </svg>
                    Available in Media Server
                  </h4>
                  {searchResults.tmdbInternal.map((item) => {
                    const itemKey = `internal-${item.media_type}-${item.id}`
                    const isAdding = addingItems.has(itemKey)
                    
                    return (
                      <button
                        key={itemKey}
                        onClick={() => handleAddInternalMedia(item)}
                        disabled={isAdding}
                        className={classNames(
                          "w-full flex items-center space-x-3 p-2 rounded text-left transition-colors",
                          isAdding
                            ? "bg-gray-600 opacity-50 cursor-not-allowed"
                            : "hover:bg-gray-600"
                        )}
                      >
                        <Image
                          src={item.poster_path || '/sorry-image-not-available.jpg'}
                          alt={item.title || item.name}
                          width={32}
                          height={48}
                          className="w-8 h-12 object-cover rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{item.title || item.name}</p>
                          <p className="text-xs text-green-400">
                            {item.media_type === 'movie' ? 'Movie' : 'TV Show'} • {item.release_date || item.first_air_date || 'Unknown'} • In Library
                          </p>
                        </div>
                        {isAdding ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-green-400"></div>
                        ) : (
                          <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}

              {/* External TMDB Results */}
              {searchResults.tmdbExternal?.length > 0 && (
                <div className={`p-2 ${(searchResults.watchlist?.length > 0 || searchResults.tmdbInternal?.length > 0) ? 'border-t border-gray-600' : ''}`}>
                  <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center">
                    <svg className="w-4 h-4 mr-2 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    Add from TMDB
                  </h4>
                  {searchResults.tmdbExternal.map((item) => {
                    const itemKey = `external-${item.media_type}-${item.id}`
                    const isAdding = addingItems.has(itemKey)
                    
                    return (
                      <button
                        key={itemKey}
                        onClick={() => handleAddFromTMDB(item)}
                        disabled={isAdding}
                        className={classNames(
                          "w-full flex items-center space-x-3 p-2 rounded text-left transition-colors",
                          isAdding
                            ? "bg-gray-600 opacity-50 cursor-not-allowed"
                            : "hover:bg-gray-600"
                        )}
                      >
                        <Image
                          src={item.poster_path ? `https://image.tmdb.org/t/p/w92${item.poster_path}` : '/sorry-image-not-available.jpg'}
                          alt={item.title || item.name}
                          width={32}
                          height={48}
                          className="w-8 h-12 object-cover rounded"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{item.title || item.name}</p>
                          <p className="text-xs text-gray-400">
                            {item.media_type === 'movie' ? 'Movie' : 'TV Show'} • {item.release_date || item.first_air_date || 'Unknown'}
                          </p>
                        </div>
                        {isAdding ? (
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-400"></div>
                        ) : (
                          <svg className="w-4 h-4 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center space-x-4">
          {/* Bulk Actions */}
          {selectedItems.size > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowBulkActions(!showBulkActions)}
                className="flex items-center space-x-2 px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
                disabled={bulkLoading}
              >
                <span>{selectedItems.size} selected</span>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showBulkActions && (
                <div className="absolute top-full right-0 mt-1 w-48 bg-gray-700 rounded-md shadow-lg z-10">
                  <div className="py-1">
                    {/* Copy to playlist - always available */}
                    <button
                      onClick={() => {
                        setShowCopyMenu(true)
                        setShowBulkActions(false)
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
                    >
                      Copy to playlist
                    </button>
                    {/* Move and Remove - only for users with edit permissions */}
                    {canEditPlaylist && (
                      <>
                        <button
                          onClick={() => {
                            setShowMoveMenu(true)
                            setShowBulkActions(false)
                          }}
                          className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
                        >
                          Move to playlist
                        </button>
                        <button
                          onClick={handleBulkRemove}
                          className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-600"
                        >
                          Remove from watchlist
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        onSelectAll()
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
                    >
                      Select all
                    </button>
                    <button
                      onClick={() => {
                        onClearSelection()
                      }}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
                    >
                      Clear selection
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Select All */}
          <button
            onClick={onSelectAll}
            className="px-3 py-2 text-gray-400 hover:text-white rounded-md hover:bg-gray-700 transition-colors"
            title="Select all"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {/* Filter */}
          <select
            id="playlist-filter-type"
            name="filterType"
            value={filterType}
            onChange={(e) => onFilterTypeChange(e.target.value)}
            className="pl-3 pr-7 py-2 bg-gray-700 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Filter by media type"
          >
            <option value="all">All Types</option>
            <option value="movie">Movies</option>
            <option value="tv">TV Shows</option>
          </select>

          {/* Sort Lock/Unlock Button */}
          {canEditPlaylist && (
            <button
              onClick={onToggleSortLock}
              className={classNames(
                'px-3 py-2 rounded-md text-sm transition-colors flex items-center space-x-2',
                sortLocked
                  ? 'bg-red-600 text-white hover:bg-red-700'
                  : 'bg-green-600 text-white hover:bg-green-700'
              )}
              title={sortLocked ? 'Unlock sort settings' : 'Lock sort settings'}
            >
              {sortLocked ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <span>Locked</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                  </svg>
                  <span>Unlocked</span>
                </>
              )}
            </button>
          )}

          {/* Sort */}
          <select
            id="playlist-sort-order"
            name="sortOrder"
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [newSortBy, newSortOrder] = e.target.value.split('-')
              onSortChange(newSortBy, newSortOrder)
            }}
            disabled={sortLocked}
            className={classNames(
              'px-3 py-2 border border-gray-600 rounded-md text-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500',
              sortLocked
                ? 'bg-gray-600 cursor-not-allowed opacity-50'
                : 'bg-gray-700'
            )}
            aria-label="Sort playlist items"
          >
            <option value="dateAdded-desc">Recently Added</option>
            <option value="dateAdded-asc">Oldest First</option>
            <option value="title-asc">Title A-Z</option>
            <option value="title-desc">Title Z-A</option>
            <option value="releaseDate-desc">Newest Releases First</option>
            <option value="releaseDate-asc">Oldest Releases First</option>
            <option value="custom-asc">Custom Order</option>
          </select>

          {/* View Mode */}
          <div className="flex rounded-md overflow-hidden">
            <button
              onClick={() => onViewModeChange('grid')}
              className={classNames(
                'px-3 py-2 text-sm transition-colors',
                viewMode === 'grid'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              )}
              title="Grid view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
              </svg>
            </button>
            <button
              onClick={() => onViewModeChange('list')}
              className={classNames(
                'px-3 py-2 text-sm transition-colors',
                viewMode === 'list'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              )}
              title="List view"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Bulk Move Modal */}
      <MoveToPlaylistModal
        isOpen={showMoveMenu}
        onClose={() => setShowMoveMenu(false)}
        onMoveToPlaylist={handleBulkMove}
        playlists={playlists}
        itemTitle={`${selectedItems.size} items`}
        isLoading={bulkLoading}
        selectedPlaylistId={currentPlaylist?.id}
      />
      
      {/* Bulk Copy Modal */}
      <MoveToPlaylistModal
        isOpen={showCopyMenu}
        onClose={() => setShowCopyMenu(false)}
        onMoveToPlaylist={handleBulkCopy}
        playlists={playlists}
        itemTitle={`Copy ${selectedItems.size} items`}
        isLoading={bulkLoading}
        selectedPlaylistId={currentPlaylist?.id}
        isCopyMode={true}
      />
    </div>
  )
}