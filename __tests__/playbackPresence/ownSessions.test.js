/**
 * @jest-environment node
 *
 * A user's own live sessions (plans/media-activity-presence.md, "A user's own
 * sessions"): GET /api/authenticated/presence, and `watchingNow` on
 * /api/authenticated/media next to watchHistory. Same reader, shape, ranking
 * and title rule as the admin surfaces, minus the addresses and the raw user
 * agent, and always the caller's own.
 */

const mockFindLiveSessions = jest.fn()
jest.mock('@src/utils/playbackPresence/live', () => ({
  __esModule: true,
  findLiveSessions: (...args) => mockFindLiveSessions(...args),
}))

const mockGate = jest.fn()
jest.mock('@src/lib/roles/gates', () => ({
  approvedGate: { route: (...args) => mockGate(...args) },
}))

const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))

// The media route's collaborators that are not under test here
jest.mock('@src/utils/jit/preference', () => ({ applyJitPreference: jest.fn(async () => {}) }))
jest.mock('@src/utils/watchHistoryUtils', () => ({ addWatchHistoryToItems: jest.fn(async (items) => items) }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/roles/libraryAccess', () => ({ libraryAccessFor: jest.fn(async () => ({ all: true })) }))
const mockGetFlatRequestedMedia = jest.fn()
const mockSeasonEpisodes = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  getFlatRequestedMedia: (...args) => mockGetFlatRequestedMedia(...args),
  getFlatTVSeasonWithEpisodes: (...args) => mockSeasonEpisodes(...args),
  getVisibleEpisodeCountBySeason: jest.fn(async () => new Map([[2, 10]])),
}))

const { toOwnSession, watchingNowFor } = require('@src/utils/playbackPresence/personal')
const { GET: presenceGET } = require('@src/app/api/authenticated/presence/route')
const { GET: mediaGET } = require('@src/app/api/authenticated/media/route')

const USER = '507f1f77bcf86cd799439011'
const SHOW = '64b000000000000000000001'
const OTHER_SHOW = '64b000000000000000000002'

function session(overrides = {}) {
  return {
    id: '6740000000000000000000a1',
    sessionId: 'tv-session-1',
    userId: USER,
    videoId: 'https://files.example.com/tv/s02e07.mp4',
    normalizedVideoId: 'nid-s02e07',
    mediaId: 'mid:s02e07',
    mediaType: 'tv',
    showId: SHOW,
    seasonNumber: 2,
    episodeNumber: 7,
    state: 'playing',
    position: 2472,
    positionAt: '2026-11-09T20:00:00.000Z',
    device: { type: 'tv', label: 'TV', platform: 'Android', userAgent: 'NextJSStreamTVApp/1.0.0 (android; tv; SHIELD)' },
    ipAddress: '203.0.113.5',
    localIp: '192.168.1.20',
    lastHeartbeat: '2026-11-09T20:00:00.000Z',
    staleAfter: '2026-11-09T20:01:00.000Z',
    ...overrides,
  }
}

const episodeOnTv = session()
const pausedMovieOnCast = session({
  id: '6740000000000000000000a2',
  sessionId: 'cast:3f2b6c1e-8a4d-4f0b-9c2e-5d7a1b0e6f42',
  videoId: 'https://files.example.com/movies/film.mp4',
  normalizedVideoId: 'nid-film',
  mediaId: 'mid:film',
  mediaType: 'movie',
  showId: null,
  seasonNumber: null,
  episodeNumber: null,
  state: 'paused',
  device: { type: 'cast', label: 'Cast', platform: 'Cast', userAgent: null },
})
const otherShowEpisode = session({
  id: '6740000000000000000000a3',
  sessionId: 'web-session-9',
  normalizedVideoId: 'nid-other',
  mediaId: 'mid:other',
  showId: OTHER_SHOW,
  seasonNumber: 1,
  episodeNumber: 1,
})
const ALL = [episodeOnTv, pausedMovieOnCast, otherShowEpisode]

beforeEach(() => {
  jest.clearAllMocks()
  mockGate.mockResolvedValue({ id: USER })
  mockFindLiveSessions.mockResolvedValue(ALL)
})

describe('the shape a user sees of their own sessions', () => {
  it('keeps what a "Playing on TV · 41:12" line needs, and drops the addresses and the user agent', () => {
    const own = toOwnSession(episodeOnTv)
    expect(own).not.toHaveProperty('ipAddress')
    expect(own).not.toHaveProperty('localIp')
    expect(own).not.toHaveProperty('userId')
    expect(own.device).toEqual({ type: 'tv', label: 'TV', platform: 'Android' })
    expect(own).toMatchObject({ state: 'playing', position: 2472, mediaId: 'mid:s02e07', seasonNumber: 2, episodeNumber: 7 })
  })
})

describe('watchingNowFor: what a media payload is about', () => {
  const own = ALL.map(toOwnSession)

  it('a movie: sessions on that title', () => {
    const movie = { _id: 'm1', type: 'movie', mediaId: 'mid:film', normalizedVideoId: 'nid-film' }
    expect(watchingNowFor(movie, own).map((s) => s.sessionId)).toEqual([pausedMovieOnCast.sessionId])
  })

  it('an episode: sessions on that episode, by mediaId even after a file swap', () => {
    const episode = { type: 'tv', showId: SHOW, seasonNumber: 2, episodeNumber: 7, mediaId: 'mid:s02e07', normalizedVideoId: 'nid-newfile' }
    expect(watchingNowFor(episode, own).map((s) => s.sessionId)).toEqual(['tv-session-1'])
  })

  it('a season: sessions on any of its episodes, and only its own', () => {
    expect(watchingNowFor({ type: 'tv', showId: SHOW, seasonNumber: 2 }, own)).toHaveLength(1)
    expect(watchingNowFor({ type: 'tv', showId: SHOW, seasonNumber: 1 }, own)).toHaveLength(0)
  })

  it('a show: sessions on any of its episodes, each naming its episode', () => {
    const [only] = watchingNowFor({ _id: SHOW, type: 'tv', seasons: [] }, own)
    expect(only).toMatchObject({ seasonNumber: 2, episodeNumber: 7, mediaId: 'mid:s02e07' })
  })

  it('Specials are a season too', () => {
    const special = toOwnSession(session({ seasonNumber: 0, episodeNumber: 3 }))
    expect(watchingNowFor({ type: 'tv', showId: SHOW, seasonNumber: 0 }, [special])).toHaveLength(1)
  })
})

describe('GET /api/authenticated/presence', () => {
  const get = (query = '') =>
    presenceGET(new Request(`https://cinema.example/api/authenticated/presence${query ? `?${query}` : ''}`))

  it('returns the caller’s own sessions, never cached', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store, private')
    const { sessions, asOf } = await res.json()
    expect(sessions).toHaveLength(3)
    expect(sessions[0]).not.toHaveProperty('ipAddress')
    // The server's clock, for a client that moves a playing position on between polls
    expect(Number.isFinite(Date.parse(asOf))).toBe(true)
    expect(mockFindLiveSessions).toHaveBeenCalledWith({ userIds: [USER] })
  })

  it('has no userId parameter: it is always the caller', async () => {
    await get('userId=64b0000000000000000000ff')
    expect(mockFindLiveSessions).toHaveBeenCalledWith({ userIds: [USER] })
  })

  it('filters to one title, a show, or a season', async () => {
    const title = await (await get('mediaId=mid:film')).json()
    expect(title.sessions.map((s) => s.mediaId)).toEqual(['mid:film'])

    const show = await (await get(`showId=${SHOW}`)).json()
    expect(show.sessions.map((s) => s.mediaId)).toEqual(['mid:s02e07'])

    const season = await (await get(`showId=${SHOW}&season=1`)).json()
    expect(season.sessions).toEqual([])
  })

  it('refuses filters it cannot answer', async () => {
    expect((await get(`mediaId=mid:film&showId=${SHOW}`)).status).toBe(400)
    expect((await get('showId=not-an-id')).status).toBe(400)
    expect((await get('season=2')).status).toBe(400)
    expect((await get(`showId=${SHOW}&season=two`)).status).toBe(400)
    expect((await get(`showId=${SHOW}&season=-1`)).status).toBe(400)
    expect(mockFindLiveSessions).not.toHaveBeenCalled()
  })

  it('a signed-out or unapproved caller gets the gate’s answer', async () => {
    mockGate.mockResolvedValue(new Response(null, { status: 401 }))
    expect((await get()).status).toBe(401)
    expect(mockFindLiveSessions).not.toHaveBeenCalled()
  })

  it('a failed read is an error, not "watching nothing"', async () => {
    mockFindLiveSessions.mockRejectedValue(new Error('mongo down'))
    expect((await get()).status).toBe(500)
  })
})

describe('watchingNow on /api/authenticated/media', () => {
  const get = async (query) =>
    (await mediaGET(new Request(`https://cinema.example/api/authenticated/media?${query}`))).json()

  const movie = { _id: 'm1', type: 'movie', title: 'Film', originalTitle: 'Film', mediaId: 'mid:film', normalizedVideoId: 'nid-film', videoURL: 'https://files.example.com/movies/film.mp4' }
  const showDoc = { _id: SHOW, id: SHOW, type: 'tv', title: 'Show', originalTitle: 'Show', seasons: [{ seasonNumber: 2 }], metadata: {} }
  const seasonDoc = { id: 'season-2', showId: SHOW, type: 'tv', title: 'Show', originalTitle: 'Show', seasonNumber: 2, metadata: {} }

  it('comes with watchHistory, under the same flag', async () => {
    mockGetFlatRequestedMedia.mockResolvedValue(movie)
    const body = await get('mediaType=movie&mediaTitle=Film&includeWatchHistory=true')
    expect(body.watchingNow.map((s) => s.mediaId)).toEqual(['mid:film'])
    expect(body.watchingNow[0]).not.toHaveProperty('ipAddress')
  })

  it('is not read at all without the flag', async () => {
    mockGetFlatRequestedMedia.mockResolvedValue(movie)
    const body = await get('mediaType=movie&mediaTitle=Film')
    expect(body).not.toHaveProperty('watchingNow')
    expect(mockFindLiveSessions).not.toHaveBeenCalled()
  })

  it('is empty when nothing is live on the title', async () => {
    mockGetFlatRequestedMedia.mockResolvedValue({ ...movie, mediaId: 'mid:another', normalizedVideoId: 'nid-another' })
    expect((await get('mediaType=movie&mediaTitle=Another&includeWatchHistory=true')).watchingNow).toEqual([])
  })

  it('is absent, not empty, when the sessions could not be read', async () => {
    mockGetFlatRequestedMedia.mockResolvedValue(movie)
    mockFindLiveSessions.mockRejectedValue(new Error('mongo down'))
    const body = await get('mediaType=movie&mediaTitle=Film&includeWatchHistory=true')
    expect(body).not.toHaveProperty('watchingNow')
    expect(body.title).toBe('Film')
  })

  it('on the TV app’s show page: sessions on any episode', async () => {
    mockGetFlatRequestedMedia.mockResolvedValue(showDoc)
    const body = await get(`mediaType=tv&mediaId=${SHOW}&isTVdevice=true&includeWatchHistory=true`)
    expect(body.watchingNow.map((s) => [s.seasonNumber, s.episodeNumber])).toEqual([[2, 7]])
  })

  it('on the TV app’s season page: the season’s sessions, and each episode’s own', async () => {
    mockGetFlatRequestedMedia.mockImplementation(async (request) => (request.season ? seasonDoc : showDoc))
    mockSeasonEpisodes.mockResolvedValue({
      episodes: [
        { episodeNumber: 6, title: 'Six', mediaId: 'mid:s02e06', normalizedVideoId: 'nid-s02e06' },
        { episodeNumber: 7, title: 'Seven', mediaId: 'mid:s02e07', normalizedVideoId: 'nid-s02e07' },
      ],
    })
    const body = await get(`mediaType=tv&mediaId=${SHOW}&season=2&isTVdevice=true&includeWatchHistory=true`)
    expect(body.watchingNow).toHaveLength(1)
    expect(body.episodes.map((e) => e.watchingNow.length)).toEqual([0, 1])
  })
})
