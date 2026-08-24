'use client'

/**
 * The one place that talks to the Google Cast sender SDK.
 *
 * No React, no @videojs/* imports — this is a plain observable over
 * `globalThis.cast`, so the hook above it stays trivial and every consumer sees
 * one consistent answer to "is something casting, and what".
 *
 * Two facts about the SDK shape everything here, both read off the shipping
 * implementation (gstatic cast_framework.js, which is injected at runtime and
 * is not in node_modules):
 *
 *   1. `getCurrentSession()` LAGS the session-ended events. Teardown is
 *      literally `X(this,"SESSION_ENDED"); this.ma=this.h.bb; this.h=null;` —
 *      the dispatch happens inside X(), and the current session is cleared on
 *      the next statement. Both CastContext events therefore fire while
 *      getCurrentSession() still returns the dying session, and nothing is
 *      dispatched afterwards. Anything deriving "casting" from that getter
 *      latches on forever. `castState` does not lag: X() assigns it before
 *      dispatching. So castState is the source of truth here.
 *
 *   2. A RemotePlayerController BINDS TO A LIVE SESSION AT CONSTRUCTION:
 *      `(a = a.h) ? vb(this, a.i) : this.D()`. Construct the pair while a
 *      session exists and it is populated synchronously — device name, media
 *      info, duration, position — with no event to wait for. That is what makes
 *      returning to a casting page correct on the first render instead of a
 *      beat later, and it is the only surface that reports `isConnected` AFTER
 *      the session pointer is cleared.
 */

const SDK_POLL_MS = 2000

const EMPTY = Object.freeze({
  active: false,
  connecting: false,
  mediaLoaded: false,
  deviceName: null,
  contentId: null,
  contentUrl: null,
  title: null,
})

export function getFramework() {
  try {
    return globalThis.cast?.framework ?? null
  } catch {
    return null
  }
}

export function getContext() {
  try {
    return getFramework()?.CastContext?.getInstance?.() ?? null
  } catch {
    return null
  }
}

/**
 * The document's single RemotePlayer/RemotePlayerController pair.
 *
 * Deliberately created once and never destroyed: CAF exposes no disposal for
 * it, and one pair per document is bounded (the player framework already
 * constructs its own per mount). Listeners are a different matter — CAF does
 * not dedupe handlers, so every listener added must be removed by whoever added
 * it. See addRemoteListeners.
 */
let pair = null
// Keyed to the framework object that produced it: if `globalThis.cast` is ever
// replaced, the old pair is bound to a CastContext that no longer exists and
// would report a session that is not there.
let pairFramework = null

export function getRemote() {
  const framework = getFramework()
  if (!framework?.RemotePlayer || !framework?.RemotePlayerController) return null
  if (!pair || pairFramework !== framework) {
    try {
      const player = new framework.RemotePlayer()
      // Constructing the controller is what binds `player` to any live session
      // and assigns `player.controller` — the return value is intentionally
      // unused.
      new framework.RemotePlayerController(player)
      pair = { player, controller: player.controller }
      pairFramework = framework
    } catch {
      pair = null
      pairFramework = null
      return null
    }
  }
  return pair
}

/**
 * Whether a stop was requested and has not yet been acknowledged.
 *
 * endCurrentSession() is fire-and-forget with a no-op error callback over a
 * bridge message that times out after 3s, so a TV that is asleep or off the
 * network produces no event and no state change at all. This makes the UI obey
 * the click immediately, and the verification pass below makes it honest again
 * if the stop never actually happened.
 */
let endingUntil = 0

export function isEnding() {
  return Date.now() < endingUntil
}

/** The live cast state. Never derived from getCurrentSession() truthiness. */
export function readCastSnapshot() {
  try {
    const framework = getFramework()
    const context = getContext()
    if (!framework || !context) return EMPTY

    const castState = context.getCastState?.() ?? null
    const player = getRemote()?.player
    // Display fields only — never the liveness decision.
    const session = context.getCurrentSession?.()
    const info = player?.mediaInfo ?? session?.getMediaSession?.()?.media ?? null

    return {
      active: castState === framework.CastState?.CONNECTED,
      connecting: castState === framework.CastState?.CONNECTING,
      mediaLoaded: Boolean(player?.isMediaLoaded),
      // The DEVICE, not the receiver application. RemotePlayer.displayName is
      // copied straight from session.displayName, which is the name of the Cast
      // app — so it reads "Adam Cinema - Local" rather than the television it is
      // playing on, which is the one thing a person actually wants to be told.
      // getCastDevice() returns a chrome.cast.Receiver, whose friendlyName is
      // the device. There is deliberately no fallback to the app name: with no
      // device name the UI says plain "Casting", which is at least true.
      deviceName: session?.getCastDevice?.()?.friendlyName || null,
      contentId: info?.contentId ?? null,
      contentUrl: info?.contentUrl ?? null,
      title: player?.title || info?.metadata?.title || null,
    }
  } catch {
    return EMPTY
  }
}

function canonical(url) {
  try {
    return new URL(url, globalThis.location?.href).href
  } catch {
    return url || ''
  }
}

/**
 * Whether the receiver is playing this exact source.
 *
 * Both contentId and contentUrl are checked because our own receiver's LOAD
 * interceptor can replace `loadRequestData.media` wholesale for an id-style
 * source, which does not preserve contentId. Comparison is on absolute URLs so
 * a relative src and the absolute one the receiver echoes back still match.
 */
export function castMatchesSource(snapshot, url) {
  if (!url || !snapshot?.active) return false
  const want = canonical(url)
  return [snapshot.contentId, snapshot.contentUrl].some(
    (value) => value && (value === url || canonical(value) === want)
  )
}

/**
 * A breadcrumb in localStorage saying "this browser was casting X".
 *
 * A full page load starts with no Cast SDK at all — it is fetched lazily — so
 * for the first moment nothing on the page can know a session exists, however
 * the code is arranged. Chrome does resume the session by itself (the framework
 * asks for `resumeSavedSession` with an origin-scoped auto-join policy), but
 * only after the script arrives and the handshake completes. That gap is why a
 * reloaded watch page flashes a second of video from the beginning before
 * standing down, and why the casting chip cannot exist at all on a page that
 * never mounts a player.
 *
 * This closes both: it is the one thing that survives a reload synchronously,
 * so the first render can suppress autoplay, and any page can decide whether
 * loading the ~90KB Cast SDK is worth it.
 *
 * It is a HINT, never a source of truth. It can be stale — the session may have
 * ended while the tab was closed — so everything that reads it must recover
 * gracefully when the SDK later says otherwise, and clear it when it does.
 */
const HINT_KEY = 'cast:last-session'
const HINT_TTL_MS = 12 * 60 * 60 * 1000

export function readCastHint() {
  try {
    const raw = globalThis.localStorage?.getItem(HINT_KEY)
    if (!raw) return null
    const hint = JSON.parse(raw)
    if (!hint?.at || Date.now() - hint.at > HINT_TTL_MS) {
      clearCastHint()
      return null
    }
    return hint
  } catch {
    return null
  }
}

export function clearCastHint() {
  try {
    globalThis.localStorage?.removeItem(HINT_KEY)
  } catch {
    /* storage unavailable or full */
  }
}

/** Mirror the current snapshot into the hint. Called whenever cast state moves. */
function persistCastHint(snapshot) {
  try {
    if (!snapshot?.active) {
      // Authoritative: the SDK is loaded and says nothing is casting.
      clearCastHint()
      return
    }
    globalThis.localStorage?.setItem(
      HINT_KEY,
      JSON.stringify({
        contentId: snapshot.contentId,
        contentUrl: snapshot.contentUrl,
        deviceName: snapshot.deviceName,
        title: snapshot.title,
        at: Date.now(),
      })
    )
  } catch {
    /* storage unavailable or full */
  }
}

/** Whether the hint names this exact source, for a first-render decision. */
export function hintMatchesSource(url) {
  const hint = readCastHint()
  if (!hint || !url) return false
  return castMatchesSource({ ...hint, active: true }, url)
}

// Every mounted consumer's onChange, so a stop can notify them all at once
// rather than waiting for an SDK event that may never come.
const subscribers = new Set()

function notifyAll() {
  for (const fn of subscribers) {
    try {
      fn()
    } catch {
      /* one bad subscriber must not stop the rest */
    }
  }
}

/**
 * Subscribe to everything that can change the snapshot.
 *
 * The two CastContext events carry availability and the fresh cast state; the
 * RemotePlayer events are what report media info arriving after a session
 * starts (which no CastContext event does) and connection loss after the
 * session pointer is cleared.
 *
 * Position and volume events are deliberately NOT subscribed: they fire about
 * once a second and would re-render every consumer on a timer. Anything that
 * needs live position reads it imperatively.
 */
export function subscribeCast(onChange) {
  subscribers.add(onChange)

  let detach = null
  let poll = null

  const attach = () => {
    const framework = getFramework()
    const context = getContext()
    if (!context || !framework?.CastContextEventType) return false

    // Every state change updates the breadcrumb before waking React, so the
    // hint is written by the SDK's own events rather than during a render.
    const notify = () => {
      persistCastHint(readCastSnapshot())
      onChange()
    }

    const { SESSION_STATE_CHANGED, CAST_STATE_CHANGED } = framework.CastContextEventType
    context.addEventListener(SESSION_STATE_CHANGED, notify)
    context.addEventListener(CAST_STATE_CHANGED, notify)

    const remote = getRemote()
    const remoteEvents = []
    if (remote && framework.RemotePlayerEventType) {
      const {
        IS_CONNECTED_CHANGED,
        IS_MEDIA_LOADED_CHANGED,
        MEDIA_INFO_CHANGED,
        TITLE_CHANGED,
        DISPLAY_NAME_CHANGED,
      } = framework.RemotePlayerEventType
      for (const type of [
        IS_CONNECTED_CHANGED,
        IS_MEDIA_LOADED_CHANGED,
        MEDIA_INFO_CHANGED,
        TITLE_CHANGED,
        DISPLAY_NAME_CHANGED,
      ]) {
        if (!type) continue
        remote.controller.addEventListener(type, notify)
        remoteEvents.push(type)
      }
    }

    detach = () => {
      context.removeEventListener(SESSION_STATE_CHANGED, notify)
      context.removeEventListener(CAST_STATE_CHANGED, notify)
      for (const type of remoteEvents) {
        try {
          remote.controller.removeEventListener(type, notify)
        } catch {
          /* controller already gone */
        }
      }
    }

    notify()
    return true
  }

  if (!attach()) {
    // The SDK is injected lazily by the player, so a page that has never
    // mounted one has no globalThis.cast yet.
    poll = setInterval(() => {
      if (attach()) {
        clearInterval(poll)
        poll = null
      }
    }, SDK_POLL_MS)
  }

  return () => {
    subscribers.delete(onChange)
    if (poll) clearInterval(poll)
    detach?.()
  }
}

/**
 * Stop casting: halt playback on the receiver and end the session.
 *
 * The optimistic window is not cosmetic. endCurrentSession() hands a message to
 * the browser with both callbacks set to no-ops; if the receiver never acks,
 * no event fires and nothing anywhere changes. So the UI follows the click, and
 * a verification pass restores the truth — chip back, plus a console error —
 * rather than leaving a Stop button that silently did nothing.
 */
export function endCastSession() {
  const context = getContext()
  if (!context?.getCurrentSession?.()) {
    notifyAll()
    return
  }

  // Slightly longer than chrome.cast.timeout.stopSession (3000ms).
  endingUntil = Date.now() + 3500
  notifyAll()

  try {
    context.endCurrentSession(true)
  } catch (error) {
    console.error('[cast] endCurrentSession threw', error)
  }

  // Re-check as the ack should be arriving, then once past the timeout.
  setTimeout(notifyAll, 500)
  setTimeout(notifyAll, 1500)
  setTimeout(() => {
    endingUntil = 0
    if (readCastSnapshot().active) {
      console.error('[cast] stop was never acknowledged by the receiver')
    }
    notifyAll()
  }, 3600)
}

export { EMPTY as EMPTY_CAST_SNAPSHOT }
