'use client'

import { useState, useEffect, useCallback, use, useRef, useMemo } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'react-toastify'
import { motion, AnimatePresence } from 'framer-motion'
import { debounce } from 'lodash'
import PlaylistSidebar from './PlaylistSidebar'
import PlaylistGrid from './PlaylistGrid'
import PlaylistControls from './PlaylistControls'
import SharePlaylistModal from './SharePlaylistModal'
import MoveToPlaylistModal from './MoveToPlaylistModal'
import { ControlsSkeleton } from './WatchlistSkeletons'
import ShowInAppUserModal from './ShowInAppUserModal'
import ShowInAppAdminModal from './ShowInAppAdminModal'
import { searchMedia } from '@src/utils/tmdb/client'
import { classNames, formatDate } from '@src/utils'

// Custom hook for API calls using React 19 patterns
function useWatchlistAPI() {
  const apiCall = useCallback(async (endpoint, options = {}) => {
    const { method = 'GET', body, params } = options

    let url = `/api/authenticated/watchlist${endpoint}`
    if (params && typeof params === 'object') {
      const entries = Object.entries(params).filter(([_, v]) => v !== undefined && v !== null && v !== 'undefined')
      if (entries.length > 0) {
        const searchParams = new URLSearchParams(entries)
        url += `?${searchParams.toString()}`
      }
    }

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }))
      throw new Error(error.error || `HTTP ${response.status}`)
    }

    return response.json()
  }, [])

  return {
    // Playlist operations
    getPlaylists: useCallback((includeShared = true, options = {}) =>
      apiCall('', { params: { action: 'playlists', includeShared, ...options } }), [apiCall]),
    
    getPlaylistById: useCallback((playlistId) =>
      apiCall('', { params: { action: 'playlist-by-id', playlistId } }), [apiCall]),
    
    getPlaylistItems: useCallback((playlistId, options = {}) =>
      apiCall('', { 
        params: { 
          action: 'playlist-items', 
          playlistId,
          ...options 
        } 
      }), [apiCall]),
    
    createPlaylist: useCallback((playlistData) => 
      apiCall('', { 
        method: 'POST', 
        params: { action: 'create-playlist' },
        body: playlistData 
      }), [apiCall]),
    
    updatePlaylist: useCallback((playlistId, updates) => 
      apiCall('', { 
        method: 'PUT', 
        params: { action: 'update-playlist', playlistId },
        body: updates 
      }), [apiCall]),
    
    deletePlaylist: useCallback((playlistId) => 
      apiCall('', { 
        method: 'DELETE', 
        params: { action: 'delete-playlist', playlistId } 
      }), [apiCall]),
    
    sharePlaylist: useCallback((playlistId, collaborators) => 
      apiCall('', { 
        method: 'POST', 
        params: { action: 'share-playlist' },
        body: { playlistId, collaborators } 
      }), [apiCall]),
    
    // Watchlist operations
    addToWatchlist: useCallback((item) => 
      apiCall('', { 
        method: 'POST', 
        params: { action: 'add' },
        body: item 
      }), [apiCall]),
    
    removeFromWatchlist: useCallback((itemId) => 
      apiCall('', { 
        method: 'DELETE', 
        params: { action: 'remove', id: itemId } 
      }), [apiCall]),
    
    moveItems: useCallback((itemIds, targetPlaylistId) => 
      apiCall('', { 
        method: 'POST', 
        params: { action: 'move-items' },
        body: { itemIds, targetPlaylistId } 
      }), [apiCall]),
    
    bulkRemove: useCallback((itemIds) => 
      apiCall('', { 
        method: 'DELETE', 
        params: { action: 'bulk-remove' },
        body: { ids: itemIds } 
      }), [apiCall]),
    
    searchWatchlist: useCallback((query, options = {}) => 
      apiCall('', { 
        params: { 
          action: 'list', 
          ...options,
          // For now, we'll implement search client-side
          // In a real app, you'd want server-side search
        } 
      }), [apiCall]),
    
    getWatchlistSummary: useCallback(async (playlistId = 'default') => {
      // Get comprehensive stats by fetching playlists and counting items by type for the specified playlist
      const [playlistsData, totalItems, movieCount, tvCount] = await Promise.all([
        apiCall('', { params: { action: 'playlists' } }),
        apiCall('', { params: { action: 'list', playlistId, countOnly: 'true' } }),
        apiCall('', { params: { action: 'list', playlistId, mediaType: 'movie', countOnly: 'true' } }),
        apiCall('', { params: { action: 'list', playlistId, mediaType: 'tv', countOnly: 'true' } })
      ])
      
      return {
        total: totalItems.count || 0,
        movieCount: movieCount.count || 0,
        tvCount: tvCount.count || 0,
        playlistCount: playlistsData.playlists?.length || 0
      }
    }, [apiCall]),

    // Playlist sorting operations
    updatePlaylistSorting: useCallback((playlistId, sortBy, sortOrder) =>
      apiCall('', {
        method: 'PUT',
        params: { action: 'update-playlist-sorting' },
        body: { playlistId, sortBy, sortOrder }
      }), [apiCall]),
    
    updatePlaylistOrder: useCallback((playlistId, itemIds) =>
      apiCall('', {
        method: 'PUT',
        params: { action: 'update-playlist-order' },
        body: { playlistId, itemIds }
      }), [apiCall]),

    // Per-user playlist visibility (Show in App)
    getPlaylistVisibility: useCallback((options = {}) =>
      apiCall('', {
        params: { action: 'playlist-visibility', ...options }
      }), [apiCall]),

    setPlaylistVisibility: useCallback((payload) =>
      apiCall('', {
        method: 'PUT',
        params: { action: 'playlist-visibility' },
        body: payload
      }), [apiCall]),

    // Admin: list users for visibility management
    listUsersForVisibility: useCallback((options = {}) =>
      apiCall('', {
        params: { action: 'playlist-visibility-list-users', ...options }
      }), [apiCall]),

    // Admin: reset visibility for all users for a playlist
    resetPlaylistVisibilityAll: useCallback((playlistId) =>
      apiCall('', {
        method: 'POST',
        params: { action: 'playlist-visibility-reset-all' },
        body: { playlistId }
      }), [apiCall])
  }
}

export default function WatchlistPage({ user }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const api = useWatchlistAPI()
  
  const [playlists, setPlaylists] = useState([])
  const [currentPlaylist, setCurrentPlaylist] = useState(null)
  const [currentItems, setCurrentItems] = useState([])
  
  // Derive selected playlist ID from URL - single source of truth
  const selectedPlaylistId = useMemo(() => {
    const urlPlaylistParam = searchParams.get('playlist')
    const isSharedParam = searchParams.get('shared') === 'true'
    
    // If URL has a playlist parameter (could be shared/public), use it
    // We'll validate access when loading the playlist
    if (urlPlaylistParam) {
      // Check if it's in user's playlists first
      if (playlists.some(p => p.id === urlPlaylistParam)) {
        return urlPlaylistParam
      }
      
      // If marked as shared, allow it even if not in user's list
      // We'll fetch it separately to check if it's public/accessible
      if (isSharedParam) {
        return urlPlaylistParam
      }
    }
    
    // Otherwise, determine default playlist
    if (playlists.length > 0) {
      const defaultPlaylist = playlists.find(p => p.isDefault) ||
                              playlists.find(p => p.id === 'default') ||
                              playlists[0]
      return defaultPlaylist?.id || 'default'
    }
    
    return 'default'
  }, [searchParams, playlists])
  
  // Granular loading states
  const [playlistsLoading, setPlaylistsLoading] = useState(true)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [initializing, setInitializing] = useState(true)
  
  
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState({ watchlist: [], tmdbInternal: [], tmdbExternal: [] })
  const [isSearching, setIsSearching] = useState(false)
  
  // Request ID counter to prevent race conditions in search
  const searchRequestIdRef = useRef(0)
  const [selectedItems, setSelectedItems] = useState(new Set())
  const [showShareModal, setShowShareModal] = useState(false)
  const [sharePlaylistId, setSharePlaylistId] = useState(null)
  const [showMoveModal, setShowMoveModal] = useState(false)
  const [showCopyModal, setShowCopyModal] = useState(false)
  const [moveItemData, setMoveItemData] = useState(null)
  const [showManageRows, setShowManageRows] = useState(false)
  const [viewMode, setViewMode] = useState(() => {
    // Initialize from localStorage if available, fallback to 'grid'
    if (typeof window !== 'undefined') {
      return localStorage.getItem('watchlist-view-mode') || 'grid'
    }
    return 'grid'
  }) // 'grid' or 'list'
  const [sortBy, setSortBy] = useState('dateAdded') // 'dateAdded', 'title', 'releaseDate'
  const [sortOrder, setSortOrder] = useState('desc') // 'asc' or 'desc'
  const [filterType, setFilterType] = useState('all') // 'all', 'movie', 'tv'
  const [summary, setSummary] = useState(null)
  
  // State for sort errors
  const [sortError, setSortError] = useState(null)
  
  // State for sort/order lock functionality
  const [sortLocked, setSortLocked] = useState(true) // Default to locked
  const [showAdminRows, setShowAdminRows] = useState(false)
  
  // Helper function to check if user has edit permissions
  // Use the canEdit field from the playlist data (computed server-side)
  const canEditPlaylist = useMemo(() => {
    console.log('[canEditPlaylist] Computing canEdit permission')
    console.log('[canEditPlaylist] currentPlaylist:', currentPlaylist)
    console.log('[canEditPlaylist] currentPlaylist.canEdit:', currentPlaylist?.canEdit)
    console.log('[canEditPlaylist] user:', user)
    console.log('[canEditPlaylist] selectedPlaylistId:', selectedPlaylistId)
    
    // Use server-provided canEdit field if available
    if (currentPlaylist?.canEdit !== undefined) {
      console.log('[canEditPlaylist] Using server-provided canEdit:', currentPlaylist.canEdit)
      return currentPlaylist.canEdit
    }
    
    console.log('[canEditPlaylist] canEdit not provided, using fallback logic')
    
    // Fallback logic if canEdit not provided (shouldn't happen with updated API)
    if (!user) {
      console.log('[canEditPlaylist] No user, returning false')
      return false
    }
    
    // Check if user is admin (check both role and admin flag)
    if (user.role === 'Admin' || user.admin || user.permissions?.includes('Admin')) {
      console.log('[canEditPlaylist] User is admin, returning true')
      return true
    }
    
    // Check if user has "Can Edit" permission
    if (user.permissions?.includes('Can Edit')) {
      console.log('[canEditPlaylist] User has Can Edit permission, returning true')
      return true
    }
    
    // If currentPlaylist is not loaded yet, check the playlists array
    if (!currentPlaylist && selectedPlaylistId) {
      const playlistFromList = playlists.find(p => p.id === selectedPlaylistId)
      console.log('[canEditPlaylist] Found playlist in list:', playlistFromList)
      
      if (playlistFromList) {
        // Use canEdit from playlists array if available
        if (playlistFromList.canEdit !== undefined) {
          console.log('[canEditPlaylist] Using canEdit from playlist list:', playlistFromList.canEdit)
          return playlistFromList.canEdit
        }
        // Check isOwner from playlists array
        if (playlistFromList.isOwner) {
          console.log('[canEditPlaylist] User is owner (from playlist list), returning true')
          return true
        }
      }
    }
    
    // Check if user is the playlist owner from currentPlaylist
    if (currentPlaylist?.isOwner) {
      console.log('[canEditPlaylist] User is playlist owner, returning true')
      return true
    }
    
    console.log('[canEditPlaylist] No edit permission found, returning false')
    return false
  }, [user, currentPlaylist, selectedPlaylistId, playlists])

  // Admin detection for showing admin tools
  const isAdmin = useMemo(() => {
    if (!user) return false
    return (
      user.role === 'admin' ||
      user.role === 'Admin' ||
      user.admin === true ||
      user.isAdmin === true ||
      (Array.isArray(user.permissions) && user.permissions.includes('Admin'))
    )
  }, [user])
  
  // Helper function to sort items locally for optimistic updates
  const sortItemsLocally = useCallback((items, sortBy, sortOrder) => {
    const sortedItems = [...items]
    
    switch (sortBy) {
      case 'title':
        sortedItems.sort((a, b) => {
          const titleA = (a.title || '').toLowerCase()
          const titleB = (b.title || '').toLowerCase()
          return sortOrder === 'asc' ? titleA.localeCompare(titleB) : titleB.localeCompare(titleA)
        })
        break
      case 'releaseDate':
        sortedItems.sort((a, b) => {
          const dateA = new Date(a.releaseDate || 0)
          const dateB = new Date(b.releaseDate || 0)
          return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
        })
        break
      case 'dateAdded':
        sortedItems.sort((a, b) => {
          const dateA = new Date(a.dateAdded || 0)
          const dateB = new Date(b.dateAdded || 0)
          return sortOrder === 'asc' ? dateA - dateB : dateB - dateA
        })
        break
      case 'custom':
        // For custom sort, maintain the current order (server handles this)
        break
      default:
        break
    }
    
    return sortedItems
  }, [])
  
  // State for tracking if we're currently reordering
  const [isReordering, setIsReordering] = useState(false)
  
  // Debouncing for sort changes
  const sortChangeTimeout = useRef(null)
  
  // Track last loaded playlist to prevent redundant loads
  const lastLoadedPlaylistRef = useRef(null)
  

  // Create separate functions for data loading that return promises
  const loadPlaylistsData = useCallback(async () => {
    try {
      const data = await api.getPlaylists()
      return data.playlists || []
    } catch (error) {
      console.error('Error loading playlists:', error)
      toast.error('Failed to load playlists')
      return []
    }
  }, [api])

  const loadSummaryData = useCallback(async (playlistId = 'default') => {
    try {
      const summaryData = await api.getWatchlistSummary(playlistId)
      return summaryData
    } catch (error) {
      console.error('Error loading summary:', error)
      return null
    }
  }, [api])

  // Unified initial data loading - runs only once on mount
  useEffect(() => {
    const initializeWatchlist = async () => {
      setInitializing(true)
      setPlaylistsLoading(true)
      setSummaryLoading(true)
      
      try {
        // Capture initial playlist param from URL
        const initialPlaylistParam = searchParams.get('playlist')
        const isSharedParam = searchParams.get('shared') === 'true'
        
        // Fetch playlists and summary in parallel
        const [playlistsResult, summaryResult] = await Promise.allSettled([
          loadPlaylistsData(),
          loadSummaryData() // Load default summary initially
        ])
        
        let loadedPlaylists = []
        if (playlistsResult.status === 'fulfilled') {
          loadedPlaylists = playlistsResult.value || []
          setPlaylists(loadedPlaylists)
        }
        setPlaylistsLoading(false)
        
        if (summaryResult.status === 'fulfilled' && summaryResult.value) {
          setSummary(summaryResult.value)
        }
        setSummaryLoading(false)
        
        // Determine initial playlist from URL
        let targetPlaylistId = 'default'
        
        if (initialPlaylistParam) {
          // Check if it's in user's playlists
          if (loadedPlaylists.some(p => p.id === initialPlaylistParam)) {
            targetPlaylistId = initialPlaylistParam
          }
          // Or if it's marked as shared, allow it (will be fetched separately)
          else if (isSharedParam) {
            targetPlaylistId = initialPlaylistParam
          }
          // Otherwise fall through to default playlist
        }
        
        // If no valid playlist ID from URL, use default
        if (targetPlaylistId === 'default' && loadedPlaylists.length > 0) {
          const defaultPlaylist = loadedPlaylists.find(p => p.isDefault) ||
                                   loadedPlaylists.find(p => p.id === 'default') ||
                                   loadedPlaylists[0]
          if (defaultPlaylist) {
            targetPlaylistId = defaultPlaylist.id
          }
        }
        
        // Load playlist items for the initial playlist
        if (targetPlaylistId && loadedPlaylists.length > 0) {
          await loadPlaylistItems(targetPlaylistId)
          lastLoadedPlaylistRef.current = targetPlaylistId
          
          // Load specific summary for this playlist if it's not the default
          if (targetPlaylistId !== 'default') {
            const playlistSummary = await loadSummaryData(targetPlaylistId)
            if (playlistSummary) {
              setSummary(playlistSummary)
            }
          }
        }
        
        // Ensure URL reflects the correct playlist (handle default playlist case)
        const defaultPlaylist = loadedPlaylists.find(p => p.isDefault) || loadedPlaylists.find(p => p.id === 'default')
        const isDefaultPlaylist = defaultPlaylist && targetPlaylistId === defaultPlaylist.id
        
        if (isDefaultPlaylist && initialPlaylistParam && !isSharedParam) {
          // Remove playlist param for default playlist (but not if it's a shared link)
          router.replace('/watchlist', { scroll: false, shallow: true })
        } else if (!isDefaultPlaylist && !initialPlaylistParam) {
          // Add playlist param for non-default playlist
          const sharedSuffix = isSharedParam ? '&shared=true' : ''
          router.replace(`/watchlist?playlist=${targetPlaylistId}${sharedSuffix}`, { scroll: false, shallow: true })
        }
        
      } catch (error) {
        console.error('Error initializing watchlist:', error)
        toast.error('Failed to initialize watchlist')
      } finally {
        setInitializing(false)
      }
    }

    initializeWatchlist()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Run only once on mount - dependencies are intentionally omitted as this is initialization


  // Save view mode to localStorage whenever it changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('watchlist-view-mode', viewMode)
    }
  }, [viewMode])


  // Simple handler for playlist selection - only updates URL
  const handlePlaylistSelect = useCallback((playlistId) => {
    // Check if this is the default playlist
    const defaultPlaylist = playlists.find(p => p.isDefault) || playlists.find(p => p.id === 'default')
    const isDefaultPlaylist = defaultPlaylist && playlistId === defaultPlaylist.id
    
    if (isDefaultPlaylist) {
      // For default playlist, remove the playlist parameter from URL
      router.push('/watchlist', { scroll: false })
    } else {
      // For custom playlists, set the playlist parameter
      router.push(`/watchlist?playlist=${playlistId}`, { scroll: false })
    }
  }, [router, playlists])

  const loadPlaylists = useCallback(async () => {
    setPlaylistsLoading(true)
    try {
      const data = await api.getPlaylists()
      setPlaylists(data.playlists || [])
    } catch (error) {
      console.error('Error loading playlists:', error)
      toast.error('Failed to load playlists')
    } finally {
      setPlaylistsLoading(false)
    }
  }, [api])

  const loadPlaylistItems = useCallback(async (playlistId) => {
    setItemsLoading(true)
    try {
      const data = await api.getPlaylistItems(playlistId, { limit: 100 })
      
      // Use playlist info returned by API
      if (data.playlist) {
        const playlistInfo = {
          ...data.playlist,
          itemCount: data.items?.length || 0
        }
        setCurrentPlaylist(playlistInfo)
        
        // Update local sort state to match playlist preferences
        setSortBy(data.playlist.sortBy || 'dateAdded')
        setSortOrder(data.playlist.sortOrder || 'desc')
      } else {
        // Fallback: find playlist in local state or fetch by ID
        let playlist = playlists.find(p => p.id === playlistId)
        
        // If not in local state, try to fetch it (could be a public/shared playlist)
        if (!playlist) {
          try {
            const playlistData = await api.getPlaylistById(playlistId)
            if (playlistData?.playlist) {
              playlist = playlistData.playlist
            }
          } catch (error) {
            console.error('Error fetching playlist by ID:', error)
          }
        }
        
        if (playlist) {
          const playlistInfo = {
            ...playlist,
            itemCount: data.items?.length || 0
          }
          setCurrentPlaylist(playlistInfo)
          setSortBy(playlist.sortBy || 'dateAdded')
          setSortOrder(playlist.sortOrder || 'desc')
        }
      }
      
      // Items are now hydrated and sorted by the backend
      setCurrentItems(data.items || [])
    } catch (error) {
      console.error('Error loading playlist items:', error)
      toast.error('Failed to load playlist items')
    } finally {
      setItemsLoading(false)
    }
  }, [api, playlists])


  const loadSummary = useCallback(async (playlistId = selectedPlaylistId) => {
    setSummaryLoading(true)
    try {
      const summaryData = await api.getWatchlistSummary(playlistId)
      setSummary(summaryData)
    } catch (error) {
      console.error('Error loading summary:', error)
    } finally {
      setSummaryLoading(false)
    }
  }, [api, selectedPlaylistId])

  // Debounced playlist loading function for rapid navigation - using ref pattern
  const debouncedLoadPlaylistRef = useRef(null)
  
  // Initialize debounced function once
  useEffect(() => {
    debouncedLoadPlaylistRef.current = debounce((playlistId) => {
      if (playlistId && playlists.length > 0 && lastLoadedPlaylistRef.current !== playlistId) {
        loadPlaylistItems(playlistId)
        loadSummary(playlistId)
        lastLoadedPlaylistRef.current = playlistId
      }
    }, 400)
    
    return () => {
      debouncedLoadPlaylistRef.current?.cancel()
    }
  }, [loadPlaylistItems, loadSummary, playlists])

  // Handle playlist selection changes after initialization with debouncing for rapid navigation
  useEffect(() => {
    if (!initializing && selectedPlaylistId) {
      debouncedLoadPlaylistRef.current?.(selectedPlaylistId)
    }
  }, [selectedPlaylistId, initializing])

  const handleCreatePlaylist = useCallback(async (playlistData) => {
    try {
      const result = await api.createPlaylist(playlistData)
      // Reload playlists to ensure we have the complete data with all fields
      await loadPlaylists()
      toast.success('Playlist created successfully')
      return result.playlist
    } catch (error) {
      console.error('Error creating playlist:', error)
      toast.error('Failed to create playlist')
      throw error
    }
  }, [api, loadPlaylists])

  const handleUpdatePlaylist = useCallback(async (playlistId, updates) => {
    try {
      await api.updatePlaylist(playlistId, updates)
      // Reload playlists to ensure we have the complete updated data
      await loadPlaylists()
      if (currentPlaylist?.id === playlistId) {
        setCurrentPlaylist(prev => ({ ...prev, ...updates }))
      }
      toast.success('Playlist updated successfully')
    } catch (error) {
      console.error('Error updating playlist:', error)
      toast.error('Failed to update playlist')
      throw error
    }
  }, [api, currentPlaylist, loadPlaylists])

  const handleDeletePlaylist = useCallback(async (playlistId) => {
    try {
      await api.deletePlaylist(playlistId)
      const updatedPlaylists = playlists.filter(p => p.id !== playlistId)
      setPlaylists(updatedPlaylists)
      
      if (selectedPlaylistId === playlistId) {
        // Navigate to default playlist when current playlist is deleted
        const defaultPlaylist = updatedPlaylists.find(p => p.isDefault) || updatedPlaylists.find(p => p.id === 'default') || updatedPlaylists[0]
        if (defaultPlaylist) {
          const isDefaultPlaylist = defaultPlaylist.isDefault || defaultPlaylist.id === 'default'
          if (isDefaultPlaylist) {
            router.push('/watchlist', { scroll: false })
          } else {
            router.push(`/watchlist?playlist=${defaultPlaylist.id}`, { scroll: false })
          }
        }
      }
      toast.success('Playlist deleted successfully')
    } catch (error) {
      console.error('Error deleting playlist:', error)
      toast.error('Failed to delete playlist')
      throw error
    }
  }, [api, selectedPlaylistId, playlists, router])

  const handleSearch = useCallback(async (query) => {
    if (!query.trim()) {
      setSearchResults({ watchlist: [], tmdbInternal: [], tmdbExternal: [] })
      setIsSearching(false)
      return
    }

    // Increment request ID and capture it for this search
    searchRequestIdRef.current += 1
    const currentRequestId = searchRequestIdRef.current
    
    console.log(`[Search] Starting search #${currentRequestId} for query: "${query}"`)

    setIsSearching(true)
    try {
      // Dual search: Database + TMDB
      const [databaseResults, tmdbMoviesRaw, tmdbTVShowsRaw] = await Promise.all([
        // Search internal database using existing endpoint
        fetch('/api/authenticated/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        }).then(res => res.ok ? res.json() : { results: [] }).catch(() => ({ results: [] })),
        
        // Search TMDB
        searchMedia(query, 'movie', { page: 1 }).catch(() => ({ data: { results: [] } })),
        searchMedia(query, 'tv', { page: 1 }).catch(() => ({ data: { results: [] } }))
      ])
      
      // Handle both response formats: direct results or wrapped in data
      const tmdbMovies = tmdbMoviesRaw?.data || tmdbMoviesRaw || { results: [] }
      const tmdbTVShows = tmdbTVShowsRaw?.data || tmdbTVShowsRaw || { results: [] }

      // Check if this is still the latest request
      if (currentRequestId !== searchRequestIdRef.current) {
        console.log(`[Search] Ignoring stale response #${currentRequestId} (current: ${searchRequestIdRef.current})`)
        return
      }

      // Filter watchlist items from current playlist
      const watchlistResults = currentItems.filter(item =>
        item.title?.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 10)

      // Create sets of existing items in current playlist for duplicate filtering
      const existingTmdbIds = new Set(
        currentItems.map(item => item.tmdbId).filter(Boolean)
      )
      const existingMediaIds = new Set(
        currentItems.map(item => item.mediaId).filter(Boolean)
      )
      const existingTitleTypes = new Set(
        currentItems.map(item => `${item.title?.toLowerCase()}-${item.mediaType}`)
      )

      // Process database results - these are already internal media
      // Build a map of ALL database results by TMDB ID (before filtering) to check against external TMDB
      const allDatabaseTmdbIds = new Set(
        (databaseResults.results || [])
          .map(item => item.metadata?.id)
          .filter(Boolean)
      )
      
      console.log(`[Search] Database returned ${databaseResults.results?.length || 0} results`)
      console.log(`[Search] Database TMDB IDs:`, Array.from(allDatabaseTmdbIds).slice(0, 10))
      console.log(`[Search] Existing playlist TMDB IDs:`, Array.from(existingTmdbIds))
      console.log(`[Search] Existing playlist titles:`, Array.from(existingTitleTypes).slice(0, 10))

      const internalResults = (databaseResults.results || []).slice(0, 10).map(item => {
        return {
          id: item.metadata?.id, // Use TMDB ID for consistency
          title: item.title,
          media_type: item.type === 'movie' ? 'movie' : (item.type === 'tv' ? 'tv' : item.mediaType),
          poster_path: item.posterURL,
          release_date: formatDate(item.releaseDate || item.metadata?.release_date),
          first_air_date: formatDate(item.metadata?.first_air_date),
          overview: item.metadata?.overview,
          isInternalMedia: true,
          internalMediaId: item.id || item._id
        }
      }).filter(item => {
        // Filter out items already in current playlist
        const tmdbId = item.id
        const mediaId = item.internalMediaId
        const titleType = `${item.title?.toLowerCase()}-${item.media_type}`
        
        return !existingTmdbIds.has(tmdbId) &&
               !existingMediaIds.has(mediaId) &&
               !existingTitleTypes.has(titleType)
      })

      // Process TMDB results and check which ones are NOT in our database
      const allTmdbResults = [
        ...(tmdbMovies.results || []).slice(0, 5).map(item => ({ ...item, media_type: 'movie' })),
        ...(tmdbTVShows.results || []).slice(0, 5).map(item => ({ ...item, media_type: 'tv' }))
      ]
      
      console.log(`[Search] TMDB returned ${tmdbMovies.results?.length || 0} movies, ${tmdbTVShows.results?.length || 0} TV shows`)
      console.log(`[Search] Combined TMDB results (first 10):`, allTmdbResults.slice(0, 10).map(item => ({
        id: item.id,
        title: item.title || item.name,
        media_type: item.media_type
      })))

      // Filter external TMDB results using the complete database ID set
      const externalTmdbResults = allTmdbResults.filter(item => {
        const titleType = `${(item.title || item.name)?.toLowerCase()}-${item.media_type}`
        
        // Debug first few items
        if (allTmdbResults.indexOf(item) < 3) {
          console.log(`[Search] Checking TMDB item:`, {
            id: item.id,
            title: item.title || item.name,
            titleType,
            inDatabase: allDatabaseTmdbIds.has(item.id),
            inPlaylist: existingTmdbIds.has(item.id),
            titleMatch: existingTitleTypes.has(titleType)
          })
        }
        
        // Filter out items already in our database (use allDatabaseTmdbIds, not filtered internalResults)
        if (allDatabaseTmdbIds.has(item.id)) return false
        
        // Filter out items already in current playlist by TMDB ID
        if (existingTmdbIds.has(item.id)) return false
        
        // Also check by title-type combination (use consistent format)
        if (existingTitleTypes.has(titleType)) return false
        
        return true
      })

      console.log(`[Search] Results #${currentRequestId}:`, {
        watchlist: watchlistResults.length,
        tmdbInternal: internalResults.length,
        tmdbExternal: externalTmdbResults.length
      })

      // Final check before setting state
      if (currentRequestId === searchRequestIdRef.current) {
        setSearchResults({
          watchlist: watchlistResults,
          tmdbInternal: internalResults,
          tmdbExternal: externalTmdbResults
        })
      } else {
        console.log(`[Search] Race detected - ignoring result #${currentRequestId}`)
      }
    } catch (error) {
      console.error(`[Search] Error in request #${currentRequestId}:`, error)
      // Only show error if this is still the latest request
      if (currentRequestId === searchRequestIdRef.current) {
        toast.error('Search failed')
      }
    } finally {
      // Only clear loading state if this is still the latest request
      if (currentRequestId === searchRequestIdRef.current) {
        setIsSearching(false)
      }
    }
  }, [currentItems])

  const handleItemSelect = useCallback((itemId, selected) => {
    setSelectedItems(prev => {
      const newSet = new Set(prev)
      if (selected) {
        newSet.add(itemId)
      } else {
        newSet.delete(itemId)
      }
      return newSet
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    if (selectedItems.size === currentItems.length) {
      setSelectedItems(new Set())
    } else {
      setSelectedItems(new Set(currentItems.map(item => item.id)))
    }
  }, [selectedItems.size, currentItems])

  const handleClearSelection = useCallback(() => {
    setSelectedItems(new Set())
  }, [])

  const handleSharePlaylist = useCallback((playlistId) => {
    setSharePlaylistId(playlistId)
    setShowShareModal(true)
  }, [])

  const handleRefresh = useCallback(() => {
    loadPlaylists()
    loadPlaylistItems(selectedPlaylistId)
    loadSummary(selectedPlaylistId)
  }, [loadPlaylists, loadPlaylistItems, selectedPlaylistId, loadSummary])

  // Optimistic item addition handler
  const handleItemAdded = useCallback((newItem) => {
    console.log('handleItemAdded called with:', newItem)
    console.log('New item keys:', Object.keys(newItem))
    
    // Add the new item to the current items list optimistically
    setCurrentItems(prevItems => {
      console.log('Previous items count:', prevItems.length)
      
      // Check if item already exists by ID (most reliable)
      const exists = prevItems.some(item => item.id === newItem.id)
      
      if (exists) {
        console.log('Item already exists, skipping add')
        return prevItems
      }
      
      // Ensure the new item has all required fields by comparing with existing items
      if (prevItems.length > 0) {
        const sampleItem = prevItems[0]
        console.log('Sample existing item keys:', Object.keys(sampleItem))
        console.log('Sample existing item posterURL:', sampleItem.posterURL)
        console.log('New item posterURL:', newItem.posterURL)
      }
      
      // Add the new item at the beginning (most recent)
      const updatedItems = [newItem, ...prevItems]
      console.log('Updated items count:', updatedItems.length)
      
      // Apply current sorting to maintain order
      const sortedItems = sortItemsLocally(updatedItems, sortBy, sortOrder)
      console.log('Sorted items count:', sortedItems.length)
      
      return sortedItems
    })
    
    // Update playlist item counts optimistically
    setPlaylists(prevPlaylists => {
      return prevPlaylists.map(playlist => {
        if (playlist.id === selectedPlaylistId || (selectedPlaylistId === 'default' && playlist.isDefault)) {
          return {
            ...playlist,
            itemCount: playlist.itemCount + 1
          }
        }
        return playlist
      })
    })
    
    // Update summary count
    setSummary(prevSummary => {
      if (!prevSummary) return null
      return {
        ...prevSummary,
        total: prevSummary.total + 1,
        movieCount: newItem.mediaType === 'movie' ? prevSummary.movieCount + 1 : prevSummary.movieCount,
        tvCount: newItem.mediaType === 'tv' ? prevSummary.tvCount + 1 : prevSummary.tvCount
      }
    })
  }, [sortBy, sortOrder, sortItemsLocally, selectedPlaylistId])

  // Optimistic item removal handler
  const handleItemRemoved = useCallback((removedItemId) => {
    setCurrentItems(prevItems => {
      return prevItems.filter(item => item.id !== removedItemId)
    })
    
    // Update playlist item counts optimistically
    setPlaylists(prevPlaylists => {
      return prevPlaylists.map(playlist => {
        if (playlist.id === selectedPlaylistId || (selectedPlaylistId === 'default' && playlist.isDefault)) {
          return {
            ...playlist,
            itemCount: Math.max(0, playlist.itemCount - 1)
          }
        }
        return playlist
      })
    })
    
    // Update summary count
    setSummary(prevSummary => {
      if (!prevSummary) return null
      const removedItem = currentItems.find(item => item.id === removedItemId)
      if (!removedItem) return prevSummary
      
      return {
        ...prevSummary,
        total: Math.max(0, prevSummary.total - 1),
        movieCount: removedItem.mediaType === 'movie' ? Math.max(0, prevSummary.movieCount - 1) : prevSummary.movieCount,
        tvCount: removedItem.mediaType === 'tv' ? Math.max(0, prevSummary.tvCount - 1) : prevSummary.tvCount
      }
    })
  }, [currentItems, selectedPlaylistId])

  // Optimistic bulk removal handler
  const handleItemsRemoved = useCallback((removedItemIds) => {
    setCurrentItems(prevItems => {
      return prevItems.filter(item => !removedItemIds.includes(item.id))
    })
    
    // Update playlist item counts optimistically
    setPlaylists(prevPlaylists => {
      return prevPlaylists.map(playlist => {
        if (playlist.id === selectedPlaylistId || (selectedPlaylistId === 'default' && playlist.isDefault)) {
          return {
            ...playlist,
            itemCount: Math.max(0, playlist.itemCount - removedItemIds.length)
          }
        }
        return playlist
      })
    })
    
    // Update summary count
    setSummary(prevSummary => {
      if (!prevSummary) return null
      const removedItems = currentItems.filter(item => removedItemIds.includes(item.id))
      const removedMovieCount = removedItems.filter(item => item.mediaType === 'movie').length
      const removedTvCount = removedItems.filter(item => item.mediaType === 'tv').length
      
      return {
        ...prevSummary,
        total: Math.max(0, prevSummary.total - removedItems.length),
        movieCount: Math.max(0, prevSummary.movieCount - removedMovieCount),
        tvCount: Math.max(0, prevSummary.tvCount - removedTvCount)
      }
    })
    
    // Clear selection
    setSelectedItems(new Set())
  }, [currentItems, selectedPlaylistId])

  // Optimistic item move handler (removes from current playlist)
  const handleItemMoved = useCallback((movedItemId, targetPlaylistId = null) => {
    setCurrentItems(prevItems => {
      return prevItems.filter(item => item.id !== movedItemId)
    })
    
    // Update playlist item counts optimistically (decrease source, increase target)
    setPlaylists(prevPlaylists => {
      return prevPlaylists.map(playlist => {
        if (playlist.id === selectedPlaylistId || (selectedPlaylistId === 'default' && playlist.isDefault)) {
          // Decrease source playlist count
          return {
            ...playlist,
            itemCount: Math.max(0, playlist.itemCount - 1)
          }
        } else if (targetPlaylistId && (playlist.id === targetPlaylistId || (targetPlaylistId === 'default' && playlist.isDefault))) {
          // Increase target playlist count
          return {
            ...playlist,
            itemCount: playlist.itemCount + 1
          }
        }
        return playlist
      })
    })
    
    // Update summary count
    setSummary(prevSummary => {
      if (!prevSummary) return null
      const movedItem = currentItems.find(item => item.id === movedItemId)
      if (!movedItem) return prevSummary
      
      return {
        ...prevSummary,
        total: Math.max(0, prevSummary.total - 1),
        movieCount: movedItem.mediaType === 'movie' ? Math.max(0, prevSummary.movieCount - 1) : prevSummary.movieCount,
        tvCount: movedItem.mediaType === 'tv' ? Math.max(0, prevSummary.tvCount - 1) : prevSummary.tvCount
      }
    })
  }, [currentItems, selectedPlaylistId])

  // Optimistic bulk move handler (removes from current playlist)
  const handleItemsMoved = useCallback((movedItemIds, targetPlaylistId = null) => {
    setCurrentItems(prevItems => {
      return prevItems.filter(item => !movedItemIds.includes(item.id))
    })
    
    // Update playlist item counts optimistically (decrease source, increase target)
    setPlaylists(prevPlaylists => {
      return prevPlaylists.map(playlist => {
        if (playlist.id === selectedPlaylistId || (selectedPlaylistId === 'default' && playlist.isDefault)) {
          // Decrease source playlist count
          return {
            ...playlist,
            itemCount: Math.max(0, playlist.itemCount - movedItemIds.length)
          }
        } else if (targetPlaylistId && (playlist.id === targetPlaylistId || (targetPlaylistId === 'default' && playlist.isDefault))) {
          // Increase target playlist count
          return {
            ...playlist,
            itemCount: playlist.itemCount + movedItemIds.length
          }
        }
        return playlist
      })
    })
    
    // Update summary count
    setSummary(prevSummary => {
      if (!prevSummary) return null
      const movedItems = currentItems.filter(item => movedItemIds.includes(item.id))
      const movedMovieCount = movedItems.filter(item => item.mediaType === 'movie').length
      const movedTvCount = movedItems.filter(item => item.mediaType === 'tv').length
      
      return {
        ...prevSummary,
        total: Math.max(0, prevSummary.total - movedItems.length),
        movieCount: Math.max(0, prevSummary.movieCount - movedMovieCount),
        tvCount: Math.max(0, prevSummary.tvCount - movedTvCount)
      }
    })
    
    // Clear selection
    setSelectedItems(new Set())
  }, [currentItems, selectedPlaylistId])

  // Handler to show move modal for a specific item
  const handleShowMoveModal = useCallback((item) => {
    setMoveItemData(item)
    setShowMoveModal(true)
  }, [])

  // Handler to show copy modal for a specific item
  const handleShowCopyModal = useCallback((item) => {
    setMoveItemData(item)
    setShowCopyModal(true)
  }, [])

  // Handler to close move modal
  const handleCloseMoveModal = useCallback(() => {
    setShowMoveModal(false)
    setMoveItemData(null)
  }, [])

  // Handler to close copy modal
  const handleCloseCopyModal = useCallback(() => {
    setShowCopyModal(false)
    setMoveItemData(null)
  }, [])

  // Handler for moving item from modal
  const handleMoveFromModal = useCallback(async (targetPlaylistId) => {
    if (!moveItemData) return

    try {
      // Use optimistic update if available
      if (handleItemMoved) {
        handleItemMoved(moveItemData.id, targetPlaylistId)
      }
      
      await api.moveItems([moveItemData.id], targetPlaylistId)
      const targetPlaylist = playlists.find(p => p.id === targetPlaylistId)
      toast.success(`Moved "${moveItemData.title}" to ${targetPlaylist?.name || 'My Watchlist'}`)
      
      // Only refresh if optimistic update not available
      if (!handleItemMoved) {
        handleRefresh()
      }
    } catch (error) {
      console.error('Error moving item:', error)
      toast.error('Failed to move item')
      
      // On error, refresh to revert optimistic changes
      if (handleItemMoved) {
        handleRefresh()
      }
      throw error // Re-throw to let modal handle loading state
    }
  }, [moveItemData, playlists, handleItemMoved, api, handleRefresh])

  // Handler for copying item from modal
  const handleCopyFromModal = useCallback(async (targetPlaylistId) => {
    if (!moveItemData) return

    try {
      console.log('[handleCopyFromModal] Full moveItemData:', moveItemData)
      console.log('[handleCopyFromModal] mediaId:', moveItemData.mediaId)
      console.log('[handleCopyFromModal] tmdbId:', moveItemData.tmdbId)
      
      // Validate we have required IDs
      if (!moveItemData.mediaId && !moveItemData.tmdbId) {
        console.error('[handleCopyFromModal] Missing both mediaId and tmdbId!', moveItemData)
        toast.error('Cannot copy item: missing required IDs')
        throw new Error('Missing mediaId and tmdbId')
      }
      
      // Prepare complete item data for copying
      const watchlistItem = {
        mediaType: moveItemData.mediaType,
        title: moveItemData.title,
        isExternal: moveItemData.isExternal || false,
        playlistId: targetPlaylistId
      }
      
      // Add IDs based on what's available
      if (moveItemData.mediaId) {
        watchlistItem.mediaId = moveItemData.mediaId
      }
      if (moveItemData.tmdbId) {
        watchlistItem.tmdbId = moveItemData.tmdbId
      }
      
      // For external items, include TMDB metadata
      if (moveItemData.isExternal) {
        watchlistItem.tmdbData = {
          overview: moveItemData.overview,
          release_date: moveItemData.releaseDate,
          first_air_date: moveItemData.releaseDate,
          poster_path: moveItemData.posterPath,
          backdrop_path: moveItemData.backdropPath,
          genres: moveItemData.genres,
          original_language: moveItemData.originalLanguage,
          vote_average: moveItemData.voteAverage,
          vote_count: moveItemData.voteCount
        }
        
        // Add posterURL if available
        if (moveItemData.posterURL) {
          watchlistItem.posterURL = moveItemData.posterURL
        }
      }
      
      console.log('[handleCopyFromModal] Sending watchlistItem:', watchlistItem)
      
      await api.addToWatchlist(watchlistItem)
      
      // Refresh playlists from server to get accurate counts from database
      // This ensures sidebar shows true item counts instead of optimistic guesses
      await loadPlaylists()
      
      const targetPlaylist = playlists.find(p => p.id === targetPlaylistId)
      toast.success(`Copied "${moveItemData.title}" to ${targetPlaylist?.name || 'My Watchlist'}`)
    } catch (error) {
      console.error('Error copying item:', error)
      if (error.message?.includes('already exists')) {
        toast.info('Item already exists in target playlist')
        // Don't throw - this is expected and not an error
      } else {
        toast.error('Failed to copy item')
        throw error // Re-throw to let modal handle loading state
      }
    }
  }, [moveItemData, playlists, api, loadPlaylists])

  const handleClearPlaylist = useCallback(async (playlistId) => {
    try {
      // Get all items in the playlist
      const data = await api.getPlaylistItems(playlistId, { limit: 1000 })
      const itemIds = data.items?.map(item => item.id) || []
      
      if (itemIds.length > 0) {
        // Remove all items from the playlist
        await api.bulkRemove(itemIds)
        toast.success('All items cleared from playlist')
        
        // Refresh the current view
        handleRefresh()
      } else {
        toast.info('Playlist is already empty')
      }
    } catch (error) {
      console.error('Error clearing playlist:', error)
      toast.error('Failed to clear playlist')
      throw error
    }
  }, [api, handleRefresh])


  // Handler for toggling sort lock
  const handleToggleSortLock = useCallback(() => {
    if (!canEditPlaylist) {
      toast.error('You do not have permission to modify sort settings')
      return
    }
    setSortLocked(prev => !prev)
  }, [canEditPlaylist])

  const handleSortChange = useCallback(async (newSortBy, newSortOrder) => {
    // Check if sort is locked - even admins/editors need to unlock first
    if (sortLocked) {
      toast.error('Sort settings are locked. Click the unlock button to modify sort settings.')
      return
    }
    
    // If changing from custom order, confirm with user
    if (sortBy === 'custom' && newSortBy !== 'custom') {
      const confirmed = window.confirm(
        'Changing the sort order will clear your custom arrangement. Are you sure you want to continue?'
      )
      if (!confirmed) {
        return
      }
    }
    
    // Clear any previous sort errors
    setSortError(null)
    
    // Update local state immediately for responsive UI
    setSortBy(newSortBy)
    setSortOrder(newSortOrder)
    
    // Clear any existing timeout
    if (sortChangeTimeout.current) {
      clearTimeout(sortChangeTimeout.current)
    }
    
    // Apply sorting to current items immediately (not using optimistic state for sorting)
    const sortedItems = sortItemsLocally(currentItems, newSortBy, newSortOrder)
    setCurrentItems(sortedItems)
    
    // Debounce the API call to prevent rapid requests
    sortChangeTimeout.current = setTimeout(async () => {
      try {
        // Save sort preferences to playlist if user has edit permissions
        if (currentPlaylist && currentPlaylist.isOwner) {
          await api.updatePlaylistSorting(currentPlaylist.id, newSortBy, newSortOrder)
          // Update local playlist state
          setCurrentPlaylist(prev => ({ ...prev, sortBy: newSortBy, sortOrder: newSortOrder }))
        }
        
        // Clear any sort errors on success
        setSortError(null)
      } catch (error) {
        console.error('Error updating playlist sorting:', error)
        setSortError(error.message)
        toast.error('Failed to save sort preferences')
        
        // On error, reload items from server to get the correct order
        await loadPlaylistItems(selectedPlaylistId)
      }
    }, 500) // 500ms debounce
  }, [currentPlaylist, api, loadPlaylistItems, selectedPlaylistId, sortBy, currentItems, sortItemsLocally, sortLocked])

  const handleCustomReorder = useCallback(async (draggedIndex, targetIndex) => {
    // Check if sort is locked - even admins/editors need to unlock first
    if (sortLocked) {
      toast.error('Sort settings are locked. Click the unlock button to reorder items.')
      throw new Error('Sort settings are locked')
    }
    
    if (!currentPlaylist || !currentPlaylist.isOwner) {
      throw new Error('No permission to reorder items')
    }
    
    // Prevent multiple reorders at once
    if (isReordering) return
    
    setIsReordering(true)
    
    try {
      // Create the new order
      const newOrder = [...currentItems]
      const [movedItem] = newOrder.splice(draggedIndex, 1)
      newOrder.splice(targetIndex, 0, movedItem)
      
      // Update state immediately for instant feedback
      setCurrentItems(newOrder)
      setSortBy('custom')
      setSortOrder('asc')
      setCurrentPlaylist(prev => ({ ...prev, sortBy: 'custom', sortOrder: 'asc' }))
      
      // Save to server in background
      const newOrderIds = newOrder.map(item => item.id)
      await api.updatePlaylistOrder(currentPlaylist.id, newOrderIds)
      await api.updatePlaylistSorting(currentPlaylist.id, 'custom', 'asc')
      
    } catch (error) {
      console.error('Error updating playlist order:', error)
      toast.error('Failed to save custom order')
      // On error, reload items to revert
      await loadPlaylistItems(selectedPlaylistId)
    } finally {
      setIsReordering(false)
    }
  }, [currentPlaylist, api, currentItems, loadPlaylistItems, selectedPlaylistId, isReordering, sortLocked])

  // Apply client-side filtering
  const filteredItems = currentItems.filter(item => {
    if (filterType === 'all') return true
    return item.mediaType === filterType
  })

  // Always render the layout, never show full-screen loader
  return (
    <div className="flex min-h-screen bg-gray-900">
      {/* Sidebar */}
      <PlaylistSidebar
        playlists={playlists}
        playlistsLoading={playlistsLoading}
        selectedPlaylistId={selectedPlaylistId}
        onPlaylistSelect={handlePlaylistSelect}
        onCreatePlaylist={handleCreatePlaylist}
        onUpdatePlaylist={handleUpdatePlaylist}
        onDeletePlaylist={handleDeletePlaylist}
        onClearPlaylist={handleClearPlaylist}
        onSharePlaylist={handleSharePlaylist}
        summary={summary}
        summaryLoading={summaryLoading}
        currentPlaylist={currentPlaylist}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="bg-gray-800 border-b border-gray-700 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              {/* Back button - always visible */}
              <Link href="/list" className="text-gray-400 hover:text-white">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
              </Link>
              
              {/* Playlist title and description - show skeleton during initialization */}
              {initializing ? (
                <div className="flex items-center space-x-4">
                  <div className="h-8 bg-gray-700 rounded w-48 animate-pulse"></div>
                  <div className="h-4 bg-gray-700 rounded w-32 animate-pulse"></div>
                </div>
              ) : (
                <>
                  <h1 className="text-2xl font-bold text-white">
                    {currentPlaylist?.name || 'My Watchlist'}
                  </h1>
                  {currentPlaylist?.description && (
                    <p className="text-gray-400 text-sm">{currentPlaylist.description}</p>
                  )}
                </>
              )}
            </div>
            
            <div className="flex items-center space-x-2">
              {/* Item count and refresh button - show skeleton during initialization */}
              {initializing ? (
                <div className="flex items-center space-x-2">
                  <div className="h-5 bg-gray-700 rounded w-16 animate-pulse"></div>
                  <div className="h-8 w-8 bg-gray-700 rounded animate-pulse"></div>
                </div>
              ) : (
                <>
                  <span className="text-sm text-gray-400">
                    {filteredItems.length} items
                  </span>
                  <button
                    onClick={handleRefresh}
                    className="p-2 text-gray-400 hover:text-white rounded-md hover:bg-gray-700"
                    title="Refresh"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <button
                    onClick={() => setShowManageRows(true)}
                    className="ml-2 px-3 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
                    title="Manage Your App Rows"
                  >
                    Manage App Rows
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => setShowAdminRows(true)}
                      className="ml-2 px-3 py-2 bg-yellow-600 text-white rounded-md hover:bg-yellow-700 transition-colors"
                      title="Admin: Manage App Rows for Users"
                    >
                      Manage App Rows (Admin)
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Controls */}
        {initializing ? (
          <ControlsSkeleton />
        ) : (
          <PlaylistControls
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onSearch={handleSearch}
            searchResults={searchResults}
            setSearchResults={setSearchResults}
            isSearching={isSearching}
            selectedItems={selectedItems}
            onSelectAll={handleSelectAll}
            onClearSelection={handleClearSelection}
            onItemSelect={handleItemSelect}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            sortBy={sortBy}
            onSortChange={handleSortChange}
            sortOrder={sortOrder}
            filterType={filterType}
            onFilterTypeChange={setFilterType}
            currentPlaylist={currentPlaylist}
            currentItems={currentItems}
            playlists={playlists}
            setPlaylists={setPlaylists}
            onRefresh={handleRefresh}
            onItemAdded={handleItemAdded}
            onItemsRemoved={handleItemsRemoved}
            onItemsMoved={handleItemsMoved}
            onCustomReorder={handleCustomReorder}
            api={api}
            sortError={sortError}
            sortLocked={sortLocked}
            canEditPlaylist={canEditPlaylist}
            onToggleSortLock={handleToggleSortLock}
          />
        )}

        {/* Content */}
        <div className="flex-1 p-6">
          {/* Sort Error Display */}
          {sortError && (
            <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-3 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <svg className="w-5 h-5 text-red-400 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-red-400 text-sm font-medium">Failed to update sort: {sortError}</span>
                </div>
                <button
                  onClick={() => setSortError(null)}
                  className="text-red-400 hover:text-red-300 text-xs underline"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
          
          <AnimatePresence mode="wait">
            <motion.div
              key={viewMode}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{
                duration: 0.3,
                ease: "easeInOut"
              }}
            >
              <PlaylistGrid
                items={filteredItems}
                loading={itemsLoading || initializing}
                viewMode={viewMode}
                selectedItems={selectedItems}
                onItemSelect={handleItemSelect}
                onRefresh={handleRefresh}
                onItemRemoved={handleItemRemoved}
                onItemMoved={handleItemMoved}
                onShowMoveModal={handleShowMoveModal}
                onShowCopyModal={handleShowCopyModal}
                currentPlaylist={currentPlaylist}
                playlists={playlists}
                onCustomReorder={handleCustomReorder}
                api={api}
                sortBy={sortBy}
                sortLocked={sortLocked}
                canEditPlaylist={canEditPlaylist}
                user={user}
              />
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Share Modal */}
      {showShareModal && (
        <SharePlaylistModal
          playlistId={sharePlaylistId}
          playlist={playlists.find(p => p.id === sharePlaylistId)}
          onClose={() => {
            setShowShareModal(false)
            setSharePlaylistId(null)
          }}
          onSuccess={() => {
            setShowShareModal(false)
            setSharePlaylistId(null)
            handleRefresh()
          }}
          api={api}
        />
      )}

      {/* Move to Playlist Modal */}
      <MoveToPlaylistModal
        isOpen={showMoveModal}
        onClose={handleCloseMoveModal}
        onMoveToPlaylist={handleMoveFromModal}
        playlists={playlists}
        itemTitle={moveItemData?.title}
        isLoading={false}
        selectedPlaylistId={selectedPlaylistId}
      />
      
      {/* Copy to Playlist Modal */}
      <MoveToPlaylistModal
        isOpen={showCopyModal}
        onClose={handleCloseCopyModal}
        onMoveToPlaylist={handleCopyFromModal}
        playlists={playlists}
        itemTitle={moveItemData?.title}
        isLoading={false}
        selectedPlaylistId={selectedPlaylistId}
        isCopyMode={true}
      />

      {/* Manage Your App Rows (per-user visibility) */}
      <ShowInAppUserModal
        isOpen={showManageRows}
        onClose={() => setShowManageRows(false)}
        api={{
          // Thin wrapper to conform to modal's expectations
          getPlaylists: async (includeShared = true) => api.getPlaylists(includeShared),
          getPlaylistVisibility: async (options = {}) => api.getPlaylistVisibility(options),
          setPlaylistVisibility: async (payload) => api.setPlaylistVisibility(payload)
        }}
      />

      {/* Admin: Manage App Rows for users */}
      <ShowInAppAdminModal
        isOpen={showAdminRows}
        onClose={() => setShowAdminRows(false)}
        api={{
          getPlaylists: async (includeShared = true) => api.getPlaylists(includeShared),
          listUsers: async (options = {}) => api.listUsersForVisibility(options),
          setVisibilityBulk: async (payload) => api.setPlaylistVisibility(payload),
          resetVisibilityAll: async (playlistId) => api.resetPlaylistVisibilityAll(playlistId)
        }}
      />
    </div>
  )
}
