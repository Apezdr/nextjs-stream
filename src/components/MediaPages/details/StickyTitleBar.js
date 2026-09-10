'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { classNames } from '@src/utils'
import useWatchPosition from '@components/WatchProgress/useWatchPosition'
import PrimaryPlayButton from './PrimaryPlayButton'

/** Height of the site nav the bar tucks under. */
const NAV_HEIGHT_PX = 64

// Client-only mount flag, the same pattern GeneralLayout uses: the server
// snapshot is `false`, so SSR and the first client render agree on "nothing".
const subscribeOnce = (cb) => {
  cb()
  return () => {}
}
const useMounted = () => useSyncExternalStore(subscribeOnce, () => true, () => false)

/**
 * The slim bar that takes over once the hero scrolls out: title, a 2 px
 * progress line and the same Resume button, translucent over the fixed
 * backdrop. Watches the hero's action row (by id) so it appears exactly when
 * the real buttons leave the screen.
 *
 * Portaled to <body> so an animated ancestor (the route template) can never
 * turn `fixed` into "fixed inside a transform".
 *
 * @param {Object} props
 * @param {string} props.sentinelId - id of the element whose exit shows the bar
 * @param {string} props.title
 * @param {string|null} [props.subtitle]
 * @param {string|null} props.videoURL
 * @param {string|null} [props.mediaId]
 * @param {number|null} [props.durationMs]
 * @param {string} props.playHref
 */
export default function StickyTitleBar({ sentinelId, title, subtitle = null, videoURL, mediaId = null, durationMs = null, playHref }) {
  const mounted = useMounted()
  const [past, setPast] = useState(false)
  const { progress } = useWatchPosition({ videoURL, mediaId, durationMs })

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined
    const sentinel = document.getElementById(sentinelId)
    if (!sentinel) return undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        setPast(!entry.isIntersecting && entry.boundingClientRect.bottom < NAV_HEIGHT_PX)
      },
      { rootMargin: `-${NAV_HEIGHT_PX}px 0px 0px 0px`, threshold: 0 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [sentinelId])

  if (!mounted) return null

  const pct = Math.max(0, Math.min(100, progress.progressPercent || 0))

  return createPortal(
    <div
      className={classNames(
        'fixed inset-x-0 z-10 transition-[opacity,transform] duration-200 motion-reduce:transition-none',
        past ? 'translate-y-0 opacity-100' : 'pointer-events-none -translate-y-2 opacity-0'
      )}
      style={{ top: NAV_HEIGHT_PX }}
      aria-hidden={!past}
      inert={!past || undefined}
      data-testid="sticky-title-bar"
    >
      <div className="border-b border-white/10 bg-[#070b1d]/85 shadow-lg shadow-black/30 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-2 sm:px-6 lg:px-8">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white sm:text-base">
            {title}
            {subtitle ? <span className="font-normal text-white/60">: {subtitle}</span> : null}
          </p>
          <PrimaryPlayButton videoURL={videoURL} mediaId={mediaId} durationMs={durationMs} playHref={playHref} size="sm" />
        </div>
        <div className="h-0.5 w-full bg-white/10" aria-hidden="true">
          <div
            className={classNames('h-full transition-[width] duration-300', progress.completed ? 'bg-emerald-400' : 'bg-blue-500')}
            style={{ width: `${progress.hasProgress ? pct : 0}%` }}
          />
        </div>
      </div>
    </div>,
    document.body
  )
}
