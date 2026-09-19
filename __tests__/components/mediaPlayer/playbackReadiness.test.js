/**
 * Playback readiness — what replaces the store's `canPlay` for resume and
 * watch-history.
 *
 * The two things worth protecting: (1) a stream that never reaches
 * readyState 4 — the JIT origin's normal case — still gets its saved position
 * applied and its progress written, and (2) nothing is ready while a Cast
 * receiver owns the title, regardless of what the local element says. The
 * old gate got (2) right by accident of the bridge's readyState cap; this one
 * states it outright.
 */

import {
  NOT_READY,
  READY,
  READINESS_EVENTS,
  TRACK_ONLY,
  readinessFrom,
} from '@components/MediaPlayer/playbackReadiness'

const HAVE_NOTHING = 0
const HAVE_METADATA = 1
const HAVE_CURRENT_DATA = 2
const HAVE_FUTURE_DATA = 3
const HAVE_ENOUGH_DATA = 4

describe('readinessFrom', () => {
  test('the JIT case: readyState never exceeds 3, and both answers are still yes', () => {
    for (const readyState of [HAVE_METADATA, HAVE_CURRENT_DATA, HAVE_FUTURE_DATA]) {
      expect(readinessFrom({ readyState, duration: 5400 })).toEqual({
        canSeek: true,
        canTrack: true,
      })
    }
  })

  test('readyState 4 is sufficient but no longer necessary', () => {
    expect(readinessFrom({ readyState: HAVE_ENOUGH_DATA, duration: 5400 })).toEqual({
      canSeek: true,
      canTrack: true,
    })
  })

  test('nothing is ready before metadata', () => {
    expect(readinessFrom({ readyState: HAVE_NOTHING, duration: NaN })).toBe(NOT_READY)
    expect(readinessFrom({ readyState: HAVE_NOTHING, duration: 5400 })).toBe(NOT_READY)
  })

  test('metadata without a finite duration can track but not seek', () => {
    // A live/unknown-duration element: currentTime is meaningful, a seek
    // target is not.
    expect(readinessFrom({ readyState: HAVE_METADATA, duration: NaN })).toEqual({
      canSeek: false,
      canTrack: true,
    })
    expect(readinessFrom({ readyState: HAVE_METADATA, duration: Infinity })).toEqual({
      canSeek: false,
      canTrack: true,
    })
    expect(readinessFrom({ readyState: HAVE_METADATA, duration: 0 })).toEqual({
      canSeek: false,
      canTrack: true,
    })
  })

  test('a missing element is not ready', () => {
    expect(readinessFrom(null)).toBe(NOT_READY)
    expect(readinessFrom(undefined)).toBe(NOT_READY)
  })

  test('castAdopted forces not-ready even when the local element is fully ready', () => {
    // The bridge used to enforce this by capping the HOST readyState at 3.
    // Reading the raw element bypasses that cap, so the invariant lives here.
    expect(
      readinessFrom({ readyState: HAVE_ENOUGH_DATA, duration: 5400 }, { castAdopted: true })
    ).toBe(NOT_READY)
  })

  test('the falling edge: an emptied element (readyState 0) is not ready again', () => {
    // canPlay never fell once set; a source swap must reset readiness so the
    // one-shot restore and the heartbeat re-arm against the new source.
    const before = readinessFrom({ readyState: HAVE_FUTURE_DATA, duration: 5400 })
    const after = readinessFrom({ readyState: HAVE_NOTHING, duration: NaN })
    expect(before.canTrack).toBe(true)
    expect(after).toBe(NOT_READY)
  })
})

describe('READINESS_EVENTS', () => {
  test('includes the rising and falling edges the store omits', () => {
    for (const ev of ['loadedmetadata', 'durationchange', 'emptied', 'loadstart']) {
      expect(READINESS_EVENTS).toContain(ev)
    }
  })

  test('still covers everything the store already listened to', () => {
    // So the new gate is never sampled less often than the old one.
    for (const ev of ['canplay', 'canplaythrough', 'loadstart', 'emptied']) {
      expect(READINESS_EVENTS).toContain(ev)
    }
  })
})

describe('snapshot identity', () => {
  test('equal readings are the same frozen object, so useSyncExternalStore does not re-render', () => {
    expect(readinessFrom({ readyState: 3, duration: 100 })).toBe(READY)
    expect(readinessFrom({ readyState: 4, duration: 100 })).toBe(READY)
    expect(readinessFrom({ readyState: 1, duration: NaN })).toBe(TRACK_ONLY)
    expect(readinessFrom({ readyState: 0, duration: NaN })).toBe(NOT_READY)
    expect(Object.isFrozen(READY) && Object.isFrozen(TRACK_ONLY) && Object.isFrozen(NOT_READY)).toBe(
      true
    )
  })
})
