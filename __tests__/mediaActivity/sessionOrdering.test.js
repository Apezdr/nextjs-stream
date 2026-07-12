const mockSessionSort = jest.fn()
let mockWatchHistoryEntries = []

function createWatchHistoryCursor() {
  let entries = mockWatchHistoryEntries.map((entry) => ({ ...entry }))

  return {
    sort: (sortSpec) => {
      mockSessionSort(sortSpec)

      if (sortSpec._id) {
        entries.sort((left, right) =>
          sortSpec._id * String(left._id).localeCompare(String(right._id))
        )
      } else if (sortSpec.lastUpdated) {
        entries.sort((left, right) =>
          sortSpec.lastUpdated * (new Date(left.lastUpdated) - new Date(right.lastUpdated))
        )
      }

      return {
        limit: (limit) => ({
          toArray: async () => entries.slice(0, limit),
        }),
      }
    },
  }
}

const mockCollection = jest.fn((name) => {
  if (name === 'WatchHistory') {
    return { find: () => createWatchHistoryCursor() }
  }

  return {
    find: () => ({ toArray: async () => [] }),
  }
})

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

import { getActiveMediaSessions } from '@src/utils/mediaActivity'

const request = {
  url: 'http://localhost:3232/api/media-activity?activeWindowSeconds=300',
}

const firstSession = {
  _id: '000000000000000000000001',
  userId: 'user-1',
  videoId: '/movies/first.mp4',
  playbackTime: 60,
  lastUpdated: '2026-01-01T10:00:00.000Z',
  isPaused: false,
}

const secondSession = {
  _id: '000000000000000000000002',
  userId: 'user-2',
  videoId: '/movies/second.mp4',
  playbackTime: 30,
  lastUpdated: '2026-01-01T09:59:00.000Z',
  isPaused: true,
}

describe('media activity session ordering', () => {
  beforeEach(() => {
    mockSessionSort.mockClear()
    mockWatchHistoryEntries = [firstSession, secondSession]
  })

  it('preserves row order when a paused session resumes and updates lastUpdated', async () => {
    const beforeResume = await getActiveMediaSessions(request)

    mockWatchHistoryEntries = [
      firstSession,
      {
        ...secondSession,
        isPaused: false,
        lastUpdated: '2026-01-01T10:01:00.000Z',
      },
    ]
    const afterResume = await getActiveMediaSessions(request)

    expect(beforeResume.sessions.map((session) => session.id)).toEqual([
      firstSession._id,
      secondSession._id,
    ])
    expect(afterResume.sessions.map((session) => session.id)).toEqual([
      firstSession._id,
      secondSession._id,
    ])
    expect(mockSessionSort).toHaveBeenNthCalledWith(1, { _id: 1 })
    expect(mockSessionSort).toHaveBeenNthCalledWith(2, { _id: 1 })
  })
})