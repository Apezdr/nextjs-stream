/**
 * The web's progress surfaces (rail card bar, popup row, details panel) all
 * read through these helpers, so the clock format and the completion rule
 * are pinned here once.
 */

const { formatClock, readProgress, durationMsFrom, canShowProgress } = require('@src/components/WatchProgress/progress')

describe('formatClock', () => {
  it('always shows zero-padded hours so position and runtime line up', () => {
    expect(formatClock(0)).toBe('00:00:00')
    expect(formatClock(59)).toBe('00:00:59')
    expect(formatClock(4354.6)).toBe('01:12:34')
    expect(formatClock(7314.724)).toBe('02:01:54')
    expect(formatClock(NaN)).toBe('00:00:00')
    expect(formatClock(-5)).toBe('00:00:00')
  })
})

describe('readProgress', () => {
  it('prefers the server fields and renders "HH:MM:SS / HH:MM:SS"', () => {
    const p = readProgress({
      watchHistory: { playbackTime: 6472.66, progressPercent: 88.5, completed: false },
      durationMs: 7314724,
    })
    expect(p.clock).toBe('01:47:52 / 02:01:54')
    expect(p.progressPercent).toBe(88.5)
    expect(p.completed).toBe(false)
    expect(p.hasProgress).toBe(true)
  })

  it('computes locally for payloads without the computed fields, with the same 95% rule', () => {
    expect(readProgress({ watchHistory: { playbackTime: 3600 }, durationMs: 7_200_000 })).toMatchObject({
      progressPercent: 50,
      completed: false,
    })
    expect(readProgress({ playbackTime: 6900, durationMs: 7_200_000 })).toMatchObject({
      progressPercent: 95.8,
      completed: true,
    })
  })

  it('reports no progress for an unwatched or missing row', () => {
    expect(readProgress({ watchHistory: null, durationMs: 7_200_000 }).hasProgress).toBe(false)
    expect(readProgress({ watchHistory: { playbackTime: 0, progressPercent: 0, completed: false } }).hasProgress).toBe(false)
    expect(readProgress({}).clock).toBe('00:00:00')
  })

  it('falls back to a position-only clock when the runtime is unknown', () => {
    expect(readProgress({ playbackTime: 125 }).clock).toBe('00:02:05')
  })
})

describe('durationMsFrom and canShowProgress', () => {
  it('reads milliseconds first, TMDB minutes as the last resort', () => {
    expect(durationMsFrom({ duration: 7314724 })).toBe(7314724)
    expect(durationMsFrom({ duration: '7314724' })).toBe(7314724)
    expect(durationMsFrom({ metadata: { runtime: 100 } })).toBe(6_000_000)
    expect(durationMsFrom({})).toBeNull()
  })

  it('movies and specific episodes carry a position; a whole show does not', () => {
    expect(canShowProgress({ type: 'movie' })).toBe(true)
    expect(canShowProgress({ type: 'tv', seasonNumber: 3, episodeNumber: 15 })).toBe(true)
    expect(canShowProgress({ type: 'tv' })).toBe(false)
    expect(canShowProgress({ type: 'tv', seasonNumber: 3, episodeNumber: null })).toBe(false)
  })
})
