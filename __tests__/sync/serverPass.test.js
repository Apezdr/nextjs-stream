/**
 * @jest-environment node
 *
 * A server's pass (run/serverPass), started the way production starts it:
 * through syncAllServers, with the real services, strategies and repositories
 * writing to an in-memory MongoDB. Pre-tag, missing-media and post-sync
 * cleanup are stood in for; the side jobs (notifications, the PlaybackStatus
 * migration and the watch-history validation) are recorded.
 *
 * The cases: what one pass writes, the side jobs it runs and the lines it
 * logs; what the admins' sync notice counts as added; the server config a
 * pass refuses, or hands the services; which errors fail the server and which
 * only fail a title; and the one pool movies and shows go through.
 */

const mockServers = [
  { id: 'default', priority: 1 },
  { id: 'server2', priority: 2 },
]
const mockDatabases = {}
const mockLogLines = []
const mockSideJobs = []
let mockSyncClientError = null

jest.mock('@src/lib/mongodb', () => {
  const client = { db: (name) => ({ collection: (collection) => mockCollection(name, collection) }) }
  return {
    __esModule: true,
    default: Promise.resolve(client),
    getSyncClientPromise: async () => {
      if (mockSyncClientError) throw mockSyncClientError
      return client
    },
  }
})
jest.mock('@src/utils/config', () => ({
  getServer: (id) => mockServers.find((server) => server.id === id),
  getAllServers: () => mockServers,
  multiServerHandler: {
    getHandler: (id) => ({ createFullURL: (path) => `https://${id}.example${path}` }),
  },
}))
jest.mock('chalk', () => {
  const paint = new Proxy((text) => text, { get: () => paint })
  return { __esModule: true, default: paint }
})
jest.mock('@src/lib/logger', () => ({
  createLogger: (component) => ({
    info: (obj, msg) => mockLogLines.push({ component, level: 'info', obj, msg }),
    warn: (obj, msg) => mockLogLines.push({ component, level: 'warn', obj, msg }),
    error: (obj, msg) => mockLogLines.push({ component, level: 'error', obj, msg }),
    debug: () => {},
  }),
  logError: jest.fn(),
}))
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
  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject })
      next()
    })
})
jest.mock('@src/utils/admin_utils', () => ({
  // A metadata, or a blurhash, file on the file server.
  fetchMetadataMultiServer: jest.fn(async (serverId, url, type) => {
    if (!url) return {}
    if (type === 'blurhash') return `blurhash-of:${serverId}:${url}`
    const episode = url.match(/E(\d+)_metadata/)
    if (episode) return { episode_number: Number(episode[1]), name: `Episode named ${Number(episode[1])}` }
    if (url.startsWith('/tv/')) {
      return { id: 1, name: 'Example Show', seasons: [{ season_number: 1, name: 'Season One', episode_count: 3 }] }
    }
    return { id: 2, title: 'Example Movie', overview: 'x' }
  }),
}))
jest.mock('@src/lib/httpHelper', () => ({
  httpGet: jest.fn(async (url) => ({ data: `blurhash-of:${url}`, headers: { 'content-type': 'text/plain' } })),
}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: (url) => `nid:${url}` }))
jest.mock('@src/utils/fetchAllServerData', () => ({ fetchAllServerData: jest.fn() }))
jest.mock('@src/utils/sync/run/preTag', () => ({ preTagSyncRunId: jest.fn() }))
jest.mock('@src/utils/sync/run/missingMedia', () => ({
  computeMissingMedia: jest.fn(async () => ({ missingMovies: [], missingTVShows: [] })),
}))
jest.mock('@src/utils/sync/run/postSync', () => ({ runPostSyncCleanup: jest.fn(async () => ({})) }))
jest.mock('@src/utils/notifications/MediaNotificationOrchestrator', () => ({
  MediaNotificationOrchestrator: {
    processSyncResults: jest.fn(async (results) => {
      mockSideJobs.push({
        job: 'notifications',
        movies: results.movies.processed,
        episodes: results.episodes.processed,
        storedEpisodes: (mockDatabases.Media?.FlatEpisodes?.docs ?? []).length,
      })
      return { notifications: [] }
    }),
  },
}))
jest.mock('@src/utils/watchHistory/migrate', () => ({
  migratePlaybackStatusIfNeeded: jest.fn(async () => mockSideJobs.push({ job: 'migration' })),
}))
jest.mock('@src/utils/sync/run/watchHistoryValidation', () => ({
  validateWatchHistoryAgainstDatabase: jest.fn(async () => {
    mockSideJobs.push({ job: 'validation' })
    return { checked: 0 }
  }),
}))

const isEqual = require('lodash/isEqual')
const { syncAllServers } = require('@src/utils/sync/run/syncAllServers')
const { buildFieldAvailability } = require('@src/utils/sync/run/availability')
const { getSyncLockHolder, releaseSyncLock } = require('@src/utils/sync/run/runState')
const { preTagSyncRunId } = require('@src/utils/sync/run/preTag')
const { ResourceManager } = require('@src/utils/sync/core/ResourceManager')
const { MovieSyncService } = require('@src/utils/sync/domain/movies/MovieSyncService')
const { TVShowSyncService } = require('@src/utils/sync/domain/tv/TVShowSyncService')
const { MediaAdditionAnalyzer } = require('@src/utils/notifications/analyzers/MediaAdditionAnalyzer')

// ---------------------------------------------------------------- in-memory MongoDB

// MongoDB stores a field set to `undefined` as `null`.
const stored = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)))
const DATE_FIELDS = ['createdAt', 'updatedAt', 'lastSynced', 'initialDiscoveryDate', 'mediaLastModified', 'airDate', 'firstAirDate', 'lastAirDate', 'startedAt', 'recordedAt']
const clone = (doc) => {
  const copy = JSON.parse(JSON.stringify(doc))
  for (const field of DATE_FIELDS) {
    if (typeof copy[field] === 'string') copy[field] = new Date(copy[field])
  }
  return copy
}

// Just enough of MongoDB's matching for the queries the sync issues.
function matches(doc, filter) {
  return Object.entries(filter).every(([key, condition]) => {
    if (key === '$or') return condition.some((branch) => matches(doc, branch))
    if (key === '$and') return condition.every((branch) => matches(doc, branch))
    const value = doc[key]
    if (condition instanceof RegExp) return typeof value === 'string' && condition.test(value)
    if (condition === null) return value === null || value === undefined
    if (typeof condition !== 'object') return value === condition
    if (!Object.keys(condition).some((k) => k.startsWith('$'))) return isEqual(value, condition)
    return Object.entries(condition).every(([op, operand]) => {
      if (op === '$in') return operand.includes(value ?? null)
      if (op === '$ne') return value !== operand
      if (op === '$exists') return (value !== undefined) === operand
      if (op === '$type') return operand === 'string' ? typeof value === 'string' : false
      if (op === '$gt') return value > operand
      throw new Error(`unsupported operator ${op}`)
    })
  })
}

let nextId = 1
function mockCollection(dbName, name) {
  mockDatabases[dbName] = mockDatabases[dbName] || {}
  if (mockDatabases[dbName][name]) return mockDatabases[dbName][name]
  const collection = {
    docs: [],
    async createIndex() {
      return 'index'
    },
    async findOne(filter) {
      const doc = collection.docs.find((d) => matches(d, filter))
      return doc ? clone(doc) : null
    },
    find(filter) {
      let found = collection.docs.filter((d) => matches(d, filter))
      const cursor = {
        sort(spec) {
          const [[field, direction]] = Object.entries(spec)
          found = [...found].sort((a, b) => (a[field] - b[field]) * direction)
          return cursor
        },
        async toArray() {
          return found.map(clone)
        },
      }
      return cursor
    },
    async countDocuments(filter = {}) {
      return collection.docs.filter((d) => matches(d, filter)).length
    },
    async updateOne(filter, update, options = {}) {
      let doc = collection.docs.find((d) => matches(d, filter))
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 }
        doc = { _id: `id${nextId++}`, ...filter, ...stored(update.$setOnInsert || {}) }
        collection.docs.push(doc)
        Object.assign(doc, stored(update.$set || {}))
        return { matchedCount: 0, upsertedCount: 1 }
      }
      const setKeys = Object.keys(update.$set || {})
      const unsetKeys = Object.keys(update.$unset || {})
      // MongoDB rejects an update that sets and unsets the same path.
      const conflict = setKeys.filter((k) => unsetKeys.includes(k))
      if (conflict.length > 0) throw new Error(`conflicting $set/$unset on ${conflict.join(', ')}`)
      Object.assign(doc, stored(update.$set || {}))
      for (const key of unsetKeys) delete doc[key]
      return { matchedCount: 1 }
    },
    async replaceOne(filter, replacement, options = {}) {
      const index = collection.docs.findIndex((d) => matches(d, filter))
      if (index >= 0) {
        collection.docs[index] = { _id: collection.docs[index]._id, ...stored(replacement) }
        return { matchedCount: 1 }
      }
      if (options.upsert) collection.docs.push({ _id: `id${nextId++}`, ...stored(replacement) })
      return { matchedCount: 0 }
    },
    async deleteOne(filter) {
      collection.docs = collection.docs.filter((d) => !matches(d, filter))
    },
    async bulkWrite(operations) {
      for (const { updateOne } of operations) {
        await collection.updateOne(updateOne.filter, updateOne.update, { upsert: updateOne.upsert })
      }
      return {}
    },
  }
  mockDatabases[dbName][name] = collection
  return collection
}

const docs = (name) => mockCollection('Media', name).docs
const appliedRecord = () => mockCollection('app_config', 'syncInfo').docs.find((d) => d._id === 'appliedPayloads') ?? null

// ---------------------------------------------------------------- payloads

const MOVIE = 'Example Movie (2020)'
const MOVIE_FOLDER = `/movies/${encodeURIComponent(MOVIE)}`
const moviePayload = () => ({
  _id: 'uuid-movie',
  mediaIdentity: { id: 'mid:movie', scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
  fileNames: ['Example Movie.mkv', 'metadata.json'],
  length: { 'Example Movie.mkv': 6000000 },
  dimensions: { 'Example Movie.mkv': '1920x1080' },
  urls: {
    mp4: `${MOVIE_FOLDER}/Example%20Movie.mkv`,
    mediaLastModified: '2024-01-01T00:00:00.000Z',
    metadata: `${MOVIE_FOLDER}/metadata.json?hash=d1`,
    poster: `${MOVIE_FOLDER}/poster.jpg?hash=p1`,
    posterBlurhash: `${MOVIE_FOLDER}/poster.jpg.blurhash`,
  },
  hdr: null,
  mediaQuality: null,
  additional_metadata: { duration: 6000000, dimensions: '1920x1080', size: { gb: 4 } },
})

const SHOW = 'Example Show (2019)'
const SHOW_ROOT = `/tv/${encodeURIComponent(SHOW)}`
const SEASON_FOLDER = `${SHOW_ROOT}/Season%201`
const key = (n) => `S01E${String(n).padStart(2, '0')}`
const episodePayload = (n) => ({
  _id: `uuid-${key(n)}`,
  videoURL: `${SEASON_FOLDER}/${encodeURIComponent(`${SHOW} - ${key(n)}.mkv`)}`,
  sources: [{ url: `${SEASON_FOLDER}/${encodeURIComponent(`${SHOW} - ${key(n)}.mkv`)}`, container: 'mkv', isPrimary: true }],
  // Served through the transcoder, so the episode counts as visible
  jitEligible: true,
  jitUrl: `https://jit.example/stream/${key(n)}/master.m3u8`,
  mediaLastModified: '2024-01-01T00:00:00.000Z',
  hdr: null,
  episodeNumber: n,
  thumbnail: `${SEASON_FOLDER}/${n} - Thumbnail.jpg?hash=t1`,
  metadata: `${SEASON_FOLDER}/E${String(n).padStart(2, '0')}_metadata.json?hash=m1`,
  mediaIdentity: { id: `mid:show:e${n}`, scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
})
const showPayload = (episodes = [1, 2]) => ({
  metadata: `${SHOW_ROOT}/metadata.json?hash=s1`,
  poster: `${SHOW_ROOT}/show_poster.jpg?hash=p1`,
  posterBlurhash: null,
  logo: '',
  backdrop: null,
  mediaIdentity: { id: 'mid:show', scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
  seasons: {
    'Season 1': {
      seasonNumber: 1,
      season_poster: `${SEASON_FOLDER}/season_poster.jpg?hash=sp1`,
      episodes: Object.fromEntries(episodes.map((n) => [key(n), episodePayload(n)])),
      lengths: Object.fromEntries(episodes.map((n) => [key(n), 2880000 + n])),
      dimensions: Object.fromEntries(episodes.map((n) => [key(n), '1920x1080'])),
    },
  },
})

const config = (id, overrides = {}) => ({
  baseURL: `https://${id}.example`,
  prefixPath: '',
  syncEndpoint: `https://${id}-node.example`,
  priority: mockServers.find((server) => server.id === id).priority,
  ...overrides,
})

const ETAGS = {
  default: { tv: '"tv-1"', movies: '"movies-1"' },
  server2: { tv: '"s2-tv-1"', movies: '"s2-movies-1"' },
}

// ---------------------------------------------------------------- driving a run

/** Pre-tag as it runs for real: stamp what is stored, report full coverage. */
function preTagCovers() {
  preTagSyncRunId.mockImplementation(async (_fileServers, syncRunId) => {
    for (const name of ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']) {
      for (const doc of docs(name)) doc.syncRunId = syncRunId
    }
    return { ok: true, skipped: false, syncRunId, coverage: {} }
  })
}

async function runSync(fileServers, options = {}) {
  const fieldAvailability = await buildFieldAvailability(fileServers)
  const result = await syncAllServers(fileServers, fieldAvailability, {
    allEnabledServersProbed: true,
    payloadETags: ETAGS,
    ...options,
  })
  // Let the background cleanup settle and release the orchestration lock
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  return result
}

const oneServer = ({ movies = { [MOVIE]: moviePayload() }, tv = { [SHOW]: showPayload() }, ...configOverrides } = {}) => ({
  default: { config: config('default', configOverrides), movies, tv },
})

const logLine = (msg) => mockLogLines.find((line) => line.msg === msg)

const realFetch = global.fetch

beforeEach(() => {
  for (const name of Object.keys(mockDatabases)) delete mockDatabases[name]
  mockLogLines.length = 0
  mockSideJobs.length = 0
  mockSyncClientError = null
  nextId = 1
  // Each case gets an adapter over its own collections.
  delete globalThis.__syncDatabaseAdapter
  // The Node.js server's hash endpoints: not there, so the pass runs without them.
  global.fetch = jest.fn(async () => ({ ok: false, status: 404 }))
  preTagCovers()
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) jest.spyOn(console, method).mockImplementation(() => {})
})

afterEach(() => {
  const holder = getSyncLockHolder()
  if (holder) releaseSyncLock(holder.syncRunId)
  global.fetch = realFetch
  jest.restoreAllMocks()
})

// ---------------------------------------------------------------- one pass

describe('a full pass for one server', () => {
  it('writes the movie, the show, its season and its episodes, each stamped with the run and the server’s gate', async () => {
    const result = await runSync(oneServer())

    expect(result.errors).toEqual([])
    const [movie] = docs('FlatMovies')
    expect(movie).toMatchObject({
      originalTitle: MOVIE,
      title: 'Example Movie',
      videoURL: `https://default.example${MOVIE_FOLDER}/Example%20Movie.mkv`,
      videoSource: 'default',
      syncRunId: result.syncRunId,
    })
    expect(movie.syncGates?.default).toEqual(expect.stringMatching(/^g\d+:/))

    const [show] = docs('FlatTVShows')
    expect(show).toMatchObject({ originalTitle: SHOW, title: 'Example Show', visibleEpisodeCount: 2, syncRunId: result.syncRunId })
    expect(show.syncGates?.default).toEqual(expect.stringMatching(/^g\d+:/))

    const [season] = docs('FlatSeasons')
    expect(season).toMatchObject({ seasonNumber: 1, showId: show._id, showTitle: 'Example Show', syncRunId: result.syncRunId })

    const episodes = docs('FlatEpisodes')
    expect(episodes.map((e) => e.episodeNumber).sort()).toEqual([1, 2])
    for (const episode of episodes) {
      expect(episode).toMatchObject({ showId: show._id, seasonId: season._id, videoSource: 'default', syncRunId: result.syncRunId })
      expect(episode.syncGates?.default).toEqual(expect.stringMatching(/^g\d+:/))
    }

    expect(result.flatSyncResults.default).toMatchObject({
      movies: { processed: 1, errors: 0 },
      tvShows: { processed: 1, errors: 0 },
      seasons: { processed: 1, errors: 0 },
      episodes: { processed: 2, errors: 0 },
      errors: [],
    })
    // Nothing failed and every gate is stamped: the pass is recorded, and the
    // next tick may skip.
    expect(appliedRecord()).toMatchObject({ state: 'complete', syncRunId: result.syncRunId })
  })

  it('runs the side jobs once, after both the movies and the TV', async () => {
    await runSync(oneServer())

    expect(mockSideJobs).toEqual([
      { job: 'notifications', movies: 1, episodes: 2, storedEpisodes: 2 },
      { job: 'migration' },
      { job: 'validation' },
    ])
  })

  it('logs the lines the verifier and the dashboards read', async () => {
    await runSync(oneServer())

    expect(logLine('Movie processing completed')).toMatchObject({
      component: 'FlatSync.NewArch',
      obj: { serverId: 'default', processed: 1, errors: 0, skipped: 0 },
    })
    expect(logLine('Collected changed media for post-sync cache invalidation')).toMatchObject({
      component: 'FlatSync.NewArch',
      obj: {
        serverId: 'default',
        processed: { movies: 1, tvShows: 1, seasons: 1, episodes: 2 },
        changedMedia: { movies: expect.any(Number), shows: 1, seasons: 1, episodes: 2 },
      },
    })
    expect(logLine('NEW architecture sync completed')).toMatchObject({
      component: 'FlatSync.NewArch',
      obj: { serverId: 'default', durationMs: expect.any(Number) },
    })
  })
})

// ---------------------------------------------------------------- title hashes

describe('the title hashes a pass fetches from the server’s Node.js API', () => {
  const NODE = 'https://default-node.example'
  const MOVIE_HASH = 'movie-metadata-hash-1'
  const SHOW_HASH = 'show-hash-1'
  const SHOW_CONTENT_HASH = 'show-content-hash-1'
  const answer = (body) => ({ ok: true, status: 200, json: async () => body })
  const entry = (hash, extra = {}) => ({ hash, lastModified: '2024-01-01T00:00:00.000Z', generated: '2024-01-01T00:00:00.000Z', ...extra })

  // Each list answers only at its own URL, so a pass that asked for the
  // movies' list at the TV URL (or the other way round) gets the other kind's
  // titles, which name neither the movie nor the show.
  const hashEndpoints = () =>
    jest.fn(async (url) => {
      if (url === `${NODE}/api/metadata-hashes/movies`) {
        return answer({ hash: 'all-movies', titles: { [MOVIE]: entry(MOVIE_HASH) } })
      }
      if (url === `${NODE}/api/metadata-hashes/tv`) {
        return answer({ hash: 'all-tv', titles: { [SHOW]: entry(SHOW_HASH, { contentHash: SHOW_CONTENT_HASH }) } })
      }
      return { ok: false, status: 404 }
    })

  const { fetchMetadataMultiServer } = require('@src/utils/admin_utils')
  const movieMetadataFetches = () =>
    fetchMetadataMultiServer.mock.calls.filter(([, url, type]) => type === 'file' && url === moviePayload().urls.metadata)
      .length

  beforeEach(() => {
    global.fetch = hashEndpoints()
    fetchMetadataMultiServer.mockClear()
  })

  it('asks the server’s Node.js URL for the movie list and the TV list, once each', async () => {
    await runSync(oneServer())

    const asked = global.fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/api/metadata-hashes/'))
    expect(asked.sort()).toEqual([`${NODE}/api/metadata-hashes/movies`, `${NODE}/api/metadata-hashes/tv`])
  })

  it('hands the movie list to the metadata step: a hash that matches the stored one skips the metadata fetch', async () => {
    await runSync(oneServer())
    const [movie] = docs('FlatMovies')
    expect(movie).toMatchObject({ metadataHash: MOVIE_HASH, metadataSource: 'default', syncHash: MOVIE_HASH })
    expect(movieMetadataFetches()).toBe(1)

    // A forced pass runs every step; the metadata step finds the hash unchanged
    fetchMetadataMultiServer.mockClear()
    await runSync(oneServer(), { forceSync: true })
    expect(movieMetadataFetches()).toBe(0)

    // Without the list the same forced pass fetches the metadata
    global.fetch = jest.fn(async () => ({ ok: false, status: 404 }))
    await runSync(oneServer(), { forceSync: true })
    expect(movieMetadataFetches()).toBe(1)
  })

  it('writes the show’s syncHash and contentHash from the TV list', async () => {
    await runSync(oneServer())

    const [show] = docs('FlatTVShows')
    expect(show).toMatchObject({ syncHash: SHOW_HASH, contentHash: SHOW_CONTENT_HASH })
    expect(show.syncGates?.default).toEqual(expect.stringMatching(/^g\d+:/))
  })
})

// ---------------------------------------------------------------- added

describe('what the admins’ sync notice counts as added', () => {
  it('counts the documents a run created', async () => {
    const result = await runSync(oneServer())

    expect(result.added).toEqual({ movies: 1, shows: 1, episodes: 2 })
  })

  it('does not count a document a run only rewrote', async () => {
    await runSync(oneServer())

    // A forced pass runs every title in full and rewrites what differs
    const forced = await runSync(oneServer(), { forceSync: true })

    expect(forced.changedMedia.movies.length).toBeGreaterThan(0)
    expect(forced.changedMedia.episodes.length).toBe(2)
    expect(forced.added).toEqual({ movies: 0, shows: 0, episodes: 0 })
  })

  it('counts only the new episode when a show gains one', async () => {
    await runSync(oneServer())

    const result = await runSync(oneServer({ tv: { [SHOW]: showPayload([1, 2, 3]) } }))

    expect(result.added).toEqual({ movies: 0, shows: 0, episodes: 1 })
    expect(docs('FlatEpisodes')).toHaveLength(3)
  })

  it('turns on no new-content notice: the analyzer reads no flag the count reads', async () => {
    const result = await runSync(oneServer())

    // What the pass hands the notifications side job (mocked above)
    const analysis = MediaAdditionAnalyzer.analyzeSyncResults(result.flatSyncResults.default)
    expect(analysis.summary).toMatchObject({ totalNewMovies: 0, totalNewEpisodes: 0 })
    expect(analysis.shouldNotify).toBe(false)
  })

  it('counts a document two servers have once: the second server’s pass updates it', async () => {
    const fileServers = {
      ...oneServer(),
      server2: { config: config('server2'), movies: { [MOVIE]: moviePayload() }, tv: { [SHOW]: showPayload() } },
    }

    const result = await runSync(fileServers)

    expect(result.errors).toEqual([])
    expect(result.added).toEqual({ movies: 1, shows: 1, episodes: 2 })
    expect(docs('FlatMovies')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- config

describe('the server config a pass refuses', () => {
  it.each([
    ['no priority', { priority: undefined }, /priority undefined for server default is not a number/],
    ['a priority that is a string', { priority: '1' }, /priority "1" for server default is not a number/],
    ['a priority that is not a finite number', { priority: NaN }, /priority NaN for server default is not a number/],
    ['no baseURL', { baseURL: undefined }, /missing baseURL for server default/],
  ])('fails the server’s pass on %s, writing nothing and recording nothing', async (_label, overrides, message) => {
    const result = await runSync(oneServer(overrides))

    expect(result.errors).toEqual([expect.objectContaining({ serverId: 'default', error: expect.stringMatching(message) })])
    expect(result.flatSyncResults?.default).toBeUndefined()
    expect(docs('FlatMovies')).toEqual([])
    expect(docs('FlatTVShows')).toEqual([])
    expect(mockSideJobs).toEqual([])
    expect(appliedRecord()).toMatchObject({ state: 'running', syncRunId: result.syncRunId })
  })

  it('hands movies and shows one server config, with the priority config gives, 0 included', async () => {
    const syncMovie = MovieSyncService.prototype.syncMovie
    const syncTVShow = TVShowSyncService.prototype.syncTVShow
    const seen = []
    jest.spyOn(MovieSyncService.prototype, 'syncMovie').mockImplementation(function (title, context, ...rest) {
      seen.push(context.serverConfig)
      return syncMovie.call(this, title, context, ...rest)
    })
    jest.spyOn(TVShowSyncService.prototype, 'syncTVShow').mockImplementation(function (title, context) {
      seen.push(context.serverConfig)
      return syncTVShow.call(this, title, context)
    })

    const result = await runSync(oneServer({ priority: 0 }))

    expect(result.errors).toEqual([])
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
    expect(seen[0]).toEqual({
      id: 'default',
      priority: 0,
      baseUrl: 'https://default.example',
      nodeUrl: 'https://default-node.example',
      prefix: '',
      enabled: true,
      timeout: 30000,
    })
  })
})

// ---------------------------------------------------------------- errors

describe('errors', () => {
  it('an error thrown in the pass reaches syncAllServers’ per-server catch: the server failed, nothing recorded', async () => {
    mockSyncClientError = new Error('sync pool unavailable')

    const result = await runSync(oneServer())

    expect(result.errors).toEqual([
      expect.objectContaining({ serverId: 'default', error: 'sync pool unavailable' }),
    ])
    expect(result.flatSyncResults?.default).toBeUndefined()
    expect(mockSideJobs).toEqual([])
    expect(appliedRecord()).toMatchObject({ state: 'running', syncRunId: result.syncRunId })
  })

  it('a show whose sync throws is one failed result; the other titles are written and the pass goes on', async () => {
    const OTHER = 'Another Show (2021)'
    const syncTVShow = TVShowSyncService.prototype.syncTVShow
    jest.spyOn(TVShowSyncService.prototype, 'syncTVShow').mockImplementation(function (title, context) {
      if (title === OTHER) return Promise.reject(new Error('show sync blew up'))
      return syncTVShow.call(this, title, context)
    })

    const result = await runSync(oneServer({ tv: { [SHOW]: showPayload(), [OTHER]: showPayload() } }))

    expect(result.errors).toEqual([])
    const pass = result.flatSyncResults.default
    expect(pass.tvShows).toMatchObject({ processed: 1, errors: 1 })
    expect(pass.errors).toEqual([expect.objectContaining({ phase: 'tvContentSync', error: 'show sync blew up' })])
    expect(docs('FlatTVShows').map((d) => d.originalTitle)).toEqual([SHOW])
    expect(docs('FlatMovies')).toHaveLength(1)
    // The side jobs still run, and the failure keeps the pass from being recorded
    expect(mockSideJobs.map((s) => s.job)).toEqual(['notifications', 'migration', 'validation'])
    expect(appliedRecord()).toMatchObject({ state: 'running' })
  })
})

// ---------------------------------------------------------------- the pool

describe('movies and shows go through one pool', () => {
  beforeEach(() => {
    process.env.SYNC_CONCURRENCY = '2'
    ResourceManager.resetInstance()
  })
  afterEach(() => {
    delete process.env.SYNC_CONCURRENCY
    ResourceManager.resetInstance()
  })

  it('as wide as syncConcurrency, the next title starting as soon as one finishes, movies first', async () => {
    const events = []
    let inFlight = 0
    let widest = 0
    const enter = (title) => {
      events.push(`start ${title}`)
      widest = Math.max(widest, ++inFlight)
    }
    const leave = (title) => {
      inFlight--
      events.push(`end ${title}`)
    }
    const tick = () => new Promise((resolve) => setImmediate(resolve))
    const result = (title, mediaType) => [
      { status: 'skipped', entityId: title, mediaType, operation: 'metadata', serverId: 'default', timestamp: new Date(), changes: [], errors: [] },
    ]

    jest.spyOn(MovieSyncService.prototype, 'syncMovie').mockImplementation(async (title) => {
      enter(title)
      await tick()
      leave(title)
      return result(title, 'movie')
    })
    // The first show is slow: it finishes only after the third has run (or
    // after a second, so a pool that waits for it cannot hang the test).
    let releaseFirst
    const firstReleased = new Promise((resolve) => {
      releaseFirst = resolve
      setTimeout(resolve, 1000)
    })
    jest.spyOn(TVShowSyncService.prototype, 'syncTVShow').mockImplementation(async (title) => {
      enter(title)
      if (title === 'Show 1') await firstReleased
      else await tick()
      if (title === 'Show 3') releaseFirst()
      leave(title)
      return result(title, 'tvshow')
    })

    const movies = Object.fromEntries(['Movie 1', 'Movie 2', 'Movie 3'].map((t) => [t, { urls: { mp4: `/movies/${t}/v.mkv` } }]))
    const tv = Object.fromEntries(['Show 1', 'Show 2', 'Show 3'].map((t) => [t, { seasons: {} }]))
    const run = await runSync(oneServer({ movies, tv }))

    expect(widest).toBe(2)
    // Every movie is done before the first show starts
    const lastMovieEnd = Math.max(...['Movie 1', 'Movie 2', 'Movie 3'].map((t) => events.indexOf(`end ${t}`)))
    expect(lastMovieEnd).toBeLessThan(events.indexOf('start Show 1'))
    // The third show started while the first was still running: no batches
    expect(events.indexOf('start Show 3')).toBeLessThan(events.indexOf('end Show 1'))
    // Results come back in title order, whatever order the titles finished in
    expect(run.flatSyncResults.default.tvShows.details.map((r) => r.entityId)).toEqual(['Show 1', 'Show 2', 'Show 3'])
  })
})
