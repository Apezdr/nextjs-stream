/**
 * @jest-environment node
 *
 * Counts a scoped user sees: the notification page's totals and the unread
 * count (the bell's X-Unread-Count) count only the notices their scope lets
 * them see, and a playlist's itemCount only the items it doesn't hide. The
 * whole library keeps the queries it always had: no extra read, no extra
 * clause.
 */

const mockQueries = []
const mockNotices = []
function mockNotificationsCollection() {
  const record = (op, query) => mockQueries.push({ op, query })
  const cursor = (docs) => {
    const c = { sort: () => c, skip: () => c, limit: () => c, toArray: async () => docs }
    return c
  }
  return {
    createIndex: async () => 'index',
    find: (query, options) => {
      record('find', query)
      // The hidden-notice scan asks for titles only; the page gets nothing back here
      return cursor(options?.projection ? mockNotices : [])
    },
    countDocuments: async (query) => {
      record('count', query)
      return 0
    },
  }
}
const mockWatchlistCounts = []
const mockWatchlistReads = []
// A playlist: two library titles the scope hides (by TMDB id, one stored as a
// string), one it holds, and one the library doesn't have (TMDB-only). Then
// three titles with no TMDB id, kept under their library ids: one the scope
// hides, one it holds, and one that has left the library.
const mockItems = [
  { _id: 'w1', mediaType: 'movie', tmdbId: 77 },
  { _id: 'w2', mediaType: 'tv', tmdbId: '88' },
  { _id: 'w3', mediaType: 'movie', tmdbId: 11 },
  { _id: 'w4', mediaType: 'tv', tmdbId: 999 },
  { _id: 'w5', mediaType: 'movie', libraryMediaId: 'mid:00000000000000aa' },
  { _id: 'w6', mediaType: 'movie', libraryMediaId: 'mid:00000000000000bb' },
  { _id: 'w7', mediaType: 'tv', libraryMediaId: 'mid:00000000000000cc' },
]
const mockPlaylists = [{ _id: { toString: () => 'p1', equals: () => true }, name: 'Mine', ownerId: { toString: () => 'u1', equals: () => true } }]
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => {
        if (name === 'Notifications') return mockNotificationsCollection()
        if (name === 'Playlists') {
          const c = { sort: () => c, toArray: async () => mockPlaylists }
          return { find: () => c, findOne: async () => mockPlaylists[0] }
        }
        if (name === 'Watchlist') {
          return {
            createIndex: async () => 'index',
            countDocuments: async (query) => {
              mockWatchlistCounts.push(query)
              return 0
            },
            find: (query, options) => {
              mockWatchlistReads.push({ query, options })
              return { toArray: async () => mockItems }
            },
            aggregate: (pipeline) => {
              mockWatchlistReads.push({ pipeline })
              return { toArray: async () => [] }
            },
          }
        }
        throw new Error(`unexpected collection ${name}`)
      },
    }),
  }),
}))
jest.mock('@src/utils/migrations/runOnce', () => ({ runMigrationOnce: async () => ({ applied: false }) }))
jest.mock('@src/lib/logger', () => ({ createLogger: () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }) }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: { find: jest.fn(async () => []) } }))
jest.mock('@src/utils/watchHistory/database', () => ({ getAllWatchHistoryUserIds: jest.fn() }))
jest.mock('@src/lib/cachedAuth.js', () => ({ getSession: jest.fn(async () => ({ user: { id: '64b7f0c2a1b2c3d4e5f60718' } })) }))
jest.mock('@src/utils/tmdb/backendClient', () => ({ fetchTmdbFromBackend: jest.fn() }))
// What the scope holds, as libraryAccess.ts indexes it
const mockIndex = {
  showIds: [],
  movieKeys: new Set(['In Scope (2001)']),
  showKeys: new Set(),
  hiddenTmdbIds: { movie: [77, 12], tv: [88] },
  // A movie's library id hides a movie's item only: the show under the same id stays
  hiddenMediaIds: { movie: ['mid:00000000000000aa', 'mid:00000000000000cc'], tv: [] },
}
jest.mock('@src/lib/roles/libraryAccess', () => ({
  libraryScopeIndex: async (access) => (access.scope === null ? null : mockIndex),
}))

const { ObjectId } = require('mongodb')
const { FULL_LIBRARY } = require('@src/lib/roles/libraryScope')
const { getUserNotifications, getUnreadNotificationCount } = require('@src/utils/notifications/notificationDatabase')
const { getUserPlaylists, getPlaylistById, getUserWatchlist } = require('@src/utils/watchlist/database')

const USER_ID = '64b7f0c2a1b2c3d4e5f60718'
const SCOPED = { id: 'scope-test', scope: { movieRatingCap: null, tvRatingCap: null, titles: [] }, showIds: [] }
const HIDDEN_ID = new ObjectId()
const SHOWN_ID = new ObjectId()

beforeEach(() => {
  mockQueries.length = 0
  mockWatchlistCounts.length = 0
  mockNotices.length = 0
  mockNotices.push(
    { _id: SHOWN_ID, type: 'new_content', data: { movies: [{ originalTitle: 'In Scope (2001)' }] } },
    { _id: HIDDEN_ID, type: 'new_content', data: { movies: [{ originalTitle: 'Out Of Scope (2001)' }] } }
  )
})

describe('notifications', () => {
  it('the whole library: the page and its counts are the queries they always were', async () => {
    const result = await getUserNotifications(USER_ID, { access: FULL_LIBRARY, page: 1, limit: 20 })
    expect(mockQueries).toEqual([
      { op: 'find', query: { userId: new ObjectId(USER_ID) } },
      { op: 'count', query: { userId: new ObjectId(USER_ID) } },
      { op: 'count', query: { userId: new ObjectId(USER_ID), read: false } },
    ])
    expect(result.pagination).toMatchObject({ totalCount: 0, totalPages: 0 })

    mockQueries.length = 0
    await getUnreadNotificationCount(USER_ID, FULL_LIBRARY)
    expect(mockQueries).toEqual([{ op: 'count', query: { userId: new ObjectId(USER_ID), read: false } }])
  })

  it('a scoped reader: the page, the totals and the unread count leave out the notices it hides', async () => {
    await getUserNotifications(USER_ID, { access: SCOPED, page: 1, limit: 20 })
    const [scan, page, total, unread] = mockQueries
    expect(scan).toEqual({ op: 'find', query: { userId: new ObjectId(USER_ID), type: 'new_content' } })
    const hidden = { _id: { $nin: [HIDDEN_ID] } }
    expect(page.query).toEqual({ userId: new ObjectId(USER_ID), ...hidden })
    expect(total.query).toEqual({ userId: new ObjectId(USER_ID), ...hidden })
    expect(unread.query).toEqual({ userId: new ObjectId(USER_ID), read: false, ...hidden })

    mockQueries.length = 0
    await getUnreadNotificationCount(USER_ID, SCOPED)
    expect(mockQueries.at(-1).query).toEqual({ userId: new ObjectId(USER_ID), read: false, ...hidden })
  })

  it('a scoped reader with nothing hidden keeps the plain queries', async () => {
    mockNotices.splice(1, 1)
    await getUnreadNotificationCount(USER_ID, SCOPED)
    expect(mockQueries.at(-1).query).toEqual({ userId: new ObjectId(USER_ID), read: false })
  })
})

describe('playlists', () => {
  beforeEach(() => {
    mockWatchlistReads.length = 0
  })

  it('the whole library counts every item with the query it always had, and reads no items', async () => {
    await getUserPlaylists(USER_ID, true, true, FULL_LIBRARY)
    await getPlaylistById('64b7f0c2a1b2c3d4e5f60719', { user: { id: USER_ID }, access: FULL_LIBRARY })
    expect(mockWatchlistCounts).toEqual([{ playlistId: mockPlaylists[0]._id }, { playlistId: mockPlaylists[0]._id }])
    expect(mockWatchlistReads).toEqual([])
  })

  it('the whole library lists and counts a playlist with the queries it always had', async () => {
    const playlistId = '64b7f0c2a1b2c3d4e5f60719'
    expect(await getUserWatchlist({ access: FULL_LIBRARY, userId: USER_ID, playlistId, countOnly: true })).toBe(0)
    expect(mockWatchlistCounts).toEqual([{ playlistId: new ObjectId(playlistId) }])
    await getUserWatchlist({ access: FULL_LIBRARY, userId: USER_ID, playlistId, sortBy: 'dateAdded' })
    expect(mockWatchlistReads.map((read) => read.pipeline?.[0])).toEqual([{ $match: { playlistId: new ObjectId(playlistId) } }])
  })

  it('a scoped viewer: the playlist’s own items are filtered in memory, TMDB-only ones kept, counts derived from them', async () => {
    await getUserPlaylists(USER_ID, true, true, SCOPED)
    await getPlaylistById('64b7f0c2a1b2c3d4e5f60719', { user: { id: USER_ID }, access: SCOPED })
    // No count query: three items of seven are hidden, from the one read of the items
    expect(mockWatchlistCounts).toEqual([])
    const read = {
      query: { playlistId: mockPlaylists[0]._id },
      options: { projection: { _id: 1, mediaType: 1, tmdbId: 1, libraryMediaId: 1 } },
    }
    expect(mockWatchlistReads).toEqual([read, read])

    const playlistId = '64b7f0c2a1b2c3d4e5f60719'
    expect(await getUserWatchlist({ access: SCOPED, userId: USER_ID, playlistId, countOnly: true })).toBe(4)
    mockWatchlistReads.length = 0
    await getUserWatchlist({ access: SCOPED, userId: USER_ID, playlistId, sortBy: 'dateAdded' })
    // The page query leaves out the hidden items by their own ids: bounded by the playlist, not the library.
    // w5 is a library title outside the scope with no TMDB id, hidden by its library id.
    expect(mockWatchlistReads.at(-1).pipeline[0]).toEqual({
      $match: { playlistId: new ObjectId(playlistId), _id: { $nin: ['w1', 'w2', 'w5'] } },
    })
  })
})
