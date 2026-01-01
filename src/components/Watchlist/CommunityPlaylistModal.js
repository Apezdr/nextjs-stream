'use client'

import { useState, useCallback, useEffect } from 'react'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'

export default function CommunityPlaylistModal({
  isOpen,
  onClose,
  onSuccess,
  api,
  user
}) {
  const [allPlaylists, setAllPlaylists] = useState([])
  const [communityPlaylists, setCommunityPlaylists] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedTab, setSelectedTab] = useState('promote') // 'promote' or 'manage'

  // Check if user is Application Admin
  const isApplicationAdmin = session?.user?.role === 'admin' || session?.user?.isAdmin || user?.permissions?.includes('Admin')

  useEffect(() => {
    if (isOpen && isApplicationAdmin) {
      loadData()
    }
  }, [isOpen, isApplicationAdmin])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Load all public playlists and current community playlists
      const [publicPlaylistsResponse, communityPlaylistsResponse] = await Promise.all([
        api.getAllPublicPlaylists(),
        api.getCommunityPlaylists()
      ])
      
      setAllPlaylists(publicPlaylistsResponse.playlists || [])
      setCommunityPlaylists(communityPlaylistsResponse.playlists || [])
    } catch (error) {
      console.error('Error loading playlist data:', error)
      toast.error('Failed to load playlist data')
    } finally {
      setLoading(false)
    }
  }, [api])

  const handlePromoteToCommunity = useCallback(async (playlistId) => {
    try {
      await api.promoteToCommunity(playlistId)
      toast.success('Playlist promoted to community successfully')
      await loadData() // Refresh data
    } catch (error) {
      console.error('Error promoting playlist:', error)
      toast.error('Failed to promote playlist to community')
    }
  }, [api, loadData])

  const handleRemoveFromCommunity = useCallback(async (playlistId) => {
    if (window.confirm('Are you sure you want to remove this playlist from the community section?')) {
      try {
        await api.removeFromCommunity(playlistId)
        toast.success('Playlist removed from community')
        await loadData() // Refresh data
      } catch (error) {
        console.error('Error removing playlist from community:', error)
        toast.error('Failed to remove playlist from community')
      }
    }
  }, [api, loadData])

  const handleSetFeatured = useCallback(async (playlistId, featured) => {
    try {
      await api.setCommunityPlaylistFeatured(playlistId, featured)
      toast.success(`Playlist ${featured ? 'featured' : 'unfeatured'} successfully`)
      await loadData() // Refresh data
    } catch (error) {
      console.error('Error updating featured status:', error)
      toast.error('Failed to update featured status')
    }
  }, [api, loadData])

  // Filter playlists that are not already in community
  const communityPlaylistIds = new Set(communityPlaylists.map(p => p.id))
  const availableForPromotion = allPlaylists.filter(p => 
    p.privacy === 'public' && !communityPlaylistIds.has(p.id)
  )

  if (!isOpen) return null

  if (!isApplicationAdmin) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-gray-800 rounded-lg p-6 w-96 max-w-full mx-4">
          <h3 className="text-lg font-semibold text-white mb-4">Access Denied</h3>
          <p className="text-gray-300 mb-4">
            You need Application Admin permissions to manage community playlists.
          </p>
          <button
            onClick={onClose}
            className="w-full bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-4xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">
            Community Playlist Management
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex space-x-1 mb-6 bg-gray-700 rounded-lg p-1">
          <button
            onClick={() => setSelectedTab('promote')}
            className={classNames(
              'flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors',
              selectedTab === 'promote'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white hover:bg-gray-600'
            )}
          >
            Promote to Community
          </button>
          <button
            onClick={() => setSelectedTab('manage')}
            className={classNames(
              'flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors',
              selectedTab === 'manage'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-300 hover:text-white hover:bg-gray-600'
            )}
          >
            Manage Community
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500"></div>
            <span className="ml-3 text-gray-300">Loading playlists...</span>
          </div>
        ) : (
          <>
            {/* Promote Tab */}
            {selectedTab === 'promote' && (
              <div>
                <h3 className="text-lg font-medium text-white mb-4">
                  Public Playlists Available for Promotion
                </h3>
                {availableForPromotion.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <p>No public playlists available for promotion</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {availableForPromotion.map((playlist) => (
                      <div
                        key={playlist.id}
                        className="bg-gray-700 rounded-lg p-4 flex items-center justify-between"
                      >
                        <div className="flex-1">
                          <h4 className="font-medium text-white">{playlist.name}</h4>
                          {playlist.description && (
                            <p className="text-gray-300 text-sm mt-1">{playlist.description}</p>
                          )}
                          <div className="flex items-center space-x-4 mt-2 text-sm text-gray-400">
                            <span>{playlist.itemCount || 0} items</span>
                            <span>by {playlist.ownerName || 'Unknown'}</span>
                            <span>Created {new Date(playlist.dateCreated).toLocaleDateString()}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handlePromoteToCommunity(playlist.id)}
                          className="ml-4 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
                        >
                          Promote
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Manage Tab */}
            {selectedTab === 'manage' && (
              <div>
                <h3 className="text-lg font-medium text-white mb-4">
                  Current Community Playlists
                </h3>
                {communityPlaylists.length === 0 ? (
                  <div className="text-center py-8 text-gray-400">
                    <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                    </svg>
                    <p>No community playlists yet</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {communityPlaylists.map((playlist) => (
                      <div
                        key={playlist.id}
                        className="bg-gray-700 rounded-lg p-4"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center space-x-2">
                              <h4 className="font-medium text-white">{playlist.name}</h4>
                              {playlist.isFeatured && (
                                <span className="bg-yellow-600 text-white text-xs px-2 py-1 rounded">
                                  Featured
                                </span>
                              )}
                            </div>
                            {playlist.description && (
                              <p className="text-gray-300 text-sm mt-1">{playlist.description}</p>
                            )}
                            <div className="flex items-center space-x-4 mt-2 text-sm text-gray-400">
                              <span>{playlist.itemCount || 0} items</span>
                              <span>by {playlist.ownerName || 'Unknown'}</span>
                              <span>Added {new Date(playlist.communityDateAdded).toLocaleDateString()}</span>
                            </div>
                          </div>
                          <div className="flex items-center space-x-2 ml-4">
                            <button
                              onClick={() => handleSetFeatured(playlist.id, !playlist.isFeatured)}
                              className={classNames(
                                'px-3 py-1 text-sm rounded-md transition-colors',
                                playlist.isFeatured
                                  ? 'bg-yellow-600 text-white hover:bg-yellow-700'
                                  : 'bg-gray-600 text-white hover:bg-gray-500'
                              )}
                            >
                              {playlist.isFeatured ? 'Unfeature' : 'Feature'}
                            </button>
                            <button
                              onClick={() => handleRemoveFromCommunity(playlist.id)}
                              className="px-3 py-1 text-sm bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="flex justify-end mt-6 pt-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>

        {/* Info Notice */}
        <div className="mt-4 p-3 bg-blue-900 bg-opacity-50 border border-blue-600 rounded-lg">
          <div className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-200">
              <p className="font-medium mb-1">Community Playlists</p>
              <p>Community playlists are curated collections that appear in a special discovery section for all users. Only public playlists can be promoted to community status. Featured playlists appear at the top of the community section.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}