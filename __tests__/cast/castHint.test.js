/**
 * The localStorage breadcrumb.
 *
 * On a full page load the Cast SDK has not been fetched, so nothing on the page
 * can tell a casting title from an ordinary one until it arrives. This is the
 * only thing readable synchronously at that moment — which makes it useful, and
 * makes it dangerous: it is a guess about a session that may have ended while
 * the tab was closed.
 *
 * So the tests that matter are the ones about being WRONG. A stale breadcrumb
 * must cost a moment of delay, never a video that refuses to play.
 */

import {
  readCastHint,
  clearCastHint,
  hintMatchesSource,
  subscribeCast,
  rememberCastPath,
  readCastSnapshot,
} from '@src/components/Cast/castSdk'

const CastState = { CONNECTED: 'CONNECTED', NOT_CONNECTED: 'NOT_CONNECTED' }
const HINT_KEY = 'cast:last-session'

function installSdk({ castState = CastState.CONNECTED, media = null } = {}) {
  const listeners = { caststatechanged: [], sessionstatechanged: [] }
  const context = {
    _castState: castState,
    _session: { getCastDevice: () => ({ friendlyName: 'TV' }), getMediaSession: () => null },
    getCastState: () => context._castState,
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
    displayName: 'TV',
    title: media?.metadata?.title ?? null,
    controller: { addEventListener: () => {}, removeEventListener: () => {} },
  }
  globalThis.cast = {
    framework: {
      CastState,
      CastContextEventType: {
        CAST_STATE_CHANGED: 'caststatechanged',
        SESSION_STATE_CHANGED: 'sessionstatechanged',
      },
      RemotePlayerEventType: {},
      CastContext: { getInstance: () => context },
      RemotePlayer: function RemotePlayer() {
        return player
      },
      RemotePlayerController: function RemotePlayerController() {
        return {}
      },
    },
  }
  return { context, listeners }
}

describe('cast hint', () => {
  beforeEach(() => {
    globalThis.localStorage.clear()
  })

  afterEach(() => {
    delete globalThis.cast
  })

  it('is written when a session becomes visible, and names the title', () => {
    installSdk({ media: { contentId: 'https://x/a.mp4', metadata: { title: 'A Film' } } })
    const unsubscribe = subscribeCast(() => {})

    const hint = readCastHint()
    expect(hint).toMatchObject({ contentId: 'https://x/a.mp4', title: 'A Film', deviceName: 'TV' })
    unsubscribe()
  })

  it('is erased as soon as the SDK says nothing is casting', () => {
    const sdk = installSdk({ media: { contentId: 'https://x/a.mp4' } })
    const unsubscribe = subscribeCast(() => {})
    expect(readCastHint()).not.toBeNull()

    sdk.context._castState = CastState.NOT_CONNECTED
    for (const fn of sdk.listeners.caststatechanged) fn()

    expect(readCastHint()).toBeNull()
    unsubscribe()
  })

  it('expires rather than lingering for ever', () => {
    globalThis.localStorage.setItem(
      HINT_KEY,
      JSON.stringify({ contentId: 'https://x/a.mp4', at: Date.now() - 13 * 60 * 60 * 1000 })
    )
    expect(readCastHint()).toBeNull()
    // ...and it cleans up after itself rather than being re-read every load.
    expect(globalThis.localStorage.getItem(HINT_KEY)).toBeNull()
  })

  it('survives storage holding something that is not a hint at all', () => {
    globalThis.localStorage.setItem(HINT_KEY, 'not json {{{')
    expect(readCastHint()).toBeNull()
    expect(hintMatchesSource('https://x/a.mp4')).toBe(false)
  })

  it('matches the title it names, and only that one', () => {
    globalThis.localStorage.setItem(
      HINT_KEY,
      JSON.stringify({ contentId: 'https://x/a.mp4', at: Date.now() })
    )
    expect(hintMatchesSource('https://x/a.mp4')).toBe(true)
    expect(hintMatchesSource('https://x/b.mp4')).toBe(false)
    expect(hintMatchesSource(null)).toBe(false)
  })

  it('matches through contentUrl when the receiver rewrote contentId', () => {
    globalThis.localStorage.setItem(
      HINT_KEY,
      JSON.stringify({ contentId: 'entity-id', contentUrl: 'https://x/a.mp4', at: Date.now() })
    )
    expect(hintMatchesSource('https://x/a.mp4')).toBe(true)
  })

  it('remembers the route the session was started from', () => {
    installSdk({ media: { contentId: 'https://x/a.mp4' } })
    const unsubscribe = subscribeCast(() => {})

    rememberCastPath('/list/movie/Some%20Film/play')

    expect(readCastHint().path).toBe('/list/movie/Some%20Film/play')
    expect(readCastSnapshot().path).toBe('/list/movie/Some%20Film/play')
    unsubscribe()
  })

  it('keeps the route when later cast events rewrite the hint', () => {
    const sdk = installSdk({ media: { contentId: 'https://x/a.mp4' } })
    const unsubscribe = subscribeCast(() => {})
    // A distinct route per test: `castPath` is module state that outlives a
    // single test, so reusing one would pass even if nothing were written.
    rememberCastPath('/list/tv/Some%20Show/1/2/play')

    // Any cast event rewrites the whole hint; the route must survive it, or the
    // way back disappears the first time the receiver reports anything.
    for (const fn of sdk.listeners.sessionstatechanged) fn()

    expect(readCastHint().path).toBe('/list/tv/Some%20Show/1/2/play')
    unsubscribe()
  })

  it('forgets the route when the session ends', () => {
    const sdk = installSdk({ media: { contentId: 'https://x/a.mp4' } })
    const unsubscribe = subscribeCast(() => {})
    rememberCastPath('/list/movie/Another%20Film/play')

    sdk.context._castState = CastState.NOT_CONNECTED
    for (const fn of sdk.listeners.caststatechanged) fn()

    expect(readCastHint()).toBeNull()
    expect(readCastSnapshot().path).toBeNull()
    unsubscribe()
  })

  it('clearCastHint is safe with nothing stored', () => {
    expect(() => clearCastHint()).not.toThrow()
    expect(readCastHint()).toBeNull()
  })
})
