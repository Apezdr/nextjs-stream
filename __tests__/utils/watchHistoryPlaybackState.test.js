import {
  PLAYBACK_END_STATES,
  derivePlaybackEndState,
  normalizePlaybackEndState,
} from '@src/utils/watchHistory/playbackState'

function element(overrides = {}) {
  return {
    error: null,
    ended: false,
    paused: false,
    isConnected: true,
    ...overrides,
  }
}

describe('normalizePlaybackEndState', () => {
  test.each(PLAYBACK_END_STATES)('accepts %s', (state) => {
    expect(normalizePlaybackEndState(state)).toBe(state)
  })

  test('is case and whitespace tolerant', () => {
    expect(normalizePlaybackEndState('  Buffering ')).toBe('buffering')
  })

  test('rejects anything the UI cannot render', () => {
    for (const bad of ['', 'stalled', '<script>', 42, null, undefined, {}, ['paused']]) {
      expect(normalizePlaybackEndState(bad)).toBeNull()
    }
  })
})

describe('derivePlaybackEndState', () => {
  test('reports a fatal error above every other signal', () => {
    expect(
      derivePlaybackEndState({ element: element({ error: { code: 3 }, ended: true, paused: true }) })
    ).toBe('error')
    expect(derivePlaybackEndState({ element: null, hadFatalError: true, paused: true })).toBe('error')
  })

  test('reports a finished stream as ended, not the pause the browser applies', () => {
    expect(derivePlaybackEndState({ element: element({ ended: true, paused: true }) })).toBe('ended')
  })

  test('reports paused ahead of buffering', () => {
    expect(derivePlaybackEndState({ element: element({ paused: true }), buffering: true })).toBe('paused')
  })

  test('reports a stall as buffering', () => {
    expect(derivePlaybackEndState({ element: element(), buffering: true })).toBe('buffering')
  })

  test('reports an active stream as playing', () => {
    expect(derivePlaybackEndState({ element: element() })).toBe('playing')
  })

  test('ignores paused on a detached element and falls back to the tracked flag', () => {
    const detached = element({ paused: true, isConnected: false })
    expect(derivePlaybackEndState({ element: detached, paused: false })).toBe('playing')
    expect(derivePlaybackEndState({ element: detached, paused: false, buffering: true })).toBe('buffering')
    expect(derivePlaybackEndState({ element: detached, paused: true })).toBe('paused')
  })

  test('defaults to playing with no information rather than throwing', () => {
    expect(derivePlaybackEndState()).toBe('playing')
    expect(derivePlaybackEndState({})).toBe('playing')
  })

  test('only ever returns a value the API boundary accepts', () => {
    const cases = [
      { element: element({ error: {} }) },
      { element: element({ ended: true }) },
      { element: element({ paused: true }) },
      { element: element(), buffering: true },
      { element: element() },
    ]
    for (const input of cases) {
      expect(normalizePlaybackEndState(derivePlaybackEndState(input))).not.toBeNull()
    }
  })
})