/**
 * @jest-environment node
 *
 * GET /api/authenticated/system-status sets its own Cache-Control. The shared
 * ETag helper also sets one ('no-cache') and used to be spread after it,
 * silently replacing the route's max-age on every response.
 */

const mockGetStatus = jest.fn()
jest.mock('@src/utils/getProcessedSystemStatus', () => ({
  getProcessedSystemStatus: (...args) => mockGetStatus(...args),
}))
jest.mock('@src/utils/routeAuth', () => ({
  __esModule: true,
  default: async () => ({ id: 'user-1' }),
}))
jest.mock('next/server', () => ({ connection: async () => {} }))

const { GET } = require('@src/app/api/authenticated/system-status/route')

const request = () => new Request('http://localhost/api/authenticated/system-status')

beforeEach(() => {
  mockGetStatus.mockReset()
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  console.error.mockRestore()
})

test('a 200 keeps the route max-age alongside its ETag', async () => {
  mockGetStatus.mockResolvedValue({
    overall: { level: 'normal', message: 'All systems operational.', updatedAt: 'now' },
    servers: [],
    hasActiveIncidents: false,
  })

  const res = await GET(request())

  expect(res.status).toBe(200)
  expect(res.headers.get('Cache-Control')).toBe('private, must-revalidate, max-age=30')
  expect(res.headers.get('ETag')).toBeTruthy()
})

test('the error fallback keeps its shorter max-age', async () => {
  mockGetStatus.mockRejectedValue(new Error('boom'))

  const res = await GET(request())

  expect(res.status).toBe(200)
  expect(res.headers.get('Cache-Control')).toBe('private, must-revalidate, max-age=10')
  expect(res.headers.get('X-Status')).toBe('error')
})
