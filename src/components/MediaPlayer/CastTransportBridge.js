'use client'

import { useEffect, useState } from 'react'
import { addMediaComponent, HTMLMediaElementHost } from '@videojs/media/dom/media-host'
import { Player } from './videojs'
import { useCastAdoption } from '@components/Cast/useCastSession'
import { getRemote } from '@components/Cast/castSdk'

/**
 * Makes the player's controls drive the television when the receiver is
 * already playing this title.
 *
 * Why this exists at all: the player framework routes every media property
 * through `getMediaOwner(host, prop)`, which returns the first registered
 * component whose `targetOverride` exposes that property, and otherwise the raw
 * <video>. The framework's own `GoogleCast` component only exposes `remote`
 * unless its provider considers itself connected — and for a session this page
 * did not start, it never does: adoption there is driven by a SESSION_RESUMED
 * event that a client-side navigation never produces, and the private state it
 * would have to set is unreachable from outside the package.
 *
 * So returning to a casting title left every control pointed at the local
 * element: pressing play started the video on the page, on top of the TV.
 *
 * Rather than reach into the framework's private state, this registers a
 * SECOND media component that owns the transport properties while, and only
 * while, we are adopted. Ownership is precedence-safe by construction: a
 * genuinely connected provider exposes every property and is consulted first,
 * so it always wins, and this component is additionally disabled whenever the
 * store reports a real connection.
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
  #enabled = false
  #seeking = false
  #attached = false
  #listeners = null
  #override = null
  #lastRemoteTime = 0

  constructor() {
    this.#override = this.#createOverride()
  }

  // --- MediaComponent contract -------------------------------------------

  setMedia() {
    // The host is not needed: events are dispatched on the target, which the
    // host forwards to itself for every type the store subscribed to.
  }

  attach(target) {
    this.#target = target
    if (this.#enabled) this.#attachRemote()
  }

  detach() {
    this.#detachRemote()
    this.#target = null
  }

  destroy() {
    this.detach()
  }

  /**
   * Null unless we can actually serve the transport. `getMediaOwner` treats a
   * property as unowned when the override yields `undefined`, so returning null
   * hands everything straight back to the local element.
   */
  get targetOverride() {
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
    if (!player || !this.#target) return
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
    try {
      if (this.#lastRemoteTime > 1 && Number.isFinite(target.duration)) {
        target.currentTime = this.#lastRemoteTime
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
       * Capped at 3 exactly as the provider does, which keeps the store's
       * `canPlay` false for the whole adopted period. That is deliberate: three
       * effects key off canPlay — the saved-position restore, the clip window,
       * and the playback tracker's writes — and every one of them would act on
       * the television. A restore in particular would yank the TV backwards to
       * whatever this page last had saved.
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
      get volume() {
        return player()?.volumeLevel ?? 1
      },
      set volume(value) {
        const p = player()
        if (!p) return
        p.volumeLevel = +value
        p.controller?.setVolumeLevel()
      },
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
 * Render this AFTER <GoogleCast> so the framework's component is first in the
 * registry and wins the ownership walk whenever it is genuinely connected.
 */
export default function CastTransportBridge({ videoURL }) {
  const media = Player.useMedia()
  const remoteState = Player.usePlayer((s) => s.remotePlaybackState)
  const { adopted } = useCastAdoption(videoURL)
  const [component] = useState(() => new CastTransport())

  useEffect(() => {
    if (!(media instanceof HTMLMediaElementHost)) return undefined
    return addMediaComponent(media, component)
  }, [media, component])

  // Never contend with a real connection: when this player started the session,
  // the provider owns everything and this stands down.
  useEffect(() => {
    component.setEnabled(adopted && remoteState === 'disconnected')
  }, [adopted, remoteState, component])

  useEffect(() => () => component.destroy(), [component])

  return null
}
