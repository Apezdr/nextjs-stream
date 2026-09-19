'use client'

import { useState } from 'react'
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { toast } from 'react-toastify'
import useLiveProgress from '@components/WatchProgress/useLiveProgress'
import { markWatched } from '@components/WatchProgress/markWatched'
import PrimaryPlayButton from './PrimaryPlayButton'
import { SECONDARY_CLASSES } from './Primitives'

/**
 * The dialog's body. The parent keys it by the episode's id, so opening the
 * dialog for another episode remounts it with fresh `pending` state — no
 * effect resets anything.
 */
function DialogBody({ episode, completed, onClose, onMarked }) {
  const [pending, setPending] = useState(false)
  const playable = Boolean(episode.videoURL && episode.hrefs?.play)

  const handleMark = async () => {
    setPending(true)
    try {
      await markWatched(episode)
      toast.success('Marked as watched')
      onMarked?.(episode)
      onClose()
    } catch (error) {
      toast.error(error?.message || 'Could not mark as watched')
      setPending(false)
    }
  }

  return (
    <>
      <DialogTitle className="text-lg font-semibold text-white">
        Episode {episode.episodeNumber} · {episode.title}
      </DialogTitle>
      <p className="mt-1 text-sm text-white/60">Choose an episode action.</p>
      <div className="mt-5 flex flex-col gap-3">
        {playable ? (
          <PrimaryPlayButton
            videoURL={episode.videoURL}
            mediaId={episode.mediaId}
            durationMs={episode.durationMs}
            playHref={episode.hrefs.play}
            watchHistory={episode.watchHistory}
            noun=""
            className="w-full"
          />
        ) : null}
        {completed ? null : (
          <button
            type="button"
            onClick={handleMark}
            disabled={pending}
            className={`${SECONDARY_CLASSES} justify-center disabled:cursor-wait disabled:opacity-60`}
          >
            {pending ? 'Marking…' : 'Mark watched'}
          </button>
        )}
        <button
          type="button"
          onClick={onClose}
          className="mt-1 self-center rounded text-sm text-white/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300"
        >
          Close
        </button>
      </div>
    </>
  )
}

/**
 * The centred "Episode 1 · Pilot — choose an episode action" modal the row's
 * "…" button opens: Play/Resume/Watch again, Mark watched (hidden once the
 * episode counts as watched) and Close. Focus is trapped and Escape closes
 * (Headless UI Dialog). One instance serves the whole list; the page passes
 * the active row's data or null.
 *
 * Mark watched posts the finished position through markWatched, which also
 * primes the local mirror, so the row behind the dialog flips to "Watched"
 * the moment it closes; `onMarked` lets the page refresh its server data.
 *
 * @param {{ open: boolean, episode: import('./EpisodeRow').EpisodeRowData|null, onClose: () => void, onMarked?: ((episode: Object) => void)|null }} props
 */
export default function EpisodeActionDialog({ open, episode, onClose, onMarked = null }) {
  const progress = useLiveProgress({
    watchHistory: episode?.watchHistory ?? null,
    mediaId: episode?.mediaId ?? null,
    videoURL: episode?.videoURL ?? null,
    durationMs: episode?.durationMs ?? null,
    enabled: Boolean(episode),
  })

  if (!episode) return null

  return (
    <Dialog open={open && Boolean(episode)} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/60 backdrop-blur-sm" />
      <div className="fixed inset-0 flex items-center justify-center p-4">
        <DialogPanel className="w-full max-w-sm rounded-2xl bg-[#0f1633] p-6 ring-1 ring-white/10 shadow-2xl">
          <DialogBody key={episode._id} episode={episode} completed={progress.completed} onClose={onClose} onMarked={onMarked} />
        </DialogPanel>
      </div>
    </Dialog>
  )
}
