'use client'

import { useActionState, useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import {
  Cog6ToothIcon,
  XMarkIcon,
  MagnifyingGlassIcon,
  ChevronDownIcon,
  PhotoIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline'
import { buildURL } from '@src/utils'
import { getTmdbConfigAction, saveTmdbConfigAction } from '@src/utils/admin/tmdbConfigActions'
import TmdbImagePicker from './TmdbImagePicker'

const inputClass =
  'mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-indigo-500 focus:ring-indigo-500'

// Structured metadata override fields. The backend shallow-merges config.metadata
// over the TMDB response (applyMetadataOverrides), so any top-level TMDB field can
// be overridden. These cover the common scalar fields; the "Advanced (raw JSON)"
// editor handles everything else (genres arrays, etc.).
const METADATA_FIELDS = {
  common: [
    { key: 'overview', label: 'Overview', type: 'textarea' },
    { key: 'tagline', label: 'Tagline', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'homepage', label: 'Homepage', type: 'text' },
    { key: 'original_language', label: 'Original Language', type: 'text' },
    { key: 'vote_average', label: 'Vote Average', type: 'number' },
  ],
  movie: [
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'original_title', label: 'Original Title', type: 'text' },
    { key: 'release_date', label: 'Release Date', type: 'text' },
    { key: 'runtime', label: 'Runtime (min)', type: 'number' },
  ],
  tv: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'original_name', label: 'Original Name', type: 'text' },
    { key: 'first_air_date', label: 'First Air Date', type: 'text' },
    { key: 'last_air_date', label: 'Last Air Date', type: 'text' },
  ],
}

/**
 * Opens a dialog to view/edit the media item's backend `tmdb.config`
 * (the file the media-processor reads to decide what to pull from TMDB).
 *
 * @param {'movie'|'tv'} type
 * @param {string} originalTitle - filesystem directory name (mediaName on the backend)
 * @param {number|string} [recordTmdbId] - TMDB id already on the record (metadata.id).
 *   Used to seed the dialog's TMDB ID on open so the image Browse buttons work
 *   immediately when the per-directory config hasn't pinned one yet.
 * @param {string} [title] - Display title, used to pre-fill the TMDB search box.
 * @param {{poster?:string, backdrop?:string, logo?:string}} [currentImages] - The
 *   record's current TMDB image paths (metadata.*_path), used to highlight the
 *   in-use image in the Browse picker when no explicit override is set.
 * @param {{isLocalOverride:boolean, hostingServerLabel:string, hostingPriority:number|null,
 *   writeTargetLabel:string, writeTargetPriority:number, overrideWillWin:boolean}} [ownership]
 *   Multi-server ownership info. When `isLocalOverride` is true the media is
 *   hosted on a different server, so saving here writes a local placeholder
 *   override (on the default server) rather than editing the source config.
 */
export default function TmdbConfigButton({
  type,
  originalTitle,
  recordTmdbId = null,
  title = '',
  currentImages = {},
  ownership = null,
}) {
  const metaFields = [...METADATA_FIELDS.common, ...(type === 'tv' ? METADATA_FIELDS.tv : METADATA_FIELDS.movie)]
  const metaKeys = new Set(metaFields.map((f) => f.key))

  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(null)
  const [configPath, setConfigPath] = useState(null)
  // True when the backend returned only defaults (no saved tmdb.config found) —
  // a strong hint the file isn't where the dialog is looking.
  const [configMissing, setConfigMissing] = useState(false)

  // Raw config as loaded from the backend, so fields the dialog doesn't manage
  // are preserved on save instead of being wiped.
  const [baseConfig, setBaseConfig] = useState({})
  const [tmdbId, setTmdbId] = useState('')
  const [updateMetadata, setUpdateMetadata] = useState(true)
  const [backdropFocal, setBackdropFocal] = useState('')
  const [overridePoster, setOverridePoster] = useState('')
  const [overrideBackdrop, setOverrideBackdrop] = useState('')
  const [overrideLogo, setOverrideLogo] = useState('')

  // Metadata overrides: structured scalar fields + an advanced raw-JSON remainder.
  const [meta, setMeta] = useState({})
  const [metadataAdvanced, setMetadataAdvanced] = useState('')
  const [metadataError, setMetadataError] = useState(null)
  const [metadataOpen, setMetadataOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [saveState, save, isSaving] = useActionState(saveTmdbConfigAction, { status: 'idle' })

  const [searchQuery, setSearchQuery] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState(null)

  // Pagination for the "Find on TMDB" list (infinite scroll). `activeQuery` is the
  // query that produced the current results, so "load more" keeps paging the same
  // search even if the input box is edited afterward. TMDB returns 20 results per
  // page along with `page` / `total_pages` in the body.
  const [activeQuery, setActiveQuery] = useState('')
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [loadingMore, setLoadingMore] = useState(false)

  // TMDB image picker state. Images are fetched once per tmdb_id and cached.
  const [pickerKind, setPickerKind] = useState(null) // 'poster' | 'backdrop' | 'logo' | null
  const [tmdbImages, setTmdbImages] = useState(null)
  const [imagesForId, setImagesForId] = useState(null)
  const [imagesLoading, setImagesLoading] = useState(false)
  const [imagesError, setImagesError] = useState(null)

  const setMetaField = (key, value) => setMeta((p) => ({ ...p, [key]: value }))

  async function fetchSearchPage(q, pageNum) {
    const res = await fetch(
      buildURL(
        `/api/authenticated/tmdb/search?type=${type}&query=${encodeURIComponent(q)}&page=${pageNum}`
      )
    )
    if (!res.ok) throw new Error(`Search failed (${res.status})`)
    return res.json()
  }

  async function runSearch(queryArg) {
    const q = (typeof queryArg === 'string' ? queryArg : searchQuery).trim()
    if (!q) return
    setSearching(true)
    setSearchError(null)
    setActiveQuery(q)
    setPage(1)
    setTotalPages(1)
    try {
      const data = await fetchSearchPage(q, 1)
      setResults(data.results || [])
      setPage(data.page || 1)
      setTotalPages(data.total_pages || 1)
    } catch (err) {
      setSearchError(err.message)
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  // Append the next page of results, paging the query that produced the current
  // list. Guarded so overlapping scroll events and an exhausted search are no-ops.
  async function loadMore() {
    if (loadingMore || searching || !activeQuery || page >= totalPages) return
    const next = page + 1
    setLoadingMore(true)
    try {
      const data = await fetchSearchPage(activeQuery, next)
      setResults((prev) => {
        const seen = new Set(prev.map((r) => r.id))
        return prev.concat((data.results || []).filter((r) => !seen.has(r.id)))
      })
      setPage(data.page || next)
      setTotalPages(data.total_pages || totalPages)
    } catch (err) {
      setSearchError(err.message)
    } finally {
      setLoadingMore(false)
    }
  }

  // Load the next page once the list is scrolled near its end so new items keep
  // appearing as the admin scrolls. The threshold starts the fetch just before
  // the very bottom so the loading row is visible without a hard stop.
  function onResultsScroll(e) {
    const el = e.currentTarget
    if (el.scrollHeight - el.scrollTop - el.clientHeight <= 48) {
      loadMore()
    }
  }

  // Keep the results list visible after picking so the chosen match stays
  // highlighted and the admin can switch to a different result if needed.
  function selectResult(r) {
    setTmdbId(String(r.id))
  }

  function populate(config = {}) {
    setTmdbId(config.tmdb_id != null ? String(config.tmdb_id) : '')
    setUpdateMetadata(config.update_metadata !== false)
    setBackdropFocal(config.backdrop_focal ?? '')
    setOverridePoster(config.override_poster ?? '')
    setOverrideBackdrop(config.override_backdrop ?? '')
    setOverrideLogo(config.override_logo ?? '')

    // Split the metadata override block into structured fields + a JSON remainder.
    const md = config.metadata && typeof config.metadata === 'object' ? config.metadata : {}
    const metaState = {}
    for (const f of metaFields) {
      const v = md[f.key]
      metaState[f.key] = v == null ? '' : String(v)
    }
    const remainder = {}
    for (const [k, v] of Object.entries(md)) {
      if (!metaKeys.has(k)) remainder[k] = v
    }
    setMeta(metaState)
    setMetadataAdvanced(Object.keys(remainder).length ? JSON.stringify(remainder, null, 2) : '')
    setMetadataError(null)
    setMetadataOpen(Object.keys(md).length > 0)
    setAdvancedOpen(Object.keys(remainder).length > 0)
  }

  // Load on open from an event handler (not an effect) so we never setState
  // synchronously inside an effect body.
  async function open() {
    setIsOpen(true)
    setLoading(true)
    setLoadError(null)
    setConfigPath(null)
    setConfigMissing(false)
    setResults([])
    setActiveQuery('')
    setPage(1)
    setTotalPages(1)
    setLoadingMore(false)
    // Default the search box to the title so the admin can re-search in one keystroke.
    setSearchQuery(title ? String(title) : '')
    setSearchError(null)
    setTmdbImages(null)
    setImagesForId(null)
    setImagesError(null)
    const res = await getTmdbConfigAction({ mediaType: type, originalTitle })
    if (res.status === 'success') {
      setBaseConfig(res.config || {})
      populate(res.config)
      setConfigPath(res.configPath || null)
      // No tmdb_id, no overrides, no metadata block => the backend almost
      // certainly fell back to defaults (no saved tmdb.config at that path).
      const c = res.config || {}
      const looksEmpty =
        !c.tmdb_id && !c.override_poster && !c.override_backdrop && !c.override_logo && !c.metadata
      setConfigMissing(looksEmpty)
      // Seed the TMDB ID from the record when the per-directory config doesn't
      // pin one, so the image Browse buttons are usable immediately. Only
      // possible when the record actually carries a TMDB id (metadata.id).
      const hasConfigId = res.config?.tmdb_id != null && res.config.tmdb_id !== ''
      const hasRecordId = recordTmdbId != null && String(recordTmdbId).trim() !== ''
      if (!hasConfigId && hasRecordId) {
        setTmdbId(String(recordTmdbId))
      }
    } else {
      setLoadError(res.message)
    }
    setLoading(false)
    // Auto-run a search by title so the matched result is shown (and highlighted
    // against the current TMDB ID). Fire-and-forget; not awaited.
    if (title) runSearch(String(title))
  }

  // Fetch (and cache) the TMDB image set, then open the picker for `kind`.
  // Runs from a click handler — never an effect.
  async function browse(kind) {
    const id = String(tmdbId).trim()
    if (!id) return
    setPickerKind(kind)
    if (tmdbImages && imagesForId === id) return // cached for this id
    setImagesLoading(true)
    setImagesError(null)
    try {
      const res = await fetch(
        buildURL(`/api/authenticated/tmdb/images/${type}?tmdb_id=${encodeURIComponent(id)}`)
      )
      if (!res.ok) throw new Error(`Image fetch failed (${res.status})`)
      const data = await res.json()
      setTmdbImages(data)
      setImagesForId(id)
    } catch (err) {
      setImagesError(err.message)
      setTmdbImages(null)
    } finally {
      setImagesLoading(false)
    }
  }

  function onSelectImage(filePath) {
    if (pickerKind === 'poster') setOverridePoster(filePath)
    else if (pickerKind === 'backdrop') setOverrideBackdrop(filePath)
    else if (pickerKind === 'logo') setOverrideLogo(filePath)
    setPickerKind(null)
  }

  function submit(e) {
    e.preventDefault()

    // Validate the advanced raw-JSON remainder before anything else.
    let parsedAdvanced = {}
    const advText = metadataAdvanced.trim()
    if (advText) {
      try {
        parsedAdvanced = JSON.parse(advText)
        if (!parsedAdvanced || typeof parsedAdvanced !== 'object' || Array.isArray(parsedAdvanced)) {
          throw new Error('must be a JSON object')
        }
      } catch (err) {
        setMetadataOpen(true)
        setAdvancedOpen(true)
        setMetadataError(`Invalid advanced JSON: ${err.message}`)
        return
      }
    }
    setMetadataError(null)

    // Structured values: coerce numbers, drop blanks. Structured fields win over
    // the advanced remainder if a key somehow appears in both.
    const structuredValues = {}
    for (const f of metaFields) {
      const raw = meta[f.key]
      if (raw == null || String(raw).trim() === '') continue
      if (f.type === 'number') {
        const n = Number(raw)
        if (!Number.isNaN(n)) structuredValues[f.key] = n
      } else {
        structuredValues[f.key] = String(raw)
      }
    }

    const finalMetadata = { ...parsedAdvanced, ...structuredValues }

    const config = {
      ...baseConfig, // preserve fields the dialog doesn't manage
      tmdb_id: tmdbId,
      update_metadata: updateMetadata,
      backdrop_focal: backdropFocal || null,
      override_poster: overridePoster,
      override_backdrop: overrideBackdrop,
      override_logo: overrideLogo,
    }
    if (Object.keys(finalMetadata).length) config.metadata = finalMetadata
    else delete config.metadata

    save({ mediaType: type, originalTitle, config })
  }

  const tmdbIdSet = String(tmdbId).trim() !== ''
  const overrideRows = [
    { kind: 'poster', label: 'Override Poster', value: overridePoster, setValue: setOverridePoster },
    { kind: 'backdrop', label: 'Override Backdrop', value: overrideBackdrop, setValue: setOverrideBackdrop },
    { kind: 'logo', label: 'Override Logo', value: overrideLogo, setValue: setOverrideLogo },
  ]
  const pickerImages =
    pickerKind === 'poster'
      ? tmdbImages?.posters ?? []
      : pickerKind === 'backdrop'
        ? tmdbImages?.backdrops ?? []
        : pickerKind === 'logo'
          ? tmdbImages?.logos ?? []
          : []
  // Highlight the in-use image in the picker: prefer the explicit override,
  // otherwise fall back to the record's current TMDB path for that kind.
  const overrideByKind = { poster: overridePoster, backdrop: overrideBackdrop, logo: overrideLogo }
  const pickerSelected = pickerKind
    ? overrideByKind[pickerKind] || currentImages?.[pickerKind] || ''
    : ''

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
      >
        <Cog6ToothIcon className="h-4 w-4" /> TMDB Config
      </button>

      <Dialog open={isOpen} onClose={setIsOpen} className="relative z-50">
        <DialogBackdrop className="fixed inset-0 bg-black/40" />
        <div className="fixed inset-0 flex items-center justify-center p-4">
          <DialogPanel className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
              <DialogTitle className="text-lg font-semibold text-gray-900">TMDB Config</DialogTitle>
              <button type="button" onClick={() => setIsOpen(false)} className="text-gray-400 hover:text-gray-600">
                <XMarkIcon className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4 overflow-y-auto px-6 py-5">
              <p className="text-xs text-gray-500">
                Edits the backend <code className="rounded bg-gray-100 px-1">tmdb.config</code> for{' '}
                <span className="font-medium text-gray-700">{originalTitle}</span>. Changes take effect on
                the next sync.
              </p>

              {!loading && !loadError && configPath ? (
                <p className="break-all text-[11px] text-gray-400">
                  Backend file: <code className="rounded bg-gray-100 px-1">{configPath}</code>
                </p>
              ) : null}

              {!loading && !loadError && ownership?.isLocalOverride ? (
                <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <span className="font-semibold">Local override.</span> “{title || originalTitle}” is hosted
                  on <span className="font-medium">{ownership.hostingServerLabel}</span>. Saving here writes a{' '}
                  <code className="rounded bg-blue-100 px-1">tmdb.config</code> placeholder on your server (
                  <span className="font-medium">{ownership.writeTargetLabel}</span>, priority{' '}
                  {ownership.writeTargetPriority}) that wins in your library on the next sync — the source
                  server is not modified.
                  {!ownership.overrideWillWin ? (
                    <span className="mt-1 block font-semibold text-amber-700">
                      ⚠ {ownership.writeTargetLabel} (priority {ownership.writeTargetPriority}) does not
                      outrank {ownership.hostingServerLabel} (priority {ownership.hostingPriority}), so this
                      override may not take effect until it has higher priority.
                    </span>
                  ) : null}
                </div>
              ) : !loading && !loadError && configMissing && !ownership ? (
                <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  No saved <code className="rounded bg-amber-100 px-1">tmdb.config</code> was found at that
                  path (showing defaults). If you edited a config that isn&apos;t showing here, the media
                  likely lives on a different file server than the one this dialog queries — saving will
                  write to the path above.
                </p>
              ) : !loading && !loadError && configMissing ? (
                <p className="rounded-md bg-gray-50 px-3 py-2 text-xs text-gray-500">
                  No <code className="rounded bg-gray-100 px-1">tmdb.config</code> yet for this title —
                  saving creates one at the path above.
                </p>
              ) : null}

              {loading ? (
                <p className="py-6 text-center text-sm text-gray-500">Loading current config…</p>
              ) : loadError ? (
                <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{loadError}</p>
              ) : (
                <>
                  <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    <input
                      type="checkbox"
                      checked={updateMetadata}
                      onChange={(e) => setUpdateMetadata(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    Allow metadata updates from TMDB
                  </label>

                  <div>
                    <label className="block text-sm font-medium text-gray-700">Find on TMDB</label>
                    <div className="mt-1 flex gap-2">
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault()
                            runSearch()
                          }
                        }}
                        placeholder={`Search ${type === 'tv' ? 'TV shows' : 'movies'} by title…`}
                        className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                      />
                      <button
                        type="button"
                        onClick={() => runSearch()}
                        disabled={searching}
                        className="inline-flex shrink-0 items-center rounded-md border border-gray-300 px-3 text-gray-600 hover:bg-gray-50 disabled:opacity-60"
                      >
                        <MagnifyingGlassIcon className="h-5 w-5" />
                      </button>
                    </div>
                    {searchError && <p className="mt-1 text-xs text-red-600">{searchError}</p>}
                    {searching && <p className="mt-1 text-xs text-gray-400">Searching…</p>}
                    {results.length > 0 && (
                      <ul
                        onScroll={onResultsScroll}
                        className="mt-2 max-h-56 divide-y divide-gray-100 overflow-auto rounded-md border border-gray-200"
                      >
                        {results.map((r) => {
                          const title = r.title || r.name || 'Untitled'
                          const date = r.release_date || r.first_air_date
                          const year = date ? String(date).slice(0, 4) : null
                          const isMatch = String(r.id) === String(tmdbId)
                          return (
                            <li key={r.id}>
                              <button
                                type="button"
                                onClick={() => selectResult(r)}
                                className={`flex w-full items-center gap-3 px-2 py-1.5 text-left ${isMatch ? 'bg-indigo-50' : 'hover:bg-gray-50'}`}
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={r.poster_path ? `https://image.tmdb.org/t/p/w92${r.poster_path}` : '/sorry-image-not-available.jpg'}
                                  alt=""
                                  className="h-12 w-8 shrink-0 rounded bg-gray-100 object-cover"
                                />
                                <span className="flex-1 text-sm text-gray-900">
                                  {title}
                                  {year ? <span className="text-gray-400"> ({year})</span> : null}
                                  {isMatch ? (
                                    <span className="ml-2 rounded bg-indigo-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">
                                      Selected
                                    </span>
                                  ) : null}
                                </span>
                                <span className="text-xs text-gray-400">#{r.id}</span>
                              </button>
                            </li>
                          )
                        })}
                        {loadingMore && (
                          <li
                            aria-live="polite"
                            className="flex items-center justify-center gap-2 px-2 py-2 text-xs text-gray-400"
                          >
                            <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
                            Loading more…
                          </li>
                        )}
                      </ul>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label htmlFor="cfg-tmdb-id" className="block text-sm font-medium text-gray-700">
                        TMDB ID
                      </label>
                      <input
                        id="cfg-tmdb-id"
                        type="number"
                        value={tmdbId}
                        onChange={(e) => setTmdbId(e.target.value)}
                        placeholder="e.g. 700391"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label htmlFor="cfg-focal" className="block text-sm font-medium text-gray-700">
                        Backdrop Focal Point
                      </label>
                      <select
                        id="cfg-focal"
                        value={backdropFocal}
                        onChange={(e) => setBackdropFocal(e.target.value)}
                        className={inputClass}
                      >
                        <option value="">Default (auto detect)</option>
                        <option value="left">Left</option>
                        <option value="center">Center</option>
                        <option value="right">Right</option>
                      </select>
                    </div>
                  </div>

                  {overrideRows.map((row) => (
                    <div key={row.kind}>
                      <label htmlFor={`cfg-${row.kind}`} className="block text-sm font-medium text-gray-700">
                        {row.label} URL
                      </label>
                      <div className="mt-1 flex gap-2">
                        <input
                          id={`cfg-${row.kind}`}
                          value={row.value}
                          onChange={(e) => row.setValue(e.target.value)}
                          placeholder="/abc123.jpg or full URL"
                          className="block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                        />
                        <button
                          type="button"
                          onClick={() => browse(row.kind)}
                          disabled={!tmdbIdSet}
                          title={tmdbIdSet ? `Browse TMDB ${row.kind}s` : 'Set a TMDB ID first'}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-gray-300 px-3 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50"
                        >
                          <PhotoIcon className="h-5 w-5" /> Browse
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="rounded-md border border-gray-200">
                    <button
                      type="button"
                      onClick={() => setMetadataOpen((o) => !o)}
                      className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold text-gray-700"
                    >
                      <span>Metadata Overrides</span>
                      <ChevronDownIcon className={`h-4 w-4 text-gray-400 transition ${metadataOpen ? 'rotate-180' : ''}`} />
                    </button>
                    {metadataOpen && (
                      <div className="space-y-4 border-t border-gray-200 p-3">
                        <p className="text-xs text-gray-500">
                          Values here are merged over the TMDB data on the next sync. Leave blank to keep the
                          TMDB value.
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {metaFields.map((f) => (
                            <div key={f.key} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}>
                              <label htmlFor={`cfg-meta-${f.key}`} className="block text-sm font-medium text-gray-700">
                                {f.label}
                              </label>
                              {f.type === 'textarea' ? (
                                <textarea
                                  id={`cfg-meta-${f.key}`}
                                  rows={3}
                                  value={meta[f.key] ?? ''}
                                  onChange={(e) => setMetaField(f.key, e.target.value)}
                                  className={inputClass}
                                />
                              ) : (
                                <input
                                  id={`cfg-meta-${f.key}`}
                                  type={f.type === 'number' ? 'number' : 'text'}
                                  value={meta[f.key] ?? ''}
                                  onChange={(e) => setMetaField(f.key, e.target.value)}
                                  className={inputClass}
                                />
                              )}
                            </div>
                          ))}
                        </div>

                        <div>
                          <button
                            type="button"
                            onClick={() => setAdvancedOpen((o) => !o)}
                            className="flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-800"
                          >
                            <ChevronDownIcon className={`h-3.5 w-3.5 transition ${advancedOpen ? 'rotate-180' : ''}`} />
                            Advanced (raw JSON)
                          </button>
                          {advancedOpen && (
                            <div className="mt-2">
                              <p className="text-xs text-gray-500">
                                Any metadata keys not covered above (e.g.{' '}
                                <code className="rounded bg-gray-100 px-1">genres</code>). Must be a JSON object.
                              </p>
                              <textarea
                                rows={6}
                                value={metadataAdvanced}
                                onChange={(e) => {
                                  setMetadataAdvanced(e.target.value)
                                  setMetadataError(null)
                                }}
                                placeholder={'{\n  "genres": [{ "id": 18, "name": "Drama" }]\n}'}
                                className={`${inputClass} font-mono text-xs`}
                              />
                            </div>
                          )}
                          {metadataError && <p className="mt-1 text-xs text-red-600">{metadataError}</p>}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-60"
                    >
                      {isSaving ? 'Saving…' : 'Save config'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    {saveState.status === 'error' && <span className="text-sm text-red-600">{saveState.message}</span>}
                    {saveState.status === 'success' && <span className="text-sm text-green-600">{saveState.message}</span>}
                  </div>
                </>
              )}
            </form>
          </DialogPanel>
        </div>
      </Dialog>

      <TmdbImagePicker
        open={pickerKind !== null}
        onClose={() => setPickerKind(null)}
        kind={pickerKind || 'poster'}
        images={pickerImages}
        loading={imagesLoading}
        error={imagesError}
        selected={pickerSelected}
        onSelect={onSelectImage}
      />
    </>
  )
}
