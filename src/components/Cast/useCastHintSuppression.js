'use client'

import { useEffect, useState } from 'react'
import {
  getFramework,
  readCastSnapshot,
  clearCastHint,
  hintMatchesSource,
  castMatchesSource,
} from './castSdk'

/**
 * How long to believe the breadcrumb before giving up on it.
 *
 * Long enough for the SDK to be fetched and a session resumed on a cold load,
 * short enough that a stale hint only delays playback rather than blocking it.
 */
const SETTLE_TIMEOUT_MS = 6000

/**
 * Whether the local element should stay quiet because a previous session said
 * this title is playing on a television.
 *
 * On a full page load nothing can consult the Cast SDK — it has not been
 * fetched yet — so for the first second or so the page cannot tell a casting
 * title from an ordinary one, and autoplay starts the video underneath the
 * TV. The breadcrumb in localStorage is the only thing available synchronously
 * at that moment, so it is used to hold the element back.
 *
 * It is only ever a guess, and it expires two ways: as soon as the SDK is
 * loaded and reports no session for this title, or after a timeout if the SDK
 * never arrives at all. Both paths clear the hint and hand control back, so
 * the worst a stale breadcrumb can do is delay playback by a few seconds.
 *
 * @param {string} videoURL
 * @param {boolean} adopted - the SDK has confirmed the receiver has this title
 * @returns {boolean}
 */
export default function useCastHintSuppression(videoURL, adopted) {
  // Read once, at mount. During server rendering there is no localStorage, so
  // this is false there and only becomes true on the client — which is safe
  // precisely because nothing rendered depends on it, only an effect.
  const [suppressed, setSuppressed] = useState(() => hintMatchesSource(videoURL))

  useEffect(() => {
    if (!suppressed || adopted) return undefined

    let cancelled = false

    const release = () => {
      if (cancelled) return
      clearCastHint()
      setSuppressed(false)
    }

    // The SDK has arrived and disagrees. Note the test is "not THIS title",
    // not "nothing is casting": a session for some other title is still a
    // reason to let this page play normally, and checking only `active` would
    // leave the element muted for as long as anything was casting anything.
    const poll = setInterval(() => {
      if (!getFramework()) return
      if (!castMatchesSource(readCastSnapshot(), videoURL)) release()
    }, 500)

    // ...or it never arrived (a browser with no Cast support at all, which
    // should never have written a hint, but must not be left stuck if it did).
    const timeout = setTimeout(release, SETTLE_TIMEOUT_MS)

    return () => {
      cancelled = true
      clearInterval(poll)
      clearTimeout(timeout)
    }
  }, [suppressed, adopted, videoURL])

  // Once the SDK confirms adoption the guess is redundant, so it is simply
  // ignored rather than cleared — no state write, and the real signal wins.
  return suppressed && !adopted
}
