'use client'

import { useState, useCallback } from 'react'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'
import { SummaryStatsSkeleton, PlaylistListSkeleton } from './WatchlistSkeletons'

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
  summaryLoading
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
    privacy: 'private'
  })

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
      await onUpdatePlaylist(editingPlaylist.id, editForm)
      setEditingPlaylist(null)
      setEditForm({ name: '', description: '', privacy: 'private' })
    } catch (error) {
      // Error already handled in parent
    }
  }, [editForm, editingPlaylist, onUpdatePlaylist])

  const handleEditStart = useCallback((playlist) => {
    setEditingPlaylist(playlist)
    setEditForm({
      name: playlist.name,
      description: playlist.description || '',
      privacy: playlist.privacy
    })
  }, [])

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
  }, [onDeletePlaylist])

  // Find the default playlist from the database records
  const defaultPlaylist = playlists.find(p => p.isDefault) || playlists.find(p => p.id === 'default')
  const customPlaylists = playlists.filter(p => !p.isDefault && p.id !== 'default')
  
  // Arrange playlists with default first, then custom playlists
  const allPlaylists = defaultPlaylist ? [defaultPlaylist, ...customPlaylists] : playlists

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
      </div>

      {/* Playlist List */}
      <div className="flex-1 overflow-y-auto">
        {playlistsLoading ? (
          <PlaylistListSkeleton count={4} />
        ) : (
          <div className="p-4 space-y-2">
            {allPlaylists.map((playlist) => (
            <div
              key={playlist.id}
              className={classNames(
                'group relative rounded-lg p-3 cursor-pointer transition-colors',
                selectedPlaylistId === playlist.id
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              )}
              onClick={() => onPlaylistSelect(playlist.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium truncate">{playlist.name}</h3>
                  {playlist.description && (
                    <p className="text-sm opacity-75 truncate">{playlist.description}</p>
                  )}
                  <div className="flex items-center space-x-2 mt-1">
                    <span className="text-xs opacity-75">{playlist.itemCount} items</span>
                    {playlist.privacy !== 'private' && (
                      <span className="text-xs bg-gray-600 px-2 py-0.5 rounded">
                        {playlist.privacy}
                      </span>
                    )}
                  </div>
                </div>

                {/* Playlist Actions */}
                {playlist.isOwner && (
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
                        handleEditStart(playlist)
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
                        handleDeleteClick(playlist)
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
            ))}
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
                <label className="block text-sm font-medium text-gray-300 mb-1">
                  Privacy
                </label>
                <select
                  value={editForm.privacy}
                  onChange={(e) => setEditForm(prev => ({ ...prev, privacy: e.target.value }))}
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
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingPlaylist(null)
                    setEditForm({ name: '', description: '', privacy: 'private' })
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