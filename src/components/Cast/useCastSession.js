'use client'

import { useSyncExternalStore } from 'react'

// The Cast SDK is injected lazily by the player's <GoogleCast> component, so on
// a page that has never mounted a player `globalThis.cast` may not exist yet.
// Poll for it at this interval until it appears, then stop.
const SDK_POLL_MS = 2000

const EMPTY = Object.freeze({ active: false, deviceName: null, contentId: null, title: null })

function readSnapshot() {
  try {
    const context = globalThis.cast?.framework?.CastContext?.getInstance?.()
    const session = context?.getCurrentSession?.()
    if (!session) return EMPTY

    const mediaSession = session.getMediaSession?.()
    const media = mediaSession?.media
    return {
      active: true,
      deviceName: session.getCastDevice?.()?.friendlyName ?? null,
      contentId: media?.contentId ?? null,
      title: media?.metadata?.title ?? null,
    }
  } catch {
    return EMPTY
  }
}

// useSyncExternalStore compares snapshots by identity, so an object rebuilt on
// every read would loop forever. Cache and only swap when a field changes.
let cached = EMPTY

function getSnapshot() {
  const next = readSnapshot()
  if (
    next.active === cached.active &&
    next.deviceName === cached.deviceName &&
    next.contentId === cached.contentId &&
    next.title === cached.title
  ) {
    return cached
  }
  cached = next
  return cached
}

function subscribe(onChange) {
  let detachSdk = null
  let poll = null

  const attach = () => {
    const framework = globalThis.cast?.framework
    const context = framework?.CastContext?.getInstance?.()
    if (!context || !framework.CastContextEventType) return false

    const { SESSION_STATE_CHANGED, CAST_STATE_CHANGED } = framework.CastContextEventType
    // Session state covers start/resume/end; cast state covers the device
    // connecting. Media metadata arrives after the session starts, so also
    // listen for the session's own media updates where available.
    context.addEventListener(SESSION_STATE_CHANGED, onChange)
    context.addEventListener(CAST_STATE_CHANGED, onChange)
    detachSdk = () => {
      context.removeEventListener(SESSION_STATE_CHANGED, onChange)
      context.removeEventListener(CAST_STATE_CHANGED, onChange)
    }
    onChange()
    return true
  }

  if (!attach()) {
    poll = setInterval(() => {
      if (attach()) {
        clearInterval(poll)
        poll = null
      }
    }, SDK_POLL_MS)
  }

  return () => {
    if (poll) clearInterval(poll)
    detachSdk?.()
  }
}

/**
 * The live Google Cast session, read straight from the Cast SDK.
 *
 * Deliberately independent of the player framework. The SDK's CastContext is a
 * process-global singleton that outlives the player — sessions survive
 * navigation and page close by design, and the framework never ends one — so
 * anything that needs to know "is something casting right now" must ask the
 * SDK, not the player store. The store only knows about sessions the player
 * itself started, and goes stale the moment the player unmounts.
 *
 * @returns {{ active: boolean, deviceName: string|null, contentId: string|null, title: string|null }}
 */
export default function useCastSession() {
  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}

export function endCastSession() {
  try {
    // true = stop receiver playback as well, which is what "stop casting" means
    // to a user. false would merely detach this sender and leave the TV playing.
    globalThis.cast?.framework?.CastContext?.getInstance?.()?.endCurrentSession?.(true)
  } catch {
    /* no session, or the SDK never loaded */
  }
}
