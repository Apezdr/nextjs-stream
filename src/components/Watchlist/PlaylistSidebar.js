'use client'

import { useState, useCallback, useMemo, useEffect } from 'react'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'
import { SummaryStatsSkeleton, PlaylistListSkeleton } from './WatchlistSkeletons'

// PlaylistItem component for rendering individual playlist items
function PlaylistItem({
  playlist,
  selectedPlaylistId,
  onPlaylistSelect,
  onSharePlaylist,
  onEditStart,
  onDeleteClick,
  isAdmin = false,
  isPublicView = false,
  isTemporary = false
}) {
  const isSelected =
    selectedPlaylistId === playlist.id ||
    (selectedPlaylistId === 'default' && playlist.isDefault && playlist.isOwner)

  const privacyValue = playlist.privacy || 'private'

  return (
    <div
      className={classNames(
        'group relative rounded-lg p-3 cursor-pointer transition-colors',
        isTemporary && 'border-2 border-dashed border-gray-400',
        isSelected
          ? 'bg-indigo-600 text-white'
          : 'bg-gray-700 text-gray-300 hover:bg-gray-500'
      )}
      onClick={() => onPlaylistSelect(playlist.id)}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <h3 className="font-medium truncate">{playlist.name}</h3>
            {isPublicView && (
              <svg className="w-4 h-4 flex-shrink-0 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>
          {playlist.description && (
            <p className="text-sm opacity-75 truncate">{playlist.description}</p>
          )}
          <div className="flex items-center space-x-2 mt-1">
            <span className="text-xs opacity-75">{playlist.itemCount} items</span>
            {!isPublicView && (
              <span className="text-xs bg-gray-600 px-2 py-0.5 rounded inline-flex items-center space-x-1">
                {privacyValue === 'private' && (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2h-1V9a5 5 0 00-10 0v2H6a2 2 0 00-2 2v6a2 2 0 002 2zm3-10V9a3 3 0 016 0v2H9z" />
                  </svg>
                )}
                {privacyValue === 'shared' && (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z" />
                  </svg>
                )}
                {privacyValue === 'public' && (
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.6 9h16.8M3.6 15h16.8M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z" />
                  </svg>
                )}
                <span className="capitalize">{privacyValue}</span>
              </span>
            )}
            {isPublicView && playlist.ownerName && (
              <span className="text-xs opacity-75">by {playlist.ownerName}</span>
            )}
          </div>
        </div>

        {/* Playlist Actions - show for owner or global admin */}
        {(playlist.isOwner || isAdmin) && onSharePlaylist && onEditStart && onDeleteClick && (
          <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onSharePlaylist(playlist.id)
              }}
              className="p-1 rounded hover:bg-gray-600"
              title="Share playlist"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onEditStart(playlist)
              }}
              className="p-1 rounded hover:bg-gray-600"
              title="Edit playlist"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onDeleteClick(playlist)
              }}
              className="p-1 rounded hover:bg-red-600"
              title={playlist.isDefault ? "Clear all items" : "Delete playlist"}
            >
              {playlist.isDefault ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function PlaylistSidebar({
  playlists,
  playlistsLoading,
  selectedPlaylistId,
  onPlaylistSelect,
  onCreatePlaylist,
  onUpdatePlaylist,
  onDeletePlaylist,
  onClearPlaylist,
  onSharePlaylist,
  summary,
  summaryLoading,
  currentPlaylist,
  isAdmin = false,
  onListUsers,
  onOpenManageRows // optional: open user modal to manage Show in App rows
}) {
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [editingPlaylist, setEditingPlaylist] = useState(null)
  const [createForm, setCreateForm] = useState({
    name: '',
    description: '',
    privacy: 'private'
  })
  const [editForm, setEditForm] = useState({
    name: '',
    description: '',
    privacy: 'private',
    ownerId: '',
    isDefault: false
  })
  const [ownerUserOptions, setOwnerUserOptions] = useState([])
  const [loadingOwnerUsers, setLoadingOwnerUsers] = useState(false)

  const handleCreateSubmit = useCallback(async (e) => {
    e.preventDefault()
    
    if (!createForm.name.trim()) {
      toast.error('Playlist name is required')
      return
    }

    try {
      await onCreatePlaylist(createForm)
      setCreateForm({ name: '', description: '', privacy: 'private' })
      setShowCreateForm(false)
    } catch (error) {
      // Error already handled in parent
    }
  }, [createForm, onCreatePlaylist])

  const handleEditSubmit = useCallback(async (e) => {
    e.preventDefault()
    
    if (!editForm.name.trim()) {
      toast.error('Playlist name is required')
      return
    }

    try {
      const updates = {
        name: editForm.name,
        description: editForm.description,
        privacy: editForm.privacy,
        isDefault: editForm.isDefault
      }

      if (isAdmin && editForm.ownerId) {
        updates.ownerId = editForm.ownerId
      }

      await onUpdatePlaylist(editingPlaylist.id, updates)
      setEditingPlaylist(null)
      setEditForm({ name: '', description: '', privacy: 'private', ownerId: '', isDefault: false })
    } catch (error) {
      // Error already handled in parent
    }
  }, [editForm, editingPlaylist, isAdmin, onUpdatePlaylist])

  const handleEditStart = useCallback((playlist) => {
    setEditingPlaylist(playlist)
    setEditForm({
      name: playlist.name,
      description: playlist.description || '',
      privacy: playlist.privacy,
      ownerId: playlist.ownerId || '',
      isDefault: Boolean(playlist.isDefault)
    })
  }, [])

  useEffect(() => {
    if (!editingPlaylist || !isAdmin || typeof onListUsers !== 'function') {
      return
    }

    let cancelled = false

    const loadOwnerUsers = async () => {
      setLoadingOwnerUsers(true)
      try {
        const result = await onListUsers({ page: 0, limit: 500 })
        if (!cancelled) {
          setOwnerUserOptions(Array.isArray(result?.users) ? result.users : [])
        }
      } catch (_error) {
        if (!cancelled) {
          setOwnerUserOptions([])
          toast.error('Failed to load users for owner transfer')
        }
      } finally {
        if (!cancelled) {
          setLoadingOwnerUsers(false)
        }
      }
    }

    loadOwnerUsers()

    return () => {
      cancelled = true
    }
  }, [editingPlaylist, isAdmin, onListUsers])

  const ownerSelectOptions = useMemo(() => {
    const sortedKnownUsers = [...ownerUserOptions]
      .filter((user) => user?.userId)
      .sort((left, right) => {
        const leftLabel = (left.name || left.email || '').toLowerCase()
        const rightLabel = (right.name || right.email || '').toLowerCase()
        return leftLabel.localeCompare(rightLabel)
      })

    const knownOptions = sortedKnownUsers.map((user) => {
      const label = user.name || user.email || `User (${user.userId.slice(0, 8)})`
      const emailSuffix = user.name && user.email ? ` (${user.email})` : ''
      return {
        userId: user.userId,
        label: `${label}${emailSuffix}`,
        isUnknown: false,
      }
    })

    if (!editForm.ownerId) {
      return knownOptions
    }

    const ownerExists = knownOptions.some((option) => option.userId === editForm.ownerId)
    if (ownerExists) {
      return knownOptions
    }

    const unknownOwnerLabel = editingPlaylist?.ownerName || `Unknown User (${editForm.ownerId.slice(0, 8)})`
    return [
      ...knownOptions,
      {
        userId: editForm.ownerId,
        label: `${unknownOwnerLabel} (unknown)` ,
        isUnknown: true,
      },
    ]
  }, [ownerUserOptions, editForm.ownerId, editingPlaylist])

  const handleDeleteClick = useCallback(async (playlist) => {
    if (playlist.isDefault) {
      // For default playlist, offer to clear all content
      if (window.confirm(`Are you sure you want to clear all items from "${playlist.name}"? This will remove all items from your personal watchlist.`)) {
        try {
          // Call a clear playlist function instead of delete
          await onClearPlaylist(playlist.id)
        } catch (error) {
          // Error already handled in parent
        }
      }
    } else {
      // For custom playlists, delete normally
      if (window.confirm(`Are you sure you want to delete "${playlist.name}"? All items will be moved to your default watchlist.`)) {
        try {
          await onDeletePlaylist(playlist.id)
        } catch (error) {
          // Error already handled in parent
        }
      }
    }
  }, [onDeletePlaylist, onClearPlaylist])

  const uniquePlaylists = useMemo(() => {
    const seen = new Set()
    const deduped = []

    for (const playlist of playlists || []) {
      if (!playlist?.id || seen.has(playlist.id)) continue
      seen.add(playlist.id)
      deduped.push(playlist)
    }

    return deduped
  }, [playlists])

  // Organize playlists into categories using API-provided flags
  const defaultPlaylist =
    uniquePlaylists.find((p) => p.isOwner && p.isDefault) ||
    uniquePlaylists.find((p) => p.isOwner && p.id === 'default')
  
  // Personal playlists (owned by user, not default)
  const personalPlaylists = uniquePlaylists.filter(p => p.isOwner && !p.isDefault && p.id !== 'default')
  
  // Shared playlists (user is collaborator, uses API flag)
  const sharedPlaylists = uniquePlaylists.filter(p => p.isCollaborator === true)
  
  // Public playlists from others (uses API flag)
  const publicPlaylists = uniquePlaylists.filter(p => p.isPublic === true)

  const temporarySharedPlaylist = useMemo(() => {
    if (isAdmin) return null
    if (!currentPlaylist?.id) return null
    if (currentPlaylist.privacy !== 'shared') return null

    const alreadyInSidebar = uniquePlaylists.some((playlist) => playlist.id === currentPlaylist.id)
    if (alreadyInSidebar) return null

    return currentPlaylist
  }, [isAdmin, currentPlaylist, uniquePlaylists])

  const groupPlaylistsByOwner = useCallback((list = []) => {
    return Object.values(
      list.reduce((groups, playlist) => {
        const ownerKey = playlist.ownerId || 'unknown-owner'

        if (!groups[ownerKey]) {
          const fallbackOwnerName = playlist.ownerId
            ? `Unknown User (${String(playlist.ownerId).slice(0, 8)})`
            : 'Unknown User'

          groups[ownerKey] = {
            ownerId: ownerKey,
            ownerName: playlist.ownerName || fallbackOwnerName,
            playlists: [],
          }
        }

        groups[ownerKey].playlists.push(playlist)
        return groups
      }, {})
    )
      .map((group) => ({
        ...group,
        playlists: [...group.playlists].sort((a, b) => {
          if (a.isDefault && !b.isDefault) return -1
          if (!a.isDefault && b.isDefault) return 1
          return (a.name || '').localeCompare(b.name || '')
        }),
      }))
      .sort((a, b) => (a.ownerName || '').localeCompare(b.ownerName || ''))
  }, [])

  // Admin view: all other owners' playlists (includes shared/public for intentional duplication)
  const adminOtherPlaylists = isAdmin
    ? uniquePlaylists.filter((p) => !p.isOwner && !p.isCollaborator && !p.isPublic)
    : []

  const adminSharedOwnerGroups = isAdmin ? groupPlaylistsByOwner(sharedPlaylists) : []
  const adminPublicOwnerGroups = isAdmin ? groupPlaylistsByOwner(publicPlaylists) : []
  const adminOtherOwnerGroups = isAdmin ? groupPlaylistsByOwner(adminOtherPlaylists) : []

  return (
    <div className="w-80 bg-gray-800 border-r border-gray-700 flex flex-col">
      {/* Header */}
      <div className="p-6 border-b border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-4">Playlists</h2>
        
        {/* Summary Stats */}
        {summaryLoading ? (
          <SummaryStatsSkeleton />
        ) : summary ? (
          <div className="bg-gray-700 rounded-lg p-4 mb-4">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <div className="text-2xl font-bold text-white">{summary.total}</div>
                <div className="text-xs text-gray-400">Total Items</div>
              </div>
              <div>
                <div className="text-2xl font-bold text-white">{summary.playlistCount}</div>
                <div className="text-xs text-gray-400">Playlists</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 text-center mt-3 pt-3 border-t border-gray-600">
              <div>
                <div className="text-lg font-semibold text-blue-400">{summary.movieCount}</div>
                <div className="text-xs text-gray-400">Movies</div>
              </div>
              <div>
                <div className="text-lg font-semibold text-green-400">{summary.tvCount}</div>
                <div className="text-xs text-gray-400">TV Shows</div>
              </div>
            </div>
          </div>
        ) : null}

        {/* Create Playlist Button */}
        <button
          onClick={() => setShowCreateForm(true)}
          className="w-full flex items-center justify-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
        >
          <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Playlist
        </button>

        {/* Manage App Rows button (per-user visibility) */}
        {typeof onOpenManageRows === 'function' && (
          <button
            onClick={onOpenManageRows}
            className="mt-2 w-full flex items-center justify-center px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors"
            title="Choose which playlists appear as rows on your home screen"
          >
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Manage App Rows
          </button>
        )}
      </div>

      {/* Playlist List */}
      <div className="flex-1 overflow-y-auto">
        {playlistsLoading ? (
          <PlaylistListSkeleton count={4} />
        ) : (
          <div className="p-4 space-y-4">
            {isAdmin ? (
              <>
                {/* Admin's own and shared playlists (standard sections) */}
                {defaultPlaylist && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                      Personal
                    </h3>
                    <div className="space-y-2">
                      <PlaylistItem
                        playlist={defaultPlaylist}
                        selectedPlaylistId={selectedPlaylistId}
                        onPlaylistSelect={onPlaylistSelect}
                        onSharePlaylist={onSharePlaylist}
                        onEditStart={handleEditStart}
                        onDeleteClick={handleDeleteClick}
                        isAdmin={isAdmin}
                      />
                    </div>
                  </div>
                )}

                {personalPlaylists.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                      My Playlists
                    </h3>
                    <div className="space-y-2">
                      {personalPlaylists.map((playlist) => (
                        <PlaylistItem
                          key={playlist.id}
                          playlist={playlist}
                          selectedPlaylistId={selectedPlaylistId}
                          onPlaylistSelect={onPlaylistSelect}
                          onSharePlaylist={onSharePlaylist}
                          onEditStart={handleEditStart}
                          onDeleteClick={handleDeleteClick}
                          isAdmin={isAdmin}
                        />
                      ))}
                    </div>
                  </div>
                )}

                {sharedPlaylists.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                      Shared With Me
                    </h3>
                    <div className="space-y-3">
                      {adminSharedOwnerGroups.map((group) => (
                        <div key={`shared-${group.ownerId}`}>
                          <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
                            {group.ownerName} ({group.playlists.length})
                          </h4>
                          <div className="space-y-2">
                            {group.playlists.map((playlist) => (
                              <PlaylistItem
                                key={playlist.id}
                                playlist={playlist}
                                selectedPlaylistId={selectedPlaylistId}
                                onPlaylistSelect={onPlaylistSelect}
                                onSharePlaylist={onSharePlaylist}
                                onEditStart={handleEditStart}
                                onDeleteClick={handleDeleteClick}
                                isAdmin={isAdmin}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {publicPlaylists.length > 0 && (
                  <div className='pb-12'>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                      Public Playlists
                    </h3>
                    <div className="space-y-3">
                      {adminPublicOwnerGroups.map((group) => (
                        <div key={`public-${group.ownerId}`}>
                          <h4 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-2 px-1">
                            {group.ownerName} ({group.playlists.length})
                          </h4>
                          <div className="space-y-2">
                            {group.playlists.map((playlist) => (
                              <PlaylistItem
                                key={playlist.id}
                                playlist={playlist}
                                selectedPlaylistId={selectedPlaylistId}
                                onPlaylistSelect={onPlaylistSelect}
                                onSharePlaylist={onSharePlaylist}
                                onEditStart={handleEditStart}
                                onDeleteClick={handleDeleteClick}
                                isAdmin={isAdmin}
                                isPublicView={true}
                              />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <hr className="border-gray-600" />

                {/* All other playlists grouped by owner */}
                {adminOtherOwnerGroups.length > 0 && (
                  <div className='pt-2 pb-4'>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                      All Other Playlists
                    </h3>
                  </div>
                )}

                {adminOtherOwnerGroups.map((group) => (
                  <div key={group.ownerId}>
                    <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                      {group.ownerName} ({group.playlists.length})
                    </h3>
                    <div className="space-y-2">
                      {group.playlists.map((playlist) => (
                        <PlaylistItem
                          key={playlist.id}
                          playlist={playlist}
                          selectedPlaylistId={selectedPlaylistId}
                          onPlaylistSelect={onPlaylistSelect}
                          onSharePlaylist={onSharePlaylist}
                          onEditStart={handleEditStart}
                          onDeleteClick={handleDeleteClick}
                          isAdmin={isAdmin}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </>
            ) : (
              <>
            {/* Default Playlist */}
            {defaultPlaylist && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                  Personal
                </h3>
                <div className="space-y-2">
                  <PlaylistItem
                    playlist={defaultPlaylist}
                    selectedPlaylistId={selectedPlaylistId}
                    onPlaylistSelect={onPlaylistSelect}
                    onSharePlaylist={onSharePlaylist}
                    onEditStart={handleEditStart}
                    onDeleteClick={handleDeleteClick}
                    isAdmin={isAdmin}
                  />
                </div>
              </div>
            )}
            
            {/* Personal Playlists */}
            {personalPlaylists.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                  My Playlists
                </h3>
                <div className="space-y-2">
                  {personalPlaylists.map((playlist) => (
                    <PlaylistItem
                      key={playlist.id}
                      playlist={playlist}
                      selectedPlaylistId={selectedPlaylistId}
                      onPlaylistSelect={onPlaylistSelect}
                      onSharePlaylist={onSharePlaylist}
                      onEditStart={handleEditStart}
                      onDeleteClick={handleDeleteClick}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              </div>
            )}
            
            {/* Shared Playlists */}
            {sharedPlaylists.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                  Shared With Me
                </h3>
                <div className="space-y-2">
                  {sharedPlaylists.map((playlist) => (
                    <PlaylistItem
                      key={playlist.id}
                      playlist={playlist}
                      selectedPlaylistId={selectedPlaylistId}
                      onPlaylistSelect={onPlaylistSelect}
                      onSharePlaylist={onSharePlaylist}
                      onEditStart={handleEditStart}
                      onDeleteClick={handleDeleteClick}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              </div>
            )}
            
            {/* Public Playlists */}
            {publicPlaylists.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                  Public Playlists
                </h3>
                <div className="space-y-2">
                  {publicPlaylists.map((playlist) => (
                    <PlaylistItem
                      key={playlist.id}
                      playlist={playlist}
                      selectedPlaylistId={selectedPlaylistId}
                      onPlaylistSelect={onPlaylistSelect}
                      onSharePlaylist={isAdmin ? onSharePlaylist : null}
                      onEditStart={isAdmin ? handleEditStart : null}
                      onDeleteClick={isAdmin ? handleDeleteClick : null}
                      isAdmin={isAdmin}
                      isPublicView={true}
                    />
                  ))}
                </div>
              </div>
            )}

            {temporarySharedPlaylist && (
              <div className="pt-3 border-t border-gray-700">
                <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-1">
                  Temporary Shared Link
                </h3>
                <div className="space-y-2">
                  <PlaylistItem
                    playlist={temporarySharedPlaylist}
                    selectedPlaylistId={selectedPlaylistId}
                    onPlaylistSelect={onPlaylistSelect}
                    onSharePlaylist={null}
                    onEditStart={null}
                    onDeleteClick={null}
                    isAdmin={false}
                    isTemporary={true}
                  />
                </div>
              </div>
            )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Create Playlist Modal */}
      {showCreateForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96 max-w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">Create New Playlist</h3>
            <form onSubmit={handleCreateSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enter playlist name"
                  maxLength={100}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={createForm.description}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enter playlist description"
                  rows={3}
                  maxLength={500}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Privacy
                </label>
                <select
                  value={createForm.privacy}
                  onChange={(e) => setCreateForm(prev => ({ ...prev, privacy: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="private">Private</option>
                  <option value="shared">Shared</option>
                  <option value="public">Public</option>
                </select>
              </div>
              <div className="flex space-x-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 transition-colors"
                >
                  Create
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateForm(false)
                    setCreateForm({ name: '', description: '', privacy: 'private' })
                  }}
                  className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Playlist Modal */}
      {editingPlaylist && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-6 w-96 max-w-full mx-4">
            <h3 className="text-lg font-semibold text-white mb-4">Edit Playlist</h3>
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Name *
                </label>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enter playlist name"
                  maxLength={100}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Description
                </label>
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enter playlist description"
                  rows={3}
                  maxLength={500}
                />
              </div>
              <div>
                <label className="flex items-center space-x-2 text-sm font-medium text-gray-300 mb-1">
                  <span>Privacy</span>
                </label>
                <div className="relative">
                  <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    {editForm.privacy === 'private' && (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2h-1V9a5 5 0 00-10 0v2H6a2 2 0 00-2 2v6a2 2 0 002 2zm3-10V9a3 3 0 016 0v2H9z" />
                    )}
                    {editForm.privacy === 'shared' && (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z" />
                    )}
                    {editForm.privacy === 'public' && (
                      <>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.6 9h16.8M3.6 15h16.8M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z" />
                      </>
                    )}
                  </svg>
                  <select
                    value={editForm.privacy}
                    onChange={(e) => setEditForm(prev => ({ ...prev, privacy: e.target.value }))}
                    className="w-full pl-9 pr-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="private">Private</option>
                    <option value="shared">Shared</option>
                    <option value="public">Public</option>
                  </select>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  Choose privacy based on your goal. Collaborator and global permissions still apply within these visibility rules.
                </p>
                <div className="mt-2 space-y-2">
                  <div
                    className={classNames(
                      'rounded-md border px-3 py-2 text-xs',
                      editForm.privacy === 'private'
                        ? 'border-indigo-500 bg-indigo-900/20 text-gray-200'
                        : 'border-gray-600 bg-gray-700/40 text-gray-400'
                    )}
                  >
                    <div className="flex items-start space-x-2">
                      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2h-1V9a5 5 0 00-10 0v2H6a2 2 0 00-2 2v6a2 2 0 002 2zm3-10V9a3 3 0 016 0v2H9z" />
                      </svg>
                      <span><span className="font-medium">Private:</span> Only you and explicitly invited collaborators can access.</span>
                    </div>
                  </div>
                  <div
                    className={classNames(
                      'rounded-md border px-3 py-2 text-xs',
                      editForm.privacy === 'shared'
                        ? 'border-indigo-500 bg-indigo-900/20 text-gray-200'
                        : 'border-gray-600 bg-gray-700/40 text-gray-400'
                    )}
                  >
                    <div className="flex items-start space-x-2">
                      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 4v-4z" />
                      </svg>
                      <span><span className="font-medium">Shared:</span> Any signed-in user with the link can access.</span>
                    </div>
                  </div>
                  <div
                    className={classNames(
                      'rounded-md border px-3 py-2 text-xs',
                      editForm.privacy === 'public'
                        ? 'border-indigo-500 bg-indigo-900/20 text-gray-200'
                        : 'border-gray-600 bg-gray-700/40 text-gray-400'
                    )}
                  >
                    <div className="flex items-start space-x-2">
                      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.6 9h16.8M3.6 15h16.8M12 3c2.5 2.4 4 5.6 4 9s-1.5 6.6-4 9c-2.5-2.4-4-5.6-4-9s1.5-6.6 4-9z" />
                      </svg>
                      <span><span className="font-medium">Public:</span> Broadly discoverable to signed-in users in playlist listings.</span>
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <input
                  id="edit-playlist-default-toggle"
                  type="checkbox"
                  checked={Boolean(editForm.isDefault)}
                  onChange={(e) => setEditForm(prev => ({ ...prev, isDefault: e.target.checked }))}
                  className="h-4 w-4 rounded border-gray-500 bg-gray-700 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="edit-playlist-default-toggle" className="text-sm text-gray-300">
                  Set as default playlist
                </label>
              </div>
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1">
                    Owner
                  </label>
                  <select
                    value={editForm.ownerId}
                    onChange={(e) => setEditForm(prev => ({ ...prev, ownerId: e.target.value }))}
                    className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    disabled={loadingOwnerUsers}
                    required
                  >
                    {ownerSelectOptions.map((option) => (
                      <option key={option.userId} value={option.userId} className={option.isUnknown ? 'text-gray-400' : ''}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {loadingOwnerUsers && (
                    <p className="text-xs text-gray-400 mt-1">Loading users...</p>
                  )}
                </div>
              )}
              <div className="flex space-x-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-indigo-600 text-white py-2 px-4 rounded-md hover:bg-indigo-700 transition-colors"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPlaylist(null)
                    setEditForm({ name: '', description: '', privacy: 'private', ownerId: '', isDefault: false })
                  }}
                  className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}