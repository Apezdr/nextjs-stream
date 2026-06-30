'use client'

import { useActionState, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDownIcon } from '@heroicons/react/24/outline'
import { saveSeasonAction, deleteSeasonAction } from '@src/utils/admin/flatMediaActions'
import LockableField from './LockableField'
import ImagePreview from './ImagePreview'
import EpisodeEditor from './EpisodeEditor'
import RawRecordButton from './RawRecordButton'

/**
 * Season accordion: editable season poster + its episode list (each episode is
 * its own EpisodeEditor) + an "add episode" affordance.
 */
export default function SeasonEditor({ showId, season, defaultOpen = false, initialEpisode = null }) {
  const [saveState, save, isSaving] = useActionState(saveSeasonAction, { status: 'idle' })
  const [delState, del, isDeleting] = useActionState(deleteSeasonAction, { status: 'idle' })
  const [open, setOpen] = useState(Boolean(defaultOpen))
  const containerRef = useRef(null)

  // Navigating between items of the same show is a soft navigation, so this
  // component is reused (not remounted) and the new ?season=/?episode= props
  // arrive as prop changes. Sync `open` to the target during render (React's
  // "adjusting state when a prop changes" pattern) rather than in an effect:
  // becoming the target opens this season, losing it collapses it. Because we
  // only react to a *change* in `defaultOpen`, a season the admin toggled
  // manually in between is left untouched.
  const [prevDefaultOpen, setPrevDefaultOpen] = useState(defaultOpen)
  if (defaultOpen !== prevDefaultOpen) {
    setPrevDefaultOpen(defaultOpen)
    setOpen(defaultOpen)
  }

  // Scroll the targeted season into view — but only when no specific episode is
  // targeted (the episode handles its own scroll then). DOM-only side effect.
  useEffect(() => {
    if (defaultOpen && initialEpisode == null && containerRef.current) {
      containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [defaultOpen, initialEpisode])

  const [posterURL, setPosterURL] = useState(season?.posterURL ?? '')
  const [posterBlurhash, setPosterBlurhash] = useState(season?.posterBlurhash ?? '')
  const [locks, setLocks] = useState(() => ({ ...(season?.lockedFields ?? {}) }))

  const episodes = useMemo(() => season?.episodes ?? [], [season])
  const nextEpisodeNumber = episodes.length
    ? Math.max(...episodes.map((e) => e.episodeNumber || 0)) + 1
    : 1

  const isLocked = (key) => locks[key] === true
  const toggleLock = (key) =>
    setLocks((p) => {
      const next = { ...p }
      if (next[key] === true) delete next[key]
      else next[key] = true
      return next
    })

  const savePayload = {
    showId,
    seasonNumber: season.seasonNumber,
    ...(season?._id ? { seasonId: season._id } : {}),
    posterURL,
    posterBlurhash,
    lockedFields: locks,
  }

  return (
    <div ref={containerRef} className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex w-full items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex flex-1 items-center justify-between text-left"
        >
          <span className="font-semibold text-gray-900">
            Season {season.seasonNumber}
            <span className="ml-2 text-sm font-normal text-gray-400">
              {episodes.length} episode{episodes.length === 1 ? '' : 's'}
            </span>
          </span>
          <ChevronDownIcon className={`h-5 w-5 text-gray-400 transition ${open ? 'rotate-180' : ''}`} />
        </button>
        <RawRecordButton record={season} title={`Season ${season.seasonNumber} record`} compact />
      </div>

      {open && (
        <div className="space-y-5 border-t border-gray-200 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              save(savePayload)
            }}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <div className="space-y-3">
              <LockableField
                id={`season-${season.seasonNumber}-poster`}
                label="Season Poster URL"
                value={posterURL}
                onChange={setPosterURL}
                locked={isLocked('posterURL')}
                onToggleLock={() => toggleLock('posterURL')}
              />
              <LockableField
                id={`season-${season.seasonNumber}-posterbh`}
                label="Poster Blurhash URL"
                value={posterBlurhash}
                onChange={setPosterBlurhash}
                locked={isLocked('posterBlurhash')}
                onToggleLock={() => toggleLock('posterBlurhash')}
              />
              <ImagePreview url={posterURL} alt="Season poster" className="h-40" />
            </div>
            <div className="flex flex-col items-start gap-3">
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-60"
              >
                {isSaving ? 'Saving…' : 'Save season'}
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => del({ showId, seasonNumber: season.seasonNumber })}
                className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {isDeleting ? 'Deleting…' : 'Delete season (and episodes)'}
              </button>
              {saveState.status === 'error' && <span className="text-sm text-red-600">{saveState.message}</span>}
              {delState.status === 'error' && <span className="text-sm text-red-600">{delState.message}</span>}
            </div>
          </form>

          <div className="space-y-2">
            <h4 className="text-sm font-semibold text-gray-700">Episodes</h4>
            {episodes.map((ep) => (
              <EpisodeEditor
                key={ep._id}
                showId={showId}
                seasonNumber={season.seasonNumber}
                episode={ep}
                defaultOpen={initialEpisode != null && ep.episodeNumber === initialEpisode}
              />
            ))}
            <EpisodeEditor
              key={`add-${episodes.length}`}
              showId={showId}
              seasonNumber={season.seasonNumber}
              isNew
              defaultEpisodeNumber={nextEpisodeNumber}
            />
          </div>
        </div>
      )}
    </div>
  )
}
