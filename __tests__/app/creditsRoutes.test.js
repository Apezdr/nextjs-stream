/**
 * @jest-environment node
 *
 * GET /api/authenticated/credits and /credits/availability: an approved user
 * gets the catalog for their access level, a user with limited access never
 * gets titles, and a failed read is a 500, never "no credits".
 */

const mockUser = { current: { id: 'u1', limitedAccess: false } }
jest.mock('@src/utils/routeAuth', () => ({
  isAuthenticatedAndApproved: jest.fn(async () => mockUser.current),
}))
jest.mock('@src/utils/credits/catalog', () => ({
  getCreditsCatalog: jest.fn(),
  getCreditsAvailability: jest.fn(),
}))

const { getCreditsCatalog, getCreditsAvailability } = require('@src/utils/credits/catalog')
const { isAuthenticatedAndApproved } = require('@src/utils/routeAuth')
const catalogRoute = require('@src/app/api/authenticated/credits/route')
const availabilityRoute = require('@src/app/api/authenticated/credits/availability/route')

const request = (path) => new Request(`https://cinema.example/api/authenticated/${path}`)

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockUser.current = { id: 'u1', limitedAccess: false }
})

it('answers the availability for a full-access user', async () => {
  getCreditsAvailability.mockResolvedValue({ available: true, library: true, titles: 3 })
  const response = await availabilityRoute.GET(request('credits/availability'))
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ available: true, library: true, titles: 3 })
  expect(getCreditsAvailability).toHaveBeenCalledWith({ includeTitles: true })
  expect(response.headers.get('cache-control')).toBe('private, no-store')
})

it('asks for no titles for a user with limited access', async () => {
  mockUser.current = { id: 'u2', limitedAccess: true }
  getCreditsCatalog.mockResolvedValue({ library: null, titles: [] })
  await catalogRoute.GET(request('credits'))
  expect(getCreditsCatalog).toHaveBeenCalledWith({ includeTitles: false })
})

it('answers the catalog', async () => {
  const catalog = { library: null, titles: [{ type: 'movie', id: 'm1', title: 'T', originalTitle: 'T' }] }
  getCreditsCatalog.mockResolvedValue(catalog)
  expect(await (await catalogRoute.GET(request('credits'))).json()).toEqual(catalog)
})

it('answers 500 when the read fails, never an empty answer', async () => {
  getCreditsAvailability.mockRejectedValue(new Error('down'))
  getCreditsCatalog.mockRejectedValue(new Error('down'))
  expect((await availabilityRoute.GET(request('credits/availability'))).status).toBe(500)
  expect((await catalogRoute.GET(request('credits'))).status).toBe(500)
})

it('passes an unauthenticated answer through', async () => {
  isAuthenticatedAndApproved.mockResolvedValueOnce(new Response(null, { status: 401 }))
  expect((await availabilityRoute.GET(request('credits/availability'))).status).toBe(401)
  expect(getCreditsAvailability).not.toHaveBeenCalled()
})
