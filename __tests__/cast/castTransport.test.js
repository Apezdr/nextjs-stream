/**
 * The transport bridge's ownership gate.
 *
 * This component is registered into the player framework's media registry and,
 * when it claims a property, everything the player does with that property goes
 * to a television instead of the <video> on the page. So the interesting tests
 * are not "does casting work" — they are "does it ever claim ownership when it
 * should not", because that failure mode breaks ordinary local playback.
 *
 * getMediaOwner treats a property as unowned when the override yields
 * undefined, so a null targetOverride hands everything straight back to the
 * local element.
 */

// Both packages ship ESM only and jest does not transform node_modules. Neither
// is used by the class under test — they belong to the React wrapper in the same
// file — so stubbing the module boundary keeps the unit under test intact.
jest.mock('@videojs/media/dom/media-host', () => ({
  __esModule: true,
  addMediaComponent: jest.fn(() => () => {}),
  HTMLMediaElementHost: class HTMLMediaElementHost {},
}))

jest.mock('@src/components/MediaPlayer/videojs', () => ({
  __esModule: true,
  Player: { useMedia: () => null, usePlayer: () => 'disconnected' },
}))

// The bridge reads the SDK through castSdk; give the test control of the
// final-position record while keeping getRemote/castMatchesSource real-shaped.
let mockFinalPosition = null
jest.mock('@components/Cast/castSdk', () => {
  const actual = jest.requireActual('@components/Cast/castSdk')
  return {
    __esModule: true,
    ...actual,
    readFinalRemotePosition: () => mockFinalPosition,
  }
})

import { CastTransport } from '@src/components/MediaPlayer/CastTransportBridge'

const PlayerState = { IDLE: 'IDLE', PLAYING: 'PLAYING', PAUSED: 'PAUSED', BUFFERING: 'BUFFERING' }

function setupSdk({ isConnected = true, isMediaLoaded = true, isPaused = false, currentTime = 600 } = {}) {
  const calls = { playOrPause: 0, seek: 0, muteOrUnmute: 0, setVolumeLevel: 0 }
  const listeners = {}

  const player = {
    isConnected,
    isMediaLoaded,
    isPaused,
    currentTime,
    duration: 7200,
    volumeLevel: 0.5,
    isMuted: false,
    playerState: isPaused ? PlayerState.PAUSED : PlayerState.PLAYING,
    controller: {
      playOrPause: () => {
        calls.playOrPause += 1
      },
      seek: () => {
        calls.seek += 1
      },
      muteOrUnmute: () => {
        calls.muteOrUnmute += 1
      },
      setVolumeLevel: () => {
        calls.setVolumeLevel += 1
      },
      addEventListener: (type, fn) => {
        listeners[type] = listeners[type] || []
        listeners[type].push(fn)
      },
      removeEventListener: (type, fn) => {
        listeners[type] = (listeners[type] || []).filter((f) => f !== fn)
      },
    },
  }

  globalThis.chrome = { cast: { media: { PlayerState, IdleReason: { FINISHED: 'FINISHED' } } } }
  globalThis.cast = {
    framework: {
      RemotePlayerEventType: {
        CURRENT_TIME_CHANGED: 'currentTimeChanged',
        DURATION_CHANGED: 'durationChanged',
        VOLUME_LEVEL_CHANGED: 'volumeLevelChanged',
        IS_MUTED_CHANGED: 'isMutedChanged',
        IS_PAUSED_CHANGED: 'isPausedChanged',
        PLAYER_STATE_CHANGED: 'playerStateChanged',
        IS_MEDIA_LOADED_CHANGED: 'isMediaLoadedChanged',
      },
      CastContext: { getInstance: () => ({ getCurrentSession: () => null }) },
      RemotePlayer: function RemotePlayer() {
        return player
      },
      RemotePlayerController: function RemotePlayerController() {
        return {}
      },
    },
  }

  return { player, calls, listeners }
}

/** A stand-in for the raw <video> the component dispatches events on. */
function makeTarget() {
  const seen = []
  const el = new EventTarget()
  el.paused = true
  el.duration = 7200
  el.currentTime = 0
  el.pause = () => {
    el.paused = true
  }
  const origDispatch = el.dispatchEvent.bind(el)
  el.dispatchEvent = (event) => {
    seen.push(event.type)
    return origDispatch(event)
  }
  return { el, seen }
}

describe('CastTransport ownership gate', () => {
  afterEach(() => {
    delete globalThis.cast
    delete globalThis.chrome
  })

  it('owns nothing until it is enabled', () => {
    setupSdk()
    const t = new CastTransport()
    expect(t.targetOverride).toBeNull()
  })

  it('owns nothing when the receiver is not connected', () => {
    setupSdk({ isConnected: false })
    const t = new CastTransport()
    t.attach(makeTarget().el)
    t.setEnabled(true)
    expect(t.targetOverride).toBeNull()
  })

  it('owns nothing when the receiver has no media loaded', () => {
    setupSdk({ isMediaLoaded: false })
    const t = new CastTransport()
    t.attach(makeTarget().el)
    t.setEnabled(true)
    expect(t.targetOverride).toBeNull()
  })

  it('owns nothing when the Cast SDK is absent entirely', () => {
    const t = new CastTransport()
    t.attach(makeTarget().el)
    t.setEnabled(true)
    expect(t.targetOverride).toBeNull()
  })

  it('owns the transport only when enabled, connected and loaded', () => {
    setupSdk()
    const t = new CastTransport()
    t.attach(makeTarget().el)
    t.setEnabled(true)

    const override = t.targetOverride
    expect(override).not.toBeNull()
    expect(override.currentTime).toBe(600)
    expect(override.duration).toBe(7200)
    expect(override.paused).toBe(false)
  })

  it('never claims source or track properties, so those stay with the local element', () => {
    setupSdk()
    const t = new CastTransport()
    t.attach(makeTarget().el)
    t.setEnabled(true)

    // getMediaOwner falls through on undefined — these must not be claimed.
    for (const prop of ['src', 'currentSrc', 'load', 'textTracks', 'poster', 'buffered', 'remote']) {
      expect(t.targetOverride[prop]).toBeUndefined()
    }
  })
})

describe('CastTransport transport semantics', () => {
  afterEach(() => {
    delete globalThis.cast
    delete globalThis.chrome
  })

  function enabled(options) {
    const sdk = setupSdk(options)
    const target = makeTarget()
    const t = new CastTransport()
    t.attach(target.el)
    t.setEnabled(true)
    return { t, target, ...sdk }
  }

  it('play() toggles the receiver only when it is paused', () => {
    const { t, calls } = enabled({ isPaused: true })
    t.targetOverride.play()
    expect(calls.playOrPause).toBe(1)
  })

  it('play() does nothing when the receiver is already playing — the toggle would pause the film', () => {
    const { t, calls } = enabled({ isPaused: false })
    t.targetOverride.play()
    expect(calls.playOrPause).toBe(0)
  })

  it('pause() toggles only when the receiver is playing', () => {
    const { t, calls } = enabled({ isPaused: false })
    t.targetOverride.pause()
    expect(calls.playOrPause).toBe(1)

    const paused = enabled({ isPaused: true })
    paused.t.targetOverride.pause()
    expect(paused.calls.playOrPause).toBe(0)
  })

  it('assigns the position before asking the controller to seek', () => {
    const { t, player, calls } = enabled({})
    const order = []
    let stored = player.currentTime
    Object.defineProperty(player, 'currentTime', {
      get: () => stored,
      set: (v) => {
        order.push('assign')
        stored = v
      },
    })
    player.controller.seek = () => {
      order.push('seek')
      calls.seek += 1
    }

    t.targetOverride.currentTime = 1234
    expect(order).toEqual(['assign', 'seek'])
    expect(stored).toBe(1234)
  })

  it('mutes only when the requested state differs', () => {
    const { t, calls } = enabled({})
    t.targetOverride.muted = false // already unmuted
    expect(calls.muteOrUnmute).toBe(0)
    t.targetOverride.muted = true
    expect(calls.muteOrUnmute).toBe(1)
  })

  it('keeps canPlay false by capping readyState below HAVE_ENOUGH_DATA', () => {
    const { t, player } = enabled({})
    expect(t.targetOverride.readyState).toBe(3)
    player.playerState = PlayerState.BUFFERING
    expect(t.targetOverride.readyState).toBe(2)
    player.playerState = PlayerState.IDLE
    expect(t.targetOverride.readyState).toBe(0)
  })
})

describe('CastTransport handoff and listener hygiene', () => {
  afterEach(() => {
    delete globalThis.cast
    delete globalThis.chrome
  })

  it('removes exactly the listeners it added', () => {
    const { listeners } = setupSdk()
    const t = new CastTransport()
    t.attach(makeTarget().el)

    t.setEnabled(true)
    const added = Object.values(listeners).flat().length
    expect(added).toBeGreaterThan(0)

    t.setEnabled(false)
    expect(Object.values(listeners).flat()).toHaveLength(0)
  })

  it('does not double-register when attach happens after enabling', () => {
    const { listeners } = setupSdk()
    const t = new CastTransport()
    t.setEnabled(true)
    // Count what one registration installs rather than hardcoding a number —
    // the invariant is that re-attaching adds nothing, not how many events the
    // bridge happens to mirror today.
    const afterEnable = Object.values(listeners).flat().length
    expect(afterEnable).toBeGreaterThan(0)

    t.attach(makeTarget().el)
    t.attach(makeTarget().el)
    expect(Object.values(listeners).flat().length).toBe(afterEnable)
  })

  it('never subscribes to an event name the installed SDK does not define', () => {
    const { listeners } = setupSdk()
    delete globalThis.cast.framework.RemotePlayerEventType.IS_MEDIA_LOADED_CHANGED

    const t = new CastTransport()
    t.attach(makeTarget().el)
    t.setEnabled(true)

    // Object keys stringify, so a missing name would otherwise register under
    // the literal string "undefined" and quietly never fire.
    expect(Object.keys(listeners)).not.toContain('undefined')
  })

  it('seeds the handoff position at enable, so an immediate Stop still lands right', () => {
    setupSdk({ currentTime: 432 })
    const target = makeTarget()
    target.el.paused = false
    const t = new CastTransport()
    t.attach(target.el)
    t.setEnabled(true)
    // No remote tick ever fires; the seed from #initialSync must carry it.
    t.setEnabled(false)
    expect(target.el.currentTime).toBe(432)
  })

  it('falls back to the recorded final position when no tick arrived, if it names this source', () => {
    setupSdk({ currentTime: 0 })
    mockFinalPosition = { time: 987, contentId: 'https://x/film.mp4', contentUrl: null, at: Date.now() }
    const target = makeTarget()
    const t = new CastTransport()
    t.setSource('https://x/film.mp4')
    t.attach(target.el)
    t.setEnabled(true)
    t.setEnabled(false)
    expect(target.el.currentTime).toBe(987)
    mockFinalPosition = null
  })

  it('ignores a recorded final position for a DIFFERENT title', () => {
    setupSdk({ currentTime: 0 })
    mockFinalPosition = { time: 987, contentId: 'https://x/other.mp4', contentUrl: null, at: Date.now() }
    const target = makeTarget()
    const t = new CastTransport()
    t.setSource('https://x/film.mp4')
    t.attach(target.el)
    t.setEnabled(true)
    t.setEnabled(false)
    expect(target.el.currentTime).toBe(0)
    mockFinalPosition = null
  })

  it('hands the receiver position to the local element, paused, when the session ends', () => {
    const { listeners } = setupSdk()
    const target = makeTarget()
    target.el.paused = false
    const t = new CastTransport()
    t.attach(target.el)
    t.setEnabled(true)

    // The receiver ticks: this is where the bridge learns the position.
    for (const fn of listeners.currentTimeChanged || []) fn()

    t.setEnabled(false)

    expect(target.el.currentTime).toBe(600)
    expect(target.el.paused).toBe(true)
    // Without a synthetic canplay the store never re-evaluates readiness and
    // the player stays stuck as "not ready" after the session ends.
    expect(target.seen).toContain('canplay')
    expect(target.seen).toContain('pause')
  })
})
