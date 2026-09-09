'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Slider, SpinnerIcon } from './videojs'
import { getThumbnailStatus, overallProgress, subscribeThumbnailStatus } from './thumbnailStatus'

/**
 * The seek-bar thumbnail, honest about why there is no picture yet.
 *
 * The framework's <Slider.Thumbnail> marks its node `data-hidden` (no cue at
 * this time — usually "the VTT has not loaded"), `data-loading` (sprite image
 * in flight) and `data-error` (sprite image failed). Our sizing classes used
 * to draw a solid black box for all three. Now:
 *
 *   - while the VTT is loading or the backend is generating it → spinner and
 *     "Preparing previews" (after two minutes: "long films take a few minutes")
 *   - when the backend said the title can never have previews (404) → "No
 *     previews for this title", no spinner, no retries
 *   - when the backend failed (5xx) or retries are exhausted → "Previews
 *     unavailable", no spinner; a slow background retry may still recover it
 *   - a sprite image that fails is remounted on a backoff (the framework's
 *     loader short-circuits on an unchanged URL), then reported the same way
 *
 * The VTT verdict comes from the thumbnailStatus store, written by the
 * probe-driven retry in PlayerMedia.
 */

const IMAGE_RETRY_DELAYS_MS = [3_000, 6_000, 12_000, 24_000, 45_000, 60_000]
const MAX_IMAGE_RETRIES = 6
const LONG_WAIT_MS = 2 * 60_000

function copyFor(status, imageGaveUp, longWait) {
  if (imageGaveUp) return { spin: false, title: 'Previews unavailable', hint: null }
  if (status.state === 'generating' && status.step && status.totalSteps) {
    // The backend reports progress within the current step; show the
    // weighted overall so the bar moves the way the wait feels.
    const overall = overallProgress(status.step, status.totalSteps, status.progress)
    const pct = overall === null ? null : Math.round(overall * 100)
    // One short line each: the box can be as small as 120×80.
    const hint = status.message
      ? `${status.step}/${status.totalSteps} · ${status.message}`
      : `Step ${status.step} of ${status.totalSteps}`
    return { spin: true, title: 'Preparing previews', hint, progress: overall, pct }
  }
  switch (status.state) {
    case 'gone':
      return { spin: false, title: 'No previews', hint: 'for this title' }
    case 'failed':
    case 'network':
    case 'exhausted':
      return { spin: false, title: 'Previews unavailable', hint: null }
    case 'generating':
    case 'loading':
    case 'idle':
    default:
      return {
        spin: true,
        title: 'Preparing previews',
        hint: longWait ? 'Long films take a few minutes.' : null,
      }
  }
}

export default function ScrubPreview() {
  const nodeRef = useRef(null)
  const [attrs, setAttrs] = useState({ loading: false, error: false, hidden: true })
  // epoch = remount count = image retries so far; state, so render can read it.
  const [epoch, setEpoch] = useState(0)
  const status = useSyncExternalStore(subscribeThumbnailStatus, getThumbnailStatus, getThumbnailStatus)

  // A 1 Hz clock only while we are waiting, for the long-wait hint.
  const [now, setNow] = useState(0)
  const waiting = attrs.hidden && (status.state === 'loading' || status.state === 'generating' || status.state === 'idle')
  useEffect(() => {
    if (!waiting) return undefined
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waiting])

  // Mirror the framework's state attributes into React state.
  useEffect(() => {
    const node = nodeRef.current
    if (!node || typeof MutationObserver === 'undefined') return undefined
    const read = () =>
      setAttrs((prev) => {
        const next = {
          loading: node.hasAttribute('data-loading'),
          error: node.hasAttribute('data-error'),
          hidden: node.hasAttribute('data-hidden'),
        }
        return prev.loading === next.loading && prev.error === next.error && prev.hidden === next.hidden
          ? prev
          : next
      })
    const obs = new MutationObserver(read)
    obs.observe(node, { attributes: true, attributeFilter: ['data-loading', 'data-error', 'data-hidden'] })
    const id = setTimeout(read, 0)
    return () => {
      clearTimeout(id)
      obs.disconnect()
    }
  }, [epoch])

  // A failed sprite image: remount after a backoff so it is requested again.
  useEffect(() => {
    if (!attrs.error || epoch >= MAX_IMAGE_RETRIES) return undefined
    const t = setTimeout(() => setEpoch((n) => n + 1), IMAGE_RETRY_DELAYS_MS[Math.min(epoch, IMAGE_RETRY_DELAYS_MS.length - 1)])
    return () => clearTimeout(t)
  }, [attrs.error, epoch])

  const imageGaveUp = attrs.error && epoch >= MAX_IMAGE_RETRIES
  const showOverlay = attrs.hidden || attrs.loading || attrs.error
  const longWait = waiting && status.since > 0 && now - status.since > LONG_WAIT_MS
  const copy = showOverlay ? (attrs.loading && !attrs.hidden ? { spin: true, title: null, hint: null } : copyFor(status, imageGaveUp, longWait)) : null

  return (
    <div className="relative">
      {/* Reads the sprite VTT from the media's kind="metadata" label="thumbnails"
          track automatically (parses #xywh media fragments). */}
      <Slider.Thumbnail
        key={epoch}
        ref={nodeRef}
        className="block max-h-[160px] min-h-[80px] min-w-[120px] max-w-[180px] overflow-hidden border border-white bg-black/85"
      />
      {copy ? (
        <div
          role="status"
          data-thumbnail-state={status.state}
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-[3px] px-2 text-center font-sans text-white/85"
        >
          {copy.spin ? (
            <SpinnerIcon className="h-4 w-4 animate-spin" />
          ) : (
            <span aria-hidden="true" className="flex h-4 w-4 items-center justify-center rounded-full border border-white/70 text-[10px] font-semibold leading-none">
              !
            </span>
          )}
          {copy.title ? (
            <span className="max-w-full truncate text-[10px] font-semibold leading-tight">{copy.title}</span>
          ) : null}
          {copy.hint ? (
            <span className="max-w-full truncate text-[9px] leading-tight text-white/60">{copy.hint}</span>
          ) : null}
          {typeof copy.progress === 'number' ? (
            <span className="mt-[2px] flex w-[80%] items-center gap-1">
              <span
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(copy.progress * 100)}
                className="block h-[3px] flex-1 overflow-hidden rounded-full bg-white/20"
              >
                <span
                  className="block h-full rounded-full bg-white/85 transition-[width] duration-500"
                  style={{ width: `${Math.round(copy.progress * 100)}%` }}
                />
              </span>
              {typeof copy.pct === 'number' ? (
                <span className="text-[9px] tabular-nums leading-none text-white/70">{copy.pct}%</span>
              ) : null}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
