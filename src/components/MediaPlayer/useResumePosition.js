'use client'

import { useEffect, useState } from 'react'
import { fetchServerResume, pickResume, readLocalResume, resolveInitialResume } from './resumePosition'

/**
 * The position this mount of the player starts at.
 *
 * First mount and deep links resolve synchronously (see resumePosition.js).
 * A Next Activity RE-SHOW does not: the `savedPlaybackTime` prop is frozen
 * from the original server render, and the row may have moved on another
 * device since (the TV app, a Cast receiver, another tab). Resuming at the
 * frozen value and then heartbeating from it is exactly how a web tab used
 * to overwrite a newer TV position. So a re-show asks the server first, with
 * a short deadline, and picks the newer of the server row and this browser's
 * localStorage entry.
 *
 * `ready` is false only during that fetch; callers hold the player until it
 * flips, because the engine consumes the start position at load.
 *
 * @returns {{ ready: boolean, resumeAt: number|null }}
 */
export default function useResumePosition({
  remount,
  explicitStart,
  savedPlaybackTime,
  mediaId,
  videoURL,
  castingThisTitle,
}) {
  const needsFetch = remount && explicitStart === null && !castingThisTitle && Boolean(videoURL)

  const [state, setState] = useState(() => {
    if (castingThisTitle) return { ready: true, resumeAt: null }
    if (needsFetch) return { ready: false, resumeAt: null }
    return {
      ready: true,
      resumeAt: resolveInitialResume({ explicitStart, savedPlaybackTime, mediaId, videoURL }),
    }
  })

  useEffect(() => {
    if (!needsFetch) return undefined
    const controller = new AbortController()
    let settled = false
    const settle = (resumeAt) => {
      if (settled) return
      settled = true
      // A network answer arriving after the deadline (or after unmount) must
      // not move a player that already started.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ ready: true, resumeAt })
    }
    fetchServerResume(videoURL, { signal: controller.signal }).then((server) => {
      const local = readLocalResume({ mediaId, videoURL })
      if (server) {
        const picked = pickResume(server, local)
        settle(picked > 0 ? picked : server.completed ? 0 : null)
        return
      }
      // No answer: the frozen prop is still better than nothing, and
      // localStorage may be newer than it.
      const fallback = pickResume(
        Number.isFinite(savedPlaybackTime) && savedPlaybackTime > 0
          ? { playbackTime: savedPlaybackTime, lastUpdated: null }
          : null,
        local
      )
      settle(fallback > 0 ? fallback : null)
    })
    return () => {
      controller.abort()
    }
  }, [needsFetch, videoURL, mediaId, savedPlaybackTime])

  return state
}
