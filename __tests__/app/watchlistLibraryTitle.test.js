/**
 * @jest-environment node
 *
 * Adding a library title with no TMDB id to a list used to answer 400 "Bad
 * Request": the route looked up the title's TMDB id and gave up when it had
 * none. It now asks the library which title a mediaId is, and keys the item
 * on the title's TMDB id when it has one, else on the library's own id for it.
 * The library id only ever comes from the catalog, never from the request.
 */
jest.mock('next/server', () => ({ after: (callback) => callback() }))
jest.mock('@src/lib/roles/gates', () => ({ approvedGate: { route: jest.fn(async () => ({ id: 'u1' })) } }))
const mockAccess = { id: 'all', scope: null, showIds: null }
jest.mock('@src/lib/roles/libraryAccess', () => ({ libraryAccessFor: jest.fn(async () => mockAccess) }))

const mockFindLibraryTitleIdentity = jest.fn()
const mockToggleWatchlist = jest.fn()
const mockAddToWatchlist = jest.fn()
const mockCheckWatchlistStatus = jest.fn()
const mockRemoveFromWatchlist = jest.fn()
jest.mock('@src/utils/watchlist/', () => ({
  ...jest.requireActual('@src/utils/watchlist/validation.js'),
  findLibraryTitleIdentity: (...args) => mockFindLibraryTitleIdentity(...args),
  toggleWatchlist: (...args) => mockToggleWatchlist(...args),
  addToWatchlist: (...args) => mockAddToWatchlist(...args),
  checkWatchlistStatus: (...args) => mockCheckWatchlistStatus(...args),
  removeFromWatchlist: (...args) => mockRemoveFromWatchlist(...args),
  formatWatchlistItem: (item) => item,
}))
jest.mock('@src/utils/watchlist/database', () => ({ ensureDefaultPlaylist: jest.fn(), getPlaylistById: jest.fn() }))

const { DELETE, GET, POST } = require('@src/app/api/authenticated/watchlist/route')

// The catalog document's _id, which is what the web and the apps send as mediaId
const SINTEL_DOC = '6a4fa5575bd6dc41316ddacd'
const SINTEL = 'mid:e31a15704f374ca9'
const SINTEL_TMDB_ID = 45745
const BASE = 'https://cinema.example/api/authenticated/watchlist'

const post = (query, body) =>
  POST(new Request(`${BASE}?${query}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
const get = (query) => GET(new Request(`${BASE}?${query}`))
const remove = (query) => DELETE(new Request(`${BASE}?${query}`, { method: 'DELETE' }))

beforeEach(() => {
  jest.clearAllMocks()
  mockToggleWatchlist.mockResolvedValue({ success: true, action: 'added', item: { id: 'w1' } })
  mockAddToWatchlist.mockResolvedValue({ id: 'w1' })
  mockCheckWatchlistStatus.mockResolvedValue(null)
  mockRemoveFromWatchlist.mockResolvedValue(true)
})

describe('toggle, as the web’s heart button sends it', () => {
  // The body carries the library's id for the title and no TMDB id, because the title has none
  const heart = () => post(`action=toggle&mediaId=${SINTEL_DOC}`, { mediaType: 'movie', title: 'Sintel', mediaId: SINTEL_DOC })

  it('adds a library title with no TMDB id under its library id', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: null, libraryMediaId: SINTEL })

    const response = await heart()

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, action: 'added' })
    expect(mockFindLibraryTitleIdentity).toHaveBeenCalledWith(SINTEL_DOC, 'movie', mockAccess)
    const [toggled] = mockToggleWatchlist.mock.calls[0]
    expect(toggled).toMatchObject({ mediaId: SINTEL_DOC, mediaType: 'movie', title: 'Sintel', libraryMediaId: SINTEL })
    expect(toggled.tmdbId).toBeUndefined()
  })

  it('keys a title that has a TMDB id on it, the library id riding along for an item saved before it had one', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: SINTEL_TMDB_ID, libraryMediaId: SINTEL })

    expect((await heart()).status).toBe(200)
    expect(mockToggleWatchlist.mock.calls[0][0]).toMatchObject({ tmdbId: SINTEL_TMDB_ID, libraryMediaId: SINTEL })
  })

  it('refuses a title the caller’s library doesn’t have, as before', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue(null)

    const response = await heart()

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'MISSING_TMDB_ID' })
    expect(mockToggleWatchlist).not.toHaveBeenCalled()
  })

  it('takes a title that has left the library off the list when the toggle sends back its list row’s id', async () => {
    // What a client holds for such a row: the list shows it under its own id,
    // and it has no TMDB id to be named by
    const rowId = '68eda138767b1e172b9d7c6d'
    const playlistId = '68eda138767b1e172b9d7c6c'
    mockFindLibraryTitleIdentity.mockResolvedValue(null)
    mockCheckWatchlistStatus.mockResolvedValue({ id: rowId, libraryMediaId: SINTEL, title: 'Sintel' })

    const response = await post('action=toggle', { mediaType: 'movie', title: 'Sintel', mediaId: rowId, playlistId })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, action: 'removed' })
    expect(mockCheckWatchlistStatus).toHaveBeenCalledWith(rowId, undefined, playlistId, 'movie')
    expect(mockRemoveFromWatchlist).toHaveBeenCalledWith(rowId)
    // Nothing is added: there is no title to add
    expect(mockToggleWatchlist).not.toHaveBeenCalled()
  })

  it('refuses, saying why, a title with neither a TMDB id nor a library id', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: null, libraryMediaId: null })

    const response = await heart()

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      code: 'MISSING_TITLE_IDENTITY',
      message: expect.stringContaining('no TMDB id'),
    })
    expect(mockToggleWatchlist).not.toHaveBeenCalled()
  })

  it('never takes a library id from the request', async () => {
    // A TMDB-only title (no mediaId), with a library id slipped into the body
    const response = await post('action=toggle', { mediaType: 'movie', title: 'Cars', tmdbId: 920, libraryMediaId: SINTEL })

    expect(response.status).toBe(200)
    expect(mockFindLibraryTitleIdentity).not.toHaveBeenCalled()
    const [toggled] = mockToggleWatchlist.mock.calls[0]
    expect(toggled).toMatchObject({ tmdbId: 920 })
    expect(toggled.libraryMediaId).toBeUndefined()
  })

  it('leaves the library id out when the library says the mediaId is some other title', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: 603, libraryMediaId: 'mid:00000000000000aa' })

    await post(`action=toggle&mediaId=${SINTEL_DOC}&tmdbId=920`, { mediaType: 'movie', title: 'Cars', mediaId: SINTEL_DOC })

    const [toggled] = mockToggleWatchlist.mock.calls[0]
    expect(toggled).toMatchObject({ tmdbId: 920 })
    expect(toggled.libraryMediaId).toBeUndefined()
  })
})

describe('add', () => {
  it('adds a library title with no TMDB id under its library id', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: null, libraryMediaId: SINTEL })

    const response = await post('action=add', { mediaType: 'movie', title: 'Sintel', mediaId: SINTEL_DOC, playlistId: '68eda138767b1e172b9d7c6c' })

    expect(response.status).toBe(201)
    const [added] = mockAddToWatchlist.mock.calls[0]
    expect(added).toMatchObject({ libraryMediaId: SINTEL, mediaType: 'movie', playlistId: '68eda138767b1e172b9d7c6c' })
    expect(added.tmdbId).toBeUndefined()
  })

  it('takes the library id itself as a mediaId: how the web copies such an item to another playlist', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: null, libraryMediaId: SINTEL })

    const response = await post('action=add', { mediaType: 'movie', title: 'Sintel', mediaId: SINTEL })

    expect(response.status).toBe(201)
    expect(mockFindLibraryTitleIdentity).toHaveBeenCalledWith(SINTEL, 'movie', mockAccess)
  })
})

describe('status and remove', () => {
  const item = { id: 'w1', mediaType: 'movie', libraryMediaId: SINTEL }

  it('a title with no TMDB id is looked for under its library id', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: null, libraryMediaId: SINTEL })
    mockCheckWatchlistStatus.mockImplementation(async (_mediaId, _tmdbId, _playlistId, _mediaType, libraryMediaId) =>
      libraryMediaId === SINTEL ? item : null
    )

    const response = await get(`action=status&mediaId=${SINTEL_DOC}&mediaType=movie`)

    expect(await response.json()).toMatchObject({ inWatchlist: true, item })
    expect(mockCheckWatchlistStatus).toHaveBeenCalledWith(SINTEL_DOC, undefined, null, 'movie', SINTEL)
  })

  it('the literal "tmdbId=undefined" older web builds send is not a TMDB id', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: null, libraryMediaId: SINTEL })

    await get(`action=status&mediaId=${SINTEL_DOC}&tmdbId=undefined&mediaType=movie`)

    expect(mockCheckWatchlistStatus).toHaveBeenCalledWith(SINTEL_DOC, undefined, null, 'movie', SINTEL)
  })

  it('a title with a TMDB id is looked for once, its library id alongside: its item may predate the TMDB id', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: SINTEL_TMDB_ID, libraryMediaId: SINTEL })
    mockCheckWatchlistStatus.mockResolvedValue({ id: 'w1', tmdbId: SINTEL_TMDB_ID })

    const response = await get(`action=status&mediaId=${SINTEL_DOC}&tmdbId=${SINTEL_TMDB_ID}&mediaType=movie`)

    expect(await response.json()).toMatchObject({ inWatchlist: true })
    expect(mockCheckWatchlistStatus).toHaveBeenCalledTimes(1)
    expect(mockCheckWatchlistStatus).toHaveBeenCalledWith(SINTEL_DOC, SINTEL_TMDB_ID, null, 'movie', SINTEL)
  })

  it('a title named by TMDB id alone costs no library read', async () => {
    mockCheckWatchlistStatus.mockResolvedValue({ id: 'w2', tmdbId: 920 })

    const response = await get('action=status&tmdbId=920&mediaType=movie')

    expect(await response.json()).toMatchObject({ inWatchlist: true })
    expect(mockFindLibraryTitleIdentity).not.toHaveBeenCalled()
    expect(mockCheckWatchlistStatus).toHaveBeenCalledWith(null, 920, null, 'movie')
  })

  it('a mediaId the library can’t place is looked for as it always was', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue(null)

    // By the TMDB id it came with
    await get(`action=status&mediaId=${SINTEL_DOC}&tmdbId=920&mediaType=movie`)
    expect(mockCheckWatchlistStatus).toHaveBeenLastCalledWith(SINTEL_DOC, 920, null, 'movie', undefined)

    // Or, with none, as an item that recorded that mediaId when it was added
    const response = await get(`action=status&mediaId=${SINTEL_DOC}&mediaType=movie`)
    expect(await response.json()).toMatchObject({ inWatchlist: false })
    expect(mockCheckWatchlistStatus).toHaveBeenLastCalledWith(SINTEL_DOC, undefined, null, 'movie')
  })

  it('removes a title with no TMDB id by its mediaId', async () => {
    mockFindLibraryTitleIdentity.mockResolvedValue({ tmdbId: null, libraryMediaId: SINTEL })
    mockCheckWatchlistStatus.mockImplementation(async (_mediaId, _tmdbId, _playlistId, _mediaType, libraryMediaId) =>
      libraryMediaId === SINTEL ? item : null
    )

    const response = await remove(`action=remove&mediaId=${SINTEL_DOC}&mediaType=movie`)

    expect(response.status).toBe(200)
    expect(mockRemoveFromWatchlist).toHaveBeenCalledWith('w1')
  })

  it('removes an item by its own id: the one way to remove a title that has left the library', async () => {
    const response = await remove('action=remove&id=68eda138767b1e172b9d7c6c')

    expect(response.status).toBe(200)
    expect(mockRemoveFromWatchlist).toHaveBeenCalledWith('68eda138767b1e172b9d7c6c')
    expect(mockFindLibraryTitleIdentity).not.toHaveBeenCalled()
  })
})
