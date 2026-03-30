'use client'

import { useState, useCallback } from 'react'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'

export default function SharePlaylistModal({
  playlistId,
  playlist,
  onClose,
  onSuccess,
  api
}) {
  const [collaborators, setCollaborators] = useState([])
  const [newCollaborator, setNewCollaborator] = useState({
    email: '',
    permission: 'view'
  })
  const [loading, setLoading] = useState(false)
  const [shareLink, setShareLink] = useState('')
  const [linkCopied, setLinkCopied] = useState(false)
  const [globalPermission, setGlobalPermission] = useState(playlist?.globalPermission || 'none')
  const [removeCollaboratorEmails, setRemoveCollaboratorEmails] = useState([])

  const normalizedCurrentCollaboratorEmails = (playlist?.collaborators || [])
    .map((collaborator) => collaborator?.email?.trim().toLowerCase())
    .filter(Boolean)

  const handleAddCollaborator = useCallback(() => {
    if (!newCollaborator.email.trim()) {
      toast.error('Email is required')
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newCollaborator.email)) {
      toast.error('Please enter a valid email address')
      return
    }

    const normalizedEmail = newCollaborator.email.trim().toLowerCase()

    if (collaborators.some(c => c.email === normalizedEmail)) {
      toast.error('This email is already added')
      return
    }

    if (normalizedCurrentCollaboratorEmails.includes(normalizedEmail) && !removeCollaboratorEmails.includes(normalizedEmail)) {
      toast.error('This user is already a collaborator')
      return
    }

    if (removeCollaboratorEmails.includes(normalizedEmail)) {
      setRemoveCollaboratorEmails((prev) => prev.filter((email) => email !== normalizedEmail))
    }

    setCollaborators(prev => [...prev, { ...newCollaborator, email: normalizedEmail }])
    setNewCollaborator({ email: '', permission: 'view' })
  }, [newCollaborator, collaborators, normalizedCurrentCollaboratorEmails, removeCollaboratorEmails])

  const handleRemoveCollaborator = useCallback((index) => {
    setCollaborators(prev => prev.filter((_, i) => i !== index))
  }, [])

  const toggleRemoveExistingCollaborator = useCallback((email) => {
    const normalizedEmail = email?.trim().toLowerCase()
    if (!normalizedEmail) return

    setRemoveCollaboratorEmails((prev) => (
      prev.includes(normalizedEmail)
        ? prev.filter((value) => value !== normalizedEmail)
        : [...prev, normalizedEmail]
    ))
  }, [])

  const hasChanges =
    collaborators.length > 0 ||
    removeCollaboratorEmails.length > 0 ||
    globalPermission !== (playlist?.globalPermission || 'none')

  const handleShare = useCallback(async () => {
    if (!hasChanges) {
      toast.error('No sharing changes to save')
      return
    }

    setLoading(true)
    try {
      await api.sharePlaylist(playlistId, collaborators, globalPermission, removeCollaboratorEmails)
      toast.success('Playlist sharing settings updated')
      onSuccess()
    } catch (error) {
      console.error('Error sharing playlist:', error)
      toast.error('Failed to share playlist')
    } finally {
      setLoading(false)
    }
  }, [playlistId, collaborators, globalPermission, removeCollaboratorEmails, hasChanges, onSuccess, api])

  const generateShareLink = useCallback(() => {
    const baseUrl = window.location.origin
    const link = `${baseUrl}/watchlist?playlist=${playlistId}`
    setShareLink(link)
  }, [playlistId])

  const copyShareLink = useCallback(async () => {
    if (!shareLink) {
      generateShareLink()
      return
    }

    try {
      await navigator.clipboard.writeText(shareLink)
      setLinkCopied(true)
      toast.success('Share link copied to clipboard')
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (error) {
      console.error('Error copying link:', error)
      toast.error('Failed to copy link')
    }
  }, [shareLink, generateShareLink])

  const permissionOptions = [
    { value: 'view', label: 'View Only', description: 'Can view playlist items' },
    { value: 'add', label: 'Can Add', description: 'Can view and add items' },
    { value: 'edit', label: 'Can Edit', description: 'Can view, add, and remove items' },
    { value: 'admin', label: 'Admin', description: 'Full access including sharing' }
  ]

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">
            Share "{playlist?.name}"
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

        {/* Playlist Info */}
        <div className="bg-gray-700 rounded-lg p-4 mb-6">
          <h3 className="font-medium text-white">{playlist?.name}</h3>
          {playlist?.description && (
            <p className="text-gray-300 text-sm mt-1">{playlist.description}</p>
          )}
          <div className="flex items-center space-x-4 mt-2 text-sm text-gray-400">
            <span>{playlist?.itemCount || 0} items</span>
            <span className="capitalize">{playlist?.privacy || 'private'}</span>
          </div>
        </div>

        {/* Share Link */}
        <div className="mb-6">
          <h3 className="text-lg font-medium text-white mb-3">Share Link</h3>
          <div className="flex space-x-2">
            <input
              type="text"
              value={shareLink}
              placeholder="Click 'Generate Link' to create a shareable link"
              readOnly
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none"
            />
            <button
              onClick={shareLink ? copyShareLink : generateShareLink}
              className={classNames(
                'px-4 py-2 rounded-md transition-colors',
                shareLink
                  ? linkCopied
                    ? 'bg-green-600 text-white'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                  : 'bg-gray-600 text-white hover:bg-gray-700'
              )}
            >
              {shareLink ? (linkCopied ? 'Copied!' : 'Copy') : 'Generate Link'}
            </button>
          </div>
          <p className="text-sm text-gray-400 mt-2">
            This link opens the playlist. Access is still controlled by the playlist privacy setting and any collaborator/global permissions.
          </p>
        </div>

        {/* Add Collaborators */}
        <div className="mb-6">
          <h3 className="text-lg font-medium text-white mb-3">Global Access</h3>

          <div className="bg-gray-700 rounded-lg p-4 mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Allow any authenticated user to access this playlist as:
            </label>
            <select
              value={globalPermission}
              onChange={(e) => setGlobalPermission(e.target.value)}
              className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="none">No global access</option>
              {permissionOptions.map((option) => (
                <option key={`global-${option.value}`} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-2">
              This grants access to all authenticated users without specifying individual emails, but only when the playlist privacy allows link access.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Private playlists remain restricted unless users are explicitly added as collaborators.
            </p>
          </div>

          <h3 className="text-lg font-medium text-white mb-3">Invite Collaborators</h3>
          
          <div className="flex space-x-2 mb-4">
            <input
              type="email"
              value={newCollaborator.email}
              onChange={(e) => setNewCollaborator(prev => ({ ...prev, email: e.target.value }))}
              placeholder="Enter email address"
              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              onKeyPress={(e) => e.key === 'Enter' && handleAddCollaborator()}
            />
            <select
              value={newCollaborator.permission}
              onChange={(e) => setNewCollaborator(prev => ({ ...prev, permission: e.target.value }))}
              className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {permissionOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              onClick={handleAddCollaborator}
              className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
            >
              Add
            </button>
          </div>

          {/* Permission Descriptions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-4">
            {permissionOptions.map((option) => (
              <div
                key={option.value}
                className={classNames(
                  'p-2 rounded text-xs',
                  newCollaborator.permission === option.value
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-700 text-gray-300'
                )}
              >
                <div className="font-medium">{option.label}</div>
                <div className="opacity-75">{option.description}</div>
              </div>
            ))}
          </div>

          {/* Collaborators List */}
          {collaborators.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-gray-300">Collaborators to add:</h4>
              {collaborators.map((collaborator, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between bg-gray-700 rounded-lg p-3"
                >
                  <div className="flex-1">
                    <div className="text-white">{collaborator.email}</div>
                    <div className="text-sm text-gray-400 capitalize">
                      {permissionOptions.find(p => p.value === collaborator.permission)?.label}
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveCollaborator(index)}
                    className="text-red-400 hover:text-red-300 p-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Current Collaborators */}
        {playlist?.collaborators && playlist.collaborators.length > 0 && (
          <div className="mb-6">
            <h3 className="text-lg font-medium text-white mb-3">Current Collaborators</h3>
            <div className="space-y-2">
              {playlist.collaborators.map((collaborator, index) => (
                (() => {
                  const collaboratorEmail = collaborator?.email?.trim().toLowerCase()
                  const markedForRemoval = collaboratorEmail && removeCollaboratorEmails.includes(collaboratorEmail)

                  return (
                <div
                  key={index}
                  className={classNames(
                    'flex items-center justify-between rounded-lg p-3',
                    markedForRemoval
                      ? 'bg-red-900/30 border border-red-600/40'
                      : 'bg-gray-700'
                  )}
                >
                  <div className="flex-1">
                    <div className={classNames('text-white', markedForRemoval && 'line-through opacity-70')}>
                      {collaborator.email}
                    </div>
                    <div className={classNames('text-sm capitalize', markedForRemoval ? 'text-red-300' : 'text-gray-400')}>
                      {markedForRemoval
                        ? 'Will be removed'
                        : permissionOptions.find(p => p.value === collaborator.permission)?.label}
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <div className="text-sm text-gray-400">
                      Added {new Date(collaborator.dateAdded).toLocaleDateString()}
                    </div>
                    <button
                      onClick={() => toggleRemoveExistingCollaborator(collaborator.email)}
                      className={classNames(
                        'text-xs px-2 py-1 rounded-md transition-colors',
                        markedForRemoval
                          ? 'bg-gray-600 text-white hover:bg-gray-500'
                          : 'bg-red-700 text-white hover:bg-red-600'
                      )}
                    >
                      {markedForRemoval ? 'Undo' : 'Remove'}
                    </button>
                  </div>
                </div>
                  )
                })()
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex space-x-3">
          <button
            onClick={handleShare}
            disabled={
              loading ||
              !hasChanges
            }
            className={classNames(
              'flex-1 py-2 px-4 rounded-md transition-colors',
              loading ||
                !hasChanges
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            )}
          >
            {loading
              ? 'Saving...'
              : (() => {
                  const addCount = collaborators.length
                  const removeCount = removeCollaboratorEmails.length
                  if (addCount > 0 || removeCount > 0) {
                    const parts = []
                    if (addCount > 0) {
                      parts.push(`add ${addCount}`)
                    }
                    if (removeCount > 0) {
                      parts.push(`remove ${removeCount}`)
                    }
                    return `Save settings + ${parts.join(' / ')} collaborator${addCount + removeCount !== 1 ? 's' : ''}`
                  }
                  return 'Save sharing settings'
                })()}
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-gray-600 text-white py-2 px-4 rounded-md hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>

        {/* Privacy Notice */}
        <div className="mt-4 p-3 bg-yellow-900 bg-opacity-50 border border-yellow-600 rounded-lg">
          <div className="flex items-start space-x-2">
            <svg className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <div className="text-sm text-yellow-200">
              <p className="font-medium mb-1">Privacy Notice</p>
              <p>Collaborators will be able to see all items in this playlist according to their permission level. Make sure you trust the people you're sharing with.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}