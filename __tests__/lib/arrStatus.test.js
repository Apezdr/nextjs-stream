/**
 * @jest-environment node
 *
 * Chip states for a page of cards: one bad key refuses the request, and a
 * service that is unset or down is reported once rather than failing the rest.
 */

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))
jest.mock('@src/lib/arr/radarr', () => ({ movieStatuses: jest.fn() }))
jest.mock('@src/lib/arr/sonarr', () => ({ seriesStatuses: jest.fn() }))

const { movieStatuses } = require('@src/lib/arr/radarr')
const { seriesStatuses } = require('@src/lib/arr/sonarr')
const { ArrError } = require('@src/lib/arr/http')
const { MAX_STATUS_ITEMS, getArrStatuses, parseStatusItems } = require('@src/lib/arr/status')

const originalEnv = process.env

beforeEach(() => {
  jest.clearAllMocks()
  process.env = {
    ...originalEnv,
    RADARR_URL: 'http://radarr.test',
    RADARR_API_KEY: 'k1',
    SONARR_URL: 'http://sonarr.test',
    SONARR_API_KEY: 'k2',
  }
})

afterAll(() => {
  process.env = originalEnv
})

test('parseStatusItems: movie:/tv: keys, duplicates collapsed, anything else refused', () => {
  expect(parseStatusItems('movie:603,tv:1399,movie:603')).toEqual([
    { mediaType: 'movie', tmdbId: 603 },
    { mediaType: 'tv', tmdbId: 1399 },
  ])
  expect(parseStatusItems(null)).toEqual([])
  expect(parseStatusItems('movie:603,person:1')).toBeNull()
  expect(parseStatusItems('movie:0')).toBeNull()
  expect(parseStatusItems(Array.from({ length: MAX_STATUS_ITEMS + 1 }, (_, i) => `movie:${i + 1}`).join(','))).toBeNull()
})

test('statuses are keyed mediaType:tmdbId, so a movie and a show sharing a TMDB number stay apart', async () => {
  movieStatuses.mockResolvedValue(new Map([[1399, { state: 'downloaded' }]]))
  seriesStatuses.mockResolvedValue(new Map([[1399, { state: 'wanted', released: true }]]))

  await expect(
    getArrStatuses([
      { mediaType: 'movie', tmdbId: 1399 },
      { mediaType: 'tv', tmdbId: 1399 },
    ])
  ).resolves.toEqual({
    services: { radarr: 'ok', sonarr: 'ok' },
    items: { 'movie:1399': { state: 'downloaded' }, 'tv:1399': { state: 'wanted', released: true } },
  })
})

test('an unset service and a failing one are reported, and the other still answers', async () => {
  delete process.env.RADARR_URL
  seriesStatuses.mockRejectedValue(new ArrError('timeout'))

  await expect(
    getArrStatuses([
      { mediaType: 'movie', tmdbId: 603 },
      { mediaType: 'tv', tmdbId: 1399 },
    ])
  ).resolves.toEqual({ services: { radarr: 'not_configured', sonarr: 'unreachable' }, items: {} })
  expect(movieStatuses).not.toHaveBeenCalled()

  // The failure is logged once, not on every poll.
  await getArrStatuses([{ mediaType: 'tv', tmdbId: 1399 }])
  expect(mockLog.warn).toHaveBeenCalledTimes(1)
})

test('a service with no titles on the page is not asked', async () => {
  seriesStatuses.mockResolvedValue(new Map())
  await getArrStatuses([{ mediaType: 'tv', tmdbId: 1399 }])
  expect(movieStatuses).not.toHaveBeenCalled()
})
