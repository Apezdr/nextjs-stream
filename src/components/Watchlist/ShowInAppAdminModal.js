'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'
import { debounce } from 'lodash'

export default function ShowInAppAdminModal({ isOpen, onClose, api }) {
  const [playlists, setPlaylists] = useState([])
  const [playlistsLoading, setPlaylistsLoading] = useState(false)
  const [selectedPlaylistId, setSelectedPlaylistId] = useState('')

  const [users, setUsers] = useState([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(0)
  const [limit, setLimit] = useState(20)
  const [total, setTotal] = useState(0)

  // Debounced loader ref to prevent multiple requests per key press (collapses calls)
  const debouncedLoadRef = useRef(null)

  const [selectedUserIds, setSelectedUserIds] = useState(new Set())

  const [bulkShowInApp, setBulkShowInApp] = useState(true)
  const [bulkAppOrder, setBulkAppOrder] = useState(0)
  const [bulkAppTitle, setBulkAppTitle] = useState('')

  const [applying, setApplying] = useState(false)
  const [resetting, setResetting] = useState(false)

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(total / limit))
  }, [total, limit])

  const loadPlaylists = useCallback(async () => {
    setPlaylistsLoading(true)
    try {
      const res = await api.getPlaylists(true)
      const list = Array.isArray(res?.playlists) ? res.playlists : []
      setPlaylists(list)
      if (!selectedPlaylistId && list.length > 0) {
        setSelectedPlaylistId(list[0].id)
      }
    } catch (e) {
      console.error('[ShowInAppAdminModal] loadPlaylists failed:', e)
      toast.error('Failed to load playlists')
    } finally {
      setPlaylistsLoading(false)
    }
  }, [api, selectedPlaylistId])

  // Raw loader: does the actual fetch, independent of current input state
  const loadUsersRaw = useCallback(async ({ search, pageOverride, limitOverride }) => {
    if (!isOpen) return
    setUsersLoading(true)
    try {
      const res = await api.listUsers({
        search: (search || '').trim() || undefined,
        page: pageOverride,
        limit: limitOverride
      })
      const items = Array.isArray(res?.users) ? res.users : []
      setUsers(items)
      setTotal(typeof res?.pagination?.total === 'number' ? res.pagination.total : items.length)
    } catch (e) {
      console.error('[ShowInAppAdminModal] loadUsers failed:', e)
      toast.error('Failed to load users')
    } finally {
      setUsersLoading(false)
    }
  }, [api, isOpen])

  useEffect(() => {
    if (isOpen) {
      loadPlaylists()
    }
  }, [isOpen, loadPlaylists])


  // Initialize debounced function once (stable across renders)
  useEffect(() => {
    debouncedLoadRef.current = debounce((args) => {
      loadUsersRaw(args)
    }, 300)
    return () => {
      debouncedLoadRef.current?.cancel()
    }
  }, [loadUsersRaw])

  // Unified debounced loader for users: reacts to search text, page, and limit
  useEffect(() => {
    if (!isOpen) return
    debouncedLoadRef.current?.({
      search: searchTerm,
      pageOverride: page,
      limitOverride: limit
    })
  }, [isOpen, searchTerm, page, limit])


  const toggleUser = useCallback((userId, checked) => {
    setSelectedUserIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(userId)
      else next.delete(userId)
      return next
    })
  }, [])

  const toggleAllUsers = useCallback((checked) => {
    setSelectedUserIds(prev => {
      if (checked) {
        return new Set(users.map(u => u.userId || u.id || u._id))
      }
      return new Set()
    })
  }, [users])

  const handleApply = useCallback(async () => {
    if (!selectedPlaylistId) {
      toast.error('Please select a playlist')
      return
    }
    const userIds = Array.from(selectedUserIds)
    if (userIds.length === 0) {
      toast.error('Select at least one user')
      return
    }
    setApplying(true)
    try {
      await api.setVisibilityBulk({
        playlistId: selectedPlaylistId,
        usersById: userIds,
        showInApp: !!bulkShowInApp,
        appOrder: Number.isFinite(bulkAppOrder) ? Number(bulkAppOrder) : 0,
        appTitle: bulkAppTitle?.trim() ? bulkAppTitle.trim() : null
      })
      toast.success(`Applied to ${userIds.length} user${userIds.length !== 1 ? 's' : ''}`)
    } catch (e) {
      console.error('[ShowInAppAdminModal] apply failed:', e)
      toast.error('Failed to apply visibility')
    } finally {
      setApplying(false)
    }
  }, [api, selectedPlaylistId, selectedUserIds, bulkShowInApp, bulkAppOrder, bulkAppTitle])

  const handleResetAll = useCallback(async () => {
    if (!selectedPlaylistId) {
      toast.error('Please select a playlist')
      return
    }
    if (!window.confirm('Disable this playlist for all users? This removes all visibility preferences for this playlist.')) {
      return
    }
    setResetting(true)
    try {
      await api.resetVisibilityAll(selectedPlaylistId)
      toast.success('Visibility reset for all users')
    } catch (e) {
      console.error('[ShowInAppAdminModal] reset all failed:', e)
      toast.error('Failed to reset visibility')
    } finally {
      setResetting(false)
    }
  }, [api, selectedPlaylistId])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-5xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">Manage App Rows (Admin)</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Playlist</label>
              <select
                value={selectedPlaylistId}
                onChange={(e) => setSelectedPlaylistId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                disabled={playlistsLoading}
              >
                {playlists.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="bg-gray-700 rounded-lg p-4">
              <h3 className="text-white font-medium mb-3">Bulk Settings</h3>
              <div className="space-y-3">
                <label className="flex items-center space-x-2 text-gray-200">
                  <input
                    type="checkbox"
                    className="form-checkbox h-4 w-4 text-indigo-600"
                    checked={bulkShowInApp}
                    onChange={(e) => setBulkShowInApp(e.target.checked)}
                  />
                  <span>Show in App</span>
                </label>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Row Order</label>
                  <input
                    type="number"
                    min="0"
                    value={bulkAppOrder}
                    onChange={(e) => setBulkAppOrder(parseInt(e.target.value, 10) || 0)}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Row Title (optional)</label>
                  <input
                    type="text"
                    value={bulkAppTitle}
                    onChange={(e) => setBulkAppTitle(e.target.value)}
                    placeholder="e.g. Staff Picks"
                    maxLength={100}
                    className="w-full px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="flex space-x-2">
              <button
                onClick={handleResetAll}
                disabled={resetting || !selectedPlaylistId}
                className={classNames(
                  'flex-1 px-4 py-2 rounded-md transition-colors',
                  resetting || !selectedPlaylistId
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-red-600 text-white hover:bg-red-700'
                )}
              >
                {resetting ? 'Resetting...' : 'Disable for All Users'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-2">
            <div className="bg-gray-700 rounded-lg p-4 mb-4">
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search users by name or email"
                  className="flex-1 px-3 py-2 bg-gray-600 border border-gray-500 rounded-md text-white focus:outline-none"
                />
                <button
                  onClick={() => { setPage(0) }}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
                >
                  Search
                </button>
              </div>
            </div>

            <div className="bg-gray-700 rounded-lg">
              <div className="flex items-center justify-between px-4 py-2 border-b border-gray-600">
                <div className="flex items-center space-x-2 text-gray-200">
                  <input
                    type="checkbox"
                    checked={selectedUserIds.size > 0 && selectedUserIds.size === users.length}
                    onChange={(e) => toggleAllUsers(e.target.checked)}
                    className="h-4 w-4 text-indigo-600"
                  />
                  <span>Select All</span>
                </div>
                <div className="text-gray-300 text-sm">
                  {selectedUserIds.size} selected
                </div>
              </div>

              <div className="max-h-[45vh] overflow-y-auto divide-y divide-gray-600">
                {usersLoading ? (
                  <div className="p-4 text-gray-300">Loading users...</div>
                ) : users.length === 0 ? (
                  <div className="p-4 text-gray-300">No users found</div>
                ) : (
                  users.map((u) => {
                    const id = u.userId || u.id || u._id
                    return (
                      <div key={id} className="px-4 py-3 flex items-center justify-between">
                        <div className="flex items-center space-x-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={selectedUserIds.has(id)}
                            onChange={(e) => toggleUser(id, e.target.checked)}
                            className="h-4 w-4 text-indigo-600"
                          />
                          <div className="min-w-0">
                            <div className="text-white font-medium truncate">{u.name || u.displayName || u.email || 'Unknown'}</div>
                            {u.email && <div className="text-gray-300 text-sm truncate">{u.email}</div>}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-600">
                <div className="text-gray-300 text-sm">
                  Page {page + 1} of {totalPages}
                </div>
                <div className="space-x-2">
                  <button
                    onClick={() => setPage((p) => Math.max(0, p - 1))}
                    disabled={page <= 0}
                    className={classNames(
                      'px-3 py-1 rounded-md',
                      page <= 0 ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-gray-600 text-white hover:bg-gray-500'
                    )}
                  >
                    Prev
                  </button>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1}
                    className={classNames(
                      'px-3 py-1 rounded-md',
                      page >= totalPages - 1 ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-gray-600 text-white hover:bg-gray-500'
                    )}
                  >
                    Next
                  </button>
                  <select
                    value={limit}
                    onChange={(e) => { setLimit(parseInt(e.target.value, 10)); setPage(0) }}
                    className="ml-2 px-2 py-1 bg-gray-600 text-white rounded-md"
                  >
                    {[10,20,50,100].map(n => <option key={n} value={n}>{n}/page</option>)}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end mt-4 space-x-3">
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                Close
              </button>
              <button
                onClick={handleApply}
                disabled={applying || selectedUserIds.size === 0 || !selectedPlaylistId}
                className={classNames(
                  'px-4 py-2 rounded-md transition-colors',
                  applying || selectedUserIds.size === 0 || !selectedPlaylistId
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700'
                )}
              >
                {applying ? 'Applying...' : `Apply to ${selectedUserIds.size} user${selectedUserIds.size !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 p-3 bg-blue-900 bg-opacity-50 border border-blue-600 rounded-lg">
          <div className="text-sm text-blue-200">
            <p className="font-medium mb-1">About Admin App Rows</p>
            <p>Use this tool to toggle which playlists appear as rows for selected users. This does not change playlist privacy or membership.</p>
          </div>
        </div>
      </div>
    </div>
  )
}