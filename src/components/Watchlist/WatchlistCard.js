'use client'

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import Image from 'next/image'
import { useRouter } from 'next/navigation'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'

export default function WatchlistCard({
  item,
  viewMode = 'grid',
  selected = false,
  onSelect,
  onRefresh,
  onItemRemoved,
  onItemMoved,
  onShowMoveModal,
  onShowCopyModal,
  currentPlaylist,
  playlists,
  api,
  canEditPlaylist = true,
  isNavigating = false,
  isOtherNavigating = false,
  onNavigationStart,
  user = null
}) {
  const [showActions, setShowActions] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showComingSoonModal, setShowComingSoonModal] = useState(false)
  const [comingSoonForm, setComingSoonForm] = useState({
    comingSoonDate: '',
    notes: ''
  })
  const router = useRouter()

  // Check if user is admin
  const isAdmin = user?.role === 'admin' || user?.admin || user?.permissions?.includes('Admin')

  // Custom navigation handler
  const handleNavigationClick = useCallback((url) => {
    if (!url || isNavigating || isOtherNavigating) return
    
    onNavigationStart(item.id)
    router.push(url)
  }, [item.id, onNavigationStart, router, isNavigating, isOtherNavigating])

  const handleRemove = useCallback(async () => {
    if (window.confirm(`Remove "${item.title}" from ${currentPlaylist?.name || 'watchlist'}?`)) {
      setLoading(true)
      try {
        // Use optimistic update if available
        if (onItemRemoved) {
          onItemRemoved(item.id)
        }
        
        await api.removeFromWatchlist(item.id)
        toast.success('Item removed from watchlist')
        
        // Only refresh if optimistic update not available
        if (!onItemRemoved) {
          onRefresh()
        }
      } catch (error) {
        console.error('Error removing item:', error)
        toast.error('Failed to remove item')
        
        // On error, refresh to revert optimistic changes
        if (onItemRemoved) {
          onRefresh()
        }
      } finally {
        setLoading(false)
      }
    }
  }, [item.id, item.title, currentPlaylist?.name, onRefresh, onItemRemoved, api])

  const handleShowMoveModal = useCallback(() => {
    if (onShowMoveModal) {
      onShowMoveModal(item)
      setShowActions(false)
    }
  }, [item, onShowMoveModal])

  const handleShowCopyModal = useCallback(() => {
    if (onShowCopyModal) {
      onShowCopyModal(item)
      setShowActions(false)
    }
  }, [item, onShowCopyModal])

  const formatDate = useCallback((dateString) => {
    if (!dateString) return ''
    try {
      return new Date(dateString).toLocaleDateString()
    } catch {
      return ''
    }
  }, [])

  const formatGenres = useCallback((genres) => {
    if (!genres || !Array.isArray(genres)) return ''
    return genres.slice(0, 3).map(g => g.name || g).join(', ')
  }, [])

  const getRatingColor = useCallback((rating) => {
    if (!rating) return 'text-gray-400'
    if (rating >= 8) return 'text-green-400'
    if (rating >= 6) return 'text-yellow-400'
    return 'text-red-400'
  }, [])

  const handleSetComingSoon = useCallback(async () => {
    try {
      const payload = {
        tmdbId: item.tmdbId,
        mediaType: item.mediaType
      }
      
      if (comingSoonForm.comingSoonDate) {
        payload.comingSoonDate = comingSoonForm.comingSoonDate
      }
      
      if (comingSoonForm.notes?.trim()) {
        payload.notes = comingSoonForm.notes.trim()
      }

      await fetch('/api/authenticated/watchlist?action=set-coming-soon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })

      toast.success('Marked as "Coming Soon"')
      setShowComingSoonModal(false)
      setComingSoonForm({ comingSoonDate: '', notes: '' })
      onRefresh()
    } catch (error) {
      console.error('Error setting coming soon:', error)
      toast.error('Failed to set coming soon status')
    }
  }, [item.tmdbId, item.mediaType, comingSoonForm, onRefresh])

  const handleRemoveComingSoon = useCallback(async () => {
    if (window.confirm(`Remove "Coming Soon" status from "${item.title}"?`)) {
      try {
        const response = await fetch(
          `/api/authenticated/watchlist?action=remove-coming-soon&tmdbId=${item.tmdbId}&mediaType=${item.mediaType}`,
          { method: 'DELETE' }
        )

        if (!response.ok) {
          throw new Error('Failed to remove coming soon status')
        }

        toast.success('Coming soon status removed')
        onRefresh()
      } catch (error) {
        console.error('Error removing coming soon:', error)
        toast.error('Failed to remove coming soon status')
      }
    }
  }, [item.tmdbId, item.mediaType, item.title, onRefresh])

  // Loading overlay component
  const LoadingOverlay = () => (
    <div className="absolute inset-0 bg-black/20 backdrop-blur-sm rounded-lg z-20 flex items-center justify-center">
      <div className="bg-indigo-900/90 px-4 py-2 rounded-md shadow-lg flex items-center space-x-2">
        <svg className="w-4 h-4 text-indigo-400 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        <span className="text-indigo-400 text-sm font-medium">Loading...</span>
      </div>
    </div>
  )

  if (viewMode === 'list') {
    return (
      <motion.div className={classNames(
        'bg-gray-800 rounded-lg p-4 flex items-center space-x-4 transition-all duration-200 relative',
        selected && 'ring-2 ring-indigo-500',
        loading && 'opacity-50 pointer-events-none',
        isNavigating && 'ring-2 ring-indigo-400 ring-opacity-75 shadow-lg shadow-indigo-400/25',
        isOtherNavigating && 'opacity-40 pointer-events-none'
      )}
      animate={{
        borderColor: isNavigating ? '#6366f1' : 'transparent',
      }}
      transition={{
        borderColor: { duration: 1.5, repeat: isNavigating ? Infinity : 0, repeatType: "reverse" }
      }}
      >
        {/* Loading overlay for navigating card */}
        {isNavigating && <LoadingOverlay />}
        {/* Checkbox */}
        <div className="flex-shrink-0">
          <input
            type="checkbox"
            checked={selected}
            onChange={(e) => onSelect(e.target.checked)}
            className="w-4 h-4 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500"
          />
        </div>

        {/* Poster */}
        <div className="flex-shrink-0 w-16 h-24 relative">
          <Image
            src={item.posterURL}
            alt={item.title}
            fill
            className="object-cover rounded"
            sizes="64px"
          />
          {item.mediaType && (
            <div className="absolute top-1 right-1 bg-black bg-opacity-75 text-white text-xs px-1 py-0.5 rounded">
              {item.mediaType === 'movie' ? 'M' : 'TV'}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-white truncate">
                {item.url ? (
                  <button
                    onClick={() => handleNavigationClick(item.url)}
                    className="hover:text-indigo-400 transition-colors text-left w-full truncate"
                    disabled={isNavigating || isOtherNavigating}
                  >
                    {item.title}
                  </button>
                ) : (
                  item.title
                )}
              </h3>
              
              <div className="flex items-center space-x-4 mt-1 text-sm text-gray-400">
                {item.releaseDate && (
                  <span>{formatDate(item.releaseDate)}</span>
                )}
                {item.voteAverage && (
                  <span className={classNames('flex items-center', getRatingColor(item.voteAverage))}>
                    <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                    {item.voteAverage.toFixed(1)}
                  </span>
                )}
                <span>Added {formatDate(item.dateAdded)}</span>
                {item.isExternal && (
                  <span className="bg-yellow-600 text-white text-xs px-2 py-0.5 rounded">
                    External
                  </span>
                )}
              </div>

              {item.overview && (
                <p className="text-gray-300 text-sm mt-2 line-clamp-2">
                  {item.overview}
                </p>
              )}

              {item.genres && item.genres.length > 0 && (
                <p className="text-gray-400 text-sm mt-1">
                  {formatGenres(item.genres)}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex-shrink-0 ml-4">
              <div className="relative">
                <button
                  onClick={() => setShowActions(!showActions)}
                  className="p-2 text-gray-400 hover:text-white rounded-md hover:bg-gray-700"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                  </svg>
                </button>

                {showActions && (
                  <div className="absolute right-0 mt-2 w-48 bg-gray-700 rounded-md shadow-lg z-10">
                    <div className="py-1">
                      {/* Copy to playlist - always available */}
                      <button
                        onClick={handleShowCopyModal}
                        className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
                      >
                        Copy to playlist
                      </button>
                      {/* Move and Remove - only for users with edit permissions */}
                      {canEditPlaylist && (
                        <>
                          <button
                            onClick={handleShowMoveModal}
                            className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
                          >
                            Move to playlist
                          </button>
                          <button
                            onClick={() => {
                              handleRemove()
                              setShowActions(false)
                            }}
                            className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-600"
                          >
                            Remove from watchlist
                          </button>
                        </>
                      )}
                      {/* Admin-only Coming Soon controls - only for unavailable items */}
                      {isAdmin && !item.isAvailable && (
                        <>
                          <div className="border-t border-gray-600 my-1"></div>
                          {item.comingSoon ? (
                            <button
                              onClick={() => {
                                handleRemoveComingSoon()
                                setShowActions(false)
                              }}
                              className="block w-full text-left px-4 py-2 text-sm text-orange-400 hover:bg-gray-600"
                            >
                              Remove "Coming Soon"
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                setShowComingSoonModal(true)
                                setShowActions(false)
                              }}
                              className="block w-full text-left px-4 py-2 text-sm text-blue-400 hover:bg-gray-600"
                            >
                              Mark as "Coming Soon"
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      </motion.div>
    )
  }

  // Grid view
  return (
    <motion.div className={classNames(
      'group bg-gray-800 rounded-lg overflow-hidden transition-all duration-200 hover:scale-105 hover:shadow-xl relative',
      selected && 'ring-2 ring-indigo-500',
      loading && 'opacity-50 pointer-events-none',
      isNavigating && 'ring-2 ring-indigo-400 ring-opacity-75 shadow-lg shadow-indigo-400/25',
      isOtherNavigating && 'opacity-40 pointer-events-none'
    )}
    animate={{
      borderColor: isNavigating ? '#6366f1' : 'transparent',
    }}
    transition={{
      borderColor: { duration: 1.5, repeat: isNavigating ? Infinity : 0, repeatType: "reverse" }
    }}
    >
      {/* Loading overlay for navigating card */}
      {isNavigating && <LoadingOverlay />}
      {/* Poster */}
      <div className="relative aspect-[2/3]">
        <Image
          src={item.posterURL}
          alt={item.title}
          fill
          className={classNames("object-cover group-hover:opacity-100 group-focus:opacity-100 transition-opacity duration-700",
            !item.url ? "opacity-25" : "",
          )}
          sizes="(max-width: 640px) 100vw, (max-width: 768px) 50vw, (max-width: 1024px) 33vw, (max-width: 1280px) 25vw, 20vw"
        />
        
        {/* Overlay */}
        <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-75 transition-all duration-200 flex items-center justify-center opacity-0 hover:opacity-100">
          <div className="flex space-x-2">
            <button
              onClick={() => onSelect(!selected)}
              className={classNames(
                'p-2 rounded-full transition-colors',
                selected ? 'bg-indigo-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              )}
              title={selected ? 'Deselect' : 'Select'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
            {/* Info button for internal media */}
            {item.url && (
              <button
                onClick={() => handleNavigationClick(item.url)}
                className="p-3 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 transition-colors"
                title="View Details"
                disabled={isNavigating || isOtherNavigating}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </button>
            )}
            <button
              onClick={() => setShowActions(!showActions)}
              className="p-2 bg-gray-700 text-gray-300 rounded-full hover:bg-gray-600 transition-colors"
              title="More actions"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
              </svg>
            </button>
          </div>
        </div>

        {/* Media type badge */}
        {item.mediaType && (
          <div className="absolute top-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
            {item.mediaType === 'movie' ? 'Movie' : 'TV Show'}
          </div>
        )}

        {/* External content indicator */}
        {item.isExternal && (
          <div className="absolute bottom-2 left-2 bg-yellow-600 text-white text-xs px-2 py-1 rounded">
            EXTERNAL
          </div>
        )}

        {/* Rating */}
        {item.voteAverage ? (
          <div className="absolute top-2 left-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded flex items-center">
            <svg className="w-3 h-3 mr-1 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
            {item.voteAverage.toFixed(1)}
          </div>
        ) : null}
      </div>

      {/* Content */}
      <div className="p-4">
        <h3 className="font-semibold text-white text-sm line-clamp-2 mb-2">
          {item.url ? (
            <button
              onClick={() => handleNavigationClick(item.url)}
              className="hover:text-indigo-400 transition-colors text-left w-full line-clamp-2"
              disabled={isNavigating || isOtherNavigating}
            >
              {item.title}
            </button>
          ) : (
            item.title
          )}
        </h3>
        
        <div className="text-xs text-gray-400 space-y-1">
          {item.releaseDate && (
            <div>{formatDate(item.releaseDate)}</div>
          )}
          {item.genres && item.genres.length > 0 && (
            <div className="line-clamp-1">{formatGenres(item.genres)}</div>
          )}
          <div>Added {formatDate(item.dateAdded)}</div>
        </div>

        <div className="mt-2 text-sm line-clamp-3">
          {item.url ? (
            <div className="flex items-center text-green-400">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Available now!
            </div>
          ) : (
            <div className="flex items-center text-gray-400">
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Not available yet
            </div>
          )}
        </div>
      </div>

      {/* Actions Menu */}
      {showActions && (
        <div className="absolute top-24 right-2 w-48 bg-gray-700 rounded-md shadow-lg z-10">
          <div className="py-1">
            {/* Copy to playlist - always available */}
            <button
              onClick={handleShowCopyModal}
              className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
            >
              Copy to playlist
            </button>
            {/* Move and Remove - only for users with edit permissions */}
            {canEditPlaylist && (
              <>
                <button
                  onClick={handleShowMoveModal}
                  className="block w-full text-left px-4 py-2 text-sm text-gray-300 hover:bg-gray-600"
                >
                  Move to playlist
                </button>
                <button
                  onClick={() => {
                    handleRemove()
                    setShowActions(false)
                  }}
                  className="block w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-600"
                >
                  Remove from watchlist
                </button>
              </>
            )}
            {/* Admin-only Coming Soon controls - only for unavailable items */}
            {isAdmin && !item.isAvailable && (
              <>
                <div className="border-t border-gray-600 my-1"></div>
                {item.comingSoon ? (
                  <button
                    onClick={() => {
                      handleRemoveComingSoon()
                      setShowActions(false)
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-orange-400 hover:bg-gray-600"
                  >
                    Remove "Coming Soon"
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setShowComingSoonModal(true)
                      setShowActions(false)
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-blue-400 hover:bg-gray-600"
                  >
                    Mark as "Coming Soon"
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Coming Soon Modal (Admin only) - Render using portal to escape card container */}
      {showComingSoonModal && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowComingSoonModal(false)
              setComingSoonForm({ comingSoonDate: '', notes: '' })
            }
          }}
        >
          <div
            className="bg-gray-800 rounded-lg p-6 w-96 max-w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-white mb-4">
              Mark "{item.title}" as Coming Soon
            </h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Expected Date (Optional)
                </label>
                <input
                  type="date"
                  value={comingSoonForm.comingSoonDate}
                  onChange={(e) => setComingSoonForm(prev => ({ ...prev, comingSoonDate: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  When do you expect this content to be available?
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Notes (Optional)
                </label>
                <textarea
                  value={comingSoonForm.notes}
                  onChange={(e) => setComingSoonForm(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="E.g., Scheduled via Radarr, Coming to Netflix..."
                  rows={3}
                  maxLength={500}
                />
              </div>

              <div className="flex space-x-3 pt-4">
                <button
                  onClick={handleSetComingSoon}
                  className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 transition-colors"
                >
                  Mark as Coming Soon
                </button>
                <button
                  onClick={() => {
                    setShowComingSoonModal(false)
                    setComingSoonForm({ comingSoonDate: '', notes: '' })
                  }}
                  className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>

            <div className="mt-4 p-3 bg-blue-900 bg-opacity-50 border border-blue-600 rounded-lg">
              <div className="flex items-start space-x-2">
                <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-200">
                  <p className="font-medium mb-1">Server-wide Setting</p>
                  <p>This will mark the item as "Coming Soon" for ALL users who have it in their watchlists.</p>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

    </motion.div>
  )
}