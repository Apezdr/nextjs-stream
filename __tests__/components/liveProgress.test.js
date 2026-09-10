/**
 * The newer-of-two rule behind every live progress surface: the server's
 * object (exact, frozen at render) versus the localStorage mirror (refreshed
 * every 5 s from the server rows, every second by this browser's player).
 */

const { pickLiveProgress, parseLocalEntry } = require('@src/components/WatchProgress/useLiveProgress')

const t = (iso) => new Date(iso).getTime()
const DURATION = 7_200_000

describe('pickLiveProgress', () => {
  const server = {
    playbackTime: 1800,
    progressPercent: 25,
    completed: false,
    lastWatched: '2026-09-09T10:00:00Z',
  }

  it('keeps the server object while it is the newer source', () => {
    const p = pickLiveProgress({ watchHistory: server, local: { playbackTime: 900, lastUpdated: t('2026-09-09T09:00:00Z') }, durationMs: DURATION })
    expect(p.playbackTime).toBe(1800)
    expect(p.progressPercent).toBe(25)
  })

  it('moves with the mirror once it is newer — the film playing on the Shield', () => {
    const p = pickLiveProgress({ watchHistory: server, local: { playbackTime: 3600, lastUpdated: t('2026-09-09T10:05:00Z') }, durationMs: DURATION })
    expect(p.playbackTime).toBe(3600)
    expect(p.progressPercent).toBe(50)
    expect(p.completed).toBe(false)
  })

  it('a local entry without a timestamp never overrides a dated server value', () => {
    const p = pickLiveProgress({ watchHistory: server, local: { playbackTime: 3600, lastUpdated: null }, durationMs: DURATION })
    expect(p.playbackTime).toBe(1800)
  })

  it('local fills in when the server has nothing yet', () => {
    const p = pickLiveProgress({ watchHistory: null, local: { playbackTime: 600, lastUpdated: null }, durationMs: DURATION })
    expect(p.playbackTime).toBe(600)
    expect(p.hasProgress).toBe(true)
    expect(pickLiveProgress({ watchHistory: null, local: null, durationMs: DURATION }).hasProgress).toBe(false)
  })

  it('a live position past the threshold reads as completed', () => {
    const p = pickLiveProgress({ watchHistory: server, local: { playbackTime: 6900, lastUpdated: t('2026-09-09T11:00:00Z') }, durationMs: DURATION })
    expect(p.completed).toBe(true)
  })
})

describe('parseLocalEntry', () => {
  it('reads the tracker/mirror shape and rejects junk', () => {
    expect(parseLocalEntry(JSON.stringify({ playbackTime: '77.5', lastUpdated: '2026-09-09T10:00:00Z' }))).toEqual({
      playbackTime: 77.5,
      lastUpdated: t('2026-09-09T10:00:00Z'),
    })
    expect(parseLocalEntry(JSON.stringify({ playbackTime: 0 }))).toBeNull()
    expect(parseLocalEntry('{nope')).toBeNull()
    expect(parseLocalEntry(null)).toBeNull()
  })
})
