/**
 * @jest-environment node
 *
 * GET /api/status is the TV app's unauthenticated liveness probe (8 s client
 * timeout). It must never be stored by a cache, must answer within ~2 s even
 * when Mongo hangs, and must not put driver error text on a public response.
 */

const mockCommand = jest.fn()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ command: (...args) => mockCommand(...args) }) }),
}))

const mockWarn = jest.fn()
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ warn: (...args) => mockWarn(...args) }),
}))

jest.mock('next/server', () => ({ connection: async () => {} }))

const { GET } = require('@src/app/api/status/route')

beforeEach(() => {
  mockCommand.mockReset()
  mockWarn.mockReset()
})

afterEach(() => {
  jest.useRealTimers()
})

test('a live database answers 200 with no-store', async () => {
  mockCommand.mockResolvedValue({ ok: 1 })

  const res = await GET()

  expect(res.status).toBe(200)
  expect(res.headers.get('Cache-Control')).toBe('no-store')
  expect((await res.json()).ok).toBe(true)
})

test('a failed ping answers 503 without the driver error text', async () => {
  mockCommand.mockRejectedValue(new Error('connect ECONNREFUSED 172.18.0.4:27017'))

  const res = await GET()
  const body = await res.json()

  expect(res.status).toBe(503)
  expect(res.headers.get('Cache-Control')).toBe('no-store')
  expect(body.ok).toBe(false)
  expect(JSON.stringify(body)).not.toContain('172.18.0.4')
  expect(mockWarn).toHaveBeenCalledWith(
    { err: expect.objectContaining({ message: expect.stringContaining('172.18.0.4') }) },
    'Database ping failed'
  )
})

test('a hung ping answers 503 after 2 s instead of waiting on the driver', async () => {
  jest.useFakeTimers()
  mockCommand.mockReturnValue(new Promise(() => {}))

  let settled = null
  const pending = GET().then((res) => (settled = res))

  await jest.advanceTimersByTimeAsync(1_999)
  expect(settled).toBeNull()

  await jest.advanceTimersByTimeAsync(1)
  await pending
  expect(settled.status).toBe(503)
  expect(settled.headers.get('Cache-Control')).toBe('no-store')
})
