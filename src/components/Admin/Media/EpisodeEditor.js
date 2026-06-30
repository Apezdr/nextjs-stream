'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDownIcon, PlusIcon } from '@heroicons/react/24/outline'
import { saveEpisodeAction, deleteEpisodeAction } from '@src/utils/admin/flatMediaActions'
import LockableField from './LockableField'
import ImagePreview from './ImagePreview'
import RawRecordButton from './RawRecordButton'

const SCALAR_KEYS = ['title', 'videoURL', 'thumbnail', 'thumbnailBlurhash', 'chapterURL', 'hdr', 'duration']

function initForm(episode) {
  const f = {}
  for (const k of SCALAR_KEYS) f[k] = episode?.[k] ?? ''
  if (f.duration !== '' && f.duration != null) f.duration = String(f.duration)
  return f
}

/**
 * Single-episode editor (existing or "add new"). Each instance owns its form +
 * action state so saving one episode never touches the others.
 */
export default function EpisodeEditor({ showId, seasonNumber, episode = null, isNew = false, defaultEpisodeNumber = '', defaultOpen = false }) {
  const [saveState, save, isSaving] = useActionState(saveEpisodeAction, { status: 'idle' })
  const [delState, del, isDeleting] = useActionState(deleteEpisodeAction, { status: 'idle' })

  const [open, setOpen] = useState(Boolean(defaultOpen))
  const containerRef = useRef(null)

  // Navigating between episodes of the same show reuses this component instead
  // of remounting it, so the new ?episode=N target arrives as a `defaultOpen`
  // prop change. Sync `open` to it during render (React's "adjusting state when
  // a prop changes" pattern) rather than in an effect: becoming the target
  // opens this episode, losing it collapses it. Manual toggles in between are
  // preserved since we only react to a *change* in `defaultOpen`.
  const [prevDefaultOpen, setPrevDefaultOpen] = useState(defaultOpen)
  if (defaultOpen !== prevDefaultOpen) {
    setPrevDefaultOpen(defaultOpen)
    setOpen(defaultOpen)
  }

  // Scroll the targeted episode into view. DOM-only side effect (no setState).
  useEffect(() => {
    if (defaultOpen && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [defaultOpen])
  const [epNumber, setEpNumber] = useState(() => (episode?.episodeNumber ?? defaultEpisodeNumber)?.toString?.() ?? '')
  const [form, setForm] = useState(() => initForm(episode))
  const [locks, setLocks] = useState(() => ({ ...(episode?.lockedFields ?? {}) }))

  // The "add new" form resets automatically: on a successful add, the season's
  // episode count changes, which remounts this component via its parent `key`
  // (see SeasonEditor) — no setState-in-effect needed.

  const setField = (key) => (v) => setForm((p) => ({ ...p, [key]: v }))
  const isLocked = (key) => locks[key] === true
  const toggleLock = (key) =>
    setLocks((p) => {
      const next = { ...p }
      if (next[key] === true) delete next[key]
      else next[key] = true
      return next
    })

  const payload = useMemo(
    () => ({
      showId,
      seasonNumber,
      episodeNumber: epNumber,
      ...(episode?._id ? { episodeId: episode._id } : {}),
      ...form,
      lockedFields: locks,
    }),
    [showId, seasonNumber, epNumber, episode, form, locks]
  )

  const field = (key, label, opts = {}) => (
    <LockableField
      id={`ep-${episode?._id || 'new'}-${key}`}
      label={label}
      value={form[key]}
      onChange={setField(key)}
      locked={isLocked(key)}
      onToggleLock={() => toggleLock(key)}
      {...opts}
    />
  )

  if (isNew && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-sm text-gray-500 hover:border-gray-400 hover:text-gray-700"
      >
        <PlusIcon className="h-4 w-4" /> Add episode
      </button>
    )
  }

  return (
    <div ref={containerRef} className="rounded-md border border-gray-200 bg-gray-50">
      <div className="flex w-full items-center gap-2 px-3 py-2 text-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center justify-between text-left"
        >
          <span className="font-medium text-gray-700">
            {isNew ? 'New episode' : `E${String(episode?.episodeNumber ?? '').padStart(2, '0')} — ${form.title || 'Untitled'}`}
          </span>
          <ChevronDownIcon className={`h-4 w-4 text-gray-400 transition ${open ? 'rotate-180' : ''}`} />
        </button>
        {!isNew && episode && (
          <RawRecordButton record={episode} title={`Episode ${episode?.episodeNumber ?? ''} record`} compact />
        )}
      </div>

      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save(payload)
          }}
          className="space-y-3 border-t border-gray-200 p-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
            <LockableField
              id={`ep-${episode?._id || 'new'}-num`}
              label="Episode #"
              type="number"
              value={epNumber}
              onChange={setEpNumber}
            />
            <div className="sm:col-span-3">{field('title', 'Title')}</div>
          </div>
          {field('videoURL', 'Video URL')}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-3">
              {field('thumbnail', 'Thumbnail URL')}
              {field('thumbnailBlurhash', 'Thumbnail Blurhash URL')}
              <ImagePreview url={form.thumbnail} alt="Thumbnail preview" className="h-24" />
            </div>
            <div className="space-y-3">
              {field('chapterURL', 'Chapter URL')}
              {field('hdr', 'HDR')}
              {field('duration', 'Duration (ms)', { type: 'number' })}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
            >
              {isSaving ? 'Saving…' : isNew ? 'Add episode' : 'Save episode'}
            </button>
            {!isNew && episode?._id && (
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => del({ episodeId: episode._id, showId })}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </button>
            )}
            {saveState.status === 'error' && <span className="text-sm text-red-600">{saveState.message}</span>}
            {delState.status === 'error' && <span className="text-sm text-red-600">{delState.message}</span>}
          </div>
        </form>
      )}
    </div>
  )
}
