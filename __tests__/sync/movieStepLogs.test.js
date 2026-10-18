/**
 * @jest-environment node
 *
 * What the movie steps print. The prefetch step fetches the files a step
 * reads and logs nothing; the step logs what it read where it used to fetch
 * it, with the same lines: the metadata step's "Fetched metadata" (or the
 * error a fetch threw), the artwork step's warning for a blurhash read that
 * threw or came back as an HTML page, and the retry's warning only for a
 * fetch that threw, never for an empty answer.
 */

const mockServers = { A: { id: 'A', priority: 1 } }

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: { getInstance: () => ({ throttleHttp: (fn) => fn() }) },
  getResourceManager: () => ({}),
}))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  logError: jest.fn(),
}))
jest.mock('@src/utils/config', () => ({ getServer: (id) => mockServers[id], multiServerHandler: {} }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({ fetchMetadataMultiServer: jest.fn() }))

const { syncMovieMetadata } = require('@src/utils/sync/domain/movies/metadata')
const { syncMovieArtwork, retryMovieBlurhashes } = require('@src/utils/sync/domain/movies/artwork')
const { buildWithResources } = require('@src/utils/sync/infrastructure/fileSystem/prefetch')
const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
const { httpGet } = require('@src/lib/httpHelper')
const { syncLogger, LogLevel } = require('@src/utils/sync/core/logger')

const KEY = 'Film (2020)'
const FOLDER = `/movies/${encodeURIComponent(KEY)}`
const urls = {
  metadata: `${FOLDER}/metadata.json`,
  poster: `${FOLDER}/poster.jpg?hash=p1`,
  posterBlurhash: `${FOLDER}/poster.jpg.blurhash`,
}
const input = () => ({
  originalTitle: KEY,
  movie: { title: KEY, originalTitle: KEY, metadata: {} },
  payload: { urls },
  run: { serverConfig: { ...mockServers.A, baseUrl: 'https://A.example', prefix: '', enabled: true }, allEnabledServersProbed: true },
  availability: { fieldAvailability: { movies: { [KEY]: { 'urls.metadata': ['A'], 'urls.poster': ['A'], 'urls.posterBlurhash': ['A'] } }, tv: {} } },
  caches: {},
})
const prefetch = { mediaType: 'movie', title: KEY }
const run = (step, ...args) => buildWithResources((resources) => step(...args, resources), prefetch)

let printed
beforeEach(() => {
  printed = []
  for (const method of ['log', 'warn', 'error', 'info', 'debug']) {
    jest.spyOn(console, method).mockImplementation((...args) =>
      printed.push([method, ...args.map((a) => (a instanceof Error ? `Error: ${a.message}` : a))])
    )
  }
  syncLogger.setLevel(LogLevel.DEBUG)
  httpGet.mockReset()
  fetchMetadataMultiServer.mockReset()
})
afterEach(() => {
  syncLogger.setLevel(LogLevel.INFO)
  jest.restoreAllMocks()
})
const lines = (method) => printed.filter(([m]) => m === method).map((line) => line.slice(1).join(' '))

describe('the metadata step', () => {
  it('logs that it fetched the metadata', async () => {
    fetchMetadataMultiServer.mockResolvedValue({ title: 'Film Title' })
    await run(syncMovieMetadata, input())
    expect(lines('log')).toContain(`⚪ [SYNC] ✅ Fetched metadata for "${KEY}" from A`)
  })

  it('logs an empty answer as fetched, as it always did', async () => {
    fetchMetadataMultiServer.mockResolvedValue(null)
    await run(syncMovieMetadata, input())
    expect(lines('log')).toContain(`⚪ [SYNC] ✅ Fetched metadata for "${KEY}" from A`)
    expect(lines('error')).toEqual([])
  })

  it('logs the error a fetch threw, and not that it fetched', async () => {
    fetchMetadataMultiServer.mockRejectedValue(new Error('file server timed out'))
    await run(syncMovieMetadata, input())
    expect(lines('log').some((line) => line.includes('Fetched metadata'))).toBe(false)
    expect(lines('error')).toEqual([`🔴 [SYNC] Failed to extract metadata for ${KEY}: Error: file server timed out`])
  })
})

describe('the artwork step', () => {
  it('warns about a blurhash read that threw', async () => {
    httpGet.mockRejectedValue(new Error('timeout of 3000ms exceeded'))
    await run(syncMovieArtwork, input())
    expect(lines('warn')).toEqual(['🟡 [SYNC] ⚠️ Failed to fetch blurhash: timeout of 3000ms exceeded'])
  })

  it('warns about a blurhash read answered with an HTML page', async () => {
    httpGet.mockResolvedValue({ data: '<html></html>', headers: { 'content-type': 'text/html' } })
    await run(syncMovieArtwork, input())
    expect(lines('warn')).toEqual(['🟡 [SYNC] ⚠️ Blurhash URL returned HTML (error page), Content-Type: text/html'])
  })

  it('warns about nothing for an empty file', async () => {
    httpGet.mockResolvedValue({ data: '  ', headers: {} })
    await run(syncMovieArtwork, input())
    expect(lines('warn')).toEqual([])
  })
})

describe('the blurhash retry', () => {
  const retries = [{
    field: 'posterBlurhash',
    sourceField: 'posterBlurhashSource',
    decision: { action: 'fetch', blurhashUrl: urls.posterBlurhash, source: 'A', replacesStale: false },
  }]

  it('does not warn when the fetch comes back empty, and says the blurhash is still missing', async () => {
    fetchMetadataMultiServer.mockResolvedValue('')
    await run(retryMovieBlurhashes, input(), retries)
    expect(lines('warn')).toEqual([])
    expect(lines('log')).toEqual([
      `🔍 Movie blurhash retry: fetching "posterBlurhash" for "${KEY}" (server: "A", path: ${urls.posterBlurhash})`,
      `⏭️ Movie blurhash retry: "posterBlurhash" fetch returned empty/null for "${KEY}"`,
    ])
  })

  it('warns when the fetch threw', async () => {
    fetchMetadataMultiServer.mockRejectedValue(new Error('retry boom'))
    await run(retryMovieBlurhashes, input(), retries)
    expect(lines('warn')).toEqual([`⚠️ Movie blurhash retry: failed to fetch "posterBlurhash" for "${KEY}": retry boom`])
  })
})
