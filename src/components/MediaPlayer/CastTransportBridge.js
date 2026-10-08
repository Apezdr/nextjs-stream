'use client'

import { useEffect, useState } from 'react'
import { Player, usePlayerContext } from './videojs'
import { useCastAdoption } from '@components/Cast/useCastSession'
import { getRemote, readFinalRemotePosition, castMatchesSource } from '@components/Cast/castSdk'

/**
 * Makes the player's controls drive the television when the receiver is
 * already playing this title.
 *
 * Why this exists at all: the store reads the media through a facade that
 * routes every member through the player's registered extensions first — the
 * first extension whose `mediaOverride` defines that member wins — and
 * otherwise reaches the media itself. The framework's own `GoogleCast`
 * extension only overrides `remote` unless its provider considers itself
 * connected — and for a session this page did not start, it never does:
 * adoption there is driven by a SESSION_RESUMED event that a client-side
 * navigation never produces, and the private state it would have to set is
 * unreachable from outside the package. (Still true in 10.0.0.)
 *
 * So returning to a casting title left every control pointed at the local
 * element: pressing play started the video on the page, on top of the TV.
 *
 * Rather than reach into the framework's private state, this registers a
 * SECOND player extension that owns the transport members while, and only
 * while, we are adopted. Ownership is precedence-safe by construction: a
 * genuinely connected provider overrides every member and registers first, so
 * it always wins, and this extension is additionally disabled whenever the
 * store reports a real connection.
 *
 * Registration goes through `usePlayerContext().registerExtension`, which
 * upstream marks @internal: since 10.0.0 it is the only way to put an
 * override in front of the store. It is why the @videojs packages stay pinned
 * exact; check it first on any upgrade.
 *
 * The semantics below mirror GoogleCastProvider deliberately, property for
 * property — the store was written against those, and a subtle divergence here
 * would show up as a stuck seek bar or a play button that never settles.
 */

/** chrome.cast enums, read defensively — the SDK is injected at runtime. */
function playerStates() {
  return globalThis.chrome?.cast?.media?.PlayerState ?? {}
}

function currentMedia() {
  try {
    const session = globalThis.cast?.framework?.CastContext?.getInstance?.()?.getCurrentSession?.()
    return session?.getMediaSession?.() ?? null
  } catch {
    return null
  }
}

/** Exported for tests; the React wrapper below is the only production entry point. */
export class CastTransport {
  #target = null
  #source = null
  #enabled = false
  #seeking = false
  #attached = false
  #listeners = null
  #override = null
  #lastRemoteTime = 0

  constructor() {
    this.#override = this.#createOverride()
  }

  // --- PlayerExtension contract -------------------------------------------

  /** The URL this player is for, so a final position can be identity-checked. */
  setSource(url) {
    this.#source = url || null
  }

  /**
   * The player hands over the media it resolved (the playback adapter), never
   * the facade the store reads. Events dispatched on it reach the store's
   * listeners, and writes to it reach the local element underneath.
   */
  attach(target) {
    this.#target = target?.media ?? null
    if (!this.#enabled) return
    // setEnabled can land before the player has media: on a client-side
    // navigation `adopted` is already true on the first render, while
    // Player.useMedia() is still null. Without syncing here the store would
    // keep showing the local element until the receiver's next tick.
    this.#attachRemote()
    this.#initialSync()
  }

  detach() {
    this.#detachRemote()
    this.#target = null
  }

  destroy() {
    this.detach()
  }

  /**
   * Null unless we can actually serve the transport. The store's media facade
   * treats a member as unowned when no override defines it, so returning null
   * hands everything straight back to the local element.
   */
  get mediaOverride() {
    if (!this.#enabled) return null
    const player = getRemote()?.player
    if (!player?.isConnected || !player.isMediaLoaded) return null
    return this.#override
  }

  // --- enablement ---------------------------------------------------------

  setEnabled(next) {
    if (this.#enabled === next) return
    this.#enabled = next
    if (next) {
      this.#attachRemote()
      this.#initialSync()
    } else {
      this.#handoff()
      this.#detachRemote()
    }
  }

  /**
   * Push the receiver's current state into the store the moment we take over,
   * so the seek bar and time display show the TV rather than sitting at the
   * local element's zero until the next remote tick.
   */
  #initialSync() {
    const player = getRemote()?.player
    if (!player || !this.#target || !player.isMediaLoaded) return
    // Seed the handoff position immediately rather than waiting for the first
    // remote tick — a Stop within a second of arriving otherwise found
    // #lastRemoteTime still at 0 and skipped the seek entirely.
    if (Number.isFinite(player.currentTime) && player.currentTime > 0) {
      this.#lastRemoteTime = player.currentTime
    }
    this.#dispatch('durationchange', 'timeupdate', 'volumechange')
    this.#dispatch(player.isPaused ? 'pause' : 'play')
    const PS = playerStates()
    if (player.playerState === PS.PLAYING) this.#dispatch('playing')
    else if (player.playerState === PS.BUFFERING) this.#dispatch('waiting')
  }

  /**
   * Give the local element the position the TV reached, then stand down.
   *
   * Left PAUSED on purpose: ending a cast is a stop, not a transfer, and the
   * framework's own resuming disconnect path never runs for an adopted session,
   * so nothing else would stop it.
   *
   * The synthetic `canplay` is load-bearing rather than cosmetic — the store
   * only re-evaluates readiness on canplay/canplaythrough/loadstart/emptied, so
   * without it the player stays "not ready" forever once the session ends.
   */
  #handoff() {
    const target = this.#target
    if (!target) return
    // The ticks may never have arrived (a paused receiver arms no ticker, and
    // teardown zeroes everything). The SDK layer keeps one authoritative
    // end-of-session position; use it when it names this same source.
    let position = this.#lastRemoteTime
    if (position <= 1) {
      const final = readFinalRemotePosition()
      if (
        final &&
        final.time > 1 &&
        this.#source &&
        castMatchesSource(
          { active: true, contentId: final.contentId, contentUrl: final.contentUrl },
          this.#source
        )
      ) {
        position = final.time
      }
    }
    try {
      if (position > 1 && Number.isFinite(target.duration)) {
        target.currentTime = position
      }
      if (!target.paused) target.pause()
    } catch {
      /* the element may already be gone */
    }
    this.#dispatch('canplay', 'durationchange', 'timeupdate', 'volumechange', 'pause')
  }

  // --- remote event mirroring --------------------------------------------

  #attachRemote() {
    if (this.#attached) return
    const remote = getRemote()
    const framework = globalThis.cast?.framework
    if (!remote || !framework?.RemotePlayerEventType) return

    const E = framework.RemotePlayerEventType
    const player = remote.player

    this.#listeners = {
      [E.CURRENT_TIME_CHANGED]: () => {
        if (!player.isMediaLoaded) return
        this.#lastRemoteTime = player.currentTime ?? this.#lastRemoteTime
        this.#notifySeeked()
        this.#dispatch('timeupdate')
      },
      [E.DURATION_CHANGED]: () => this.#dispatch('durationchange'),
      // mediaOverride refuses ownership until the receiver reports media
      // loaded, so this is the moment the bridge becomes able to serve the
      // transport at all. Nothing else dispatches then, and the store only
      // re-reads properties on events — without this it would go on showing
      // the local element's zeroes.
      [E.IS_MEDIA_LOADED_CHANGED]: () => {
        if (player.isMediaLoaded) this.#initialSync()
      },
      [E.VOLUME_LEVEL_CHANGED]: () => this.#dispatch('volumechange'),
      [E.IS_MUTED_CHANGED]: () => this.#dispatch('volumechange'),
      [E.IS_PAUSED_CHANGED]: () => this.#dispatch(player.isPaused ? 'pause' : 'play'),
      [E.PLAYER_STATE_CHANGED]: () => {
        const PS = playerStates()
        const state = player.playerState
        if (state !== PS.BUFFERING) this.#notifySeeked()
        if (state === PS.PAUSED) return
        if (state === PS.IDLE) {
          const finished =
            currentMedia()?.idleReason === globalThis.chrome?.cast?.media?.IdleReason?.FINISHED
          this.#dispatch(finished ? 'ended' : 'emptied')
          return
        }
        if (state === PS.PLAYING) this.#dispatch('playing')
        else if (state === PS.BUFFERING) this.#dispatch('waiting')
      },
    }

    for (const [type, handler] of Object.entries(this.#listeners)) {
      // An event name the installed SDK does not define arrives here as the
      // string "undefined" (object keys stringify), which would register a
      // listener nothing ever fires. Beta drift upstream should cost a missing
      // update, not a phantom subscription.
      if (!type || type === 'undefined') continue
      remote.controller.addEventListener(type, handler)
    }
    this.#attached = true
  }

  #detachRemote() {
    if (!this.#attached) return
    const remote = getRemote()
    // CAF does not dedupe handlers, so these must be the same references that
    // were added — never a freshly bound copy.
    if (remote && this.#listeners) {
      for (const [type, handler] of Object.entries(this.#listeners)) {
        try {
          remote.controller.removeEventListener(type, handler)
        } catch {
          /* controller gone */
        }
      }
    }
    this.#listeners = null
    this.#attached = false
    this.#seeking = false
  }

  #dispatch(...types) {
    for (const type of types) {
      try {
        this.#target?.dispatchEvent(new Event(type))
      } catch {
        /* detached mid-flight */
      }
    }
  }

  #notifySeeking() {
    this.#seeking = true
    this.#dispatch('seeking')
  }

  #notifySeeked() {
    if (!this.#seeking) return
    this.#seeking = false
    this.#dispatch('seeked')
  }

  // --- the override itself ------------------------------------------------

  #createOverride() {
    const self = this
    const player = () => getRemote()?.player

    return {
      get paused() {
        const p = player()
        return p ? p.isPaused || this.ended : true
      },
      get ended() {
        const p = player()
        const PS = playerStates()
        return (
          p?.playerState === PS.IDLE &&
          currentMedia()?.idleReason === globalThis.chrome?.cast?.media?.IdleReason?.FINISHED
        )
      },
      get seeking() {
        return self.#seeking
      },
      /**
       * Capped at 3 exactly as the provider does (still true in 10.0.0). Since
       * 10.0.0 the store's `canPlay` turns true at 3, so it is no longer false
       * for the adopted period — which no longer matters: the saved-position
       * restore, the clip window and the playback tracker read readiness off
       * the local element (playbackReadiness.js) and stand down while adopted
       * (castAdopted), because each of them would otherwise act on the
       * television — a restore would yank the TV back to this page's position.
       */
      get readyState() {
        const PS = playerStates()
        switch (player()?.playerState) {
          case PS.IDLE:
            return 0
          case PS.BUFFERING:
            return 2
          default:
            return 3
        }
      },
      get duration() {
        return player()?.duration ?? NaN
      },
      get currentTime() {
        return player()?.currentTime ?? 0
      },
      set currentTime(value) {
        const p = player()
        if (!p) return
        // The controller reads the position off the player, so assign first.
        p.currentTime = value
        self.#notifySeeking()
        p.controller?.seek()
      },
      get muted() {
        return Boolean(player()?.isMuted)
      },
      set muted(value) {
        const p = player()
        if (p && value !== p.isMuted) p.controller?.muteOrUnmute()
      },
      // No `volume`: CastVolume owns it for adopted sessions too (registered
      // first, it wins), pacing what reaches the receiver.
      play() {
        const p = player()
        if (!p) return Promise.resolve()
        // playOrPause is a TOGGLE — calling it while already playing pauses the
        // TV, which is how a "play" button ends up stopping the film.
        if (this.paused) p.controller?.playOrPause()
        return Promise.resolve()
      },
      pause() {
        const p = player()
        if (p && !this.paused) p.controller?.playOrPause()
      },
    }
  }

}

/**
 * Registers the transport bridge for as long as the receiver is playing this
 * title and the framework's own provider is not connected.
 *
 * Render this AFTER <GoogleCast>: extensions register in effect (render) order
 * and the first override defining a member wins, so the framework's provider
 * comes first and wins whenever it is genuinely connected.
 */
export default function CastTransportBridge({ videoURL }) {
  const { registerExtension } = usePlayerContext()
  const remoteState = Player.usePlayer((s) => s.remotePlaybackState)
  const { adopted } = useCastAdoption(videoURL)
  const [component] = useState(() => new CastTransport())

  // The player attaches the extension to whatever media it resolves and moves
  // it when the media changes; the returned callback releases this instance.
  useEffect(() => registerExtension?.(component), [registerExtension, component])

  useEffect(() => {
    component.setSource(videoURL)
  }, [videoURL, component])

  // Never contend with a real connection: when this player started the session,
  // the provider owns everything and this stands down.
  useEffect(() => {
    component.setEnabled(adopted && remoteState === 'disconnected')
  }, [adopted, remoteState, component])

  useEffect(() => () => component.destroy(), [component])

  return null
}
