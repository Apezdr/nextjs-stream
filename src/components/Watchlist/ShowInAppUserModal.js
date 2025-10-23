'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Modal from './Modal'
import { classNames } from '@src/utils'

/**
 * ShowInAppUserModal
 * - Lets the current user manage their own "Show in App" playlist rows (per-user visibility)
 * - Relies on watchlist API actions:
 *   - GET /api/authenticated/watchlist?action=playlists&includeShared=true (to list accessible playlists)
 *   - GET /api/authenticated/watchlist?action=playlist-visibility (to fetch current user's visibility)
 *   - PUT /api/authenticated/watchlist?action=playlist-visibility (to upsert visibility for a playlist)
 *
 * Props:
 * - isOpen: boolean
 * - onClose: () => void
 * - api: API object from WatchlistPage's useWatchlistAPI (must provide getPlaylists, getPlaylistVisibility, setPlaylistVisibility)
 */
export default function ShowInAppUserModal({ isOpen, onClose, api }) {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [playlists, setPlaylists] = useState([])
  const [visibilityList, setVisibilityList] = useState([]) // [{ playlistId, showInApp, appOrder, appTitle }]
  const [edited, setEdited] = useState(new Map()) // playlistId -> { showInApp, appOrder, appTitle }

  const visibilityMap = useMemo(() => {
    const m = new Map()
    for (const v of visibilityList) {
      m.set(v.playlistId, v)
    }
    return m
  }, [visibilityList])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      // Load all accessible playlists for this user
      const pl = await api.getPlaylists(true) // includeShared default
      const list = Array.isArray(pl?.playlists) ? pl.playlists : []

      // Load current user's visible playlist preferences (only showInApp ones)
      const vis = await api.getPlaylistVisibility()
      const vList = Array.isArray(vis?.visibility) ? vis.visibility : []

      setPlaylists(list)
      setVisibilityList(vList)
      setEdited(new Map()) // reset edits on load
    } catch (e) {
      console.error('[ShowInAppUserModal] loadData failed:', e)
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => {
    if (isOpen) {
      loadData()
    }
  }, [isOpen, loadData])

  const getDraftFor = (playlistId) => {
    if (edited.has(playlistId)) return edited.get(playlistId)
    const initial = visibilityMap.get(playlistId) || {}
    return {
      showInApp: !!initial.showInApp,
      appOrder: typeof initial.appOrder === 'number' ? initial.appOrder : 0,
      appTitle: initial.appTitle ?? '',
      hideUnavailable: !!initial.hideUnavailable  // Default to false (show all)
    }
  }

  const setDraftFor = (playlistId, patch) => {
    setEdited(prev => {
      const next = new Map(prev)
      const current = getDraftFor(playlistId)
      next.set(playlistId, { ...current, ...patch })
      return next
    })
  }

  const handleToggle = async (playlistId, value) => {
    setDraftFor(playlistId, { showInApp: value })
  }

  const handleOrderChange = (playlistId, value) => {
    const n = parseInt(value)
    if (!Number.isNaN(n) && n >= 0) {
      setDraftFor(playlistId, { appOrder: n })
    }
  }

  const handleTitleChange = (playlistId, value) => {
    if (value.length <= 100) {
      setDraftFor(playlistId, { appTitle: value })
    }
  }

  const handleSave = async () => {
    if (edited.size === 0) {
      onClose()
      return
    }
    setSaving(true)
    try {
      // Persist edits per playlist
      for (const [playlistId, payload] of edited.entries()) {
        // Convert blank title to null
        const finalPayload = {
          showInApp: !!payload.showInApp,
          appOrder: typeof payload.appOrder === 'number' ? payload.appOrder : 0,
          appTitle: payload.appTitle && payload.appTitle.trim().length > 0 ? payload.appTitle.trim() : null,
          hideUnavailable: !!payload.hideUnavailable,
          playlistId
        }
        await api.setPlaylistVisibility(finalPayload)
      }
      await loadData()
      onClose()
    } catch (e) {
      console.error('[ShowInAppUserModal] save failed:', e)
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} className="w-full max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Manage Your App Rows</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white"
          title="Close"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <p className="text-gray-300 text-sm mb-4">
        Choose which playlists appear as rows on your home screen. You can set a custom row title and order for your view.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-500"></div>
          <span className="ml-3 text-gray-300">Loading playlists...</span>
        </div>
      ) : (
        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
          {playlists.length === 0 ? (
            <div className="text-gray-400 text-sm">No accessible playlists.</div>
          ) : (
            playlists.map((p) => {
              const pid = p.id
              const draft = getDraftFor(pid)
              return (
                <div
                  key={pid}
                  className="bg-gray-700 rounded-lg p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h4 className="text-white font-medium truncate">
                        {p.name}
                      </h4>
                      {p.isOwner ? (
                        <span className="text-xs text-gray-300 bg-gray-600 px-2 py-0.5 rounded">Owned</span>
                      ) : p.isCollaborator ? (
                        <span className="text-xs text-gray-300 bg-gray-600 px-2 py-0.5 rounded">Shared</span>
                      ) : p.isPublic ? (
                        <span className="text-xs text-gray-300 bg-gray-600 px-2 py-0.5 rounded">Public</span>
                      ) : null}
                    </div>
                    {p.description && (
                      <div className="text-xs text-gray-300 mt-0.5 line-clamp-2">{p.description}</div>
                    )}
                    <div className="mt-2 space-y-2">
                      {/* Primary controls - Show in App toggle */}
                      <label className="flex items-center gap-2 text-sm text-gray-200">
                        <input
                          type="checkbox"
                          checked={!!draft.showInApp}
                          onChange={(e) => handleToggle(pid, e.target.checked)}
                          className="w-4 h-4 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500"
                        />
                        Show in App
                      </label>
                      
                      {/* Secondary controls - only show when playlist is enabled */}
                      {draft.showInApp && (
                        <div className="pl-6 space-y-2 border-l-2 border-indigo-500/30">
                          {/* Row customization */}
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-300 whitespace-nowrap">Row order</span>
                              <input
                                type="number"
                                min={0}
                                value={draft.appOrder}
                                onChange={(e) => handleOrderChange(pid, e.target.value)}
                                className="w-20 px-2 py-1 bg-gray-800 border border-gray-600 rounded-md text-white text-sm"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-gray-300 whitespace-nowrap">Row title</span>
                              <input
                                type="text"
                                value={draft.appTitle || ''}
                                onChange={(e) => handleTitleChange(pid, e.target.value)}
                                placeholder="Optional"
                                maxLength={100}
                                className="flex-1 px-2 py-1 bg-gray-800 border border-gray-600 rounded-md text-white text-sm"
                              />
                            </div>
                          </div>
                          
                          {/* Availability filter */}
                          <label className="flex items-center gap-2 text-sm text-gray-200">
                            <input
                              type="checkbox"
                              checked={!!draft.hideUnavailable}
                              onChange={(e) => setDraftFor(pid, { hideUnavailable: e.target.checked })}
                              className="w-4 h-4 text-indigo-600 bg-gray-700 border-gray-600 rounded focus:ring-indigo-500"
                            />
                            <span>Hide unavailable content</span>
                            <span className="text-xs text-gray-400 ml-1">(Show only items in your library)</span>
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      <div className="flex items-center justify-end gap-3 mt-4">
        <button
          onClick={onClose}
          disabled={saving}
          className={classNames(
            'px-4 py-2 rounded-md transition-colors',
            saving ? 'bg-gray-700 text-gray-400 cursor-not-allowed' : 'bg-gray-600 text-white hover:bg-gray-700'
          )}
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className={classNames(
            'px-4 py-2 rounded-md transition-colors',
            saving ? 'bg-indigo-700 text-white cursor-not-allowed' : 'bg-indigo-600 text-white hover:bg-indigo-700'
          )}
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
    </Modal>
  )
}