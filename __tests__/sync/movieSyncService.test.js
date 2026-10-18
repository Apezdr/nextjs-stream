/**
 * @jest-environment node
 *
 * MovieSyncService runs the movie's steps (metadata, artwork, video, the
 * blurhash retry), merges their write plans and makes one write. These cases
 * pin what the service itself decides: it reads the stored movie once, the
 * fields normalization heals are written only with a step's write (which
 * each step reports with its wroteDocument flag), and the metadata step's plan
 * never names the display title.
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

const { MovieSyncService, movieSyncGate } = require('@src/utils/sync/domain/movies/MovieSyncService')
const { syncMovieMetadata } = require('@src/utils/sync/domain/movies/metadata')
const { syncMovieArtwork, retryMovieBlurhashes } = require('@src/utils/sync/domain/movies/artwork')
const { syncMovieVideo } = require('@src/utils/sync/domain/movies/video')
const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
const { httpGet } = require('@src/lib/httpHelper')
const { MediaType, SyncOperation } = require('@src/utils/sync/core')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')

const KEY = 'Film (2020)'
const FOLDER = `/movies/${encodeURIComponent(KEY)}`
const A_POSTER = `https://A.example${FOLDER}/poster.jpg?hash=p1`

/** A folder with a poster and its blurhash, and nothing else. */
const posterOnly = () => ({
  urls: { poster: `${FOLDER}/poster.jpg?hash=p1`, posterBlurhash: `${FOLDER}/poster.jpg.blurhash` },
})

/** A stored movie that already holds the poster, with no type (an old document). */
const storedWithoutType = () => ({
  _id: 'm1',
  originalTitle: KEY,
  title: KEY,
  titleSource: 'A',
  originalTitleSource: 'A',
  createdAt: new Date('2020-01-01T00:00:00.000Z'),
  initialDiscoveryDate: new Date('2020-01-01T00:00:00.000Z'),
  initialDiscoveryServer: 'A',
  metadata: {},
  posterURL: A_POSTER,
  posterSource: 'A',
})

const contextFor = (payload, { forceSync = false } = {}) => {
  const fieldAvailability = { movies: { [KEY]: {} }, tv: {} }
  collectFieldAvailability(payload, '', 'A', fieldAvailability.movies[KEY])
  return {
    mediaType: MediaType.Movie,
    operation: SyncOperation.Metadata,
    serverConfig: { ...mockServers.A, baseUrl: 'https://A.example', prefix: '', enabled: true },
    fieldAvailability,
    fileServerData: { movies: { [KEY]: payload } },
    allEnabledServersProbed: true,
    forceSync,
  }
}

const repositoryOver = (stored) => ({
  findByOriginalTitle: jest.fn(async () => (stored ? structuredClone(stored) : null)),
  upsert: jest.fn(async () => {}),
  smartUpsert: jest.fn(async () => {}),
})

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})
beforeEach(() => {
  httpGet.mockReset()
  httpGet.mockImplementation(async (url) => ({ data: `first-of:${url}`, headers: { 'content-type': 'text/plain' } }))
  fetchMetadataMultiServer.mockReset()
  fetchMetadataMultiServer.mockImplementation(async (serverId, path) => `retry-of:${serverId}${path}`)
})

describe('the stored movie', () => {
  it('is read once by a pass, whether it is skipped, run or forced', async () => {
    const payload = posterOnly()
    const context = contextFor(payload)
    const gated = { ...storedWithoutType(), type: 'movie', syncGates: { A: movieSyncGate(payload, context.fieldAvailability, KEY) } }

    for (const [stored, forceSync, expected] of [
      [gated, false, ['skipped']],
      [storedWithoutType(), false, ['skipped', 'completed', 'skipped', 'skipped']],
      [gated, true, ['skipped', 'completed', 'skipped', 'skipped']],
      [null, false, ['skipped', 'completed', 'skipped', 'skipped']],
    ]) {
      const repository = repositoryOver(stored)
      const results = await new MovieSyncService(repository).syncMovie(KEY, contextFor(payload, { forceSync }))
      expect(results.map((r) => r.status)).toEqual(expected)
      expect(repository.findByOriginalTitle).toHaveBeenCalledTimes(1)
      expect(repository.findByOriginalTitle).toHaveBeenCalledWith(KEY)
    }
  })
})

describe('the fields normalization heals', () => {
  it('are written with a step\'s write', async () => {
    const repository = repositoryOver(storedWithoutType())
    await new MovieSyncService(repository).syncMovie(KEY, contextFor(posterOnly()))

    // The artwork step wrote the poster's blurhash, so the missing type goes with it.
    const [written] = repository.smartUpsert.mock.calls[0]
    expect(written).toMatchObject({ type: 'movie', posterBlurhash: expect.stringContaining('first-of:'), posterBlurhashSource: 'A' })
    expect(written.lastSynced).toEqual(expect.any(Date))
  })

  it('are not written when only the blurhash retry writes', async () => {
    httpGet.mockRejectedValue(new Error('timeout of 3000ms exceeded'))
    const repository = repositoryOver(storedWithoutType())
    const results = await new MovieSyncService(repository).syncMovie(KEY, contextFor(posterOnly()))

    expect(results.map((r) => [r.operation, r.status])).toEqual([
      ['metadata', 'skipped'],
      ['assets', 'skipped'],
      ['content', 'skipped'],
      ['blurhash', 'completed'],
    ])
    const [written, existing, options] = repository.smartUpsert.mock.calls[0]
    expect(written).toEqual({
      ...existing,
      posterBlurhash: `retry-of:A${FOLDER}/poster.jpg.blurhash`,
      posterBlurhashSource: 'A',
      syncGates: { A: expect.any(String) },
    })
    expect(written).not.toHaveProperty('type')
    expect(options).toEqual({ unset: [] })
  })
})

describe('the metadata step', () => {
  it('never names the display title, and completes on a successful fetch even when nothing changed', async () => {
    const payload = { urls: { metadata: `${FOLDER}/metadata.json` } }
    fetchMetadataMultiServer.mockImplementation(async () => ({ title: 'Film Title', overview: 'x' }))
    const movie = {
      originalTitle: KEY,
      title: KEY,
      metadata: { title: 'Film Title', overview: 'x' },
      metadataSource: 'A',
      syncVersion: '2.1',
    }

    const { plan, result } = await syncMovieMetadata({ originalTitle: KEY, movie, context: contextFor(payload) })

    expect(plan.set).toEqual({ lastSynced: expect.any(Date) })
    expect(plan.set).not.toHaveProperty('title')
    expect(plan.set).not.toHaveProperty('titleSource')
    expect(result).toMatchObject({ status: 'completed', changes: [] })
    expect(plan.incomplete).toBe(false)
  })
})

describe('the wroteDocument flag of each step', () => {
  // Set exactly when the step's plan stamps lastSynced: the service writes
  // the healed fields with such a step's write, and with no other.
  const outcomeOf = async (step, payload, movie) => step({ originalTitle: KEY, movie: { originalTitle: KEY, title: KEY, ...movie }, context: contextFor(payload) })
  const agrees = (outcome) => expect(outcome.wroteDocument).toBe(Object.prototype.hasOwnProperty.call(outcome.plan.set, 'lastSynced'))

  it('is set by the metadata step when it fetched the metadata, and not when it did not', async () => {
    fetchMetadataMultiServer.mockImplementation(async () => ({ title: 'Film Title' }))
    const fetched = await outcomeOf(syncMovieMetadata, { urls: { metadata: `${FOLDER}/metadata.json` } }, {})
    expect(fetched.wroteDocument).toBe(true)
    agrees(fetched)

    const notOwner = await outcomeOf(syncMovieMetadata, posterOnly(), {})
    expect(notOwner.wroteDocument).toBe(false)
    agrees(notOwner)
  })

  it('is set by the artwork step when it changes an image, and not when nothing changes', async () => {
    const changed = await outcomeOf(syncMovieArtwork, posterOnly(), {})
    expect(changed.wroteDocument).toBe(true)
    agrees(changed)

    const unchanged = await outcomeOf(syncMovieArtwork, { urls: {} }, {})
    expect(unchanged.wroteDocument).toBe(false)
    agrees(unchanged)
  })

  it('is set by the video step when it changes the video, and not when nothing changes', async () => {
    const payload = { fileNames: ['Film.mkv'], urls: { mp4: `${FOLDER}/Film.mkv` } }
    const changed = await outcomeOf(syncMovieVideo, payload, {})
    expect(changed.wroteDocument).toBe(true)
    agrees(changed)

    const unchanged = await outcomeOf(syncMovieVideo, { urls: {} }, {})
    expect(unchanged.wroteDocument).toBe(false)
    agrees(unchanged)
  })

  it('is never set by the blurhash retry, even when it writes a blurhash', async () => {
    httpGet.mockRejectedValue(new Error('timeout of 3000ms exceeded'))
    const artwork = await outcomeOf(syncMovieArtwork, posterOnly(), storedWithoutType())
    expect(artwork.retries).toHaveLength(1)
    const retry = await retryMovieBlurhashes({ originalTitle: KEY, movie: storedWithoutType(), context: contextFor(posterOnly()) }, artwork.retries)

    expect(retry.plan.set).toHaveProperty('posterBlurhash')
    expect(retry.wroteDocument).toBe(false)
    agrees(retry)
  })
})
