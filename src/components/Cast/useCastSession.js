'use client'

import { useSyncExternalStore } from 'react'
import {
  subscribeCast,
  readCastSnapshot,
  castMatchesSource,
  isEnding,
  endCastSession as endSession,
  EMPTY_CAST_SNAPSHOT,
} from './castSdk'

// useSyncExternalStore compares snapshots by identity, so an object rebuilt on
// every read would loop forever. Cache and only swap when a field changes.
let cached = EMPTY_CAST_SNAPSHOT

const FIELDS = ['active', 'connecting', 'mediaLoaded', 'deviceName', 'contentId', 'contentUrl', 'title']

function getSnapshot() {
  const read = readCastSnapshot()
  // A stop that has been requested but not yet acknowledged reads as inactive,
  // so the UI follows the click instead of the network.
  const next = read.active && isEnding() ? { ...read, active: false } : read

  if (FIELDS.every((key) => next[key] === cached[key])) return cached
  cached = next
  return cached
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
 * @returns {{ active: boolean, connecting: boolean, mediaLoaded: boolean,
 *             deviceName: string|null, contentId: string|null,
 *             contentUrl: string|null, title: string|null }}
 */
export default function useCastSession() {
  return useSyncExternalStore(subscribeCast, getSnapshot, () => EMPTY_CAST_SNAPSHOT)
}

/**
 * The same session, plus whether the receiver is playing this exact title.
 *
 * One definition of adoption for every consumer — the overlay and the player
 * previously each compared contentId themselves and could disagree.
 */
export function useCastAdoption(videoURL) {
  const session = useCastSession()
  return { ...session, adopted: castMatchesSource(session, videoURL) }
}

export function endCastSession() {
  endSession()
}
