/**
 * The "Mark watched" helper: the exact playback write it posts (the viewer's
 * own statement, kind 'mark'), the row it hands the positions store from the
 * save's answer (no time made in the browser, nothing put in localStorage),
 * and the three fixed messages it throws (never a host, a path or the
 * server's response text).
 */

const mockStore = { reportChanged: jest.fn() }
jest.mock('@components/WatchProgress/playbackStore', () => ({ playbackStore: mockStore }))

const { markWatched } = require('@components/WatchProgress/markWatched')

const VIDEO_URL = 'https://files.example.com/tv/Example%20Show/Season%201/S01E01.mp4'
const SAVED_AT = '2026-11-16T20:00:00.000Z'

const episode = {
  _id: '6a550c58025dd5c7f7266e71',
  mediaId: 'mid:0123456789abcdef:s01e01',
  normalizedVideoId: 'nid-s01e01',
  videoURL: VIDEO_URL,
  durationMs: 3_841_000,
  showId: '6a550c57025dd5c7f7266e55',
  seasonNumber: 1,
  episodeNumber: 1,
}

const sentBody = () => JSON.parse(global.fetch.mock.calls[0][1].body)
const saved = (body = {}) => ({
  ok: true,
  status: 200,
  json: async () => ({ message: 'Playback status updated successfully', acknowledged: true, kind: 'mark', savedAt: SAVED_AT, outcome: 'created', ...body }),
})

const setItem = jest.spyOn(Storage.prototype, 'setItem')

beforeEach(() => {
  jest.clearAllMocks()
  window.localStorage.clear()
  setItem.mockClear()
  global.fetch = jest.fn().mockResolvedValue(saved())
})

const PAGE = { userId: 'u1' }

describe('markWatched', () => {
  it('posts a mark at the runtime through updatePlayback, with the player’s metadata', async () => {
    const result = await markWatched(episode, PAGE)

    expect(result).toEqual({ playbackTime: 3841 })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('/api/authenticated/sync/updatePlayback')
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('include')
    // ...naming the user the page was rendered for, whom the server checks the session against
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Playback-User': 'u1' })

    const body = sentBody()
    expect(body.videoId).toBe(VIDEO_URL)
    expect(body.playbackTime).toBe(3841)
    // The viewer's statement, not a player's report: it creates the row whatever the position
    expect(body.kind).toBe('mark')
    expect(body.isPaused).toBe(true)
    // A mark that named a session or a cast would be refused
    expect(body.sessionId).toBeUndefined()
    expect(body.source).toBeUndefined()
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

  it('hands the store the row from the save’s answer: the position sent and the server’s time, under the title’s two ids', async () => {
    await markWatched(episode, PAGE)

    expect(mockStore.reportChanged).toHaveBeenCalledTimes(1)
    expect(mockStore.reportChanged).toHaveBeenCalledWith({
      userId: 'u1',
      keys: [{ mediaId: 'mid:0123456789abcdef:s01e01', normalizedVideoId: 'nid-s01e01' }],
      saved: { mediaId: 'mid:0123456789abcdef:s01e01', normalizedVideoId: 'nid-s01e01', playbackTime: 3841, savedAt: SAVED_AT },
    })
  })

  it('makes no time of its own, and puts nothing in localStorage', async () => {
    const now = jest.spyOn(Date, 'now')
    await markWatched(episode, PAGE)

    expect(now).not.toHaveBeenCalled()
    expect(setItem).not.toHaveBeenCalled()
    expect(window.localStorage.length).toBe(0)
    now.mockRestore()
  })

  it('an episode with no durable id is filed by its hash alone; a document id is no identity', async () => {
    await markWatched({ ...episode, mediaId: '64b7f0c2a1b2c3d4e5f60799' }, PAGE)

    expect(mockStore.reportChanged.mock.calls[0][0].keys).toEqual([{ mediaId: null, normalizedVideoId: 'nid-s01e01' }])
  })

  it('an answer with no savedAt still tells the tabs the title changed, and shows no row it cannot date', async () => {
    global.fetch.mockResolvedValue(saved({ savedAt: null, outcome: 'held' }))
    await markWatched(episode, PAGE)
    expect(mockStore.reportChanged).toHaveBeenCalledWith(expect.objectContaining({ saved: null, keys: [expect.any(Object)] }))

    // An answer that is not JSON at all
    mockStore.reportChanged.mockClear()
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => Promise.reject(new SyntaxError('Unexpected token')) })
    await expect(markWatched(episode, PAGE)).resolves.toEqual({ playbackTime: 3841 })
    expect(mockStore.reportChanged).toHaveBeenCalledWith(expect.objectContaining({ saved: null }))
  })

  it('says to reload when the session has become another account’s since the page was rendered', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'USER_MISMATCH' }) })
    await expect(markWatched(episode, PAGE)).rejects.toThrow('This page was opened for another account. Reload it.')
    expect(mockStore.reportChanged).not.toHaveBeenCalled()
  })

  it('a page rendered for no one names no one (the server refuses it)', async () => {
    await markWatched(episode)
    expect(global.fetch.mock.calls[0][1].headers).toEqual({ 'Content-Type': 'application/json' })
  })

  it('throws the status number alone on a failed write, telling the store nothing', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error at files.example.com', json: async () => ({ error: '/mnt/media/tv' }) })

    await expect(markWatched(episode)).rejects.toThrow('Mark watched failed (500)')
    await expect(markWatched(episode)).rejects.not.toThrow(/example\.com|\/mnt/)
    expect(mockStore.reportChanged).not.toHaveBeenCalled()
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
