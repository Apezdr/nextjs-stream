'use client'

import { useEffect, useRef } from 'react'
import useCastSession from './useCastSession'
import { getRemote, readFinalRemotePosition } from './castSdk'

/**
 * Reports the receiver's position while a Cast session is live.
 *
 * This closes the zero-writer gap: during a session the receiver's own
 * reporter stands down (a sender is connected), and the page's tracker stands
 * down (it is mirroring, not playing) — so nothing anywhere recorded progress,
 * and every restore source in the app froze at the moment casting started.
 * Stopping a cast then "rewound" to that frozen position, and Continue
 * Watching sat still for the whole session.
 *
 * It lives at the chip level, beside CastSessionBar, deliberately: the session
 * outlives any page, so its reporter must too. The SDK singleton has the
 * position on every route — no player required.
 *
 * The write goes through the session-authed updatePlayback route with
 * source: 'cast-mirror', which the server maps to the guarded CAST writer, not
 * the client one. That matters twice over. The mirror reports a position it is
 * not rendering — the definition of the cast writer — and stamping 'cast'
 * means the receiver's own reports pass the ordering guard unconditionally the
 * moment the tab closes, including a legitimate rewind on the TV remote. It
 * also sends no metadata at all: the guarded writer spreads nothing, so the
 * row's grouping fields survive, where the default path would null them.
 *
 * Never queues, never retries — a failed report is dropped and the next tick
 * carries a freshly read position. Same rule as the receiver, same reason.
 */

const TICK_MS = 15000
/** Below this the position is "the start", never worth persisting. */
const MIN_POSITION_S = 2
/** Movement smaller than this with no pause flip is not worth a write. */
const MIN_DELTA_S = 1

function postPosition({ videoId, playbackTime, isPaused, keepalive = false }) {
  return fetch('/api/authenticated/sync/updatePlayback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    keepalive,
    body: JSON.stringify({
      videoId,
      playbackTime,
      isPaused,
      source: 'cast-mirror',
    }),
  }).catch(() => {
    /* dropped on purpose — the next tick carries a fresher position */
  })
}

/** Keep the local restore paths in agreement with what the TV has reached. */
function writeLocalPosition(videoId, playbackTime) {
  try {
    globalThis.localStorage?.setItem(
      videoId,
      JSON.stringify({ playbackTime, lastUpdated: new Date().toISOString() })
    )
  } catch {
    /* storage unavailable or full */
  }
}

export default function CastPositionMirror() {
  const { active, ending, mediaLoaded, contentUrl, contentId } = useCastSession()
  const videoId = contentUrl || contentId || null

  // What was last sent, to skip writes that say nothing new.
  const lastSentRef = useRef(null)
  // Whether a session was live, so its end can be told apart from never-started.
  const hadSessionRef = useRef(false)

  // The periodic mirror.
  useEffect(() => {
    if (!active || !mediaLoaded || !videoId) return undefined

    hadSessionRef.current = true

    const tick = () => {
      const player = getRemote()?.player
      if (!player?.isMediaLoaded) return

      const time = player.currentTime
      if (!Number.isFinite(time) || time <= MIN_POSITION_S) return

      const isPaused = player.isPaused === true
      const last = lastSentRef.current
      if (last && Math.abs(time - last.time) < MIN_DELTA_S && last.isPaused === isPaused) return

      lastSentRef.current = { time, isPaused }
      writeLocalPosition(videoId, time)
      postPosition({ videoId, playbackTime: time, isPaused })
    }

    tick()
    const interval = setInterval(tick, TICK_MS)
    return () => clearInterval(interval)
  }, [active, mediaLoaded, videoId])

  // The final flush. By the time React sees the session end, teardown has
  // already zeroed the RemotePlayer, so the position comes from the recorder in
  // castSdk — which carries its own content identity, because mediaInfo is
  // gone too.
  useEffect(() => {
    // Only a session that was actually live gets a final flush — a page that
    // mounted with no session has nothing to say.
    if (active || !hadSessionRef.current) return

    hadSessionRef.current = false
    lastSentRef.current = null

    const final = readFinalRemotePosition()
    if (!final || final.time <= MIN_POSITION_S) return

    const finalId = final.contentUrl || final.contentId
    if (!finalId) return

    writeLocalPosition(finalId, final.time)
    postPosition({
      videoId: finalId,
      playbackTime: final.time,
      isPaused: true,
      keepalive: true,
    })
  }, [active, ending])

  return null
}
