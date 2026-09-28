/**
 * @jest-environment node
 */
/**
 * getUserWatchlist sorts and pages in the database. It used to page by date
 * added and then sort each page in memory, so a title- or custom-sorted
 * playlist longer than one page was only sorted within each page. An
 * internalOnly list with anything to show also threw a ReferenceError.
 */
const { ObjectId } = require('mongodb')

const PLAYLIST_ID = '68eda138767b1e172b9d7c6c'

// Every database read and write, and every lookup, in the order they happen
const mockCalls = []
const mockState = {}

const mockWatchlist = {
  createIndex: jest.fn(async () => {}),
  find: jest.fn((query) => ({
    toArray: async () => {
      mockCalls.push(['find', query])
      return 'detailsResolvedAt' in query ? mockState.unresolved : mockState.allItems
    },
  })),
  aggregate: jest.fn((pipeline, options) => ({
    toArray: async () => {
      mockCalls.push(['aggregate', pipeline, options])
      return mockState.page
    },
  })),
  bulkWrite: jest.fn(async (updates) => {
    mockCalls.push(['bulkWrite', updates])
    return {}
  }),
}
const mockCollections = {
  Watchlist: mockWatchlist,
  Playlists: { findOne: jest.fn(async () => mockState.playlist) },
  FlatMovies: { find: () => ({ toArray: async () => mockState.libraryMovies }) },
  FlatTVShows: { find: () => ({ toArray: async () => [] }) },
}

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: (name) => mockCollections[name] }) }),
}))
jest.mock('@src/lib/cachedAuth.js', () => ({ getSession: jest.fn() }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))

const mockBatchResolveMedia = jest.fn()
jest.mock('@src/utils/watchlist/mediaResolver.js', () => ({
  batchResolveMedia: (...args) => mockBatchResolveMedia(...args),
  getMediaByTMDBId: jest.fn(),
}))

const { getUserWatchlist } = require('@src/utils/watchlist/database')

const doc = (tmdbId, fields = {}) => ({
  _id: new ObjectId(),
  playlistId: new ObjectId(PLAYLIST_ID),
  userId: new ObjectId(),
  tmdbId,
  mediaType: 'movie',
  dateAdded: new Date('2026-09-01'),
  ...fields,
})
const media = (tmdbId, title, releaseDate) => ({ tmdbId, mediaType: 'movie', title, releaseDate, isInternal: true })
const lookups = (...entries) => new Map(entries.map((entry) => [entry.tmdbId, entry]))
const list = (options = {}) => getUserWatchlist({ playlistId: PLAYLIST_ID, userId: 'user-1', ...options })
const kinds = () => mockCalls.map(([kind]) => kind)

beforeEach(() => {
  jest.clearAllMocks()
  mockCalls.length = 0
  Object.assign(mockState, {
    playlist: { sortBy: 'title', sortOrder: 'asc', customOrder: [] },
    unresolved: [],
    allItems: [],
    page: [],
    libraryMovies: [],
  })
  mockBatchResolveMedia.mockImplementation(async (items) => {
    mockCalls.push(['resolve', items])
    return new Map()
  })
  jest.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

it('sorts and pages in the database, and keeps its order', async () => {
  const resolvedAt = new Date('2026-09-20')
  mockState.page = [
    doc(2, { title: 'Zodiac', releaseDate: '2007-03-02', detailsResolvedAt: resolvedAt }),
    doc(1, { title: 'Alien', releaseDate: '1979-05-25', detailsResolvedAt: resolvedAt }),
  ]
  mockBatchResolveMedia.mockResolvedValue(lookups(media(1, 'Alien', '1979-05-25'), media(2, 'Zodiac', '2007-03-02')))

  const items = await list({ page: 1, limit: 20 })

  const [, pipeline, options] = mockCalls.find(([kind]) => kind === 'aggregate')
  expect(pipeline).toEqual([
    { $match: { playlistId: new ObjectId(PLAYLIST_ID) } },
    { $sort: { title: 1, dateAdded: -1, _id: -1 } },
    { $skip: 20 },
    { $limit: 20 },
  ])
  expect(options).toEqual({ collation: { locale: 'en', strength: 2 } })
  // Not re-sorted in memory: the database put Zodiac first here
  expect(items.map((item) => item.title)).toEqual(['Zodiac', 'Alien'])
  expect(mockWatchlist.bulkWrite).not.toHaveBeenCalled()
})

it('looks up items with no stored details before sorting, and stores what they resolve to', async () => {
  const legacy = doc(1)
  mockState.unresolved = [legacy]
  mockState.page = [{ ...legacy, title: 'Alien', releaseDate: '1979-05-25', detailsResolvedAt: new Date() }]
  mockBatchResolveMedia.mockImplementation(async (items) => {
    mockCalls.push(['resolve', items])
    return lookups(media(1, 'Alien', '1979-05-25'))
  })

  await list()

  expect(kinds()).toEqual(['find', 'resolve', 'bulkWrite', 'aggregate', 'resolve'])
  expect(mockCalls[0][1]).toEqual({
    playlistId: new ObjectId(PLAYLIST_ID),
    detailsResolvedAt: { $exists: false },
  })
  const [update] = mockCalls[2][1]
  expect(update.updateOne.filter).toEqual({ _id: legacy._id })
  expect(update.updateOne.update.$set).toMatchObject({ title: 'Alien', releaseDate: '1979-05-25' })
})

it.each(['dateAdded', 'custom'])('looks nothing up before sorting by %s', async (sortBy) => {
  mockState.playlist = { sortBy, sortOrder: 'desc', customOrder: ['a'] }

  await list()

  expect(kinds()).toEqual(['aggregate'])
})

it('refreshes stored details that no longer match what the item resolves to', async () => {
  mockState.playlist = { sortBy: 'dateAdded', sortOrder: 'desc' }
  const resolvedAt = new Date('2026-01-01')
  const renamed = doc(1, { title: 'Alien (1979)', releaseDate: '1979-05-25', detailsResolvedAt: resolvedAt })
  const current = doc(2, { title: 'Brazil', releaseDate: '1985-02-20', detailsResolvedAt: resolvedAt })
  mockState.page = [renamed, current]
  mockBatchResolveMedia.mockResolvedValue(lookups(media(1, 'Alien', '1979-05-25'), media(2, 'Brazil', '1985-02-20')))

  await list()

  expect(mockWatchlist.bulkWrite).toHaveBeenCalledTimes(1)
  const [updates] = mockWatchlist.bulkWrite.mock.calls[0]
  expect(updates).toHaveLength(1)
  expect(updates[0].updateOne.filter).toEqual({ _id: renamed._id })
  expect(updates[0].updateOne.update.$set.title).toBe('Alien')
})

it('lists an internalOnly playlist', async () => {
  mockState.playlist = { sortBy: 'dateAdded', sortOrder: 'desc' }
  const film = doc(1, { title: 'Alien', releaseDate: '1979-05-25', detailsResolvedAt: new Date() })
  mockState.allItems = [film]
  mockState.libraryMovies = [{ metadata: { id: 1 } }]
  mockState.page = [film]
  mockBatchResolveMedia.mockResolvedValue(lookups(media(1, 'Alien', '1979-05-25')))

  const items = await list({ internalOnly: true })

  expect(items.map((item) => item.title)).toEqual(['Alien'])
  const [, options] = mockBatchResolveMedia.mock.calls[0]
  expect([...options.precomputedAvailability]).toEqual([1])
})

it('pages from an absolute offset when given one', async () => {
  mockState.playlist = { sortBy: 'dateAdded', sortOrder: 'desc' }

  await list({ offset: 7, limit: 1, page: 3 })

  const [, pipeline] = mockCalls.find(([kind]) => kind === 'aggregate')
  expect(pipeline.slice(-2)).toEqual([{ $skip: 7 }, { $limit: 1 }])
})
