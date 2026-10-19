/**
 * @jest-environment node
 *
 * GET /api/authenticated/calendar/<sonarr|radarr> fetches the *arr iCal feed,
 * whose URL (SONARR_ICAL_LINK, RADARR_ICAL_LINK) carries the API key. A failed
 * fetch logs one line with the key REDACTED, never the error object (got's
 * prints its options, the URL among them).
 */

process.env.SONARR_ICAL_LINK = 'https://sonarr.example/feed/calendar/Sonarr.ics?apikey=s3cr3t&unmonitored=true'

const mockHttpGet = jest.fn()
// got is an ES module jest does not transform; the route's fetch is stood in for below
jest.mock('got', () => ({ __esModule: true, default: jest.fn() }))
jest.mock('@src/lib/cache', () => ({ getCache: jest.fn(), setCache: jest.fn() }))
jest.mock('@src/lib/httpHelper', () => ({
  ...jest.requireActual('@src/lib/httpHelper'),
  httpGet: (...args) => mockHttpGet(...args),
}))
jest.mock('@src/utils/routeAuth', () => ({ isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })) }))

const { GET } = require('@src/app/api/authenticated/calendar/[endpoint]/route')

const call = (endpoint) =>
  GET(new Request(`http://127.0.0.1:3000/api/authenticated/calendar/${endpoint}`), {
    params: Promise.resolve({ endpoint }),
  })

beforeEach(() => {
  for (const method of ['log', 'error', 'warn']) jest.spyOn(console, method).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

it('logs a failed feed fetch in one line, with the API key REDACTED', async () => {
  const error = Object.assign(
    new Error(`HTTP Error: 401 for URL: ${process.env.SONARR_ICAL_LINK}`),
    { name: 'HTTPError', statusCode: 401, options: { url: new URL(process.env.SONARR_ICAL_LINK) } }
  )
  mockHttpGet.mockRejectedValue(error)

  const response = await call('sonarr')

  expect(response.status).toBe(500)
  expect(mockHttpGet).toHaveBeenCalledWith(process.env.SONARR_ICAL_LINK, expect.anything())
  const logged = [...console.error.mock.calls, ...console.log.mock.calls]
  expect(logged).toHaveLength(1)
  expect(logged[0]).toEqual([
    '[calendar] sonarr feed failed: HTTPError HTTP 401: HTTP Error: 401 for URL: ' +
      'https://sonarr.example/feed/calendar/Sonarr.ics?apikey=REDACTED&unmonitored=true',
  ])
  expect(JSON.stringify(logged)).not.toContain('s3cr3t')
})
