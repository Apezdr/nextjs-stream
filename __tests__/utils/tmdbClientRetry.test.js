/**
 * @jest-environment node
 */
/**
 * The TMDB client the web pages use retried a 4xx despite its comment saying
 * it didn't: the error it threw landed in its own catch and went round again.
 * With the proxy now passing 404s through, that cost 3 s of backoff for every
 * title TMDB no longer has. It follows the shared retry rule now.
 */

// The setup's JSDOM window puts the client on its browser path, where the page
// origin ("null" here) would be the base of a relative URL
jest.mock('@src/utils', () => ({ buildURL: (path) => `https://cinema.example${path}` }))

const { searchMedia } = require('@src/utils/tmdb/client')

const answer = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: String(status),
  json: async () => body,
})

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  // Backoff sleeps resolve at once; the 10 s abort timer never fires
  jest.spyOn(global, 'setTimeout').mockImplementation((fn, ms) => {
    if (ms < 10000) fn()
    return 0
  })
  global.fetch = jest.fn()
})

afterEach(() => jest.restoreAllMocks())

it("gives up on a title TMDB doesn't have after one request", async () => {
  global.fetch.mockResolvedValue(answer(404, { error: 'No movie with id 1', code: 'TMDB_NOT_FOUND' }))

  await expect(searchMedia('Dune', 'movie')).rejects.toMatchObject({ name: 'TMDBError', status: 404 })
  expect(global.fetch).toHaveBeenCalledTimes(1)
})

it.each([500, 502])('does not retry a %i', async (status) => {
  global.fetch.mockResolvedValue(answer(status, { error: 'boom' }))

  await expect(searchMedia('Dune', 'movie')).rejects.toMatchObject({ status })
  expect(global.fetch).toHaveBeenCalledTimes(1)
})

it('retries a 503 and returns the answer that follows', async () => {
  global.fetch
    .mockResolvedValueOnce(answer(503, { error: 'busy' }))
    .mockResolvedValueOnce(answer(200, { results: [{ id: 1 }] }))

  await expect(searchMedia('Dune', 'movie')).resolves.toEqual({ results: [{ id: 1 }] })
  expect(global.fetch).toHaveBeenCalledTimes(2)
})

it('retries a network error up to its limit', async () => {
  global.fetch.mockRejectedValue(new TypeError('fetch failed'))

  await expect(searchMedia('Dune', 'movie')).rejects.toMatchObject({ name: 'TMDBError' })
  expect(global.fetch).toHaveBeenCalledTimes(3) // first try + 2 retries
})
