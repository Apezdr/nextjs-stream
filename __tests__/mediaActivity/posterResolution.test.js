const mockMediaData = {
  PlaybackPresence: [],
  FlatMovies: [],
  FlatEpisodes: [],
  FlatTVShows: [],
}

const mockFindCalls = {
  FlatMovies: [],
  FlatEpisodes: [],
  FlatTVShows: [],
}

function createPresenceCursor() {
  let entries = mockMediaData.PlaybackPresence.map((entry) => ({ ...entry }))

  return {
    sort: (sortSpec) => {
      entries.sort((left, right) =>
        sortSpec._id * String(left._id).localeCompare(String(right._id))
      )

      return {
        limit: (limit) => ({
          toArray: async () => entries.slice(0, limit),
        }),
      }
    },
  }
}

const mockCollection = jest.fn((name) => ({
  find: (filter, options) => {
    if (name === 'PlaybackPresence') return createPresenceCursor()

    mockFindCalls[name].push({ filter, options })
    return {
      toArray: async () => mockMediaData[name].map((entry) => ({ ...entry })),
    }
  },
}))

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection: mockCollection }),
  }),
}))

jest.mock('@src/lib/userQueries', () => ({
  userQueries: { find: jest.fn().mockResolvedValue([]) },
}))

jest.mock('@src/utils/webhookServer', () => ({
  validateWebhookId: jest.fn().mockResolvedValue({ isValid: false }),
}))

jest.mock('@src/utils/deviceDetection', () => ({
  detectBrowserType: jest.fn(() => 'unknown'),
  getDeviceTypeLabel: jest.fn(() => 'Desktop'),
}))

jest.mock('mongodb', () => ({
  ObjectId: jest.fn((value) => value),
}))

import { getActiveMediaSessions } from '@src/utils/mediaActivity'

const request = {
  url: 'http://localhost:3232/api/media-activity?activeWindowSeconds=300',
}

function setActiveEpisode(overrides = {}) {
  mockMediaData.PlaybackPresence = [{
    _id: '000000000000000000000001',
    userId: 'user-1',
    videoId: '/tv/show/episode-1.mp4',
    playbackTime: 60,
    lastHeartbeat: '2026-01-01T10:00:00.000Z',
    isPaused: false,
  }]
  mockMediaData.FlatEpisodes = [{
    showId: 'show-1',
    showTitle: 'Example show',
    originalTitle: 'Example Show Filesystem Name',
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Pilot',
    videoURL: '/tv/show/episode-1.mp4',
    duration: 1800000,
    dimensions: '1920x1080',
    thumbnail: 'https://media.example/episode-still.jpg',
    ...overrides,
  }]
}

describe('media activity TV poster resolution', () => {
  beforeEach(() => {
    mockMediaData.PlaybackPresence = []
    mockMediaData.FlatMovies = []
    mockMediaData.FlatEpisodes = []
    mockMediaData.FlatTVShows = []
    mockFindCalls.FlatMovies = []
    mockFindCalls.FlatEpisodes = []
    mockFindCalls.FlatTVShows = []
    mockCollection.mockClear()
  })

  it('uses the stable showId when the episode display title does not exactly match', async () => {
    setActiveEpisode()
    mockMediaData.FlatTVShows = [{
      _id: 'show-1',
      title: 'Example Show',
      originalTitle: 'Example Show Filesystem Name',
      posterURL: 'https://media.example/show-poster.jpg?hash=current',
    }]

    const payload = await getActiveMediaSessions(request)

    expect(payload.sessions[0]).toMatchObject({
      grandparentTitle: 'Example Show',
      posterUrl: 'https://media.example/show-poster.jpg?hash=current',
    })
    expect(mockFindCalls.FlatEpisodes[0].options.projection.showId).toBe(1)
    expect(mockFindCalls.FlatTVShows[0].filter.$or).toEqual(
      expect.arrayContaining([{ _id: { $in: ['show-1'] } }])
    )
  })

  it('falls back to originalTitle and still prefers the vertical show poster', async () => {
    setActiveEpisode({
      showId: undefined,
      showTitle: 'Outdated Display Title',
      originalTitle: 'Example Show Filesystem Name',
    })
    mockMediaData.FlatTVShows = [{
      _id: 'show-1',
      title: 'Current Display Title',
      originalTitle: 'Example Show Filesystem Name',
      posterURL: 'https://media.example/current-show-poster.jpg',
    }]

    const payload = await getActiveMediaSessions(request)

    expect(payload.sessions[0].posterUrl).toBe(
      'https://media.example/current-show-poster.jpg'
    )
    expect(payload.sessions[0].posterUrl).not.toBe(
      'https://media.example/episode-still.jpg'
    )
    expect(mockFindCalls.FlatTVShows[0].filter.$or).toEqual(
      expect.arrayContaining([
        { originalTitle: { $in: ['Outdated Display Title', 'Example Show Filesystem Name'] } },
      ])
    )
  })
})