/**
 * @jest-environment node
 *
 * /api/authenticated/arr: nothing reaches Radarr/Sonarr for a caller who may
 * not use them (admins only, for now), and an add marks the title Coming Soon
 * for everyone with it on a watchlist, unless it is already in the library,
 * without failing the add when that second write fails.
 */

const mockAccess = jest.fn()
jest.mock('@src/lib/arr/access', () => ({ requireArrAccess: (...args) => mockAccess(...args) }))

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

jest.mock('@src/lib/arr/titles', () => ({
  ...jest.requireActual('@src/lib/arr/titles'),
  getArrTitle: jest.fn(),
  addArrTitle: jest.fn(),
  updateArrTitle: jest.fn(),
  searchArrTitle: jest.fn(),
  getArrEpisodes: jest.fn(),
}))
jest.mock('@src/lib/arr/status', () => ({ ...jest.requireActual('@src/lib/arr/status'), getArrStatuses: jest.fn() }))
jest.mock('@src/utils/watchlist/database', () => ({ setComingSoonStatus: jest.fn() }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))

const titles = require('@src/lib/arr/titles')
const { getArrStatuses } = require('@src/lib/arr/status')
const { setComingSoonStatus } = require('@src/utils/watchlist/database')
const titleRoute = require('@src/app/api/authenticated/arr/titles/[mediaType]/[tmdbId]/route')
const searchRoute = require('@src/app/api/authenticated/arr/titles/[mediaType]/[tmdbId]/search/route')
const episodesRoute = require('@src/app/api/authenticated/arr/titles/[mediaType]/[tmdbId]/episodes/route')
const statusRoute = require('@src/app/api/authenticated/arr/status/route')

// What requireArrAccess() answers for an admin
const ADMIN = {
  userId: '64b7f0c2a1b2c3d4e5f60718',
  userName: 'Adam',
  permissions: { profiles: { radarr: 'all', sonarr: 'all' }, manual: true, anyTitle: true, manage: true },
}
const BASE = 'http://localhost/api/authenticated/arr'

const context = (mediaType, tmdbId) => ({ params: Promise.resolve({ mediaType, tmdbId: String(tmdbId) }) })
const jsonRequest = (url, method, body) =>
  new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  mockAccess.mockResolvedValue(ADMIN)
})

test('a caller without access gets the auth answer, and nothing is asked of Radarr/Sonarr', async () => {
  const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  mockAccess.mockResolvedValue(denied)

  const answers = await Promise.all([
    titleRoute.GET(new Request(`${BASE}/titles/movie/11`), context('movie', 11)),
    titleRoute.POST(jsonRequest(`${BASE}/titles/movie/11`, 'POST', { qualityProfileId: 4 }), context('movie', 11)),
    titleRoute.PATCH(jsonRequest(`${BASE}/titles/movie/11`, 'PATCH', { qualityProfileId: 4 }), context('movie', 11)),
    searchRoute.POST(jsonRequest(`${BASE}/titles/tv/1438/search`, 'POST', {}), context('tv', 1438)),
    episodesRoute.GET(new Request(`${BASE}/titles/tv/1438/episodes`), context('tv', 1438)),
    statusRoute.GET(new Request(`${BASE}/status?items=movie:11`)),
  ])

  for (const answer of answers) expect(answer).toBe(denied)
  for (const fn of [titles.getArrTitle, titles.addArrTitle, titles.updateArrTitle, titles.searchArrTitle, titles.getArrEpisodes, getArrStatuses]) {
    expect(fn).not.toHaveBeenCalled()
  }
  expect(setComingSoonStatus).not.toHaveBeenCalled()
})

describe('POST (add)', () => {
  const added = { service: 'radarr', entry: { id: 900 }, inLibrary: false, next: null }
  const post = (body = { qualityProfileId: 4, folder: 'Star Wars' }) =>
    titleRoute.POST(jsonRequest(`${BASE}/titles/movie/11?title=Star%20Wars`, 'POST', body), context('movie', 11))

  test('adds, then marks the title Coming Soon with who did it', async () => {
    titles.addArrTitle.mockResolvedValue(added)

    const response = await post()

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ ...added, comingSoon: true })
    expect(titles.addArrTitle).toHaveBeenCalledWith(
      { mediaType: 'movie', tmdbId: 11 },
      expect.objectContaining({ qualityProfileId: 4, folder: 'Star Wars', search: true }),
      'Star Wars',
      ADMIN
    )
    expect(setComingSoonStatus).toHaveBeenCalledWith({
      tmdbId: 11,
      mediaType: 'movie',
      setBy: ADMIN.userId,
      setByUsername: 'Adam',
      source: 'radarr',
    })
  })

  test('a title already in the library is not marked Coming Soon', async () => {
    titles.addArrTitle.mockResolvedValue({ ...added, inLibrary: true })
    const response = await post()
    await expect(response.json()).resolves.toMatchObject({ comingSoon: false })
    expect(setComingSoonStatus).not.toHaveBeenCalled()
  })

  test('Coming Soon failing does not fail an add that already happened', async () => {
    titles.addArrTitle.mockResolvedValue(added)
    setComingSoonStatus.mockRejectedValue(new Error('db down'))

    const response = await post()

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ comingSoon: false })
    expect(mockLog.error).toHaveBeenCalled()
  })

  test('a bad title or body is a 400 before anything is asked', async () => {
    const badType = await titleRoute.POST(jsonRequest(`${BASE}/titles/music/11`, 'POST', { qualityProfileId: 4 }), context('music', 11))
    expect(badType.status).toBe(400)

    const notJson = await titleRoute.POST(
      new Request(`${BASE}/titles/movie/11`, { method: 'POST', body: 'not json' }),
      context('movie', 11)
    )
    expect(notJson.status).toBe(400)
    await expect(notJson.json()).resolves.toMatchObject({ error: 'invalid_request', message: 'Expected a JSON body.' })
    expect(titles.addArrTitle).not.toHaveBeenCalled()
  })

  test('a refusal from the rules keeps its status and message', async () => {
    titles.addArrTitle.mockRejectedValue(new titles.ArrRequestError(409, 'folder_taken', 'Taken.'))
    const response = await post()
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'folder_taken', message: 'Taken.' })
    expect(setComingSoonStatus).not.toHaveBeenCalled()
  })
})

test('GET answers the dialog’s state, passing the display title through', async () => {
  titles.getArrTitle.mockResolvedValue({ state: 'not_found', service: 'sonarr' })
  const response = await titleRoute.GET(new Request(`${BASE}/titles/tv/1438?title=The%20Wire`), context('tv', 1438))
  await expect(response.json()).resolves.toEqual({ state: 'not_found', service: 'sonarr' })
  expect(titles.getArrTitle).toHaveBeenCalledWith({ mediaType: 'tv', tmdbId: 1438 }, 'The Wire', ADMIN)
})

test('search: a movie ignores any scope; a show’s scope is parsed', async () => {
  titles.searchArrTitle.mockResolvedValue({ service: 'radarr', episodes: null })
  const movie = await searchRoute.POST(
    jsonRequest(`${BASE}/titles/movie/11/search`, 'POST', { scope: { type: 'seasons', seasons: [1] } }),
    context('movie', 11)
  )
  expect(movie.status).toBe(202)
  expect(titles.searchArrTitle).toHaveBeenLastCalledWith({ mediaType: 'movie', tmdbId: 11 }, { type: 'all' }, null, ADMIN)

  titles.searchArrTitle.mockResolvedValue({ service: 'sonarr', episodes: 10 })
  await searchRoute.POST(
    jsonRequest(`${BASE}/titles/tv/1438/search`, 'POST', { scope: { type: 'seasons', seasons: [2, 2] } }),
    context('tv', 1438)
  )
  expect(titles.searchArrTitle).toHaveBeenLastCalledWith(
    { mediaType: 'tv', tmdbId: 1438 },
    { type: 'seasons', seasons: [2] },
    null,
    ADMIN
  )

  const empty = await searchRoute.POST(
    jsonRequest(`${BASE}/titles/tv/1438/search`, 'POST', { scope: { type: 'episodes', episodeIds: [] } }),
    context('tv', 1438)
  )
  expect(empty.status).toBe(400)
})

test('episodes are for shows only', async () => {
  const response = await episodesRoute.GET(new Request(`${BASE}/titles/movie/11/episodes`), context('movie', 11))
  expect(response.status).toBe(400)
  expect(titles.getArrEpisodes).not.toHaveBeenCalled()
})

test('status: malformed items are a 400; good ones are passed on parsed', async () => {
  const bad = await statusRoute.GET(new Request(`${BASE}/status?items=movie:11,book:3`))
  expect(bad.status).toBe(400)

  getArrStatuses.mockResolvedValue({ services: { radarr: 'ok', sonarr: 'ok' }, items: {} })
  const good = await statusRoute.GET(new Request(`${BASE}/status?items=movie:11,tv:1438`))
  expect(good.status).toBe(200)
  expect(getArrStatuses).toHaveBeenCalledWith(
    [
      { mediaType: 'movie', tmdbId: 11 },
      { mediaType: 'tv', tmdbId: 1438 },
    ],
    ADMIN
  )
})
