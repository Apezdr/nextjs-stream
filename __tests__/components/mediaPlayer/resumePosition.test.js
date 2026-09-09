/**
 * Where the web player starts — the pure half of useResumePosition.
 *
 * Two things went wrong here before: `?start=0` (the next-episode card's
 * link) was treated as "no deep link", so a finished episode reopened in its
 * credits; and an Activity re-show resumed at the SSR position frozen from
 * the original render, then heartbeated over a newer position the TV app
 * had written meanwhile.
 */

const {
  parseExplicitStart,
  pickResume,
  resolveInitialResume,
  readLocalResume,
} = require('@src/components/MediaPlayer/resumePosition')

describe('parseExplicitStart', () => {
  it('treats a present zero as an explicit restart, absent as null', () => {
    expect(parseExplicitStart('0')).toBe(0)
    expect(parseExplicitStart(0)).toBe(0)
    expect(parseExplicitStart('125.5')).toBe(125.5)
    expect(parseExplicitStart(null)).toBeNull()
    expect(parseExplicitStart(undefined)).toBeNull()
    expect(parseExplicitStart('')).toBeNull()
    expect(parseExplicitStart(false)).toBeNull()
    expect(parseExplicitStart('abc')).toBeNull()
    expect(parseExplicitStart('-5')).toBeNull()
  })
})

describe('pickResume', () => {
  const t = (iso) => new Date(iso).getTime()

  it('the newer of the server row and localStorage wins', () => {
    const server = { playbackTime: 900, lastUpdated: t('2026-09-08T10:00:00Z') }
    const local = { playbackTime: 130, lastUpdated: t('2026-09-08T09:00:00Z') }
    expect(pickResume(server, local)).toBe(900)
    expect(pickResume({ ...server, lastUpdated: t('2026-09-08T08:00:00Z') }, local)).toBe(130)
  })

  it('a side without a timestamp loses to one with', () => {
    expect(pickResume({ playbackTime: 100, lastUpdated: null }, { playbackTime: 130, lastUpdated: t('2026-09-08T09:00:00Z') })).toBe(130)
    expect(pickResume({ playbackTime: 100, lastUpdated: t('2026-09-08T09:00:00Z') }, { playbackTime: 130, lastUpdated: null })).toBe(100)
  })

  it('falls through to whichever side has a position, and restarts a completed row', () => {
    expect(pickResume(null, { playbackTime: 130, lastUpdated: null })).toBe(130)
    expect(pickResume({ playbackTime: 0, lastUpdated: null }, null)).toBe(0)
    expect(pickResume({ playbackTime: 7100, lastUpdated: t('2026-09-08T10:00:00Z'), completed: true }, { playbackTime: 130, lastUpdated: t('2026-09-09T10:00:00Z') })).toBe(0)
  })
})

describe('resolveInitialResume', () => {
  beforeEach(() => window.localStorage.clear())

  it('explicit start (including 0) outranks saved history', () => {
    window.localStorage.setItem('mid:abc', JSON.stringify({ playbackTime: 500, lastUpdated: '2026-09-08T00:00:00Z' }))
    expect(resolveInitialResume({ explicitStart: 0, savedPlaybackTime: 900, mediaId: 'mid:abc', videoURL: 'https://h/x.mp4' })).toBe(0)
    expect(resolveInitialResume({ explicitStart: 42, savedPlaybackTime: 900, mediaId: 'mid:abc', videoURL: 'https://h/x.mp4' })).toBe(42)
  })

  it('then the server position, then localStorage, then null', () => {
    expect(resolveInitialResume({ explicitStart: null, savedPlaybackTime: 900, mediaId: 'mid:abc', videoURL: 'https://h/x.mp4' })).toBe(900)
    window.localStorage.setItem('mid:abc', JSON.stringify({ playbackTime: 500, lastUpdated: '2026-09-08T00:00:00Z' }))
    expect(resolveInitialResume({ explicitStart: null, savedPlaybackTime: 0, mediaId: 'mid:abc', videoURL: 'https://h/x.mp4' })).toBe(500)
    window.localStorage.clear()
    expect(resolveInitialResume({ explicitStart: null, savedPlaybackTime: null, mediaId: null, videoURL: 'https://h/y.mp4' })).toBeNull()
  })

  it('readLocalResume tolerates garbage and reads the legacy URL key', () => {
    window.localStorage.setItem('https://h/x.mp4', '{not json')
    expect(readLocalResume({ mediaId: null, videoURL: 'https://h/x.mp4' })).toBeNull()
    window.localStorage.setItem('https://h/x.mp4', JSON.stringify({ playbackTime: '77', lastUpdated: '2026-09-08T00:00:00Z' }))
    expect(readLocalResume({ mediaId: 'mid:new', videoURL: 'https://h/x.mp4' })).toEqual({
      playbackTime: 77,
      lastUpdated: new Date('2026-09-08T00:00:00Z').getTime(),
    })
  })
})
