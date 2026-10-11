/**
 * @jest-environment node
 *
 * getProcessedSystemStatus feeds the signed-in status banner and
 * /api/authenticated/system-status. A file server that does not answer is
 * reported as 'unknown' — never as 'normal', and never with its transport
 * error, which can name an internal host — and one computation serves every
 * caller for the cache window.
 */

const mockHttpGet = jest.fn()

jest.mock('@src/utils/config', () => ({
  getAllServers: () => [
    { id: 'default', syncEndpoint: 'http://default.test/node' },
    { id: 'server2', syncEndpoint: 'http://server2.test/node' },
  ],
  getWebhookIdForServer: async () => null,
}))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: (...args) => mockHttpGet(...args) }))
// admin_utils' own imports, so its real getSystemStatusMessage can load.
jest.mock('@src/lib/cache', () => ({ getCache: jest.fn(), setCache: jest.fn() }))
jest.mock('p-limit', () => () => (fn) => fn())
jest.mock('@src/utils/admin_utils', () => ({
  ...jest.requireActual('@src/utils/admin_utils'),
  getLatestSystemStatus: async () => ({}),
}))

/** Per-server answers, keyed by server id; an Error rejects. */
function answer(byServer) {
  mockHttpGet.mockImplementation(async (url) => {
    const id = url.includes('server2') ? 'server2' : 'default'
    const result = byServer[id]
    if (result instanceof Error) throw result
    return { data: { status: result }, headers: {} }
  })
}

let getProcessedSystemStatus
let warn

beforeEach(() => {
  // The builder races each fetch against 2 s and 5 s timers; fake timers keep
  // those from outliving the test and let it move the clock past the cache.
  jest.useFakeTimers()
  jest.resetModules() // a fresh module-level cache for every test
  ;({ getProcessedSystemStatus } = require('@src/utils/getProcessedSystemStatus'))
  mockHttpGet.mockReset()
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
  jest.useRealTimers()
})

test('a file server that does not answer is unknown, named, and its error stays in the log', async () => {
  answer({ default: 'normal', server2: new Error('connect ECONNREFUSED 192.168.1.39:3000') })

  const status = await getProcessedSystemStatus()

  expect(status.servers.map((s) => s.level)).toEqual(['normal', 'unknown'])
  expect(status.servers[1].message).toBe('Server unreachable')
  expect(status.overall.level).toBe('unknown')
  expect(status.overall.message).toBe("Can't reach Server 2. Titles stored there may not play right now.")
  expect(JSON.stringify(status)).not.toContain('192.168.1.39')
  expect(warn).toHaveBeenCalledWith(
    'System status: server2 did not answer:',
    'connect ECONNREFUSED 192.168.1.39:3000'
  )
})

test('a load level on any server outranks an unreachable one', async () => {
  answer({ default: 'heavy', server2: new Error('timeout') })

  const status = await getProcessedSystemStatus()

  expect(status.overall.level).toBe('heavy')
})

test('servers that all answer normally are normal', async () => {
  answer({ default: 'normal', server2: 'normal' })

  const status = await getProcessedSystemStatus()

  expect(status.overall.level).toBe('normal')
  expect(status.overall.message).toBe('All systems operational.')
})

test('one computation serves every caller inside the cache window', async () => {
  answer({ default: 'normal', server2: 'normal' })

  // Concurrent callers share the computation in flight.
  const [first, second] = await Promise.all([getProcessedSystemStatus(), getProcessedSystemStatus()])
  expect(second).toBe(first)
  expect(mockHttpGet).toHaveBeenCalledTimes(2) // one probe per server

  // A later caller inside the window gets the same result without probing.
  jest.advanceTimersByTime(14_000)
  expect(await getProcessedSystemStatus()).toBe(first)
  expect(mockHttpGet).toHaveBeenCalledTimes(2)

  // Past the window it is computed again.
  jest.advanceTimersByTime(1_001)
  expect(await getProcessedSystemStatus()).not.toBe(first)
  expect(mockHttpGet).toHaveBeenCalledTimes(4)
})
