/**
 * @jest-environment node
 *
 * The release-picking routes: nothing runs for a caller without access, a
 * show's search names its season or episode, search ids are checked, and a
 * grab's errors name the service it ran on.
 */

const mockAccess = jest.fn()
jest.mock('@src/lib/arr/access', () => ({ requireArrAccess: (...args) => mockAccess(...args) }))
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))
jest.mock('@src/lib/arr/picks', () => ({
  ...jest.requireActual('@src/lib/arr/picks'),
  startPick: jest.fn(),
  readPick: jest.fn(),
  grabPick: jest.fn(),
  pickService: jest.fn(),
}))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))

const picks = require('@src/lib/arr/picks')
const { ArrError } = require('@src/lib/arr/http')
const startRoute = require('@src/app/api/authenticated/arr/titles/[mediaType]/[tmdbId]/releases/route')
const searchRoute = require('@src/app/api/authenticated/arr/releases/[searchId]/route')
const grabRoute = require('@src/app/api/authenticated/arr/releases/[searchId]/grab/route')

const ADMIN = { id: 'admin-1', name: 'Adam', role: 'admin' }
const BASE = 'http://localhost/api/authenticated/arr'
const SEARCH_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

const titleContext = (mediaType, tmdbId) => ({ params: Promise.resolve({ mediaType, tmdbId: String(tmdbId) }) })
const searchContext = (searchId) => ({ params: Promise.resolve({ searchId }) })
const post = (url, body) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

beforeEach(() => {
  jest.clearAllMocks()
  mockAccess.mockResolvedValue(ADMIN)
})

test('a caller without access gets the auth answer and nothing runs', async () => {
  const denied = new Response('{}', { status: 401 })
  mockAccess.mockResolvedValue(denied)

  const answers = await Promise.all([
    startRoute.POST(post(`${BASE}/titles/movie/11/releases`, {}), titleContext('movie', 11)),
    searchRoute.GET(new Request(`${BASE}/releases/${SEARCH_ID}`), searchContext(SEARCH_ID)),
    grabRoute.POST(post(`${BASE}/releases/${SEARCH_ID}/grab`, { releaseId: '0' }), searchContext(SEARCH_ID)),
  ])

  for (const answer of answers) expect(answer).toBe(denied)
  for (const fn of [picks.startPick, picks.readPick, picks.grabPick]) expect(fn).not.toHaveBeenCalled()
})

test('starting: 202; a show names its season or episode, a movie needs nothing', async () => {
  picks.startPick.mockResolvedValue({ id: SEARCH_ID, state: 'searching' })

  const show = await startRoute.POST(post(`${BASE}/titles/tv/1438/releases?title=The%20Wire`, { seasonNumber: 2 }), titleContext('tv', 1438))
  expect(show.status).toBe(202)
  expect(picks.startPick).toHaveBeenLastCalledWith({ mediaType: 'tv', tmdbId: 1438 }, { seasonNumber: 2 }, 'The Wire', ADMIN.id)

  await startRoute.POST(post(`${BASE}/titles/movie/11/releases`, { seasonNumber: 2 }), titleContext('movie', 11))
  expect(picks.startPick).toHaveBeenLastCalledWith({ mediaType: 'movie', tmdbId: 11 }, null, null, ADMIN.id)

  const noTarget = await startRoute.POST(post(`${BASE}/titles/tv/1438/releases`, {}), titleContext('tv', 1438))
  expect(noTarget.status).toBe(400)
})

test('polling: a malformed id is a 400; a known one is read', async () => {
  const bad = await searchRoute.GET(new Request(`${BASE}/releases/nope`), searchContext('nope'))
  expect(bad.status).toBe(400)
  expect(picks.readPick).not.toHaveBeenCalled()

  picks.readPick.mockReturnValue({ id: SEARCH_ID, state: 'done', releases: [] })
  const good = await searchRoute.GET(new Request(`${BASE}/releases/${SEARCH_ID}`), searchContext(SEARCH_ID))
  await expect(good.json()).resolves.toMatchObject({ state: 'done' })
})

test('grabbing passes the release id on; the service’s refusal is named after it', async () => {
  picks.grabPick.mockResolvedValue({ service: 'sonarr', title: 'The.Wire.S02', monitored: true })
  const ok = await grabRoute.POST(post(`${BASE}/releases/${SEARCH_ID}/grab`, { releaseId: '3' }), searchContext(SEARCH_ID))
  expect(ok.status).toBe(200)
  expect(picks.grabPick).toHaveBeenCalledWith(SEARCH_ID, '3')

  picks.pickService.mockReturnValue('sonarr')
  picks.grabPick.mockRejectedValue(new ArrError('rejected', 409, ['Getting release from indexer failed']))
  const refused = await grabRoute.POST(post(`${BASE}/releases/${SEARCH_ID}/grab`, { releaseId: '3' }), searchContext(SEARCH_ID))
  expect(refused.status).toBe(422)
  await expect(refused.json()).resolves.toMatchObject({ message: 'Sonarr: Getting release from indexer failed' })
})
