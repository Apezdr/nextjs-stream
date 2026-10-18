/**
 * @jest-environment node
 *
 * A movie's artwork step decides each image's blurhash once, by the rule every
 * image follows (core/imageAndBlurhash), and fetches the owner's blurhash file
 * once. A blurhash that fetch did not get, for an image that had none, gets a
 * second attempt in the retry step, through fetchMetadataMultiServer, on the
 * artwork step's decision. These cases pin that hand-over, and what each
 * step's plan says.
 */

const mockServers = { A: { id: 'A', priority: 1 }, B: { id: 'B', priority: 2 } }

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
jest.mock('@src/utils/config', () => ({
  getServer: (id) => mockServers[id],
  multiServerHandler: {},
}))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({
  fetchMetadataMultiServer: jest.fn(),
}))

const { syncMovieArtwork, retryMovieBlurhashes } = require('@src/utils/sync/domain/movies/artwork')
const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
const { httpGet } = require('@src/lib/httpHelper')
const { MediaType, SyncOperation } = require('@src/utils/sync/core')

const KEY = 'Film (2020)'
const FOLDER = `/movies/${encodeURIComponent(KEY)}`
const urls = {
  poster: `${FOLDER}/poster.jpg?hash=p1`,
  posterBlurhash: `${FOLDER}/poster.jpg.blurhash`,
}
const A_POSTER = `https://A.example${urls.poster}`

/**
 * One pass of `serverId` over the title: the artwork step on `movie`, then
 * the retry step with what the artwork step handed it.
 */
async function pass({ movie, serverId = 'A', reporters = ['A'] }) {
  const input = {
    originalTitle: KEY,
    movie: { title: KEY, originalTitle: KEY, ...movie },
    context: {
      mediaType: MediaType.Movie,
      operation: SyncOperation.Metadata,
      serverConfig: { ...mockServers[serverId], baseUrl: `https://${serverId}.example`, prefix: '', enabled: true },
      fieldAvailability: { movies: { [KEY]: { 'urls.poster': reporters, 'urls.posterBlurhash': reporters } }, tv: {} },
      fileServerData: { movies: { [KEY]: { urls } } },
    },
  }
  const artwork = await syncMovieArtwork(input)
  const retry = await retryMovieBlurhashes(input, artwork.retries)
  return { artwork, retry }
}

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})
beforeEach(() => {
  httpGet.mockReset()
  httpGet.mockImplementation(async (url) => ({ data: `first-of:${url}`, headers: { 'content-type': 'text/plain' } }))
  fetchMetadataMultiServer.mockReset()
  fetchMetadataMultiServer.mockImplementation(async (serverId, path) => `blurhash-of:${serverId}${path}`)
})

it('fetches, through fetchMetadataMultiServer, the blurhash the first fetch did not get', async () => {
  httpGet.mockRejectedValue(new Error('timeout of 3000ms exceeded'))
  const { artwork, retry } = await pass({ movie: {} })

  expect(fetchMetadataMultiServer).toHaveBeenCalledTimes(1)
  expect(fetchMetadataMultiServer).toHaveBeenCalledWith('A', urls.posterBlurhash, 'blurhash', 'movie', KEY)
  expect(artwork.plan.set).not.toHaveProperty('posterBlurhash')
  // The artwork step leaves the outcome to the retry, so it holds nothing back itself.
  expect(artwork.plan.incomplete).toBe(false)
  expect(retry.plan).toMatchObject({
    set: { posterBlurhash: `blurhash-of:A${urls.posterBlurhash}`, posterBlurhashSource: 'A' },
    unset: [],
    incomplete: false,
  })
  expect(retry.result).toMatchObject({ status: 'completed', operation: 'blurhash', changes: ['Updated posterBlurhash'] })
})

it('leaves the pass incomplete when the second attempt fails too', async () => {
  httpGet.mockRejectedValue(new Error('timeout of 3000ms exceeded'))
  fetchMetadataMultiServer.mockImplementation(async () => '')
  const { retry } = await pass({ movie: {} })

  expect(retry.plan).toMatchObject({ set: {}, incomplete: true, deferrals: ['posterBlurhash'] })
  expect(retry.result.status).toBe('skipped')
})

it('does not try again for a blurhash the first fetch got', async () => {
  const { artwork, retry } = await pass({ movie: {} })

  expect(artwork.plan.set).toMatchObject({
    posterURL: A_POSTER,
    posterSource: 'A',
    posterBlurhash: `first-of:https://A.example${urls.posterBlurhash}`,
    posterBlurhashSource: 'A',
  })
  expect(artwork.retries).toEqual([])
  expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
  expect(retry.plan.set).toEqual({})
  expect(retry.result.status).toBe('skipped')
})

it('removes a stale blurhash whose replacement could not be fetched, without a second attempt', async () => {
  httpGet.mockRejectedValue(new Error('timeout of 3000ms exceeded'))
  // Another server's, so not of the image this server owns.
  const { artwork } = await pass({
    movie: { posterURL: A_POSTER, posterBlurhash: 'B\'s', posterBlurhashSource: 'B' },
  })

  expect(artwork.plan.unset).toEqual(['posterBlurhash', 'posterBlurhashSource'])
  expect(artwork.plan).toMatchObject({ incomplete: true, deferrals: ['posterBlurhash'] })
  expect(artwork.retries).toEqual([])
  expect(artwork.result.changes).toEqual(['Cleared posterBlurhash'])
  expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
})

it('fetches nothing for a server that does not own the image', async () => {
  const { artwork, retry } = await pass({ movie: {}, serverId: 'B', reporters: ['A', 'B'] })

  expect(httpGet).not.toHaveBeenCalled()
  expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
  expect(artwork.plan).toMatchObject({ set: {}, unset: [], incomplete: false })
  expect(retry.plan).toMatchObject({ set: {}, unset: [], incomplete: false })
})

it('leaves the blurhash of an image an admin locked, or a blurhash an admin locked', async () => {
  httpGet.mockRejectedValue(new Error('would fail'))
  for (const lockedFields of [{ posterURL: true }, { posterBlurhash: true }]) {
    const { artwork, retry } = await pass({ movie: { posterURL: A_POSTER, lockedFields } })
    expect(artwork.plan.set).not.toHaveProperty('posterBlurhash')
    expect(artwork.plan.unset).toEqual([])
    expect(artwork.plan.incomplete).toBe(false)
    expect(retry.plan.incomplete).toBe(false)
  }
  expect(httpGet).not.toHaveBeenCalled()
  expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
})
