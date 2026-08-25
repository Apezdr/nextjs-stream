/**
 * The Cast SDK's teardown ordering, pinned.
 *
 * Stopping a session runs, verbatim from the shipping sender SDK:
 *
 *     X(this,"SESSION_ENDED"); this.ma = this.h.bb; this.h = null;
 *
 * Both CastContext events are dispatched inside X(), and the current-session
 * pointer is cleared on the NEXT statement — after which nothing is dispatched
 * ever again. So any listener that asks "is there a current session?" is
 * guaranteed to be told yes, exactly once, forever. That is what left the
 * casting chip on screen after Stop was pressed.
 *
 * castState does not lag: X() assigns it before dispatching. These tests fix
 * that distinction in place so the getter can never creep back.
 */

import {
  readCastSnapshot,
  castMatchesSource,
  subscribeCast,
  endCastSession,
  isEnding,
} from '@src/components/Cast/castSdk'

const CastState = { CONNECTED: 'CONNECTED', CONNECTING: 'CONNECTING', NOT_CONNECTED: 'NOT_CONNECTED' }

/** A CastContext faithful to the real teardown order. */
function makeSdk({
  castState = CastState.CONNECTED,
  sessionState = 'SESSION_STARTED',
  media = null,
  device = 'Living Room TV',
  receiverApp = 'My Receiver App',
} = {}) {
  const listeners = { caststatechanged: [], sessionstatechanged: [] }
  const remoteListeners = {}

  const session = {
    getCastDevice: () => ({ friendlyName: device }),
    getMediaSession: () => (media ? { media } : null),
  }

  const context = {
    _castState: castState,
    _sessionState: sessionState,
    _session: session,
    getCastState: () => context._castState,
    getSessionState: () => context._sessionState,
    getCurrentSession: () => context._session,
    addEventListener: (type, fn) => listeners[type]?.push(fn),
    removeEventListener: (type, fn) => {
      listeners[type] = (listeners[type] || []).filter((f) => f !== fn)
    },
    endCurrentSession: jest.fn(),
  }

  const player = {
    isMediaLoaded: Boolean(media),
    mediaInfo: media,
    // RemotePlayer.displayName is the Cast APPLICATION name, not the device.
    displayName: receiverApp,
    title: media?.metadata?.title ?? null,
    controller: {
      addEventListener: (type, fn) => {
        remoteListeners[type] = remoteListeners[type] || []
        remoteListeners[type].push(fn)
      },
      removeEventListener: (type, fn) => {
        remoteListeners[type] = (remoteListeners[type] || []).filter((f) => f !== fn)
      },
    },
  }

  globalThis.cast = {
    framework: {
      CastState,
      SessionState: {
        SESSION_STARTING: 'SESSION_STARTING',
        SESSION_STARTED: 'SESSION_STARTED',
        SESSION_ENDING: 'SESSION_ENDING',
        SESSION_ENDED: 'SESSION_ENDED',
      },
      CastContextEventType: {
        CAST_STATE_CHANGED: 'caststatechanged',
        SESSION_STATE_CHANGED: 'sessionstatechanged',
      },
      RemotePlayerEventType: {
        IS_CONNECTED_CHANGED: 'isConnectedChanged',
        IS_MEDIA_LOADED_CHANGED: 'isMediaLoadedChanged',
        MEDIA_INFO_CHANGED: 'mediaInfoChanged',
        TITLE_CHANGED: 'titleChanged',
        DISPLAY_NAME_CHANGED: 'displayNameChanged',
      },
      CastContext: { getInstance: () => context },
      RemotePlayer: function RemotePlayer() {
        return player
      },
      RemotePlayerController: function RemotePlayerController() {
        return {}
      },
    },
  }

  /**
   * Exactly what the SDK does: update castState, dispatch BOTH events, and only
   * then clear the session pointer.
   */
  const teardown = () => {
    context._castState = CastState.NOT_CONNECTED
    for (const fn of [...listeners.sessionstatechanged, ...listeners.caststatechanged]) fn()
    context._session = null
  }

  return { context, player, teardown, listeners }
}

describe('castSdk', () => {
  afterEach(() => {
    delete globalThis.cast
    jest.useRealTimers()
  })

  describe('readCastSnapshot', () => {
    it('reports casting while connected', () => {
      makeSdk({ media: { contentId: 'https://x/a.mp4', metadata: { title: 'A Film' } } })
      const snap = readCastSnapshot()
      expect(snap.active).toBe(true)
      expect(snap.contentId).toBe('https://x/a.mp4')
    })

    it('names the television, not the receiver application', () => {
      makeSdk({ device: 'Living Room TV', receiverApp: 'Adam Cinema - Local' })
      // "Casting to Adam Cinema - Local" tells the user nothing about where the
      // film is playing; RemotePlayer.displayName is the app name, and only
      // getCastDevice().friendlyName is the device.
      expect(readCastSnapshot().deviceName).toBe('Living Room TV')
    })

    it('says nothing rather than something wrong when the device is unknown', () => {
      const sdk = makeSdk({ receiverApp: 'Adam Cinema - Local' })
      sdk.context._session.getCastDevice = () => null
      expect(readCastSnapshot().deviceName).toBeNull()
    })

    it('reports NOT casting the instant castState flips, even though getCurrentSession() still returns the dying session', () => {
      const sdk = makeSdk()
      expect(readCastSnapshot().active).toBe(true)

      // Reproduce the exact window the SDK dispatches in.
      sdk.context._castState = CastState.NOT_CONNECTED
      expect(sdk.context.getCurrentSession()).not.toBeNull() // the trap
      expect(readCastSnapshot().active).toBe(false) // the fix
    })

    it('does not report media from a previous SDK instance after the framework is replaced', () => {
      makeSdk({ media: { contentId: 'https://x/first.mp4' } })
      expect(readCastSnapshot().contentId).toBe('https://x/first.mp4')

      // A fresh framework object must invalidate the cached RemotePlayer pair,
      // which is otherwise bound to a CastContext that no longer exists.
      makeSdk({ media: { contentId: 'https://x/second.mp4' } })
      expect(readCastSnapshot().contentId).toBe('https://x/second.mp4')
    })

    it('reports a session being torn down as ending, never as connecting', () => {
      // The SDK maps SESSION_ENDING to castState CONNECTING — the same value a
      // session being STARTED uses. Conflating them made stopping a cast flash
      // "Connecting…" over the title on the way out.
      makeSdk({ castState: CastState.CONNECTING, sessionState: 'SESSION_ENDING' })
      const snap = readCastSnapshot()
      expect(snap.ending).toBe(true)
      expect(snap.connecting).toBe(false)
      expect(snap.active).toBe(false)
    })

    it('still reports a session being started as connecting', () => {
      makeSdk({ castState: CastState.CONNECTING, sessionState: 'SESSION_STARTING' })
      const snap = readCastSnapshot()
      expect(snap.connecting).toBe(true)
      expect(snap.ending).toBe(false)
    })

    it('survives the SDK being absent', () => {
      delete globalThis.cast
      expect(readCastSnapshot().active).toBe(false)
    })
  })

  describe('subscribeCast', () => {
    it('observes the end of a session from inside the dispatch window', () => {
      const sdk = makeSdk()
      const seen = []
      const unsubscribe = subscribeCast(() => seen.push(readCastSnapshot().active))

      expect(seen).toEqual([true]) // initial read on attach
      sdk.teardown()

      // Both events fire while getCurrentSession() is still non-null. Deriving
      // from castState is what makes this false rather than true.
      expect(seen.slice(1)).toEqual([false, false])
      unsubscribe()
    })

    it('removes every listener it added', () => {
      const sdk = makeSdk()
      const unsubscribe = subscribeCast(() => {})
      expect(sdk.listeners.sessionstatechanged).toHaveLength(1)
      expect(sdk.listeners.caststatechanged).toHaveLength(1)

      unsubscribe()
      expect(sdk.listeners.sessionstatechanged).toHaveLength(0)
      expect(sdk.listeners.caststatechanged).toHaveLength(0)
    })
  })

  describe('endCastSession', () => {
    it('reads as stopped immediately, before the receiver acknowledges anything', () => {
      jest.useFakeTimers()
      const sdk = makeSdk()
      const seen = []
      const unsubscribe = subscribeCast(() => seen.push(readCastSnapshot().active && !isEnding()))

      endCastSession()

      expect(sdk.context.endCurrentSession).toHaveBeenCalledWith(true)
      expect(isEnding()).toBe(true)
      expect(seen[seen.length - 1]).toBe(false) // notified on the click
      unsubscribe()
    })

    it('tells the truth again if the stop is never acknowledged', () => {
      jest.useFakeTimers()
      const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
      makeSdk() // endCurrentSession is a jest.fn(): nothing ever acks

      endCastSession()
      jest.advanceTimersByTime(4000)

      expect(isEnding()).toBe(false)
      expect(errors).toHaveBeenCalledWith('[cast] stop was never acknowledged by the receiver')
      errors.mockRestore()
    })
  })

  describe('castMatchesSource', () => {
    const active = (fields) => ({ active: true, contentId: null, contentUrl: null, ...fields })

    it('matches an identical contentId', () => {
      expect(castMatchesSource(active({ contentId: 'https://x/a.mp4' }), 'https://x/a.mp4')).toBe(true)
    })

    it('matches on contentUrl when the receiver replaced contentId', () => {
      const snap = active({ contentId: 'some-entity-id', contentUrl: 'https://x/a.mp4' })
      expect(castMatchesSource(snap, 'https://x/a.mp4')).toBe(true)
    })

    it('matches a relative src against the absolute URL the receiver echoes back', () => {
      const snap = active({ contentId: `${globalThis.location.origin}/movies/a.mp4` })
      expect(castMatchesSource(snap, '/movies/a.mp4')).toBe(true)
    })

    it('rejects a different title', () => {
      expect(castMatchesSource(active({ contentId: 'https://x/a.mp4' }), 'https://x/b.mp4')).toBe(false)
    })

    it('is false whenever nothing is casting, whatever the ids say', () => {
      const snap = { active: false, contentId: 'https://x/a.mp4', contentUrl: null }
      expect(castMatchesSource(snap, 'https://x/a.mp4')).toBe(false)
    })

    it('is false for a missing url', () => {
      expect(castMatchesSource(active({ contentId: 'https://x/a.mp4' }), null)).toBe(false)
    })
  })
})
