'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { EyeIcon } from '@heroicons/react/20/solid'
import useIsAdminAfterHydration from '../useIsAdminAfterHydration'

// The dialog (and its request) loads on the first click, not with the page
const WatchedByDialog = dynamic(() => import('./WatchedByDialog'), { ssr: false })

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300'

/**
 * "Watched by N people". Everyone sees the text; for an admin it is a button
 * that opens the list of who watched. The admin check runs after hydration
 * (useIsAdminAfterHydration), since the page is cached for every viewer.
 *
 * @param {Object} props
 * @param {number} props.count - from the server's count; the dialog lists the same rows
 * @param {string} props.normalizedVideoId
 * @param {string|null} [props.mediaId]
 * @param {number|null} [props.durationMs] - turns each viewer's position into a percentage
 * @param {string} props.title - the title's display name, for the dialog's heading
 * @param {string} [props.wordsClassName] - on the "Watched by" words, e.g. to hide them visually in a narrow column
 */
export default function WatchedByButton({ count, normalizedVideoId, mediaId = null, durationMs = null, title, wordsClassName = '' }) {
  const isAdmin = useIsAdminAfterHydration()
  const [open, setOpen] = useState(false)
  // Mount the dialog on first open and keep it, so reopening shows the list at once
  const [mounted, setMounted] = useState(false)

  // One text run, so the space after "Watched by" survives the flex layout
  const content = (
    <>
      <EyeIcon className="size-4 shrink-0" aria-hidden="true" />
      <span>
        <span className={wordsClassName}>Watched by </span>
        {count} {count === 1 ? 'person' : 'people'}
      </span>
    </>
  )

  if (!isAdmin) return <span className="inline-flex items-center gap-1.5">{content}</span>

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMounted(true)
          setOpen(true)
        }}
        aria-haspopup="dialog"
        className={`inline-flex items-center gap-1.5 rounded underline decoration-white/30 underline-offset-4 transition-colors hover:text-white hover:decoration-white/70 ${FOCUS_RING}`}
      >
        {content}
      </button>
      {mounted ? (
        <WatchedByDialog
          open={open}
          onClose={() => setOpen(false)}
          title={title}
          normalizedVideoId={normalizedVideoId}
          mediaId={mediaId}
          durationMs={durationMs}
        />
      ) : null}
    </>
  )
}
