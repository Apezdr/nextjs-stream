'use client'

import { useEffect } from 'react'
import { Player } from './videojs'

// Positions below this are "the start", not somewhere the viewer had reached.
const MEANINGFUL_POSITION_S = 1
// How close to zero counts as "the provider reset us to the beginning".
const RESET_EPSILON_S = 0.5
// A receiver position this far from where we handed off is real remote
// progress, which makes the receiver's position the authoritative one.
const REMOTE_PROGRESS_DELTA_S = 1
// How long a restore stays re-appliable if the element gets reloaded under it.
const RESTORE_WINDOW_MS = 4000

/**
 * Keeps local playback where it was when a Cast session ends without the
 * receiver ever having played.
 *
 * The Cast provider's #disconnect() writes `savedPlayerState.currentTime` onto
 * the local <video>, calls play(), and copies the receiver's mute state over.
 * When a session is cancelled before the receiver loads media that saved time
 * is 0 — the Cast SDK snapshots the RemotePlayer whenever a connection ends,
 * with no isMediaLoaded condition — so the element is dragged to the start,
 * force-played there, and possibly unmuted.
 *
 * This listens on the media host's `remote`, whose 'disconnect' event the
 * provider dispatches SYNCHRONOUSLY one line after those writes: earlier than
 * the store's microtask flush, than React, and than the element's own seeking
 * task. The element is therefore read and repaired in the same stack as the
 * damage. An earlier version of this guard watched the store's
 * remotePlaybackState and seeked via the store on a setTimeout — it always ran
 * too late and read a mirror that hadn't been updated yet.
 */
export default function CastResumeGuard() {
  const media = Player.useMedia()

  useEffect(() => {
    const remote = media?.remote
    if (!media || typeof remote?.addEventListener !== 'function') return undefined

    // Where local playback was when we handed off, plus the element flag
    // #disconnect() clobbers on the way back.
    let snapshot = null
    // Last position the RECEIVER reported (not the local echo) this session.
    let remoteTime = null
    // { time, expiresAt } while a restore may still need re-applying.
    let latch = null

    // Safe at both 'connecting' and 'connect': nothing during a cast session
    // touches the local element's position — the provider only pauses it. The
    // sole positional write is in #disconnect().
    const onConnecting = () => {
      const target = media.target
      if (!target) return
      snapshot = { time: target.currentTime, muted: target.muted }
      remoteTime = null
      latch = null
    }

    // While casting the local element is paused, so a timeupdate here is the
    // provider re-dispatching the receiver's CURRENT_TIME_CHANGED. Reading
    // media.currentTime then goes through the provider's override and returns
    // the RECEIVER's position; before the receiver loads it returns the frozen
    // local echo. The paused gate rejects local timeupdates fired while the
    // device picker is open and local playback is still running.
    const onTimeUpdate = () => {
      const target = media.target
      if (!snapshot || !target || !target.paused) return
      remoteTime = media.currentTime
    }

    const remoteIsAuthoritative = (handoffTime) =>
      remoteTime !== null && Math.abs(remoteTime - handoffTime) > REMOTE_PROGRESS_DELTA_S

    const onDisconnect = () => {
      const target = media.target
      const taken = snapshot
      snapshot = null
      remoteTime = null
      if (!target || !taken) return

      // Nothing worth protecting — the viewer was at the start anyway.
      if (taken.time <= MEANINGFUL_POSITION_S) return

      // #disconnect() has already run; this is savedPlayerState.currentTime.
      // A real receiver position wins, and so does the mute state it carried.
      if (target.currentTime > RESET_EPSILON_S) return

      // The receiver reported a position of its own and it is ~0: someone
      // deliberately took the remote back to the start. Also authoritative.
      if (remoteIsAuthoritative(taken.time)) return

      target.currentTime = taken.time
      target.muted = taken.muted
      latch = { time: taken.time, expiresAt: performance.now() + RESTORE_WINDOW_MS }
    }

    // The other way the position can be lost: a full reload (the provider's
    // load() reaches target.load() when requestSession resolves after the
    // session already ended, and the native host re-assigns target.src).
    // A reload fires emptied -> loadstart -> loadedmetadata and resets to 0,
    // swallowing the write above. Re-applying here is by definition after
    // metadata, so unlike a pre-metadata seek it cannot be discarded.
    const onLoadedMetadata = () => {
      const target = media.target
      if (!latch || !target) return
      if (performance.now() > latch.expiresAt) {
        latch = null
        return
      }
      if (target.currentTime <= RESET_EPSILON_S) target.currentTime = latch.time
      latch = null
    }

    // A seek to somewhere other than where we just put things means the user
    // deliberately moved the position — stand down rather than fight it. A
    // reload never fires 'seeking', so this cannot disarm the defence above.
    const onSeeking = () => {
      const target = media.target
      if (!latch || !target) return
      if (Math.abs(target.currentTime - latch.time) > RESET_EPSILON_S) latch = null
    }

    // The provider dispatches its synthetic media events on the raw element,
    // while ordinary playback events surface on both it and the host. Listen
    // on each (handlers are idempotent) so neither source can be missed.
    const mediaTargets = [media, media.target].filter(
      (t, i, all) => t && typeof t.addEventListener === 'function' && all.indexOf(t) === i
    )

    remote.addEventListener('connecting', onConnecting)
    remote.addEventListener('connect', onConnecting)
    remote.addEventListener('disconnect', onDisconnect)
    for (const t of mediaTargets) {
      t.addEventListener('timeupdate', onTimeUpdate)
      t.addEventListener('loadedmetadata', onLoadedMetadata)
      t.addEventListener('seeking', onSeeking)
    }

    return () => {
      remote.removeEventListener('connecting', onConnecting)
      remote.removeEventListener('connect', onConnecting)
      remote.removeEventListener('disconnect', onDisconnect)
      for (const t of mediaTargets) {
        t.removeEventListener('timeupdate', onTimeUpdate)
        t.removeEventListener('loadedmetadata', onLoadedMetadata)
        t.removeEventListener('seeking', onSeeking)
      }
      snapshot = null
      remoteTime = null
      latch = null
    }
  }, [media])

  return null
}
