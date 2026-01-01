'use client'

import { useState } from 'react'
import Modal from './Modal'

export default function MoveToPlaylistModal({
  isOpen,
  onClose,
  onMoveToPlaylist,
  playlists,
  itemTitle,
  isLoading = false,
  selectedPlaylistId = null,
  isCopyMode = false
}) {
  const handleMove = async (targetPlaylistId) => {
    try {
      await onMoveToPlaylist(targetPlaylistId)
      onClose()
    } catch (error) {
      // Error handling is done in the parent component
      console.error('Move/Copy failed:', error)
    }
  }

  // Filter playlists - only show playlists the user can edit
  // For copy mode: show all editable playlists
  // For move mode: show all editable playlists except the current one
  const availablePlaylists = playlists.filter(playlist => {
    // Must have edit permission
    if (!playlist.canEdit) return false
    
    // For move mode, exclude current playlist (can't move to same playlist)
    if (!isCopyMode && playlist.id === selectedPlaylistId) return false
    
    return true
  })

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h3 className="text-lg font-semibold text-white mb-4">
        {isCopyMode ? 'Copy to Playlist' : 'Move to Playlist'}
      </h3>
      
      {itemTitle && (
        <p className="text-gray-300 text-sm mb-4">
          {isCopyMode
            ? `Copying "${itemTitle}" to another playlist`
            : `Moving "${itemTitle}" to a different playlist`}
        </p>
      )}
      
      {availablePlaylists.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <p>No playlists available</p>
          <p className="text-xs mt-2">You need edit permission to {isCopyMode ? 'copy' : 'move'} items to a playlist</p>
        </div>
      ) : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {availablePlaylists.map((playlist) => (
            <button
              key={playlist.id}
              onClick={() => handleMove(playlist.id)}
              disabled={isLoading}
              className="w-full text-left px-4 py-2 rounded-md text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <div className="flex items-center justify-between">
                <span>{playlist.name}</span>
                {playlist.ownerName && !playlist.isOwner && (
                  <span className="text-xs text-gray-500">by {playlist.ownerName}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
      
      <div className="flex space-x-3 mt-6">
        <button
          onClick={onClose}
          disabled={isLoading}
          className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Cancel
        </button>
      </div>
      
      {isLoading && (
        <div className="absolute inset-0 bg-gray-800 bg-opacity-75 flex items-center justify-center rounded-lg">
          <div className="flex items-center space-x-2 text-white">
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
            <span>{isCopyMode ? 'Copying items...' : 'Moving item...'}</span>
          </div>
        </div>
      )}
    </Modal>
  )
}