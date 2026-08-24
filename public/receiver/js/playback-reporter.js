'use strict'

/**
 * Receiver-side playback reporting.
 *
 * A Cast session outlives the page that started it — close the tab and the
 * television plays on — but until now nothing recorded where you got to once
 * the sender was gone. Finish a film on the TV after closing the browser and
 * Continue Watching still showed the position from the moment you navigated
 * away. This module closes that window from the receiver's own side.
 *
 * Two rules do most of the work:
 *
 *  - Exactly one writer at a time. While any sender is connected, the sender is
 *    reporting already (the Cast provider re-dispatches the receiver's
 *    CURRENT_TIME_CHANGED as a local timeupdate, so the web player's tracker
 *    keeps writing throughout a session). This module stays silent until the
 *    last sender leaves, then takes over. No coordination channel needed.
 *
 *  - Never queue, never retry. A failed report is dropped; the next tick reads
 *    a fresh position. A retry queue would eventually deliver a position the
 *    user has long since moved past, which is the one failure mode that
 *    actually damages watch history.
 *
 * Authentication is a Cast Playback Token minted for one user and one title
 * (see src/lib/castPlaybackToken.ts), delivered in the LOAD request's
 * customData. No token means no reporting — which is exactly what happens for a
 * signed-out or unapproved sender, so guest casting works and records nothing.
 */

const REPORT_URL = '/api/cast/playback'

/** How often the heartbeat wakes up. Reporting is rate-limited separately. */
const TICK_MS = 5000
/** Minimum gap between reports while playing. */
const REPORT_INTERVAL_PLAYING_MS = 15000
/** Minimum gap while paused — the position is not moving, so this is a keepalive. */
const REPORT_INTERVAL_PAUSED_MS = 120000
/**
 * Positions below this are never worth persisting. Mirrors
 * MIN_PERSISTED_POSITION_S in src/components/MediaPlayer/WithPlaybackTracker.js
 * so both writers agree on what counts as "started watching".
 */
const MIN_POSITION_S = 2
/**
 * Grace period after the last sender disconnects, so the sender's own final
 * write lands before this one does and the ordering guard sees them in order.
 */
const TAKEOVER_GRACE_MS = 5000

/**
 * A LOAD request rendered for the debug overlay with customData VALUES
 * withheld. customData carries the playback token, and the overlay paints it on
 * a television and mirrors it into the Cast Developer Console. Which keys
 * arrived is the whole diagnostic; their contents never were.
 *
 * @param {cast.framework.messages.LoadRequestData} req
 * @return {string}
 */
export function redactLoadRequest(req) {
  try {
    const media = req?.media || {}
    return JSON.stringify({
      contentId: media.contentId,
      contentUrl: media.contentUrl,
      contentType: media.contentType,
      streamType: media.streamType,
      entity: media.entity,
      currentTime: req?.currentTime,
      autoplay: req?.autoplay,
      tracks: Array.isArray(media.tracks) ? media.tracks.length : 0,
      customData: Object.keys(req?.customData || {}),
      mediaCustomData: Object.keys(media.customData || {}),
    })
  } catch (err) {
    return `<unserializable load request: ${err}>`
  }
}

/**
 * Start reporting. Call once, before context.start(), so the listeners exist
 * for the very first LOAD.
 *
 * @param {Object} deps
 * @param {cast.framework.CastReceiverContext} deps.context
 * @param {cast.framework.PlayerManager} deps.playerManager
 * @param {cast.debug.CastDebugLogger} deps.castDebugLogger
 * @param {string} deps.logTag
 */
export function startPlaybackReporter({ context, playerManager, castDebugLogger, logTag }) {
  const log = (message) => {
    try {
      castDebugLogger?.debug?.(logTag, `[reporter] ${message}`)
    } catch {
      /* the overlay is a convenience, never a dependency */
    }
  }

  /**
   * What is loaded right now. Re-read from live MediaInformation on every load
   * rather than captured once, because STREAM_TRANSFER is enabled: a second
   * person in the house can load over the top of the current item at any time.
   */
  const snapshot = { token: null, videoId: null, castSessionId: null }

  /** Set when the server rejects our credential; cleared by the next load. */
  let disabled = false
  let lastReportAt = 0
  /** Wall-clock after which reporting is allowed; see TAKEOVER_GRACE_MS. */
  let quietUntil = 0

  function newCastSessionId() {
    try {
      if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
    } catch {
      /* fall through */
    }
    return `cs-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }

  /**
   * Whether a sender is still connected and therefore still reporting.
   *
   * Fails CLOSED: if the answer cannot be determined, assume a sender owns the
   * position. A moment of silence costs at most one 15 s interval; a double
   * writer costs correctness.
   */
  function senderConnected() {
    try {
      return (context.getSenders() || []).length > 0
    } catch {
      return true
    }
  }

  /**
   * Refresh the snapshot from what is actually loaded.
   *
   * The token is cleared when a load carries none. This is the single most
   * important line in the file: without it, one person casts with a token, a
   * second person later casts signed-out, and the second person's viewing is
   * recorded against the first person's account.
   */
  function refreshSnapshot() {
    let media = null
    try {
      media = playerManager.getMediaInformation()
    } catch {
      media = null
    }

    const custom = media?.customData || {}
    const token = typeof custom.castToken === 'string' && custom.castToken ? custom.castToken : null
    const videoId = media?.contentUrl || media?.contentId || null

    const changed = token !== snapshot.token || videoId !== snapshot.videoId
    snapshot.token = token
    snapshot.videoId = videoId
    if (changed || !snapshot.castSessionId) snapshot.castSessionId = newCastSessionId()

    disabled = false
    lastReportAt = 0
    log(token ? `armed for ${videoId}` : `no token on this item — reporting off`)
  }

  function currentlyPaused() {
    try {
      return playerManager.getPlayerState() === cast.framework.messages.PlayerState.PAUSED
    } catch {
      return false
    }
  }

  /**
   * Send one report.
   *
   * @param {Object} [options]
   * @param {boolean} [options.final] bypasses the sender gate and the interval,
   *   and goes out via sendBeacon so it survives the page being torn down
   * @param {number} [options.positionOverride] for events that carry a more
   *   accurate position than the player will still have by the time we ask
   */
  function report({ final = false, positionOverride = null } = {}) {
    if (disabled || !snapshot.token || !snapshot.videoId) return
    // While a sender is connected it is doing the reporting. A final report is
    // exempt: by then the session is ending and this is the last word.
    if (!final && (senderConnected() || Date.now() < quietUntil)) return

    let position = positionOverride
    if (position === null || position === undefined) {
      try {
        position = playerManager.getCurrentTimeSec()
      } catch {
        return
      }
    }
    if (!Number.isFinite(position) || position <= MIN_POSITION_S) return

    lastReportAt = Date.now()

    const body = JSON.stringify({
      token: snapshot.token,
      videoId: snapshot.videoId,
      playbackTime: position,
      isPaused: currentlyPaused(),
      castSessionId: snapshot.castSessionId,
      sentAt: Date.now(),
    })

    // A shutdown gives no time for a promise to settle; sendBeacon hands the
    // request to the browser and returns.
    if (final && typeof navigator !== 'undefined' && navigator.sendBeacon) {
      try {
        navigator.sendBeacon(REPORT_URL, new Blob([body], { type: 'application/json' }))
        return
      } catch {
        /* fall through to fetch */
      }
    }

    // Relative URL, and credentials omitted: the receiver is same-origin, this
    // repo configures no CORS headers anywhere, and no ambient cookie should
    // ever be able to stand in for the token.
    fetch(REPORT_URL, {
      method: 'POST',
      body,
      credentials: 'omit',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      keepalive: final,
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          // The credential is bad or out of scope, and no amount of retrying
          // fixes either. Stop until the next load hands us a new one.
          disabled = true
          log(`disabled by server: ${res.status}`)
          return null
        }
        return res.ok ? res.json() : null
      })
      .then((data) => {
        // The server rolls the token when it nears expiry, so a long evening
        // keeps reporting without a long-lived credential ever being issued.
        if (data && typeof data.token === 'string') snapshot.token = data.token
      })
      .catch(() => {
        // Dropped deliberately. The next tick carries a fresher position than a
        // retry of this one ever could.
      })
  }

  function tick() {
    if (disabled || !snapshot.token) return
    if (senderConnected() || Date.now() < quietUntil) return
    const interval = currentlyPaused() ? REPORT_INTERVAL_PAUSED_MS : REPORT_INTERVAL_PLAYING_MS
    if (Date.now() - lastReportAt < interval) return
    report()
  }

  // Listeners are registered once, here, at module scope — never inside the
  // LOAD interceptor, which runs per load and would accumulate one listener per
  // item played.
  const events = cast.framework.events.EventType

  playerManager.addEventListener(events.PLAYER_LOAD_COMPLETE, refreshSnapshot)
  // Required, not belt-and-braces: STREAM_TRANSFER is an advertised command, so
  // the loaded item can change without a fresh LOAD from us.
  playerManager.addEventListener(events.MEDIA_INFORMATION_CHANGED, refreshSnapshot)

  playerManager.addEventListener(events.PAUSE, () => report())
  playerManager.addEventListener(events.SEEKED, () => report())

  // The last position of an item, captured before anything else loads over it.
  playerManager.addEventListener(events.MEDIA_FINISHED, (event) => {
    report({ final: true, positionOverride: event?.currentMediaTime ?? null })
  })
  playerManager.addEventListener(events.REQUEST_STOP, () => report({ final: true }))

  context.addEventListener(cast.framework.system.EventType.SENDER_DISCONNECTED, () => {
    if (senderConnected()) return
    // Let the sender's own final write land first, so the server sees the two
    // writers in the order they actually happened.
    quietUntil = Date.now() + TAKEOVER_GRACE_MS
    log('last sender left — taking over reporting')
  })

  context.addEventListener(cast.framework.system.EventType.SHUTDOWN, () => {
    report({ final: true })
  })

  setInterval(tick, TICK_MS)
  log('started')
}
