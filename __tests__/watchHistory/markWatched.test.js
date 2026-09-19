/**
 * The "Mark watched" helper: the exact playback write it posts, the mirror
 * keys it primes, the SWR key it revalidates, and the three fixed messages
 * it throws (never a host, a path or the server's response text).
 */

jest.mock('swr', () => ({ __esModule: true, default: jest.fn(), mutate: jest.fn() }))

const { mutate } = require('swr')
const { markWatched, PLAYBACK_POSITION_KEY } = require('@components/WatchProgress/markWatched')

const VIDEO_URL = 'https://files.example.com/tv/Preacher/Season%201/S01E01.mp4'

const episode = {
  _id: '6a550c58025dd5c7f7266e71',
  mediaId: 'mid:0123456789abcdef:s01e01',
  videoURL: VIDEO_URL,
  durationMs: 3_841_000,
  showId: '6a550c57025dd5c7f7266e55',
  seasonNumber: 1,
  episodeNumber: 1,
}

const sentBody = () => JSON.parse(global.fetch.mock.calls[0][1].body)

beforeEach(() => {
  window.localStorage.clear()
  mutate.mockClear()
  mutate.mockResolvedValue(undefined)
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
})

describe('markWatched', () => {
  it('posts a seek to the runtime through updatePlayback, mirroring the player metadata', async () => {
    const result = await markWatched(episode)

    expect(result).toEqual({ playbackTime: 3841 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/authenticated/sync/updatePlayback')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' })

    const body = sentBody()
    expect(body.videoId).toBe(VIDEO_URL)
    expect(body.playbackTime).toBe(3841)
    expect(body.kind).toBe('seek')
    expect(body.isPaused).toBe(true)
    expect(body.sessionId).toBeUndefined()
    expect(body.mediaMetadata).toEqual({
      mediaType: 'tv',
      mediaId: '6a550c58025dd5c7f7266e71',
      showId: '6a550c57025dd5c7f7266e55',
      seasonNumber: 1,
      episodeNumber: 1,
    })
  })

  it('drops the keys it has no value for rather than sending undefined', async () => {
    await markWatched({ ...episode, _id: null, showId: null })

    const { mediaMetadata } = sentBody()
    expect(Object.keys(mediaMetadata).sort()).toEqual(['episodeNumber', 'mediaId', 'mediaType', 'seasonNumber'])
    // The durable id stands in for the document id
    expect(mediaMetadata.mediaId).toBe('mid:0123456789abcdef:s01e01')
  })

  it('keeps season 0 (Specials) as a real number', async () => {
    await markWatched({ ...episode, seasonNumber: 0 })
    expect(sentBody().mediaMetadata.seasonNumber).toBe(0)
  })

  it('primes the local mirror under the durable id and the URL, then revalidates the position key', async () => {
    const before = Date.now()
    await markWatched(episode)

    for (const key of [episode.mediaId, VIDEO_URL]) {
      const stored = JSON.parse(window.localStorage.getItem(key))
      expect(stored.playbackTime).toBe(3841)
      expect(new Date(stored.lastUpdated).getTime()).toBeGreaterThanOrEqual(before)
    }
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate).toHaveBeenCalledWith(PLAYBACK_POSITION_KEY(VIDEO_URL))
    expect(PLAYBACK_POSITION_KEY(VIDEO_URL)).toBe(`/api/authenticated/sync/playback?videoId=${encodeURIComponent(VIDEO_URL)}`)
  })

  it('mirrors only the URL when the episode has no durable id', async () => {
    await markWatched({ ...episode, mediaId: null })

    expect(window.localStorage.getItem(VIDEO_URL)).not.toBeNull()
    expect(window.localStorage.length).toBe(1)
  })

  it('throws the status number alone on a failed write, touching nothing locally', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error at files.example.com', json: async () => ({ error: '/mnt/media/tv' }) })

    await expect(markWatched(episode)).rejects.toThrow('Mark watched failed (500)')
    await expect(markWatched(episode)).rejects.not.toThrow(/example\.com|\/mnt/)
    expect(window.localStorage.length).toBe(0)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('refuses an episode with no playable file', async () => {
    await expect(markWatched({ ...episode, videoURL: null })).rejects.toThrow('This episode has no playable file')
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses an episode whose runtime is unknown', async () => {
    await expect(markWatched({ ...episode, durationMs: null })).rejects.toThrow('Runtime unknown')
    await expect(markWatched({ ...episode, durationMs: 0 })).rejects.toThrow('Runtime unknown')
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
