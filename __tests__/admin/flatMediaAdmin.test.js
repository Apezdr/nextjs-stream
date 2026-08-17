const mockMovieCursor = {
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn(),
}
const mockShowCursor = {
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn(),
}
const mockMovieFind = jest.fn(() => mockMovieCursor)
const mockShowFind = jest.fn(() => mockShowCursor)
const mockMovieCount = jest.fn()
const mockShowCount = jest.fn()
const mockEpisodeDistinct = jest.fn()
const mockSeasonAggregate = jest.fn()
const mockEpisodeAggregate = jest.fn()

jest.mock('mongodb', () => ({
  ObjectId: class ObjectId {
    constructor(value) {
      this.value = value
    }

    static isValid(value) {
      return Boolean(value)
    }

    toString() {
      return String(this.value)
    }
  },
}))

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => ({
        FlatMovies: { find: mockMovieFind, countDocuments: mockMovieCount },
        FlatTVShows: { find: mockShowFind, countDocuments: mockShowCount },
        FlatSeasons: { aggregate: mockSeasonAggregate },
        FlatEpisodes: { distinct: mockEpisodeDistinct, aggregate: mockEpisodeAggregate },
      })[name],
    }),
  }),
}))

jest.mock('@src/utils/flatDatabaseUtils', () => ({ getFlatRequestedMedia: jest.fn() }))
jest.mock('@src/utils', () => ({ getFullImageUrl: jest.fn((path) => `https://images.test${path}`) }))

import { listAdminMovies, listAdminTVShows } from '@src/utils/admin/flatMediaAdmin'

const id = (value) => ({ toString: () => value })

beforeEach(() => {
  jest.clearAllMocks()
  mockMovieCursor.sort.mockReturnThis()
  mockMovieCursor.skip.mockReturnThis()
  mockMovieCursor.limit.mockReturnThis()
  mockShowCursor.sort.mockReturnThis()
  mockShowCursor.skip.mockReturnThis()
  mockShowCursor.limit.mockReturnThis()
  mockMovieCount.mockResolvedValue(1)
  mockShowCount.mockResolvedValue(1)
})

test('movie server filtering composes with title search before pagination', async () => {
  mockMovieCursor.toArray.mockResolvedValue([{
    _id: id('movie-1'),
    title: 'Kingdom',
    originalTitle: 'Kingdom (2025)',
    videoURL: '/movie.mp4',
    videoSource: 'server2',
    dimensions: '3840x2160',
    hdr: true,
  }])

  const result = await listAdminMovies({ search: 'King', serverId: 'server2', quality: '4K', hdr: 'hdr' })
  const filter = mockMovieFind.mock.calls[0][0]
  expect(filter.$and[0].$or[0].title).toBeInstanceOf(RegExp)
  expect(filter.$and[1]).toEqual({ videoSource: 'server2' })
  expect(filter.$and[2]).toEqual({ dimensions: expect.any(RegExp) })
  expect(filter.$and[3]).toEqual({ hdr: { $exists: true, $nin: [null, false, ''] } })
  expect(mockMovieCount).toHaveBeenCalledWith(filter)
  expect(result.items[0].serverIds).toEqual(['server2'])
  expect(result.items[0].quality).toBe('4K')
})

test('TV server filtering uses episode ownership and preserves all page server associations', async () => {
  const showId = id('show-1')
  mockEpisodeDistinct.mockResolvedValue([showId])
  mockShowCursor.toArray.mockResolvedValue([{
    _id: showId,
    title: 'Example Show',
    originalTitle: 'Example Show',
  }])
  mockSeasonAggregate.mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ _id: showId, count: 2 }]) })
  mockEpisodeAggregate.mockReturnValue({
    toArray: jest.fn().mockResolvedValue([{
      _id: showId,
      count: 12,
      videoCount: 8,
      serverIds: ['server2', 'default', 'server2', null],
      dimensions: ['3840x2160', '1920x1080'],
      hdrValues: [true, 'HDR10', false, null],
    }]),
  })

  const result = await listAdminTVShows({ serverId: 'server2' })
  expect(mockEpisodeDistinct).toHaveBeenCalledWith('showId', {
    $and: [
      { videoSource: 'server2' },
      { showId: { $ne: null } },
    ],
  })
  expect(mockShowFind.mock.calls[0][0]).toEqual({ _id: { $in: [showId] } })
  expect(result.items[0]).toMatchObject({
    seasonCount: 2,
    episodeCount: 12,
    videoCount: 8,
    hasVideo: true,
    serverIds: ['default', 'server2'],
    quality: 'Mixed',
    qualities: ['1080p', '4K'],
    hdrValues: ['HDR', 'HDR10'],
  })
})