'use client'

import { useEffect, useState } from 'react'
import { Player, usePlayerContext } from './videojs'
import { useCastAdoption } from '@components/Cast/useCastSession'
import { getContext, getRemote } from '@components/Cast/castSdk'

/**
 * Owns the player's `volume` while it is casting, and paces what reaches the
 * receiver.
 *
 * The volume slider writes on every pointer move, and while casting each write
 * is a "set receiver volume" request: a quick flick from 100% to 15% sent 20–40
 * of them in a few hundred milliseconds, all in flight at once. An AVR's
 * built-in Cast firmware applied them slowly, dropped some, and landed wherever
 * the last one it PROCESSED put it, not the last one sent. Slow drags were fine
 * because each request finished before the next arrived; spacing requests
 * 150 ms apart was still not enough for one AVR.
 *
 * So the receiver hears about a change only once the slider has been still for
 * QUIET_MS (at least every MAX_WAIT_MS during one long drag, so the AVR still
 * follows along): a flick is ONE request, the final value. One request is in
 * flight at a time (CastSession.setVolume resolves when the receiver
 * acknowledges), and the next goes out no sooner than MIN_GAP_MS later.
 * Levels are snapped to the receiver's own volume step (see snapToStep), and a
 * level the receiver already reports is not sent at all.
 * SETTLE_MS after the last acknowledgement the receiver's reported level is
 * checked against the request and the final value re-sent if a receiver
 * dropped it. While anything is pending, `volume` reads back the requested
 * value, so the slider doesn't jump to the receiver's echoes; once settled it
 * reads the receiver's real level.
 *
 * Precedence: the player routes each media member to the first registered
 * extension whose override defines it, in registration (= render) order.
 * Rendered BEFORE <GoogleCast>, this wins `volume` over the framework's
 * provider while casting (and over CastTransportBridge for a session the page
 * adopted); with no override it hands `volume` straight back to the local
 * element. A hot reload that adds this after <GoogleCast> registered leaves
 * the provider first until a full page load.
 *
 * Diagnostics: with `localStorage.playbackDiag = '1'` every send, acknowledgement
 * and settle reading is logged under `[cast-volume]`.
 */

/** The slider must be still this long before the receiver hears about it. */
const QUIET_MS = 250
/** During one long drag, the receiver still hears at least this often. */
const MAX_WAIT_MS = 1000
/** Minimum gap between one acknowledgement and the next request. */
const MIN_GAP_MS = 250
/** How long after the last acknowledgement to check where the receiver landed. */
const SETTLE_MS = 600
/** Re-sends of the final level when the receiver reports somewhere else. */
const MAX_RESENDS = 2
/** A request whose acknowledgement never comes must not stall the queue. */
const REQUEST_TIMEOUT_MS = 2000

function diag(...args) {
  try {
    if (window.localStorage.getItem('playbackDiag') === '1') console.debug('[cast-volume]', ...args)
  } catch {
    /* storage unavailable */
  }
}

function currentSession() {
  try {
    return getContext()?.getCurrentSession?.() ?? null
  } catch {
    return null
  }
}

/** The receiver's own level: its last status first, the remote player's mirror second. */
function receiverLevel() {
  let level = null
  try {
    level = currentSession()?.getVolume?.()
  } catch {
    /* no session */
  }
  if (!Number.isFinite(level)) level = getRemote()?.player?.volumeLevel
  return Number.isFinite(level) ? level : null
}

/** The receiver's volume step (its own buttons' increment), or null if it reports none. */
function receiverStep() {
  const step = currentSession()?.getSessionObj?.()?.receiver?.volume?.stepInterval
  return Number.isFinite(step) && step > 0 && step <= 0.5 ? step : null
}

/** Half a receiver volume step: closer than that counts as arrived. */
function tolerance() {
  return Math.max(0.01, (receiverStep() ?? 0.05) / 2)
}

/**
 * A level on the receiver's step grid. An AVR's built-in Cast turned level
 * changes into its own volume steps and rounded fractions of a step away:
 * 0.2 → 0.15 is 0.75 of its 1/15 step, and it barely moved, which made small
 * downward drags spotty. Snapped, every change is a whole number of steps. The
 * slider then settles on the nearest step, as the device's own buttons would.
 */
function snapToStep(level) {
  const step = receiverStep()
  if (!step) return level
  return Math.min(1, Math.max(0, Math.round(level / step) * step))
}

/**
 * The step the cast volume controls move by: the receiver's own (one press of
 * its volume buttons), or 1/20 when it reports none. Constant for a session.
 */
export function castVolumeStep() {
  return receiverStep() ?? 0.05
}

/** One step up (+1) or down (-1) from `level`, on the step grid, clamped. */
export function stepLevel(level, step, direction) {
  const index = Math.round((Number.isFinite(level) ? level : 0) / step) + direction
  return Math.min(1, Math.max(0, index * step))
}

/** The step meter: one segment per receiver step, `lit` of them at `level`. */
export function meterSegments(level, step) {
  const count = Math.max(1, Math.round(1 / step))
  const lit = Math.min(count, Math.max(0, Math.round((Number.isFinite(level) ? level : 0) / step)))
  return { count, lit }
}

function sendVolume(level) {
  let request
  try {
    request = Promise.resolve(currentSession()?.setVolume?.(level))
  } catch {
    request = Promise.resolve()
  }
  const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), REQUEST_TIMEOUT_MS))
  return Promise.race([request, timeout]).catch((error) => `error: ${error}`)
}

export class CastVolumeQueue {
  #enabled = false
  #target = null
  #override
  /** Newest level asked for and not sent yet. */
  #wanted = null
  /** When the oldest unsent write arrived, for MAX_WAIT_MS. */
  #wantedSince = null
  #writes = 0
  #inFlight = false
  #lastAckAt = 0
  /** Where the receiver should end up; non-null while anything is pending. */
  #requested = null
  #resends = 0
  #sendTimer = null
  #settleTimer = null
  /** Bumped on reset, so a late acknowledgement from before it is ignored. */
  #epoch = 0

  constructor() {
    const self = this
    this.#override = {
      get volume() {
        return self.#requested ?? receiverLevel() ?? 1
      },
      set volume(value) {
        self.#request(Number(value))
      },
    }
  }

  // --- PlayerExtension contract -------------------------------------------

  /** Null hands `volume` straight back to the local element. */
  get mediaOverride() {
    return this.#enabled ? this.#override : null
  }

  /** The player hands over the media it resolved; events dispatched on it reach the store. */
  attach(target) {
    this.#target = target?.media ?? null
  }

  detach() {
    this.#target = null
  }

  destroy() {
    this.#reset()
    this.detach()
  }

  // --- enablement ---------------------------------------------------------

  setEnabled(next) {
    if (this.#enabled === next) return
    this.#enabled = next
    if (!next) this.#reset()
    diag(next ? 'owning volume (casting)' : 'released volume (local)', {
      receiver: receiverLevel(),
    })
    // The owner of `volume` just changed hands. Leaving a cast in particular:
    // the framework's provider restores the local element's position and mute
    // but never tells the store to re-read the volume, so without this the
    // slider went on showing the TV's last level while the video played at its
    // own (moving the slider "fixed" it by writing the local element).
    this.#dispatch('volumechange')
  }

  // --- the queue ----------------------------------------------------------

  #request(level) {
    if (!this.#enabled || !Number.isFinite(level)) return
    const clamped = snapToStep(Math.min(1, Math.max(0, level)))
    this.#wanted = clamped
    this.#wantedSince ??= Date.now()
    this.#writes += 1
    this.#requested = clamped
    this.#resends = 0
    clearTimeout(this.#settleTimer)
    this.#settleTimer = null
    this.#dispatch('volumechange')
    this.#schedule()
  }

  /** Arm the next send: after QUIET_MS of stillness, capped by MAX_WAIT_MS and spaced by MIN_GAP_MS. */
  #schedule() {
    clearTimeout(this.#sendTimer)
    this.#sendTimer = null
    if (this.#inFlight || this.#wanted == null) return
    const now = Date.now()
    const quiet = Math.min(QUIET_MS, Math.max(0, MAX_WAIT_MS - (now - this.#wantedSince)))
    const gap = Math.max(0, MIN_GAP_MS - (now - this.#lastAckAt))
    this.#sendTimer = setTimeout(() => this.#send(), Math.max(quiet, gap))
  }

  #send() {
    this.#sendTimer = null
    if (this.#inFlight || this.#wanted == null) return
    const level = this.#wanted
    // Already there (a wiggle that snapped back, or the same level twice). A
    // receiver reports no status for a level it already has, so the request
    // only waited out its acknowledgement for nothing (one took a full second).
    const current = receiverLevel()
    if (current != null && Math.abs(current - level) < 0.001) {
      diag('skip', { level: +level.toFixed(3), coalesced: this.#writes })
      this.#wanted = null
      this.#wantedSince = null
      this.#writes = 0
      this.#scheduleSettle()
      return
    }
    const epoch = this.#epoch
    const sentAt = Date.now()
    diag('send', {
      level: +level.toFixed(3),
      coalesced: this.#writes,
      resend: this.#resends || undefined,
    })
    this.#wanted = null
    this.#wantedSince = null
    this.#writes = 0
    this.#inFlight = true
    sendVolume(level).then((outcome) => {
      if (epoch !== this.#epoch) return
      this.#inFlight = false
      this.#lastAckAt = Date.now()
      diag('ack', {
        level: +level.toFixed(3),
        ms: this.#lastAckAt - sentAt,
        outcome: outcome ?? 'ok',
      })
      if (this.#wanted != null) this.#schedule()
      else this.#scheduleSettle()
    })
  }

  #scheduleSettle() {
    clearTimeout(this.#settleTimer)
    const epoch = this.#epoch
    this.#settleTimer = setTimeout(() => {
      this.#settleTimer = null
      if (epoch !== this.#epoch || this.#wanted != null || this.#inFlight) return
      const target = this.#requested
      const actual = receiverLevel()
      const off = target != null && actual != null && Math.abs(actual - target) > tolerance()
      diag('settle', {
        requested: target == null ? null : +target.toFixed(3),
        receiver: actual == null ? null : +actual.toFixed(3),
        remotePlayer: getRemote()?.player?.volumeLevel,
        resending: off && this.#resends < MAX_RESENDS,
      })
      if (off && this.#resends < MAX_RESENDS) {
        this.#resends += 1
        this.#wanted = target
        this.#wantedSince = Date.now()
        this.#schedule()
        return
      }
      // Settled: from here on `volume` reads the receiver's real level.
      this.#requested = null
      this.#dispatch('volumechange')
    }, SETTLE_MS)
  }

  #reset() {
    this.#epoch += 1
    clearTimeout(this.#sendTimer)
    clearTimeout(this.#settleTimer)
    this.#sendTimer = null
    this.#settleTimer = null
    this.#wanted = null
    this.#wantedSince = null
    this.#writes = 0
    this.#inFlight = false
    this.#requested = null
    this.#resends = 0
  }

  #dispatch(type) {
    try {
      this.#target?.dispatchEvent(new Event(type))
    } catch {
      /* detached mid-flight */
    }
  }
}

/**
 * Whether `volume` belongs to the receiver: this player started the session
 * (the provider reports 'connected'), or the page adopted one already playing
 * this title. While it does, the store's volume is the TV's, not the viewer's
 * local preference (see VolumeRegulator).
 */
export function useCastOwnsVolume(videoURL) {
  const remoteState = Player.usePlayer((s) => s.remotePlaybackState)
  const { adopted } = useCastAdoption(videoURL)
  return remoteState === 'connected' || adopted
}

/** Render BEFORE <GoogleCast>; see the module comment for why. */
export default function CastVolume({ videoURL }) {
  const { registerExtension } = usePlayerContext()
  const owns = useCastOwnsVolume(videoURL)
  const [component] = useState(() => new CastVolumeQueue())

  useEffect(() => registerExtension?.(component), [registerExtension, component])

  useEffect(() => {
    component.setEnabled(owns)
  }, [owns, component])

  useEffect(() => () => component.destroy(), [component])

  return null
}
