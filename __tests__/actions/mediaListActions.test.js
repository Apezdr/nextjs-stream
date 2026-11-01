/**
 * @jest-environment node
 *
 * The media pages' data actions are public POST endpoints (the list pages'
 * client chunks carry their IDs). Each checks its caller as the pages'
 * SessionGate does (src/lib/actionViewer.ts) and reads the user from the
 * session: getMovieListData/getTVListData used to take userId from the
 * request, so anyone could page the library and read any user's watch
 * history; refreshEpisodes handed out full episode documents.
 */

const mockGetSession = jest.fn()
jest.mock('@src/lib/cachedAuth', () => ({ getSession: (...args) => mockGetSession(...args) }))
jest.mock('next/navigation', () => ({
  redirect: jest.fn((url) => {
    throw new Error(`REDIRECT ${url}`)
  }),
}))
const mockMovieList = jest.fn(async () => ({ items: [] }))
const mockTVList = jest.fn(async () => ({ items: [] }))
jest.mock('@src/utils/cache/mediaListData', () => ({
  getCachedMovieListData: (...args) => mockMovieList(...args),
  getCachedTVListData: (...args) => mockTVList(...args),
}))
const mockSeason = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({ getFlatTVSeasonWithEpisodes: (...args) => mockSeason(...args) }))

const { getMovieListData, getTVListData } = require('@src/utils/actions/mediaListActions')
const { refreshEpisodes } = require('@src/utils/actions/refreshEpisodes')

beforeEach(() => {
  mockGetSession.mockReset()
  mockMovieList.mockClear()
  mockTVList.mockClear()
  mockSeason.mockReset()
})

describe.each([
  ['getMovieListData', getMovieListData, mockMovieList, '/list/movie'],
  ['getTVListData', getTVListData, mockTVList, '/list/tv'],
])('%s', (_name, action, cached, page) => {
  it('sends a signed-out caller to sign-in, back to the list after, and reads nothing', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(action({ page: 1 })).rejects.toThrow(`REDIRECT /auth/signin?callbackUrl=${encodeURIComponent(page)}`)
    expect(cached).not.toHaveBeenCalled()
  })

  it('sends an account awaiting approval to the approval page, as the page does', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1', approved: false } })

    await expect(action({ page: 1 })).rejects.toThrow('REDIRECT /auth/error?error=APPROVAL_PENDING')
    expect(cached).not.toHaveBeenCalled()
  })

  it('serves a limited-access account, as the list page does', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me', limitedAccess: true } })

    await action({})
    expect(cached).toHaveBeenCalledWith(expect.objectContaining({ userId: 'me' }))
  })

  it("reads the signed-in user's own watch history, whatever userId the caller sends", async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me', approved: true } })

    await action({ page: 2, sortOrder: 'title', genres: ['Drama'], userId: 'someone-else' })

    expect(cached).toHaveBeenCalledWith({
      page: 2,
      sortOrder: 'title',
      genres: ['Drama'],
      hdrTypes: [],
      resolutions: [],
      userId: 'me',
    })
  })

  it('passes only the filter fields, and only their string values, to the cached fetch', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })

    await action({ page: 'x', sortOrder: { $ne: null }, hdrTypes: ['HDR10', { $gt: '' }], extra: 'ignored' })

    expect(cached.mock.calls[0][0]).toEqual({
      page: undefined,
      sortOrder: undefined,
      genres: [],
      hdrTypes: ['HDR10'],
      resolutions: [],
      userId: 'me',
    })
  })
})

describe('refreshEpisodes', () => {
  it('sends a signed-out caller to sign-in, back to the season after, and reads nothing', async () => {
    mockGetSession.mockResolvedValue(null)

    await expect(refreshEpisodes({ showTitle: 'A Show', seasonNumber: '1' })).rejects.toThrow(
      `REDIRECT /auth/signin?callbackUrl=${encodeURIComponent('/list/tv/A%20Show/1')}`
    )
    expect(mockSeason).not.toHaveBeenCalled()
  })

  it('answers whether the season has episodes now, and returns no episode documents', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })
    mockSeason.mockResolvedValue({ episodes: [{ videoURL: 'https://files.test/e1.mp4' }] })

    const result = await refreshEpisodes({ showTitle: '100% Wolf', seasonNumber: '2' })

    // The title as given: the season page already decoded it once
    expect(mockSeason).toHaveBeenCalledWith({ showTitle: '100% Wolf', seasonNumber: 2 })
    expect(result).toEqual({ success: true, hasEpisodes: true })
  })

  it('refuses a title or season that is not a plain value, before any query', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })

    for (const args of [
      { showTitle: { $regex: '.*' }, seasonNumber: '1' },
      { showTitle: '', seasonNumber: '1' },
      { showTitle: 'A Show', seasonNumber: { $gt: 0 } },
      { showTitle: 'A Show', seasonNumber: '1; drop' },
    ]) {
      await expect(refreshEpisodes(args)).resolves.toEqual({ success: false, hasEpisodes: false })
    }
    expect(mockSeason).not.toHaveBeenCalled()
  })

  it('answers no on a failure, with no error detail for the client', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'me' } })
    mockSeason.mockRejectedValue(new Error('connection to db-host:27017 refused'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    await expect(refreshEpisodes({ showTitle: 'A Show', seasonNumber: '1' })).resolves.toEqual({
      success: false,
      hasEpisodes: false,
    })
  })
})
