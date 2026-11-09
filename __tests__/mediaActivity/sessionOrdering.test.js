let mockPresenceEntries = []

// The live reader's query: rows whose own expiry has not passed.
function createPresenceCursor(query) {
  const entries = mockPresenceEntries
    .filter((entry) => new Date(entry.staleAfter) > query.staleAfter.$gt)
    .map((entry) => ({ ...entry }))
  return { limit: (limit) => ({ toArray: async () => entries.slice(0, limit) }) }
}

const mockCollection = jest.fn((name) => {
  if (name === 'PlaybackPresence') {
    return { find: (query) => createPresenceCursor(query) }
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

jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

jest.mock('@src/utils/deviceDetection', () => ({
  detectBrowserType: jest.fn(() => 'unknown'),
  getDeviceTypeLabel: jest.fn(() => 'Desktop'),
}))

// mediaActivity imports shared presence constants from a module that also uses
// MongoDB's ObjectId. Keep this read-side unit test isolated from MongoDB 7's
// ESM-only BSON runtime; none of the database write functions execute here.
jest.mock('mongodb', () => ({
  ObjectId: jest.fn((value) => value),
}))

import { getActiveMediaSessions } from '@src/utils/mediaActivity'

const request = {
  url: 'http://localhost:3232/api/media-activity',
}

const firstSession = {
  _id: '000000000000000000000001',
  userId: 'user-1',
  videoId: '/movies/first.mp4',
  playbackTime: 60,
  lastHeartbeat: '2026-01-01T10:00:00.000Z',
  state: 'playing',
  staleAfter: '2999-01-01T00:00:00.000Z',
}

const secondSession = {
  _id: '000000000000000000000002',
  userId: 'user-2',
  videoId: '/movies/second.mp4',
  playbackTime: 30,
  lastHeartbeat: '2026-01-01T09:59:00.000Z',
  state: 'paused',
  staleAfter: '2999-01-01T00:00:00.000Z',
}

describe('media activity session ordering', () => {
  beforeEach(() => {
    mockPresenceEntries = [firstSession, secondSession]
  })

  it('keeps rows in start order when a paused session resumes and outranks the other', async () => {
    const beforeResume = await getActiveMediaSessions(request)

    mockPresenceEntries = [
      firstSession,
      {
        ...secondSession,
        state: 'playing',
        lastHeartbeat: '2026-01-01T10:01:00.000Z',
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
  })
})