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
  selectedPlaylistId = null
}) {
  const handleMove = async (targetPlaylistId) => {
    try {
      await onMoveToPlaylist(targetPlaylistId)
      onClose()
    } catch (error) {
      // Error handling is done in the parent component
      console.error('Move failed:', error)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose}>
      <h3 className="text-lg font-semibold text-white mb-4">
        Move to Playlist
      </h3>
      
      {itemTitle && (
        <p className="text-gray-300 text-sm mb-4">
          Moving "{itemTitle}" to a different playlist
        </p>
      )}
      
      <div className="space-y-2 max-h-60 overflow-y-auto">
        {playlists.map((playlist) => (
          <button
            key={playlist.id}
            onClick={() => handleMove(playlist.id)}
            disabled={isLoading || selectedPlaylistId === playlist.id}
            className="w-full text-left px-4 py-2 rounded-md text-gray-300 hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {playlist.name}<span className="ml-2 text-gray-500">{selectedPlaylistId === playlist.id ? '(Selected)' : ''}</span>
          </button>
        ))}
      </div>
      
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
            <span>Moving item...</span>
          </div>
        </div>
      )}
    </Modal>
  )
}