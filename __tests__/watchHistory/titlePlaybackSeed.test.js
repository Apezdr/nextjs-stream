/**
 * @jest-environment node
 *
 * The one per-viewer read of a movie or episode details page: the viewer's
 * row for the page's title, read beside the cached subtree and handed to the
 * browser as a <PlaybackSeed>. It reads what GET /sync/playback reads
 * (readTitlePosition), for the session the page's gate resolved, and renders
 * nothing rather than a seed it cannot stand behind.
 */
const mockMedia = jest.fn()
jest.mock('@src/utils/cache/mediaFetching', () => ({ getCachedMediaWithRedirect: (...args) => mockMedia(...args) }))
const mockRead = jest.fn()
jest.mock('@src/utils/watchHistory/titlePosition', () => ({ readTitlePosition: (...args) => mockRead(...args) }))
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))
jest.mock('@components/WatchProgress/PlaybackSeed', () => ({ __esModule: true, default: function PlaybackSeed() {} }))

const TitlePlaybackSeed = require('@components/WatchProgress/TitlePlaybackSeed').default
const PlaybackSeed = require('@components/WatchProgress/PlaybackSeed').default

const USER = '507f1f77bcf86cd799439011'
const ACCESS = { id: 'scope-all', scope: null, showIds: [] }
const SESSION = { user: { id: USER, approved: true }, access: ACCESS }
const PARAMS = { mediaType: 'movie', mediaTitle: 'Family Film (2001)' }
const VIDEO_URL = 'https://files.example/movies/Family%20Film%20(2001)/family.film.mp4'
const MEDIA = { _id: 'm-family', mediaId: 'mid:familyfilm', normalizedVideoId: 'nid-family', videoURL: VIDEO_URL, duration: 7_200_000 }
const AS_OF = '2026-11-16T20:00:00.000Z'

const page = (media = MEDIA, extra = {}) => ({ media, redirectUrl: null, notFoundType: null, ...extra })
const seed = (session = SESSION) => TitlePlaybackSeed({ parsedParams: PARAMS, session })

beforeEach(() => {
  jest.clearAllMocks()
  mockMedia.mockResolvedValue(page())
  mockRead.mockResolvedValue({ found: false, mediaId: 'mid:familyfilm', normalizedVideoId: 'nid-family', playbackTime: 0, lastUpdated: null, asOf: AS_OF })
})

it('reads the title’s row for the gate’s user and scope, by its id and the URL it plays from', async () => {
  await seed()

  // The same cached fetch the page's content makes: one entry, keyed by the scope
  expect(mockMedia).toHaveBeenCalledWith(PARAMS, 'scope-all')
  expect(mockRead).toHaveBeenCalledTimes(1)
  const [asked] = mockRead.mock.calls[0]
  expect(asked).toMatchObject({ userId: USER, videoId: VIDEO_URL, mediaId: 'mid:familyfilm' })
  expect(await asked.getAccess()).toBe(ACCESS)
})

it('hands the browser the row: its own keys, the position, and the server’s two times as text', async () => {
  // Found under the file the title had before a quality swap
  mockRead.mockResolvedValue({
    found: true,
    videoId: 'https://files.example/old.mp4',
    mediaId: 'mid:familyfilm',
    normalizedVideoId: 'nid-old-file',
    playbackTime: 1800,
    lastUpdated: new Date('2026-11-10T20:00:00.000Z'),
    completed: false,
    progressPercent: 25,
    asOf: AS_OF,
  })

  const element = await seed()

  expect(element.type).toBe(PlaybackSeed)
  expect(element.props).toEqual({
    userId: USER,
    // The page's title, as the catalog holds it: what its surfaces look the position up by
    title: { mediaId: 'mid:familyfilm', normalizedVideoId: 'nid-family' },
    entry: {
      found: true,
      mediaId: 'mid:familyfilm',
      normalizedVideoId: 'nid-old-file',
      playbackTime: 1800,
      lastUpdated: '2026-11-10T20:00:00.000Z',
      asOf: AS_OF,
    },
  })
  // Not the video URL, the percentage or the flag: the surfaces compute those from their own runtime
  expect(Object.keys(element.props.entry).sort()).toEqual(['asOf', 'found', 'lastUpdated', 'mediaId', 'normalizedVideoId', 'playbackTime'])
})

it('"no row" is a seed too: the button says Play without asking', async () => {
  const element = await seed()
  expect(element.props.entry).toMatchObject({ found: false, playbackTime: 0, lastUpdated: null, asOf: AS_OF })
})

it('a title with no durable id is read by its URL, and filed by its hash', async () => {
  mockMedia.mockResolvedValue(page({ ...MEDIA, mediaId: null }))
  const element = await seed()

  expect(mockRead.mock.calls[0][0]).toMatchObject({ videoId: VIDEO_URL, mediaId: null })
  expect(element.props.title).toEqual({ mediaId: null, normalizedVideoId: 'nid-family' })
})

it('a document id is no durable id', async () => {
  mockMedia.mockResolvedValue(page({ ...MEDIA, mediaId: '64b7f0c2a1b2c3d4e5f60799' }))
  await seed()
  expect(mockRead.mock.calls[0][0].mediaId).toBeNull()
})

it.each([
  ['the title is not found', page(null, { notFoundType: 'movie' })],
  ['the page redirects', page(MEDIA, { redirectUrl: '/list/movie/Family%20Film%20(2001)' })],
  ['the title has no identity (a trailer stand-in)', page({ videoURL: 'https://video.example/watch?v=trailer' })],
  ['the title has nothing to be asked by', page({ normalizedVideoId: 'nid-family', videoURL: null })],
])('renders nothing and reads nothing when %s', async (_name, result) => {
  mockMedia.mockResolvedValue(result)
  expect(await seed()).toBeNull()
  expect(mockRead).not.toHaveBeenCalled()
})

it('renders nothing for a page with no user, and never reads', async () => {
  expect(await seed({ user: null, access: ACCESS })).toBeNull()
  expect(mockMedia).not.toHaveBeenCalled()
})

it('a read that fails seeds nothing, never "no row": the store asks, and says if it cannot find out', async () => {
  mockRead.mockRejectedValue(new Error('connection closed'))

  expect(await seed()).toBeNull()
  // The user's id, never the title
  expect(mockLog.error).toHaveBeenCalledWith({ err: expect.any(Error), userId: USER }, 'Failed to read the position for a details page')
})
