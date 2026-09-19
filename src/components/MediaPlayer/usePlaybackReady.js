'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { NOT_READY, READINESS_EVENTS, readinessFrom } from './playbackReadiness'

/**
 * `{ canSeek, canTrack }` for the player's RAW media element — see
 * playbackReadiness.js for why neither is the store's `canPlay`.
 *
 * The element is reached through the host (`store.target.media.target`), the
 * same path the paused-heartbeat visibility check already uses. It is read
 * directly, never through the host's proxied getters, so neither the Cast
 * transport bridge's readyState cap nor the framework's component-override
 * chain can shape the answer. Cast isolation is applied explicitly through
 * `castAdopted` instead.
 *
 * An external subscription, so `useSyncExternalStore`: the element is not
 * attached when the store is created and the host can swap its target, so
 * the store's own change notifications double as the attach/detach signal —
 * `bind()` is an identity check and a no-op when nothing moved. Snapshots
 * are the frozen singletons from playbackReadiness.js, so an unchanged read
 * is referentially equal and does not re-render.
 *
 * @param {object|null} store - `Player.usePlayer()`
 * @param {{castAdopted?: boolean}} [opts]
 */
export default function usePlaybackReady(store, { castAdopted = false } = {}) {
  const subscribe = useCallback(
    (onChange) => {
      if (!store) return () => {}

      let el = null
      let unlisten = null

      const bind = () => {
        // `store.target` is { media, container } once attached, null before;
        // the real node hangs off the media host. Reading `store.target` is
        // safe pre-attach; reading store STATE is not (NO_TARGET).
        const node = store.target?.media?.target ?? null
        if (node !== el) {
          unlisten?.()
          unlisten = null
          el = node
          if (el && typeof el.addEventListener === 'function') {
            const ac = new AbortController()
            for (const type of READINESS_EVENTS) {
              el.addEventListener(type, onChange, { signal: ac.signal })
            }
            unlisten = () => ac.abort()
          }
        }
        onChange()
      }

      bind()
      const unsubscribe = store.subscribe(bind)

      return () => {
        unsubscribe()
        unlisten?.()
      }
    },
    [store]
  )

  const getSnapshot = useCallback(
    () => readinessFrom(store?.target?.media?.target ?? null, { castAdopted }),
    [store, castAdopted]
  )

  const getServerSnapshot = useCallback(() => NOT_READY, [])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
