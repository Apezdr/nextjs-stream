/**
 * @jest-environment node
 *
 * BlurhashStrategy is the second attempt at a movie's poster and backdrop
 * blurhash. It runs after the asset strategy has applied the blurhash rule
 * (core/imageAndBlurhash) to the stored document, so the only blurhash left
 * for it is one that rule told the asset strategy to fetch, for an image with
 * none, and that it did not get. These cases pin that job.
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

const { BlurhashStrategy } = require('@src/utils/sync/domain/shared/BlurhashStrategy')
const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
const { MediaType, SyncOperation } = require('@src/utils/sync/core')

const KEY = 'Film (2020)'
const FOLDER = `/movies/${encodeURIComponent(KEY)}`
const urls = {
  poster: `${FOLDER}/poster.jpg?hash=p1`,
  posterBlurhash: `${FOLDER}/poster.jpg.blurhash`,
}
const A_POSTER = `https://A.example${urls.poster}`

/**
 * One pass of `serverId` over the title, with `movie` as the document after
 * the earlier strategies and `failed` the blurhashes the asset strategy could
 * not fetch.
 */
async function retry({ movie, serverId = 'A', reporters = ['A'], failed = ['posterBlurhash'] }) {
  const pendingMovieUpdates = new Map([[KEY, {}]])
  const pendingMovieFetchFailures = new Map([[KEY, new Set(failed)]])
  const repository = { findByOriginalTitle: jest.fn(), update: jest.fn() }
  const result = await new BlurhashStrategy(repository).sync(
    { title: 'Film', originalTitle: KEY, ...movie },
    {
      mediaType: MediaType.Movie,
      operation: SyncOperation.Blurhash,
      serverConfig: { ...mockServers[serverId], baseUrl: `https://${serverId}.example`, prefix: '', enabled: true },
      fieldAvailability: { movies: { [KEY]: { 'urls.poster': reporters, 'urls.posterBlurhash': reporters } }, tv: {} },
      fileServerData: { movies: { [KEY]: { urls } } },
      entityTitle: 'Film',
      entityOriginalTitle: KEY,
      pendingMovieUpdates,
      pendingMovieFetchFailures,
    }
  )
  return {
    result,
    written: pendingMovieUpdates.get(KEY),
    failures: [...pendingMovieFetchFailures.get(KEY)],
    repository,
  }
}

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})
beforeEach(() => {
  fetchMetadataMultiServer.mockReset()
  fetchMetadataMultiServer.mockImplementation(async (serverId, path) => `blurhash-of:${serverId}${path}`)
})

it('fetches the blurhash the asset strategy could not, and clears the failure it recorded', async () => {
  const { result, written, failures, repository } = await retry({ movie: { posterURL: A_POSTER } })

  expect(fetchMetadataMultiServer).toHaveBeenCalledWith('A', urls.posterBlurhash, 'blurhash', 'movie', KEY)
  expect(written).toEqual({ posterBlurhash: `blurhash-of:A${urls.posterBlurhash}`, posterBlurhashSource: 'A' })
  expect(failures).toEqual([])
  expect(result).toMatchObject({ status: 'completed', changes: ['Updated posterBlurhash'] })
  expect(repository.update).not.toHaveBeenCalled()
})

it('keeps the failure recorded when the second attempt fails too', async () => {
  fetchMetadataMultiServer.mockImplementation(async () => '')
  const { result, written, failures } = await retry({ movie: { posterURL: A_POSTER } })

  expect(written).toEqual({})
  expect(failures).toEqual(['posterBlurhash'])
  expect(result.status).toBe('skipped')
})

it('leaves a blurhash the document carries: the asset strategy kept it, wrote it or asked to remove it', async () => {
  // A stale one (another server's) that the asset strategy has asked to remove.
  const { written, failures } = await retry({
    movie: { posterURL: A_POSTER, posterBlurhash: 'B\'s', posterBlurhashSource: 'B' },
  })

  expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
  expect(written).toEqual({})
  expect(failures).toEqual(['posterBlurhash'])
})

it('does not fetch for a server that does not own the image', async () => {
  const { written } = await retry({ movie: {}, serverId: 'B', reporters: ['A', 'B'], failed: [] })

  expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
  expect(written).toEqual({})
})

it('fails, and writes nothing on its own, outside the consolidated movie write', async () => {
  // MovieSyncService creates pendingMovieUpdates before any strategy runs.
  // There used to be a fallback here that wrote straight to the repository,
  // keyed on the display title.
  const repository = { findByOriginalTitle: jest.fn(), update: jest.fn(), upsert: jest.fn(), smartUpsert: jest.fn() }
  const result = await new BlurhashStrategy(repository).sync(
    { title: 'Film', originalTitle: KEY, posterURL: A_POSTER },
    {
      mediaType: MediaType.Movie,
      operation: SyncOperation.Blurhash,
      serverConfig: { ...mockServers.A, baseUrl: 'https://A.example', prefix: '', enabled: true },
      fieldAvailability: { movies: { [KEY]: { 'urls.poster': ['A'], 'urls.posterBlurhash': ['A'] } }, tv: {} },
      fileServerData: { movies: { [KEY]: { urls } } },
      entityTitle: 'Film',
      entityOriginalTitle: KEY,
    }
  )

  expect(result.status).toBe('failed')
  expect(result.errors[0]).toContain(`no pending movie update for "${KEY}"`)
  for (const write of ['update', 'upsert', 'smartUpsert']) expect(repository[write]).not.toHaveBeenCalled()
})

it('leaves the blurhash of an image an admin locked, or a blurhash an admin locked', async () => {
  for (const lockedFields of [{ posterURL: true }, { posterBlurhash: true }]) {
    const { written, failures } = await retry({ movie: { posterURL: A_POSTER, lockedFields } })
    expect(written).toEqual({})
    expect(failures).toEqual(['posterBlurhash'])
  }
  expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
})
