/**
 * @jest-environment node
 *
 * /api/authenticated/media and a watch history that cannot be read.
 *
 * The TV and mobile apps start playback from this answer: the video URL and
 * the position arrive together. A failed history read used to answer as if
 * the title had never been played, so the app started at 0 and its first
 * save replaced the stored position. A request about one title now fails
 * (503) instead, and the apps show their retry card.
 *
 * Lists keep degrading, here (the season page's episode list) and in the
 * joins the list routes share: they only draw progress bars.
 */

const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve(mockMongo.client) }))
jest.mock('@src/lib/logger', () => ({
  __esModule: true,
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

const USER = '507f1f77bcf86cd799439011'
jest.mock('@src/lib/roles/gates', () => ({
  approvedGate: { route: jest.fn(async () => ({ id: '507f1f77bcf86cd799439011' })) },
}))
jest.mock('@src/lib/roles/libraryAccess', () => ({ libraryAccessFor: jest.fn(async () => ({ id: 'all', scope: null, showIds: null })) }))
jest.mock('@src/utils/jit/preference', () => ({ applyJitPreference: jest.fn(async () => {}) }))
jest.mock('@src/utils/playbackPresence/personal', () => ({
  findOwnLiveSessions: jest.fn(async () => []),
  watchingNowFor: jest.fn(() => []),
}))
const mockGetFlatRequestedMedia = jest.fn()
const mockSeasonEpisodes = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  getFlatRequestedMedia: (...args) => mockGetFlatRequestedMedia(...args),
  getFlatTVSeasonWithEpisodes: (...args) => mockSeasonEpisodes(...args),
  getVisibleEpisodeCountBySeason: jest.fn(async () => new Map([[1, 2]])),
  // The joins hash URLs with the one production implementation
  generateNormalizedVideoId: jest.requireActual('@src/utils/videoIdentity').generateNormalizedVideoId,
}))

const { GET } = require('@src/app/api/authenticated/media/route')
const { addWatchHistoryToItems, createWatchHistoryLookupMap } = require('@src/utils/watchHistoryUtils')
const { generateNormalizedVideoId } = require('@src/utils/videoIdentity')

const history = () => mockMongo.collection('Media', 'WatchHistory')

const MOVIE_URL = 'https://files.example/movies/Family%20Film%20(2001)/family.film.mp4'
const MOVIE_NID = generateNormalizedVideoId(MOVIE_URL)
const movie = () => ({
  _id: 'm1',
  id: 'm1',
  type: 'movie',
  title: 'Family Film',
  originalTitle: 'Family Film (2001)',
  posterURL: 'https://files.example/poster.jpg',
  videoURL: MOVIE_URL,
  normalizedVideoId: MOVIE_NID,
  mediaId: 'mid:family',
  duration: 2 * 60 * 60 * 1000,
  metadata: { overview: 'Plot', genres: [] },
})
const show = () => ({
  _id: 'show-1',
  id: 'show-1',
  type: 'tv',
  title: 'A Show',
  originalTitle: 'A Show',
  posterURL: 'https://files.example/show.jpg',
  seasons: [{ seasonNumber: 1 }],
  metadata: { overview: 'Plot', genres: [] },
})
const EPISODE_URL = 'https://files.example/tv/A%20Show/Season%201/e2.mp4'
const episode = (number = 2) => ({
  ...show(),
  seasonNumber: 1,
  episodeNumber: number,
  videoURL: EPISODE_URL.replace('e2', `e${number}`),
  normalizedVideoId: generateNormalizedVideoId(EPISODE_URL.replace('e2', `e${number}`)),
  mediaId: `mid:show-s1e${number}`,
  duration: 40 * 60 * 1000,
})
const season = () => ({ ...show(), seasonNumber: 1 })

const row = (overrides = {}) => ({
  _id: `row-${history().docs.length + 1}`,
  userId: USER,
  videoId: MOVIE_URL,
  normalizedVideoId: MOVIE_NID,
  mediaId: 'mid:family',
  playbackTime: 1800,
  lastUpdated: new Date('2026-11-10T20:00:00.000Z'),
  mediaType: 'movie',
  ...overrides,
})

const get = (query) => GET(new Request(`https://cinema.example/api/authenticated/media?${query}`))

/** The history cannot be read: every query on it throws, as with the database gone. */
function breakHistory() {
  return jest.spyOn(history(), 'find').mockImplementation(() => {
    throw new Error('connection closed')
  })
}

let consoleError
beforeEach(() => {
  jest.restoreAllMocks()
  jest.clearAllMocks()
  history().docs.length = 0
  mockGetFlatRequestedMedia.mockImplementation(async (request) =>
    request.type === 'movie' ? movie() : request.episode ? episode() : request.season ? season() : show()
  )
  mockSeasonEpisodes.mockResolvedValue({ episodes: [episode(1), episode(2)] })
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('a request about one title, when the history is read', () => {
  it('carries the row as watchHistory', async () => {
    history().docs.push(row())

    const response = await get('mediaType=movie&mediaOriginalTitle=Family%20Film%20(2001)&includeWatchHistory=true')

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.videoURL).toBe(MOVIE_URL)
    expect(body.watchHistory).toEqual({
      playbackTime: 1800,
      lastWatched: '2026-11-10T20:00:00.000Z',
      isWatched: true,
      completed: false,
      progressPercent: 25,
      normalizedVideoId: MOVIE_NID,
      mediaId: 'mid:family',
    })
  })

  it('with no row, says so: an empty watchHistory from a read that was made', async () => {
    const body = await (await get('mediaType=movie&mediaOriginalTitle=Family%20Film%20(2001)&includeWatchHistory=true')).json()

    expect(body.watchHistory).toEqual({
      playbackTime: 0,
      lastWatched: null,
      isWatched: false,
      completed: false,
      progressPercent: 0,
      normalizedVideoId: MOVIE_NID,
      mediaId: 'mid:family',
    })
  })

  it('reads the title’s rows by its keys, not the user’s whole history; by URL only when those find nothing', async () => {
    history().docs.push(row())
    const find = jest.spyOn(history(), 'find')

    await get('mediaType=movie&mediaOriginalTitle=Family%20Film%20(2001)&includeWatchHistory=true')

    expect(find).toHaveBeenCalledTimes(1)
    const [{ userId, ...filter }] = find.mock.calls[0]
    expect(String(userId)).toBe(USER)
    expect(filter.$or).toEqual([
      { mediaId: { $in: ['mid:family'] } },
      { normalizedVideoId: { $in: [MOVIE_NID, MOVIE_URL] } },
    ])

    // A row from before URLs were hashed as they are now: found by its URL, on the second read
    history().docs[0] = row({ normalizedVideoId: 'legacyhash0000001', mediaId: undefined, playbackTime: 900 })
    find.mockClear()
    const body = await (await get('mediaType=movie&mediaOriginalTitle=Family%20Film%20(2001)&includeWatchHistory=true')).json()
    expect(body.watchHistory).toMatchObject({ isWatched: true, playbackTime: 900 })
    expect(find).toHaveBeenCalledTimes(2)
    expect(find.mock.calls[1][0].videoId).toEqual({ $in: [MOVIE_NID, MOVIE_URL] })
  })
})

describe('a row the sync flagged (isValid:false)', () => {
  const MOVIE = 'mediaType=movie&mediaOriginalTitle=Family%20Film%20(2001)&includeWatchHistory=true'
  const watchHistoryOf = async (query) => (await (await get(query)).json()).watchHistory

  it('is the title’s position when the title is asked about: it was just resolved, so the flag is stale', async () => {
    history().docs.push(row({ isValid: false, playbackTime: 2100 }))

    expect(await watchHistoryOf(MOVIE)).toMatchObject({ isWatched: true, playbackTime: 2100, progressPercent: 29.2 })
  })

  it('found by its URL alone, too', async () => {
    history().docs.push(row({ isValid: false, normalizedVideoId: 'legacyhash0000001', mediaId: undefined, playbackTime: 900 }))

    expect(await watchHistoryOf(MOVIE)).toMatchObject({ isWatched: true, playbackTime: 900 })
  })

  it('gives way to a row that is not flagged, whichever key each matches by', async () => {
    // Flagged: the title's durable id, under an old file's hash, and the newer of the two
    history().docs.push(
      row({ isValid: false, normalizedVideoId: 'nid-old-file', playbackTime: 2100, lastUpdated: new Date('2026-11-12T20:00:00.000Z') }),
      row({ mediaId: undefined, playbackTime: 600, lastUpdated: new Date('2026-11-01T20:00:00.000Z') })
    )
    expect(await watchHistoryOf(MOVIE)).toMatchObject({ isWatched: true, playbackTime: 600 })

    // And to one found only by its URL
    history().docs[1] = row({ normalizedVideoId: 'legacyhash0000001', mediaId: undefined, playbackTime: 300 })
    expect(await watchHistoryOf(MOVIE)).toMatchObject({ isWatched: true, playbackTime: 300 })
  })

  it('stays out of a list: the season page’s episodes read it as not watched, the episode asked about by itself does not', async () => {
    const flaggedEpisode = episode(2)
    history().docs.push(
      row({ isValid: false, videoId: flaggedEpisode.videoURL, normalizedVideoId: flaggedEpisode.normalizedVideoId, mediaId: flaggedEpisode.mediaId, playbackTime: 1200, mediaType: 'tv' })
    )

    const listed = await (await get('mediaType=tv&mediaId=show-1&season=1&isTVdevice=true&includeWatchHistory=true')).json()
    expect(listed.episodes.map((e) => e.watchHistory.isWatched)).toEqual([false, false])

    const asked = await watchHistoryOf('mediaType=tv&mediaId=show-1&season=1&episode=2&isTVdevice=true&includeWatchHistory=true')
    expect(asked).toMatchObject({ isWatched: true, playbackTime: 1200, progressPercent: 50 })
  })
})

describe('a request about one title, when the history cannot be read', () => {
  const REQUESTS = [
    ['a movie', 'mediaType=movie&mediaOriginalTitle=Family%20Film%20(2001)&includeWatchHistory=true'],
    ['the TV app’s movie', 'mediaType=movie&mediaOriginalTitle=Family%20Film%20(2001)&isTVdevice=true&includeWatchHistory=true'],
    ['the TV app’s episode', 'mediaType=tv&mediaId=show-1&season=1&episode=2&isTVdevice=true&includeWatchHistory=true'],
    ['the popup’s card', 'mediaType=movie&mediaId=m1&card=true&includeWatchHistory=true'],
  ]

  it.each(REQUESTS)('%s answers 503, with no title and no watchHistory to start playback from', async (_name, query) => {
    history().docs.push(row())
    breakHistory()

    const response = await get(query)

    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body).toEqual({ error: 'Watch history could not be read', code: 'WATCH_HISTORY_UNAVAILABLE' })
    expect(body).not.toHaveProperty('watchHistory')
    expect(body).not.toHaveProperty('videoURL')
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(consoleError).toHaveBeenCalledWith('Failed to add watch history to media:', 'connection closed')
  })

  it('answers as before once the history can be read again', async () => {
    history().docs.push(row())
    const broken = breakHistory()
    expect((await get(REQUESTS[0][1])).status).toBe(503)

    broken.mockRestore()
    const response = await get(REQUESTS[0][1])
    expect(response.status).toBe(200)
    expect((await response.json()).watchHistory.playbackTime).toBe(1800)
  })
})

describe('requests the history does not decide', () => {
  it('one that did not ask for watch history never reads it, and answers', async () => {
    const find = breakHistory()

    const response = await get('mediaType=movie&mediaOriginalTitle=Family%20Film%20(2001)')

    expect(response.status).toBe(200)
    expect(await response.json()).not.toHaveProperty('watchHistory')
    expect(find).not.toHaveBeenCalled()
  })

  it('a show has nothing to play, so no position to lose: it answers', async () => {
    breakHistory()

    const response = await get('mediaType=tv&mediaId=show-1&isTVdevice=true&includeWatchHistory=true')

    expect(response.status).toBe(200)
    expect((await response.json()).title).toBe('A Show')
  })

  it('the season page’s episode list still degrades: every episode reads as not watched, and the page answers', async () => {
    breakHistory()

    const response = await get('mediaType=tv&mediaId=show-1&season=1&isTVdevice=true&includeWatchHistory=true')

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.episodes).toHaveLength(2)
    for (const listed of body.episodes) {
      expect(listed.watchHistory).toMatchObject({ isWatched: false, playbackTime: 0, completed: false, progressPercent: 0 })
    }
  })
})

describe('the list join the list routes share (addWatchHistoryToItems)', () => {
  it('degrades as it always has: the same items, each reading as not watched', async () => {
    breakHistory()
    const items = [movie(), episode(1)]

    const joined = await addWatchHistoryToItems(items, USER)

    expect(joined.map((item) => item.originalTitle)).toEqual(items.map((item) => item.originalTitle))
    for (const item of joined) {
      expect(item.watchHistory).toMatchObject({ isWatched: false, playbackTime: 0, lastWatched: null })
    }
    // The line production is searched for
    expect(consoleError).toHaveBeenCalledWith('Error creating watch history lookup map:', expect.any(Error))
  })

  it('over a map that now throws, so a caller that must not degrade can tell', async () => {
    breakHistory()

    await expect(createWatchHistoryLookupMap(USER)).rejects.toThrow('connection closed')
  })
})
