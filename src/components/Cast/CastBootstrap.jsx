'use client'

import { useEffect } from 'react'
import { readCastHint, clearCastHint, getContext, readCastSnapshot } from './castSdk'

/**
 * Loads the Cast SDK on pages that have no player, so a live session is still
 * visible after a full page load.
 *
 * The player framework fetches the SDK from exactly one place — its Cast
 * provider's `attach` — so on `/list` or the home page nothing has ever heard
 * of Google Cast. Refresh there while the television is playing and the app is
 * genuinely blind: the casting chip cannot appear, because no code on the page
 * is capable of knowing.
 *
 * Loading it unconditionally would put ~90KB on every page for every visitor,
 * most of whom never cast. So this waits for the breadcrumb left in
 * localStorage by a previous session. A stale breadcrumb costs one wasted
 * script fetch and is cleared the moment the SDK says there is no session; a
 * missing one just means the chip stays hidden until a player mounts, which is
 * the behaviour we already had.
 */

const SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'

let loading = null

/**
 * Inject the sender SDK once, resolving when `cast.framework` is usable.
 *
 * `__onGCastApiAvailable` is a single global that the SDK calls on load, and
 * the player framework assigns it unconditionally when the API is not yet
 * available. Whoever assigns last wins, so this chains onto whatever is already
 * there instead of overwriting it — otherwise a watch page mounting while this
 * fetch is in flight would silently never be told the SDK arrived.
 */
function loadCastSdk() {
  if (globalThis.cast?.framework) return Promise.resolve(true)
  if (loading) return loading

  loading = new Promise((resolve) => {
    const previous = globalThis.__onGCastApiAvailable
    globalThis.__onGCastApiAvailable = (available, reason) => {
      try {
        previous?.(available, reason)
      } catch {
        /* the other listener's problem, not ours */
      }
      resolve(Boolean(available) && Boolean(globalThis.cast?.framework))
    }

    // The framework's own loader early-returns on globalThis.chrome?.cast, so
    // whichever of us goes first, the script is only ever fetched once.
    if (document.querySelector(`script[src="${SDK_URL}"]`)) return

    const script = document.createElement('script')
    script.src = SDK_URL
    script.async = true
    script.onerror = () => resolve(false)
    document.head.appendChild(script)
  })

  return loading
}

export default function CastBootstrap({ receiverId }) {
  useEffect(() => {
    // Nothing to resume, or nowhere to resume it to.
    if (!receiverId || !readCastHint()) return undefined
    if (globalThis.cast?.framework) return undefined

    let cancelled = false

    // Deferred: a session that is already playing on a television is in no
    // hurry, and this must not compete with the page's own rendering.
    const start = () => {
      loadCastSdk().then((ok) => {
        if (cancelled || !ok) return

        const context = getContext()
        if (!context) return

        // The SAME receiver id is required for Chrome to rejoin a saved
        // session, which is why this is threaded down from the server rather
        // than defaulted.
        try {
          context.setOptions({
            receiverApplicationId: receiverId,
            autoJoinPolicy:
              globalThis.chrome?.cast?.AutoJoinPolicy?.ORIGIN_SCOPED ?? 'origin_scoped',
            resumeSavedSession: true,
            androidReceiverCompatible: false,
            language: 'en-US',
          })
        } catch (error) {
          console.error('[cast] setOptions failed', error)
          return
        }

        // Resumption is not instant. If nothing has appeared by the time it
        // would have, the breadcrumb was stale — drop it so the next page load
        // does not pay for this again.
        setTimeout(() => {
          if (!cancelled && !readCastSnapshot().active) clearCastHint()
        }, 8000)
      })
    }

    const idle = globalThis.requestIdleCallback
    const handle = idle ? idle(start, { timeout: 2000 }) : setTimeout(start, 300)

    return () => {
      cancelled = true
      if (idle && globalThis.cancelIdleCallback) globalThis.cancelIdleCallback(handle)
      else clearTimeout(handle)
    }
  }, [receiverId])

  return null
}
