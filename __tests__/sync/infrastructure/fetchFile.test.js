/**
 * @jest-environment node
 *
 * fetchMetadataMultiServer (infrastructure/fileSystem/fetchFile): what it
 * returns on each outcome, the request it makes, and the one HTTP limiter it
 * goes through (the ResourceManager's).
 */

const mockServerList = [
  { id: 'default', baseURL: 'https://files.example', prefixPath: '/media' },
  { id: 'server2', baseURL: 'http://192.168.1.20:8080/library', prefixPath: '' },
  { id: 'nobase', baseURL: undefined, prefixPath: '' },
]
const mockCache = new Map()
let mockCacheReadError = null
let mockCacheWriteError = null

jest.mock('@src/utils/config', () => ({
  // As config.js's serverManager.getServer: no id is the default server, an unknown one throws
  getServer: (id) => {
    const server = mockServerList.find((s) => s.id === (id || 'default'))
    if (!server) throw new Error(`No server found with ID: ${id}`)
    return server
  },
}))
jest.mock('@src/lib/cache', () => ({
  getCache: jest.fn(async (key) => {
    if (mockCacheReadError) throw mockCacheReadError
    return mockCache.get(key) ?? null
  }),
  setCache: jest.fn(async (key, data, etag, lastModified) => {
    if (mockCacheWriteError) throw mockCacheWriteError
    mockCache.set(key, { data, etag, lastModified, timestamp: new Date().toISOString() })
  }),
}))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
// The real p-limit is an ES module jest does not transform; this one keeps its contract.
jest.mock('p-limit', () => (width) => {
  let active = 0
  const queue = []
  const next = () => {
    if (active >= width || queue.length === 0) return
    active++
    const { fn, resolve, reject } = queue.shift()
    Promise.resolve()
      .then(fn)
      .then(resolve, reject)
      .finally(() => {
        active--
        next()
      })
  }
  const limit = (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      next()
    })
  Object.defineProperty(limit, 'pendingCount', { get: () => queue.length })
  return limit
})

const { httpGet } = require('@src/lib/httpHelper')
const { setCache } = require('@src/lib/cache')
const { ResourceManager } = require('@src/utils/sync/core/ResourceManager')
const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')

const METADATA = '/media/movies/Some%20Movie%20(2020)/metadata.json'
const BLURHASH = '/media/movies/Some%20Movie%20(2020)/poster.jpg.blurhash'
const DAY_MS = 24 * 60 * 60 * 1000
const cached = (key, entry) => mockCache.set(key, { etag: null, lastModified: null, timestamp: new Date().toISOString(), ...entry })
const ago = (ms) => new Date(Date.now() - ms).toISOString()

beforeEach(() => {
  mockCache.clear()
  mockCacheReadError = null
  mockCacheWriteError = null
  httpGet.mockReset()
  setCache.mockClear()
  ResourceManager.resetInstance()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  delete process.env.SYNC_HTTP_CONCURRENCY
  ResourceManager.resetInstance()
  jest.restoreAllMocks()
})

describe('what it returns', () => {
  it.each([[''], [null], [undefined]])('an empty object, and asks nothing, for the URL %j', async (url) => {
    await expect(fetchMetadataMultiServer('default', url, 'file', 'movie', 'A')).resolves.toEqual({})
    await expect(fetchMetadataMultiServer('default', url, 'blurhash', 'movie', 'A')).resolves.toEqual({})
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('the parsed file, cached for an hour with its validators', async () => {
    httpGet.mockResolvedValue({ data: { id: 7 }, headers: { etag: '"e1"', 'last-modified': 'Mon, 01 Jan 2024 00:00:00 GMT' } })

    await expect(fetchMetadataMultiServer('default', METADATA, 'file', 'movie', 'A')).resolves.toEqual({ id: 7 })

    expect(httpGet).toHaveBeenCalledWith(`https://files.example${METADATA}`, {
      headers: {},
      timeout: 5000,
      responseType: 'json',
      http2: true,
      retry: { limit: 2, baseDelay: 300 },
    })
    expect(setCache).toHaveBeenCalledWith(`default:file:${METADATA}`, { id: 7 }, '"e1"', 'Mon, 01 Jan 2024 00:00:00 GMT', 3600)
  })

  describe('raw bytes (a credits file)', () => {
    const CREDITS = '/media/movies/Some%20Movie%20(2020)/credits.json?hash=abc'
    // Not UTF-8 on purpose: the bytes must come back exactly as sent
    const RAW = Buffer.from([0x7b, 0x22, 0xe9, 0x22, 0x7d, 0xef, 0xbb, 0xbf])

    it('come back as the very bytes the server sent, read as a buffer and cached as base64', async () => {
      httpGet.mockResolvedValue({ data: RAW, headers: { etag: '"c1"' } })

      const data = await fetchMetadataMultiServer('default', CREDITS, 'bytes', 'movie', 'A')

      expect(Buffer.isBuffer(data) && data.equals(RAW)).toBe(true)
      expect(httpGet).toHaveBeenCalledWith(`https://files.example${CREDITS}`, expect.objectContaining({ responseType: 'buffer' }))
      expect(setCache).toHaveBeenCalledWith(`default:bytes:${CREDITS}`, RAW.toString('base64'), '"c1"', undefined, 3600)
    })

    it('come back from the cache as the same bytes on Not Modified, and after a failed request', async () => {
      cached(`default:bytes:${CREDITS}`, { data: RAW.toString('base64'), etag: '"c1"' })
      httpGet.mockResolvedValueOnce({ data: null, headers: {} })
      const notModified = await fetchMetadataMultiServer('default', CREDITS, 'bytes', 'movie', 'A')
      expect(Buffer.isBuffer(notModified) && notModified.equals(RAW)).toBe(true)

      httpGet.mockRejectedValueOnce(new Error('ECONNRESET'))
      const fallback = await fetchMetadataMultiServer('default', CREDITS, 'bytes', 'movie', 'A')
      expect(Buffer.isBuffer(fallback) && fallback.equals(RAW)).toBe(true)
    })

    it('come back as null for an empty body with nothing cached', async () => {
      httpGet.mockResolvedValue({ data: Buffer.alloc(0), headers: {} })
      await expect(fetchMetadataMultiServer('default', CREDITS, 'bytes', 'movie', 'A')).resolves.toBeNull()
    })
  })

  it('the blurhash text trimmed, cached for a week', async () => {
    httpGet.mockResolvedValue({ data: '  LEHV6nWB2yk8\n', headers: {} })

    await expect(fetchMetadataMultiServer('default', BLURHASH, 'blurhash', 'movie', 'A')).resolves.toBe('LEHV6nWB2yk8')

    expect(httpGet).toHaveBeenCalledWith(`https://files.example${BLURHASH}`, expect.objectContaining({ timeout: 3000, responseType: 'text' }))
    expect(setCache).toHaveBeenCalledWith(`default:blurhash:${BLURHASH}`, 'LEHV6nWB2yk8', null, undefined, 604800)
  })

  it('a blurhash cached less than a day ago, without a request or an HTTP slot', async () => {
    cached(`default:blurhash:${BLURHASH}`, { data: 'cachedHash', timestamp: ago(DAY_MS - 60000) })

    await expect(fetchMetadataMultiServer('default', BLURHASH, 'blurhash', 'movie', 'A')).resolves.toBe('cachedHash')

    expect(httpGet).not.toHaveBeenCalled()
    expect(ResourceManager.getInstance().getStats().totalHttpRequests).toBe(0)
  })

  it('asks with the cached validators once the cached copy is older (a file, or a blurhash over a day)', async () => {
    cached(`default:file:${METADATA}`, { data: { id: 1 }, etag: '"old"', lastModified: 'Sun, 31 Dec 2023 00:00:00 GMT' })
    cached(`default:blurhash:${BLURHASH}`, { data: 'oldHash', etag: '"b"', timestamp: ago(DAY_MS + 60000) })
    httpGet.mockResolvedValue({ data: null, headers: {} })

    await fetchMetadataMultiServer('default', METADATA, 'file', 'movie', 'A')
    await fetchMetadataMultiServer('default', BLURHASH, 'blurhash', 'movie', 'A')

    expect(httpGet.mock.calls[0][1].headers).toEqual({ 'If-None-Match': '"old"', 'If-Modified-Since': 'Sun, 31 Dec 2023 00:00:00 GMT' })
    expect(httpGet.mock.calls[1][1].headers).toEqual({ 'If-None-Match': '"b"' })
  })

  it('the cached copy on Not Modified, without writing the cache', async () => {
    cached(`default:file:${METADATA}`, { data: { id: 1 }, etag: '"old"' })
    httpGet.mockResolvedValue({ data: null, headers: {} })

    await expect(fetchMetadataMultiServer('default', METADATA, 'file', 'movie', 'A')).resolves.toEqual({ id: 1 })
    expect(setCache).not.toHaveBeenCalled()
  })

  // [what fails, how it is set up]. A blank answer only fails a blurhash: a
  // file's body is not trimmed.
  const answer = (file, blurhash) =>
    httpGet.mockImplementation(async (_url, options) => ({ data: options.responseType === 'text' ? blurhash : file, headers: {} }))
  const FAILURES = [
    ['an empty answer', () => answer(null, null)],
    ['a blank blurhash', () => answer({ id: 9 }, '  \n')],
    ['a request that fails', () => httpGet.mockRejectedValue(new Error('timeout of 5000ms exceeded'))],
    ['a cache write that throws', () => {
      answer({ id: 9 }, 'freshHash')
      mockCacheWriteError = new Error('redis down')
    }],
  ]

  it.each(FAILURES)('on %s, without a cached copy: null for a file, an empty string for a blurhash', async (label, arrange) => {
    arrange()
    if (label !== 'a blank blurhash') {
      await expect(fetchMetadataMultiServer('default', METADATA, 'file', 'movie', 'A')).resolves.toBeNull()
    }
    await expect(fetchMetadataMultiServer('default', BLURHASH, 'blurhash', 'movie', 'A')).resolves.toBe('')
  })

  it.each(FAILURES.filter(([label]) => label !== 'an empty answer'))('on %s, with a cached copy: the cached copy', async (label, arrange) => {
    // (An empty answer while a copy is cached is Not Modified, above.)
    cached(`default:file:${METADATA}`, { data: { id: 1 } })
    cached(`default:blurhash:${BLURHASH}`, { data: 'staleHash', timestamp: ago(2 * DAY_MS) })
    arrange()

    if (label !== 'a blank blurhash') {
      await expect(fetchMetadataMultiServer('default', METADATA, 'file', 'movie', 'A')).resolves.toEqual({ id: 1 })
    }
    await expect(fetchMetadataMultiServer('default', BLURHASH, 'blurhash', 'movie', 'A')).resolves.toBe('staleHash')
  })

  it.each([
    ['the cache cannot be read', () => (mockCacheReadError = new Error('redis down'))],
    ['the server id is unknown', () => {}, 'nope'],
    ['the server has no baseURL', () => {}, 'nobase'],
  ])('null for a file and an empty string for a blurhash, without a request, when %s', async (_label, arrange, serverId = 'default') => {
    arrange()

    await expect(fetchMetadataMultiServer(serverId, METADATA, 'file', 'movie', 'A')).resolves.toBeNull()
    await expect(fetchMetadataMultiServer(serverId, BLURHASH, 'blurhash', 'movie', 'A')).resolves.toBe('')
    expect(httpGet).not.toHaveBeenCalled()
  })

  it('no cached copy, either, for a server id that is unknown', async () => {
    cached(`nope:file:${METADATA}`, { data: { id: 1 } })

    await expect(fetchMetadataMultiServer('nope', METADATA, 'file', 'movie', 'A')).resolves.toBeNull()
  })
})

describe('the URL it asks for', () => {
  beforeEach(() => httpGet.mockResolvedValue({ data: { id: 1 }, headers: {} }))

  it.each([
    ['default', METADATA, `https://files.example${METADATA}`],
    ['server2', '/movies/Some%20Movie%20(2020)/metadata.json', 'http://192.168.1.20:8080/library/movies/Some%20Movie%20(2020)/metadata.json'],
    // The TV services hand it the full URL they built from the payload's path
    ['default', `https://files.example${BLURHASH}`, `https://files.example${BLURHASH}`],
    ['server2', 'http://192.168.1.20:8080/library/tv/Some%20Show/show_poster.jpg.blurhash', 'http://192.168.1.20:8080/library/tv/Some%20Show/show_poster.jpg.blurhash'],
  ])('on %s, for %s: %s', async (serverId, url, requested) => {
    await fetchMetadataMultiServer(serverId, url, 'file', 'tv', 'A')

    expect(httpGet).toHaveBeenCalledWith(requested, expect.any(Object))
  })

  it.each([
    ['another host', 'https://elsewhere.example/media/movies/A/metadata.json'],
    ['another server’s baseURL', 'http://192.168.1.20:8080/library/movies/A/metadata.json'],
    ['a path holding a second URL', '/media/movies/http://elsewhere.example/metadata.json'],
  ])('nothing for a URL on %s', async (_label, url) => {
    await expect(fetchMetadataMultiServer('default', url, 'file', 'movie', 'A')).resolves.toBeNull()
    expect(httpGet).not.toHaveBeenCalled()
  })
})

describe('the HTTP limiter', () => {
  it('is the ResourceManager’s: no more requests in flight than SYNC_HTTP_CONCURRENCY', async () => {
    process.env.SYNC_HTTP_CONCURRENCY = '2'
    ResourceManager.resetInstance()
    let inFlight = 0
    let widest = 0
    const release = []
    httpGet.mockImplementation(async () => {
      widest = Math.max(widest, ++inFlight)
      await new Promise((resolve) => release.push(resolve))
      inFlight--
      return { data: { id: 1 }, headers: {} }
    })

    const fetches = Array.from({ length: 5 }, (_, i) =>
      fetchMetadataMultiServer('default', `/media/movies/M${i}/metadata.json`, 'file', 'movie', `M${i}`)
    )
    // Let every fetch that can start do so, then let them finish one by one
    for (let settled = 0; settled < 5; settled++) {
      while (release.length === 0) await new Promise((resolve) => setImmediate(resolve))
      expect(ResourceManager.getInstance().getStats().activeHttpRequests).toBeLessThanOrEqual(2)
      release.shift()()
    }
    await expect(Promise.all(fetches)).resolves.toEqual(Array(5).fill({ id: 1 }))

    expect(widest).toBe(2)
    expect(ResourceManager.getInstance().getStats().totalHttpRequests).toBe(5)
  })
})
