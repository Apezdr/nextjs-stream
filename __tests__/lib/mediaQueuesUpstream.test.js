/**
 * @jest-environment node
 *
 * How each queue is requested and how every failure is classified. The old
 * route turned every failure — unset env, timeout, rejected key, a restart —
 * into 501 "not supported", and the page then stopped asking until reload.
 */

const mockRequest = jest.fn()
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    request: (...args) => mockRequest(...args),
    isAxiosError: (error) => Boolean(error && error.isAxiosError),
    isCancel: (error) => Boolean(error && error.__CANCEL__),
  },
}))

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

const KEYS = {
  RADARR_API_KEY: 'radarr-secret-key',
  SONARR_API_KEY: 'sonarr-secret-key',
  SABNZBD_API_KEY: 'sabnzbd-secret-key',
  TDARR_API_KEY: 'tdarr-secret-key',
}
const ENV = {
  RADARR_URL: 'http://radarr.test:7878',
  SONARR_URL: 'http://sonarr.test:8989/',
  SABNZBD_URL: 'http://sab.test:8080/sabnzbd',
  TDARR_URL: 'http://tdarr.test:8265',
  ...KEYS,
}

const originalEnv = process.env

// Responses, keyed by the URL path each request ends with.
const json = (body) => ({ data: JSON.stringify(body) })
const httpError = (status, data = '') =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data },
    // What a real AxiosError carries, key and all: none of it may be logged.
    config: { url: 'http://sab.test:8080/sabnzbd/api', params: { apikey: KEYS.SABNZBD_API_KEY } },
  })
const networkError = (code) => Object.assign(new Error(code), { isAxiosError: true, code })
const canceled = () => Object.assign(new Error('canceled'), { __CANCEL__: true, code: 'ERR_CANCELED' })

const arrPage = { page: 1, pageSize: 20, totalRecords: 0, records: [] }
const arrStatus = { totalCount: 0, errors: false, warnings: false, unknownErrors: false, unknownWarnings: false }
const sabQueue = { queue: { status: 'Idle', paused: false, noofslots_total: 0, slots: [], have_warnings: '0', timeleft: '0:00:00' } }
const tdarrNodes = { n1: { nodeName: 'MyInternalNode', nodePaused: false, workers: {} } }
const tdarrStats = { table1Count: 2, table3Count: 0, table4Count: 1, table6Count: 0 }

function respondWith(routes) {
  mockRequest.mockImplementation(async (config) => {
    const path = new URL(config.url).pathname
    const handler = Object.entries(routes).find(([suffix]) => path.endsWith(suffix))?.[1]
    if (!handler) throw new Error(`unexpected request to ${path}`)
    const outcome = typeof handler === 'function' ? handler(config) : handler
    if (outcome instanceof Error) throw outcome
    return outcome
  })
}

const HEALTHY = {
  '/api/v3/queue': json(arrPage),
  '/api/v3/queue/status': json(arrStatus),
  '/sabnzbd/api': json(sabQueue),
  '/api/v2/get-nodes': json(tdarrNodes),
  '/api/v2/cruddb': json(tdarrStats),
}

let loadMediaQueue

beforeEach(() => {
  jest.resetModules()
  mockRequest.mockReset()
  Object.values(mockLog).forEach((fn) => fn.mockReset())
  process.env = { ...originalEnv, ...ENV }
  loadMediaQueue = require('@src/lib/mediaQueues/upstream').loadMediaQueue
})

afterAll(() => {
  process.env = originalEnv
})

const requestTo = (suffix) => mockRequest.mock.calls.map(([config]) => config).find((config) => new URL(config.url).pathname.endsWith(suffix))

describe('configuration', () => {
  test('an unset URL or key is "not configured", and nothing is requested', async () => {
    delete process.env.RADARR_URL
    delete process.env.RADARR_API_KEY
    await expect(loadMediaQueue('radarr')).resolves.toEqual({
      service: 'radarr',
      state: 'not_configured',
      missing: ['RADARR_URL', 'RADARR_API_KEY'],
    })
    expect(mockRequest).not.toHaveBeenCalled()
  })

  test('Tdarr needs only a URL: its API key matters only when Tdarr auth is on', async () => {
    delete process.env.TDARR_API_KEY
    respondWith(HEALTHY)
    await expect(loadMediaQueue('tdarr')).resolves.toMatchObject({ state: 'ok' })
    expect(requestTo('/api/v2/get-nodes').headers).toEqual({})

    delete process.env.TDARR_URL
    await expect(loadMediaQueue('tdarr')).resolves.toEqual({ service: 'tdarr', state: 'not_configured', missing: ['TDARR_URL'] })
  })
})

describe('requests', () => {
  test('Radarr: key in the X-Api-Key header, never the URL; unknown items included', async () => {
    respondWith(HEALTHY)
    await expect(loadMediaQueue('radarr')).resolves.toMatchObject({ service: 'radarr', state: 'ok' })

    const queue = requestTo('/api/v3/queue')
    expect(queue).toMatchObject({
      method: 'GET',
      url: 'http://radarr.test:7878/api/v3/queue',
      headers: { 'X-Api-Key': KEYS.RADARR_API_KEY },
      params: { page: 1, pageSize: 20, includeUnknownMovieItems: true },
      responseType: 'text',
    })
    expect(queue.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.stringify(queue.params)).not.toContain(KEYS.RADARR_API_KEY)
    expect(requestTo('/api/v3/queue/status').headers).toEqual({ 'X-Api-Key': KEYS.RADARR_API_KEY })
  })

  test("Sonarr: same API; its unknown-items flag; the URL's trailing slash dropped", async () => {
    respondWith(HEALTHY)
    await loadMediaQueue('sonarr')
    expect(requestTo('/api/v3/queue')).toMatchObject({
      url: 'http://sonarr.test:8989/api/v3/queue',
      params: { page: 1, pageSize: 20, includeUnknownSeriesItems: true },
    })
  })

  test('SABnzbd: key in the query (it reads no header), JSON asked for explicitly, only the shown slots', async () => {
    respondWith(HEALTHY)
    await expect(loadMediaQueue('sabnzbd')).resolves.toMatchObject({ service: 'sabnzbd', state: 'ok' })
    expect(requestTo('/sabnzbd/api')).toMatchObject({
      method: 'GET',
      url: 'http://sab.test:8080/sabnzbd/api',
      params: { mode: 'queue', output: 'json', start: 0, limit: 3, apikey: KEYS.SABNZBD_API_KEY },
    })
  })

  test('Tdarr: nodes plus library statistics, key in x-api-key', async () => {
    respondWith(HEALTHY)
    await expect(loadMediaQueue('tdarr')).resolves.toMatchObject({ service: 'tdarr', state: 'ok', health: 'waiting' })
    expect(requestTo('/api/v2/get-nodes')).toMatchObject({ method: 'GET', headers: { 'x-api-key': KEYS.TDARR_API_KEY } })
    expect(requestTo('/api/v2/cruddb')).toMatchObject({
      method: 'POST',
      headers: { 'x-api-key': KEYS.TDARR_API_KEY },
      data: { data: { collection: 'StatisticsJSONDB', mode: 'getById', docID: 'statistics' } },
    })
  })
})

describe('failures are classified, never thrown', () => {
  test.each([
    ['a rejected key', httpError(401), { reason: 'unauthorized', httpStatus: 401 }],
    ['a server error', httpError(503), { reason: 'http_error', httpStatus: 503 }],
    ['the deadline passing', canceled(), { reason: 'timeout', httpStatus: null }],
    ['a refused connection', networkError('ECONNREFUSED'), { reason: 'refused', httpStatus: null }],
    ['an unknown host', networkError('ENOTFOUND'), { reason: 'network', httpStatus: null }],
    ['an oversized body', networkError('ERR_BAD_RESPONSE'), { reason: 'invalid_response', httpStatus: null }],
    ['an unsupported protocol', networkError('ERR_BAD_REQUEST'), { reason: 'bad_url', httpStatus: null }],
    [
      'a malformed URL',
      Object.assign(new TypeError('Invalid URL'), { code: 'ERR_INVALID_URL' }),
      { reason: 'bad_url', httpStatus: null },
    ],
    ['an HTML login page', { data: '<html>Sign in</html>' }, { reason: 'invalid_response', httpStatus: null }],
  ])('%s', async (_label, outcome, expected) => {
    respondWith({ ...HEALTHY, '/api/v3/queue': outcome })
    await expect(loadMediaQueue('radarr')).resolves.toEqual({ service: 'radarr', state: 'unreachable', ...expected })
  })

  test("SABnzbd 5.x's 403 plain-text answer to a wrong key", async () => {
    respondWith({ '/sabnzbd/api': httpError(403, 'API Key Incorrect') })
    await expect(loadMediaQueue('sabnzbd')).resolves.toMatchObject({ state: 'unreachable', reason: 'unauthorized', httpStatus: 403 })
  })

  test("older SABnzbd's HTTP 200 { status: false } answer to a wrong key", async () => {
    respondWith({ '/sabnzbd/api': json({ status: false, error: 'API Key Incorrect' }) })
    await expect(loadMediaQueue('sabnzbd')).resolves.toMatchObject({ state: 'unreachable', reason: 'unauthorized' })
  })

  test('a SABnzbd queue in the old `jobs` shape is an invalid response, not an empty queue', async () => {
    respondWith({ '/sabnzbd/api': json({ queue: { status: 'Idle', jobs: [] } }) })
    await expect(loadMediaQueue('sabnzbd')).resolves.toMatchObject({ state: 'unreachable', reason: 'invalid_response' })
  })

  test('losing a secondary request only drops detail', async () => {
    respondWith({ ...HEALTHY, '/api/v3/queue/status': networkError('ECONNRESET'), '/api/v2/cruddb': httpError(404) })

    const radarr = await loadMediaQueue('radarr')
    expect(radarr).toMatchObject({ state: 'ok', health: 'idle' })
    expect(radarr.notices).toHaveLength(1)

    const tdarr = await loadMediaQueue('tdarr')
    expect(tdarr).toMatchObject({ state: 'ok' })
    expect(tdarr.notices).toEqual([{ tone: 'warning', message: 'Library queue counts unavailable.' }])
  })

  test('a bug in normalization is reported, not thrown', async () => {
    jest.resetModules()
    jest.doMock('@src/lib/mediaQueues/normalize', () => ({
      ...jest.requireActual('@src/lib/mediaQueues/normalize'),
      normalizeTdarr: () => {
        throw new TypeError("Cannot read properties of undefined (reading 'x')")
      },
    }))
    const { loadMediaQueue: load } = require('@src/lib/mediaQueues/upstream')
    respondWith(HEALTHY)

    await expect(load('tdarr')).resolves.toEqual({ service: 'tdarr', state: 'unreachable', reason: 'invalid_response', httpStatus: null })
    expect(mockLog.error).toHaveBeenCalledTimes(1)
    jest.dontMock('@src/lib/mediaQueues/normalize')
  })
})

describe('logging', () => {
  test('a service that stays down logs once, then once more when it recovers', async () => {
    respondWith({ ...HEALTHY, '/api/v3/queue': httpError(401) })
    await loadMediaQueue('radarr')
    await loadMediaQueue('radarr')
    await loadMediaQueue('radarr')
    expect(mockLog.warn).toHaveBeenCalledTimes(1)
    expect(mockLog.warn.mock.calls[0][0]).toEqual({ queue: 'radarr', reason: 'unauthorized', httpStatus: 401 })

    respondWith(HEALTHY)
    await loadMediaQueue('radarr')
    await loadMediaQueue('radarr')
    expect(mockLog.info).toHaveBeenCalledTimes(1)
    expect(mockLog.info.mock.calls[0][0]).toEqual({ queue: 'radarr' })
  })

  test('no log line carries an API key or a request URL', async () => {
    respondWith({
      '/api/v3/queue': httpError(401),
      '/api/v3/queue/status': httpError(401),
      '/sabnzbd/api': httpError(403, 'API Key Incorrect'),
      '/api/v2/get-nodes': canceled(),
      '/api/v2/cruddb': canceled(),
    })
    await Promise.all(['radarr', 'sonarr', 'sabnzbd', 'tdarr'].map((service) => loadMediaQueue(service)))

    const logged = JSON.stringify([...mockLog.warn.mock.calls, ...mockLog.info.mock.calls, ...mockLog.error.mock.calls])
    expect(mockLog.warn).toHaveBeenCalled()
    for (const key of Object.values(KEYS)) expect(logged).not.toContain(key)
    expect(logged).not.toMatch(/https?:\/\//)
  })
})
