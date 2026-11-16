'use client'

import { useEffect, useRef, useState } from 'react'
import { fetchServerResume, resolveResume } from './resumePosition'

/**
 * The position this mount of the player starts at (see resumePosition.js for
 * the order).
 *
 * An explicit `?start=` resolves at once. Every other mount asks the server
 * first, with a short deadline: the `savedPlaybackTime` prop is as old as the
 * page's render, and the row may have moved on another device since (the TV
 * app, a Cast receiver, another tab). When no answer comes in time the mount
 * starts from what the page knew: where its own player last was
 * (`getLastKnownPosition`, when the page has played before), else the prop.
 *
 * `ready` is false only while it asks; callers hold the player until it
 * flips, because the engine consumes the start position at load.
 *
 * While a receiver has the title the position is the television's: nothing
 * is asked, and `resumeAt` is null.
 *
 * @param {Object} options
 * @param {number|null} options.explicitStart - from `?start=` (parseExplicitStart)
 * @param {number|null} options.savedPlaybackTime - the position the page was rendered with
 * @param {string|null} options.mediaId - the title's durable id
 * @param {string|null} options.videoURL
 * @param {boolean} options.castingThisTitle
 * @param {string|null} options.userId - the user the page was rendered for, whom the request names
 * @param {(() => number|null)|null} [options.getLastKnownPosition] - where this page's player last was; read when the answer is in, never during render
 * @returns {{ ready: boolean, resumeAt: number|null }}
 */
export default function useResumePosition({
  explicitStart,
  savedPlaybackTime,
  mediaId,
  videoURL,
  castingThisTitle,
  userId,
  getLastKnownPosition = null,
}) {
  const asks = explicitStart === null && !castingThisTitle && Boolean(videoURL)

  const [state, setState] = useState(() => {
    if (castingThisTitle) return { ready: true, resumeAt: null }
    if (asks) return { ready: false, resumeAt: null }
    return { ready: true, resumeAt: resolveResume({ explicitStart }) }
  })

  // Read when the answer is in: whether a receiver has the title by then, and
  // where the page's player last was. Neither restarts the asking.
  const castingRef = useRef(castingThisTitle)
  const lastKnownRef = useRef(getLastKnownPosition)
  useEffect(() => {
    castingRef.current = castingThisTitle
    lastKnownRef.current = getLastKnownPosition
  })

  useEffect(() => {
    if (!asks) return undefined
    const controller = new AbortController()
    let settled = false
    const settle = (resumeAt) => {
      if (settled) return
      settled = true
      // A network answer arriving after the deadline (or after unmount) must
      // not move a player that already started.
      setState({ ready: true, resumeAt })
    }
    fetchServerResume({ videoURL, mediaId, userId }, { signal: controller.signal }).then((answer) => {
      // A cast adopted the title while this asked (the request was aborted,
      // and resolves as unavailable): the position is the television's
      if (castingRef.current) return settle(null)
      settle(resolveResume({ answer, savedPlaybackTime, lastKnownPosition: lastKnownRef.current?.() ?? null }))
    })
    return () => {
      controller.abort()
    }
  }, [asks, videoURL, mediaId, userId, savedPlaybackTime])

  return state
}
