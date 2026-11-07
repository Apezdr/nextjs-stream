/**
 * @jest-environment node
 *
 * The list pages' reads from the browser (mediaListApi.js): GETs to
 * /api/authenticated/media-list, where the Server Actions they replace used
 * to be. A signed-out caller goes to sign-in and back, a pending account to
 * the approval page, as the actions' redirects sent them, and the call
 * resolves null as the page leaves; any other failure throws, with the
 * status alone.
 */
const assign = jest.fn()
global.window = { location: { pathname: '/list/movie', search: '?sort=title', assign } }

const { fetchMovieListData, fetchTVListData, fetchSeasonHasEpisodes } = require('@components/MediaPages/mediaListApi')

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const requested = () => new URL(global.fetch.mock.calls[0][0], 'https://app.example')

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn().mockResolvedValue(reply(200, { items: [] }))
})

it('asks for a page of the movie list with the filters as the query', async () => {
  expect(await fetchMovieListData({ page: 2, sortOrder: 'title', genres: ['Drama', 'Comedy'], hdrTypes: [], resolutions: ['4K'] })).toEqual({
    items: [],
  })
  const url = requested()
  expect(url.pathname).toBe('/api/authenticated/media-list/movie')
  expect(url.searchParams.get('page')).toBe('2')
  expect(url.searchParams.get('sortOrder')).toBe('title')
  expect(url.searchParams.getAll('genres')).toEqual(['Drama', 'Comedy'])
  expect(url.searchParams.getAll('resolutions')).toEqual(['4K'])
  // A GET: the "View as" guard lets it through
  expect(global.fetch.mock.calls[0][1].method).toBeUndefined()
})

it('asks for the TV list the same way', async () => {
  await fetchTVListData({ page: 1, sortOrder: 'newest', genres: [], hdrTypes: ['HDR10'], resolutions: [] })
  expect(requested().pathname).toBe('/api/authenticated/media-list/tv')
  expect(requested().searchParams.getAll('hdrTypes')).toEqual(['HDR10'])
})

it('asks whether a season has episodes, with the title as the page has it', async () => {
  global.fetch.mockResolvedValue(reply(200, { success: true, hasEpisodes: true }))
  expect(await fetchSeasonHasEpisodes({ showTitle: '100% Wolf', seasonNumber: '2' })).toEqual({ success: true, hasEpisodes: true })
  expect(requested().pathname).toBe('/api/authenticated/media-list/season-episodes')
  expect(requested().searchParams.get('showTitle')).toBe('100% Wolf')
  expect(requested().searchParams.get('seasonNumber')).toBe('2')
})

it('sends a signed-out caller to sign-in, back to this page after, and resolves null', async () => {
  global.fetch.mockResolvedValue(reply(401, { code: 'AUTH_REQUIRED' }))
  expect(await fetchMovieListData({ page: 2 })).toBeNull()
  expect(assign).toHaveBeenCalledWith(`/auth/signin?callbackUrl=${encodeURIComponent('/list/movie?sort=title')}`)
})

it('sends an account awaiting approval to the approval page', async () => {
  global.fetch.mockResolvedValue(reply(403, { code: 'APPROVAL_PENDING' }))
  expect(await fetchSeasonHasEpisodes({ showTitle: 'A Show', seasonNumber: 1 })).toBeNull()
  expect(assign).toHaveBeenCalledWith('/auth/error?error=APPROVAL_PENDING')
})

it('throws on any other failure, with the status alone', async () => {
  global.fetch.mockResolvedValue(reply(500, { error: 'connection to db-host:27017 refused' }))
  await expect(fetchTVListData({ page: 1 })).rejects.toThrow('Couldn’t load the shows (500)')
  await expect(fetchTVListData({ page: 1 })).rejects.not.toThrow(/db-host/)
  // A 403 that isn't the approval gate's is a failure, not a redirect
  global.fetch.mockResolvedValue(reply(403, { error: 'IMPERSONATING' }))
  await expect(fetchMovieListData({ page: 1 })).rejects.toThrow('(403)')
  expect(assign).not.toHaveBeenCalled()
})
