/**
 * @jest-environment node
 *
 * A library title with no TMDB id can be on a list. Adding one used to be
 * refused ("Bad Request"): every item was keyed on a TMDB id. Such a title is
 * now keyed on the library's own durable id for it ('mid:…', the catalog
 * document's mediaId), which unlike the document's _id is the same when the
 * title leaves the library and comes back.
 *
 * What follows from that, and is checked here against an in-memory Watchlist
 * collection that enforces both unique indexes:
 *   - one copy per playlist, as for a TMDB title;
 *   - a title that leaves the library stays on the list, shown from what the
 *     item stored (there is no TMDB entry to show instead), and matches again
 *     when the title comes back;
 *   - a title that is later given a TMDB id has its item moved to the TMDB
 *     key, wherever the two ids are first seen together.
 */
const { ObjectId } = require('mongodb')

const USER_ID = '64b7f0c2a1b2c3d4e5f60718'
const PLAYLIST_ID = '68eda138767b1e172b9d7c6c'
const SINTEL = 'mid:e31a15704f374ca9'
const BUNNY = 'mid:79b5f61dd251e37d'
const SINTEL_TMDB_ID = 45745

const mockItems = []
const mockLibrary = { movies: [], shows: [] }
const mockPlaylist = {
  _id: new ObjectId(PLAYLIST_ID),
  ownerId: new ObjectId(USER_ID),
  sortBy: 'dateAdded',
  sortOrder: 'desc',
  customOrder: [],
}

const same = (a, b) => (a instanceof ObjectId ? a.equals(b) : a === b)
const matches = (doc, query) =>
  Object.entries(query).every(([field, value]) => {
    if (field === '$or') return value.some((arm) => matches(doc, arm))
    if (value && typeof value === 'object' && !(value instanceof ObjectId)) {
      if ('$in' in value) return value.$in.some((candidate) => same(candidate, doc[field]))
      if ('$nin' in value) return !value.$nin.some((candidate) => same(candidate, doc[field]))
      if ('$exists' in value) return field in doc === value.$exists
    }
    return same(value, doc[field])
  })

// unique_playlist_title and unique_playlist_library_title, each partial on its own key
function assertUnique(candidate, self) {
  const clash = mockItems.some(
    (other) =>
      other !== self &&
      same(other.playlistId, candidate.playlistId) &&
      other.mediaType === candidate.mediaType &&
      (('tmdbId' in candidate && 'tmdbId' in other && other.tmdbId === candidate.tmdbId) ||
        ('libraryMediaId' in candidate && 'libraryMediaId' in other && other.libraryMediaId === candidate.libraryMediaId))
  )
  if (clash) throw Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
}

const mockWatchlist = {
  createIndex: async () => 'index',
  find: (query) => ({ toArray: async () => mockItems.filter((doc) => matches(doc, query)) }),
  findOne: async (query) => mockItems.find((doc) => matches(doc, query)) ?? null,
  countDocuments: async (query) => mockItems.filter((doc) => matches(doc, query)).length,
  aggregate: (pipeline) => ({ toArray: async () => mockItems.filter((doc) => matches(doc, pipeline[0].$match)) }),
  deleteOne: async (query) => {
    const index = mockItems.findIndex((doc) => matches(doc, query))
    if (index >= 0) mockItems.splice(index, 1)
    return { deletedCount: index >= 0 ? 1 : 0 }
  },
  deleteMany: async (query) => {
    const gone = mockItems.filter((doc) => matches(doc, query))
    for (const doc of gone) mockItems.splice(mockItems.indexOf(doc), 1)
    return { deletedCount: gone.length }
  },
  updateOne: async (filter, update, options = {}) => {
    const doc = mockItems.find((candidate) => matches(candidate, filter))
    if (!doc) {
      if (!options.upsert) return { matchedCount: 0, modifiedCount: 0 }
      const inserted = { _id: new ObjectId(), ...filter, ...update.$setOnInsert, ...update.$set }
      assertUnique(inserted, null)
      mockItems.push(inserted)
      return { matchedCount: 0, modifiedCount: 0, upsertedId: inserted._id }
    }
    const next = { ...doc, ...update.$set }
    for (const field of Object.keys(update.$unset ?? {})) delete next[field]
    assertUnique(next, doc)
    const modified = JSON.stringify(next) !== JSON.stringify(doc)
    for (const field of Object.keys(doc)) delete doc[field]
    Object.assign(doc, next)
    return { matchedCount: 1, modifiedCount: modified ? 1 : 0 }
  },
  bulkWrite: async (operations) => {
    for (const { updateOne } of operations) await mockWatchlist.updateOne(updateOne.filter, updateOne.update)
    return {}
  },
}

// The library is asked for titles by TMDB id, by library id, or either
const asked = (document, condition) =>
  condition.$or
    ? condition.$or.some((arm) => asked(document, arm))
    : condition['metadata.id']
      ? condition['metadata.id'].$in.includes(document.metadata?.id)
      : condition.mediaId.$in.includes(document.mediaId)
const libraryCollection = (documents) => ({
  find: (query) => ({ toArray: async () => documents().filter((document) => asked(document, query.$and[0])) }),
})
const mockCollections = {
  Watchlist: mockWatchlist,
  Playlists: { findOne: async () => mockPlaylist },
  FlatMovies: libraryCollection(() => mockLibrary.movies),
  FlatTVShows: libraryCollection(() => mockLibrary.shows),
  ComingSoon: { createIndex: async () => 'index', find: () => ({ toArray: async () => [] }) },
}

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: (name) => mockCollections[name] }) }),
}))
jest.mock('@src/lib/cachedAuth.js', () => ({
  getSession: jest.fn(async () => ({ user: { id: '64b7f0c2a1b2c3d4e5f60718' } })),
}))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))
const mockFetchTmdb = jest.fn()
jest.mock('@src/utils/tmdb/backendClient', () => ({
  fetchTmdbFromBackend: (...args) => mockFetchTmdb(...args),
}))

const {
  addToWatchlist,
  checkWatchlistStatus,
  getMinimalCardDataForPlaylist,
  getUserWatchlist,
} = require('@src/utils/watchlist/database')
const { formatWatchlistItem, toggleWatchlist } = require('@src/utils/watchlist')
const { FULL_LIBRARY } = require('@src/lib/roles/libraryScope')

// Sintel as the demo library has it: a hand-written metadata.json, no TMDB id
const sintel = (fields = {}) => ({
  _id: new ObjectId(),
  mediaId: SINTEL,
  type: 'movie',
  title: 'Sintel',
  originalTitle: 'Sintel',
  posterURL: 'https://files.example/media/movies/Sintel/poster.jpg',
  posterBlurhash: 'iVBORw0KGgo',
  metadata: { release_date: '2010-09-30' },
  ...fields,
})
const withTmdbId = (document) => ({ ...document, metadata: { ...document.metadata, id: SINTEL_TMDB_ID } })

const stored = (fields) => {
  const item = {
    _id: new ObjectId(),
    playlistId: new ObjectId(PLAYLIST_ID),
    userId: new ObjectId(USER_ID),
    mediaType: 'movie',
    dateAdded: new Date('2026-11-01'),
    ...fields,
  }
  mockItems.push(item)
  return item
}
const storedSintel = (fields = {}) =>
  stored({ libraryMediaId: SINTEL, title: 'Sintel', releaseDate: '2010-09-30', posterBlurhash: 'iVBORw0KGgo', ...fields })

const add = (fields) =>
  addToWatchlist({ mediaType: 'movie', title: 'Sintel', playlistId: PLAYLIST_ID, access: FULL_LIBRARY, ...fields })
const list = (options = {}) =>
  getUserWatchlist({ access: FULL_LIBRARY, playlistId: PLAYLIST_ID, userId: USER_ID, ...options })

beforeEach(() => {
  mockItems.length = 0
  mockLibrary.movies = []
  mockLibrary.shows = []
  mockFetchTmdb.mockReset()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => jest.restoreAllMocks())

describe('adding a library title with no TMDB id', () => {
  it('stores it under its library id, with what to show if the title ever leaves', async () => {
    const document = sintel()
    mockLibrary.movies = [document]

    const added = await add({ mediaId: document._id.toString(), libraryMediaId: SINTEL })

    expect(mockItems).toHaveLength(1)
    expect(mockItems[0]).toMatchObject({
      mediaType: 'movie',
      libraryMediaId: SINTEL,
      title: 'Sintel',
      releaseDate: '2010-09-30',
      posterBlurhash: 'iVBORw0KGgo',
    })
    // No tmdbId field at all: unique_playlist_title leaves the item out
    expect(mockItems[0]).not.toHaveProperty('tmdbId')
    expect(added).toMatchObject({
      tmdbId: null,
      libraryMediaId: SINTEL,
      title: 'Sintel',
      isInternal: true,
      url: '/list/movie/Sintel',
    })
    expect(mockFetchTmdb).not.toHaveBeenCalled()
  })

  it('holds one copy per playlist, and tells two such titles apart', async () => {
    mockLibrary.movies = [sintel(), sintel({ mediaId: BUNNY, title: 'Big Buck Bunny', originalTitle: 'Big Buck Bunny' })]

    await add({ libraryMediaId: SINTEL })
    await expect(add({ libraryMediaId: SINTEL })).rejects.toThrow('Item already exists in this playlist')
    await add({ libraryMediaId: BUNNY, title: 'Big Buck Bunny' })

    expect(mockItems.map((item) => item.libraryMediaId)).toEqual([SINTEL, BUNNY])
  })

  it('refuses an item that says neither which TMDB title nor which library title it is', async () => {
    await expect(add({})).rejects.toThrow('A TMDB ID or a library id')
    await expect(add({ libraryMediaId: 'not-a-library-id' })).rejects.toThrow('A TMDB ID or a library id')
    expect(mockItems).toEqual([])
  })

  it('is found by its library id, within its media type', async () => {
    const item = storedSintel()

    expect(await checkWatchlistStatus(null, null, PLAYLIST_ID, 'movie', SINTEL)).toMatchObject({ id: item._id.toString() })
    expect(await checkWatchlistStatus(null, null, PLAYLIST_ID, 'tv', SINTEL)).toBeNull()
    expect(await checkWatchlistStatus(null, null, PLAYLIST_ID, 'movie', BUNNY)).toBeNull()
  })

  it('toggles on and off like any other title', async () => {
    mockLibrary.movies = [sintel()]
    const title = { libraryMediaId: SINTEL, mediaType: 'movie', title: 'Sintel', playlistId: PLAYLIST_ID, access: FULL_LIBRARY }

    expect(await toggleWatchlist(title)).toMatchObject({ action: 'added', success: true })
    expect(mockItems).toHaveLength(1)
    expect(await toggleWatchlist(title)).toMatchObject({ action: 'removed', success: true })
    expect(mockItems).toEqual([])
  })
})

describe('when the title leaves the library', () => {
  it('the item stays, shown from what it stored and marked as gone', async () => {
    const item = storedSintel()

    const [listed] = await list()

    expect(listed).toMatchObject({
      id: item._id.toString(),
      tmdbId: null,
      libraryMediaId: SINTEL,
      title: 'Sintel',
      releaseDate: '2010-09-30',
      posterBlurhash: 'iVBORw0KGgo',
      libraryMissing: true,
      isAvailable: false,
    })
    // Nothing to open, and no TMDB entry to ask
    expect(listed.url).toBeUndefined()
    expect(mockFetchTmdb).not.toHaveBeenCalled()
    // The stored details are what's left of the title: the read keeps them
    expect(mockItems[0]).toMatchObject({ title: 'Sintel', releaseDate: '2010-09-30', posterBlurhash: 'iVBORw0KGgo' })
    // What the web list is sent
    expect(formatWatchlistItem(listed)).toMatchObject({
      tmdbId: null,
      libraryMediaId: SINTEL,
      title: 'Sintel',
      libraryMissing: true,
      posterBlurhash: 'iVBORw0KGgo',
    })
  })

  it('an item with no stored title says what happened instead of "Unknown Title"', async () => {
    stored({ libraryMediaId: SINTEL })

    expect((await list())[0]).toMatchObject({ title: 'No longer in the library', libraryMissing: true })
  })

  it('is left out of an available-only list and its count', async () => {
    mockLibrary.movies = [sintel({ mediaId: BUNNY, title: 'Big Buck Bunny', originalTitle: 'Big Buck Bunny' })]
    storedSintel()
    stored({ libraryMediaId: BUNNY, title: 'Big Buck Bunny' })

    expect(await list({ internalOnly: true, countOnly: true })).toBe(1)
    expect((await list({ internalOnly: true })).map((item) => item.title)).toEqual(['Big Buck Bunny'])
    // The whole list still holds both
    expect(await list()).toHaveLength(2)
  })

  it('matches the title again when it comes back, under whatever _id the catalog gives it', async () => {
    const item = storedSintel()
    expect((await list())[0].libraryMissing).toBe(true)

    const returned = sintel()
    mockLibrary.movies = [returned]

    const [listed] = await list()
    expect(listed).toMatchObject({
      id: item._id.toString(),
      libraryMediaId: SINTEL,
      title: 'Sintel',
      isInternal: true,
      currentMediaId: returned._id.toString(),
      url: '/list/movie/Sintel',
    })
    expect(listed.libraryMissing).toBeUndefined()
  })

  it('is found by its item’s own id: all a client holds for it, and the way it is taken off the list', async () => {
    const item = storedSintel()
    const elsewhere = stored({ libraryMediaId: BUNNY, title: 'Big Buck Bunny', playlistId: new ObjectId() })

    // The list showed the item under this id; the app sends it back as mediaId
    expect(await checkWatchlistStatus(item._id.toString(), null, PLAYLIST_ID, 'movie')).toMatchObject({
      id: item._id.toString(),
      libraryMediaId: SINTEL,
    })
    // Only within the playlist asked about
    expect(await checkWatchlistStatus(elsewhere._id.toString(), null, PLAYLIST_ID, 'movie')).toBeNull()
    // An id that is no item's, and no title's either
    expect(await checkWatchlistStatus(new ObjectId().toString(), null, PLAYLIST_ID, 'movie')).toBeNull()
  })

  it('an item that recorded its title’s mediaId when it was added is still found by it', async () => {
    const recorded = new ObjectId()
    const item = stored({ tmdbId: 603, title: 'The Matrix', mediaId: recorded })

    expect(await checkWatchlistStatus(recorded.toString(), null, PLAYLIST_ID, 'movie')).toMatchObject({ id: item._id.toString() })
  })

  it('its card says so, from the stored title and blurhash, with no TMDB lookup', async () => {
    mockLibrary.movies = [sintel({ mediaId: BUNNY, title: 'Big Buck Bunny', originalTitle: 'Big Buck Bunny' })]
    const gone = storedSintel()
    const here = stored({ libraryMediaId: BUNNY, title: 'Big Buck Bunny' })

    const cards = await getMinimalCardDataForPlaylist(await list(), null, true, { access: FULL_LIBRARY })

    const goneCard = cards.find((card) => card.watchlistId === gone._id.toString())
    expect(goneCard).toMatchObject({
      tmdbId: null,
      libraryMediaId: SINTEL,
      libraryMissing: true,
      isAvailable: false,
      title: 'Sintel',
      posterBlurhash: 'iVBORw0KGgo',
      link: null,
      url: null,
    })
    expect(goneCard.metadata).toMatchObject({ id: null, release_date: '2010-09-30' })

    const hereCard = cards.find((card) => card.watchlistId === here._id.toString())
    expect(hereCard).toMatchObject({
      tmdbId: null,
      isAvailable: true,
      title: 'Big Buck Bunny',
      link: 'Big%20Buck%20Bunny',
      url: '/list/movie/Big%20Buck%20Bunny',
    })
    expect(hereCard.libraryMissing).toBeUndefined()
    // The library id is read to match the item, and stays off the card
    expect(hereCard).not.toHaveProperty('mediaId')
    expect(mockFetchTmdb).not.toHaveBeenCalled()
  })

  it('a playlist of nothing but such titles still has cards', async () => {
    storedSintel()
    expect(await getMinimalCardDataForPlaylist(await list(), null, true, { access: FULL_LIBRARY })).toHaveLength(1)
  })
})

describe('when the title is later given a TMDB id', () => {
  it('a list read moves its item to the TMDB key', async () => {
    mockLibrary.movies = [withTmdbId(sintel())]
    const item = storedSintel()

    const [listed] = await list()
    // This read shows the title as it resolved, TMDB id included
    expect(listed).toMatchObject({ id: item._id.toString(), tmdbId: SINTEL_TMDB_ID, isInternal: true })

    expect(mockItems).toHaveLength(1)
    expect(mockItems[0]).toMatchObject({ _id: item._id, tmdbId: SINTEL_TMDB_ID, title: 'Sintel' })
    expect(mockItems[0]).not.toHaveProperty('libraryMediaId')
    // From here on it is an item like any other
    expect(await checkWatchlistStatus(null, SINTEL_TMDB_ID, PLAYLIST_ID, 'movie')).toMatchObject({ id: item._id.toString() })
  })

  it('a status check that knows both ids finds the item and moves it', async () => {
    const item = storedSintel()

    // By TMDB id alone it isn't there to be found
    expect(await checkWatchlistStatus(null, SINTEL_TMDB_ID, PLAYLIST_ID, 'movie')).toBeNull()
    expect(mockItems[0]).toHaveProperty('libraryMediaId', SINTEL)

    const found = await checkWatchlistStatus(null, SINTEL_TMDB_ID, PLAYLIST_ID, 'movie', SINTEL)
    expect(found).toMatchObject({ id: item._id.toString(), tmdbId: SINTEL_TMDB_ID })
    expect(mockItems[0]).not.toHaveProperty('libraryMediaId')
  })

  it('an add that knows both ids finds the item instead of adding a second copy', async () => {
    mockLibrary.movies = [withTmdbId(sintel())]
    const item = storedSintel()

    await expect(add({ tmdbId: SINTEL_TMDB_ID, libraryMediaId: SINTEL })).rejects.toThrow('Item already exists in this playlist')

    expect(mockItems).toHaveLength(1)
    expect(mockItems[0]).toMatchObject({ _id: item._id, tmdbId: SINTEL_TMDB_ID })
    expect(mockItems[0]).not.toHaveProperty('libraryMediaId')
  })

  it('a toggle that knows both ids takes the title off the list, as the user asked', async () => {
    mockLibrary.movies = [withTmdbId(sintel())]
    storedSintel()

    const result = await toggleWatchlist({
      tmdbId: SINTEL_TMDB_ID,
      libraryMediaId: SINTEL,
      mediaType: 'movie',
      title: 'Sintel',
      playlistId: PLAYLIST_ID,
      access: FULL_LIBRARY,
    })

    expect(result).toMatchObject({ action: 'removed', success: true })
    expect(mockItems).toEqual([])
  })

  it('drops the library-keyed copy when the playlist already holds the title under its TMDB id', async () => {
    mockLibrary.movies = [withTmdbId(sintel())]
    const fromSearch = stored({ tmdbId: SINTEL_TMDB_ID, title: 'Sintel' })
    storedSintel()

    await list()

    expect(mockItems).toHaveLength(1)
    expect(mockItems[0]._id).toEqual(fromSearch._id)
  })

  it('an add under the TMDB id alone is unaffected when there is no such item', async () => {
    mockLibrary.movies = [withTmdbId(sintel())]

    await add({ tmdbId: SINTEL_TMDB_ID, libraryMediaId: SINTEL })

    expect(mockItems).toHaveLength(1)
    expect(mockItems[0]).toMatchObject({ tmdbId: SINTEL_TMDB_ID })
    expect(mockItems[0]).not.toHaveProperty('libraryMediaId')
  })
})
