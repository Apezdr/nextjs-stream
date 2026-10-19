/**
 * @jest-environment node
 *
 * A server's pass (run/serverPass), started the way production starts it:
 * through syncAllServers, with the real services, strategies and repositories
 * writing to an in-memory MongoDB. Pre-tag, missing-media and post-sync
 * cleanup are stood in for; the run's own jobs (run/postSync runAfterSyncJobs:
 * the PlaybackStatus migration, the watch-history validation and the
 * new-content notices) run for real around a recorded validation and a
 * recorded delivery.
 *
 * The cases: what one pass writes and the lines it logs; the run's own jobs,
 * once per run; which titles the new-content notices announce; what the
 * admins' sync notice counts as added; the server config a pass refuses, or
 * hands the services; which errors fail the server and which only fail a
 * title; and the one pool movies and shows go through.
 */

const serverConfig = (id, priority) => ({
  id,
  priority,
  baseURL: `https://${id}.example`,
  prefixPath: '',
  syncEndpoint: `https://${id}-node.example`,
})
const mockServers = [serverConfig('default', 1), serverConfig('server2', 2)]
// The file servers' manifests and entries (run/manifestSource), from the libraries a run serves
const { createFakeProcessor } = require('../helpers/fakeProcessor')
const mockProcessor = createFakeProcessor()
// A message for the logger of a pass's TV phase to throw (a pass that throws between its movies and its shows)
let mockFailTvPhase = null
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
jest.mock('@src/utils/sync/run/manifestSource', () => ({
  ...jest.requireActual('@src/utils/sync/run/manifestSource'),
  fetchManifest: (...args) => mockProcessor.fetchManifest(...args),
  fetchEntries: (...args) => mockProcessor.fetchEntries(...args),
}))
jest.mock('@src/lib/logger', () => ({
  createLogger: (component) => {
    if (component === 'FlatSync.NewArch.TV' && mockFailTvPhase) throw new Error(mockFailTvPhase)
    return {
    info: (obj, msg) => mockLogLines.push({ component, level: 'info', obj, msg }),
    warn: (obj, msg) => mockLogLines.push({ component, level: 'warn', obj, msg }),
    error: (obj, msg) => mockLogLines.push({ component, level: 'error', obj, msg }),
    debug: () => {},
    }
  },
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
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({
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
jest.mock('@src/utils/sync/run/preTag', () => ({ preTagSyncRunId: jest.fn() }))
jest.mock('@src/utils/sync/run/missingMedia', () => ({
  computeMissingMedia: jest.fn(async () => ({ missingMovies: [], missingTVShows: [] })),
}))
// Post-sync cleanup is stood in for; the run's own jobs after it are real.
jest.mock('@src/utils/sync/run/postSync', () => ({
  ...jest.requireActual('@src/utils/sync/run/postSync'),
  runPostSyncCleanup: jest.fn(async () => {
    mockSideJobs.push({ job: 'cleanup' })
    return {}
  }),
}))
// What the new-content job announces: one notice naming its titles, and a
// delivery that records it (or fails, while mockDeliveryFailures holds errors)
const mockDeliveryFailures = []
jest.mock('@src/utils/notifications/MediaNotificationOrchestrator', () => ({
  MediaNotificationOrchestrator: {
    // Like the real one, no notice when there is nothing to announce
    composeNewContentNotices: jest.fn((newContent) =>
      newContent.movies.length + newContent.episodes.length === 0
        ? []
        : [
            {
              movies: newContent.movies.map((m) => m.originalTitle),
              episodes: newContent.episodes.map((e) => `${e.originalTitle} S${e.seasonNumber}E${e.episodeNumber}`),
            },
          ]
    ),
    deliverNewContentNotices: jest.fn(async (notices) => {
      if (mockDeliveryFailures.length > 0) throw mockDeliveryFailures.shift()
      for (const notice of notices) mockSideJobs.push({ job: 'notifications', ...notice })
      return { recipients: 2, notices: notices.length, inserted: 2 * notices.length, alreadyThere: 0 }
    }),
  },
}))
// Removing the stale title hashes, once per database (dropTitleHashes.test)
jest.mock('@src/utils/sync/run/dropTitleHashes', () => ({ dropTitleHashesOnce: jest.fn(async () => ({ applied: false })) }))
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
const { probeServers } = require('@src/utils/sync/run/manifestTick')
const { getSyncLockHolder, releaseSyncLock } = require('@src/utils/sync/run/runState')
const { preTagSyncRunId } = require('@src/utils/sync/run/preTag')
const { ResourceManager } = require('@src/utils/sync/core/ResourceManager')
const { MovieSyncService } = require('@src/utils/sync/domain/movies/MovieSyncService')
const { TVShowSyncService } = require('@src/utils/sync/domain/tv/TVShowSyncService')
const { runPostSyncCleanup } = require('@src/utils/sync/run/postSync')
const { MediaNotificationOrchestrator } = require('@src/utils/notifications/MediaNotificationOrchestrator')
const { dropTitleHashesOnce } = require('@src/utils/sync/run/dropTitleHashes')

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
    indexes: [],
    async createIndex(key, options) {
      collection.indexes.push({ key, options })
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
    async insertOne(doc) {
      collection.docs.push(stored(doc))
      return { insertedId: doc._id }
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

// A movie a list shows: served through the transcoder (its .mkv alone is
// hidden), like the episodes.
const playableMovie = () => {
  const movie = moviePayload()
  return {
    ...movie,
    urls: { ...movie.urls, jitEligible: true, jitUrl: 'https://jit.example/stream/movie/master.m3u8' },
  }
}

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

/** Wait for the background cleanup and the run's own jobs: the lock is released when they settle. */
async function settled() {
  for (let i = 0; i < 1000 && getSyncLockHolder(); i++) await new Promise((resolve) => setImmediate(resolve))
  if (getSyncLockHolder()) throw new Error('the run did not settle')
}

/**
 * One run, reached the way a tick reaches it: the servers `fileServers` names
 * are the enabled ones, each serving the library it gives through its manifest
 * and entries (run/manifestSource, faked), and the run is an `all` tick,
 * passing over every title as a full pass does. `fileServers[id].config` is
 * that server's config for the run. With `allEnabledServersProbed: false` the
 * other configured servers are enabled too, and did not answer. `baselineStarted`:
 * the database's announced-titles set was started on an earlier run
 * (run/newContent); without it, the first run on the database starts it and
 * announces nothing. `tick` replaces the tick the run is handed.
 */
async function runSync(
  fileServers,
  { baselineStarted = false, allEnabledServersProbed = true, forceSync = false, tick = null, operationId = 'op-test', startedByAdmin = true } = {}
) {
  if (baselineStarted) {
    const flags = mockCollection('app_config', 'migrations')
    if (!flags.docs.some((d) => d._id === 'new-content-baseline')) flags.docs.push({ _id: 'new-content-baseline' })
  }
  // The enabled servers for the run: those fileServers names, with the config
  // it gives them, and, when not every server answered, the others, down
  const saved = [...mockServers]
  const enabled = saved
    .filter((server) => fileServers[server.id] || !allEnabledServersProbed)
    .map((server) => (fileServers[server.id]?.config ? { ...fileServers[server.id].config, id: server.id } : server))
  mockServers.splice(0, mockServers.length, ...enabled)
  mockProcessor.reset()
  for (const server of enabled) {
    mockProcessor.serve(server.id, fileServers[server.id] ?? {})
    if (!fileServers[server.id]) mockProcessor.server(server.id).down = true
  }
  try {
    const probes = await probeServers(mockServers, null)
    const errors = [...probes].filter(([, probe]) => !probe.ok).map(([serverId, probe]) => ({ serverId, error: probe.error }))
    const result = await syncAllServers(tick ?? { mode: 'all', servers: probes, errors: errors.length > 0 ? errors : undefined }, {
      forceSync,
      operationId,
      startedByAdmin,
    })
    await settled()
    return result
  } finally {
    mockServers.splice(0, mockServers.length, ...saved)
  }
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
  // Each case gets an adapter over its own collections, and its own
  // watch-history validation schedule.
  delete globalThis.__syncDatabaseAdapter
  delete globalThis.__watchHistoryValidationState
  // ... and its own database, with no migration known to be done
  delete globalThis.__dataMigrations
  delete globalThis.__newContentOutboxIndex
  mockDeliveryFailures.length = 0
  // No request leaves a pass here: anything fetched answers 404.
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

  it('names what it changed by folder name, which the media pages tag their caches with, never by display title', async () => {
    const result = await runSync(oneServer())

    // The display titles are 'Example Movie' and 'Example Show' (see the first case)
    expect(new Set(result.changedMedia.movies)).toEqual(new Set([MOVIE]))
    expect(result.changedMedia.shows).toEqual([SHOW])
    expect(result.changedMedia.seasons).toEqual([{ title: SHOW, season: 1 }])
    expect(result.changedMedia.episodes).toEqual(
      expect.arrayContaining([
        { title: SHOW, season: 1, episode: 1 },
        { title: SHOW, season: 1, episode: 2 },
      ])
    )
    expect(result.changedMedia.episodes).toHaveLength(2)
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

describe('the movie metadata change key: the hash on the payload’s metadata URL, no hash list', () => {
  const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
  const movieMetadataFetches = (url = moviePayload().urls.metadata) =>
    fetchMetadataMultiServer.mock.calls.filter(([, path, type]) => type === 'file' && path === url).length
  const withMetadataUrl = (metadata) => ({ ...moviePayload(), urls: { ...moviePayload().urls, metadata } })

  beforeEach(() => {
    fetchMetadataMultiServer.mockClear()
  })

  it('asks the server’s Node.js API for no hash list', async () => {
    await runSync(oneServer())

    const asked = global.fetch.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('/api/metadata-hashes/'))
    expect(asked).toEqual([])
  })

  it('stores the URL’s hash as metadataHash, and a forced pass at the same URL skips the metadata fetch', async () => {
    await runSync(oneServer())
    const [movie] = docs('FlatMovies')
    expect(movie).toMatchObject({ metadataHash: 'd1', metadataSource: 'default' })
    expect(movieMetadataFetches()).toBe(1)

    // A forced pass runs every step; the metadata step finds the key unchanged
    fetchMetadataMultiServer.mockClear()
    await runSync(oneServer(), { forceSync: true })
    expect(movieMetadataFetches()).toBe(0)

    // A new hash on the URL is a new file: it is fetched, and its key stored
    const changed = `${MOVIE_FOLDER}/metadata.json?hash=d2`
    await runSync(oneServer({ movies: { [MOVIE]: withMetadataUrl(changed) } }))
    expect(movieMetadataFetches(changed)).toBe(1)
    expect(docs('FlatMovies')[0].metadataHash).toBe('d2')
  })

  it('fetches the metadata on every pass, and stores no hash, when the URL has none', async () => {
    const bare = `${MOVIE_FOLDER}/metadata.json`
    await runSync(oneServer({ movies: { [MOVIE]: withMetadataUrl(bare) } }))
    expect(docs('FlatMovies')[0]).not.toHaveProperty('metadataHash')

    fetchMetadataMultiServer.mockClear()
    await runSync(oneServer({ movies: { [MOVIE]: withMetadataUrl(bare) } }), { forceSync: true })
    expect(movieMetadataFetches(bare)).toBe(1)
  })

  it('stamps no title hash on any document: the gates are stamped, the hashes are not', async () => {
    await runSync(oneServer())
    // A forced pass rewrites what differs, and writes no hash either
    await runSync(oneServer({ tv: { [SHOW]: showPayload([1, 2, 3]) } }), { forceSync: true })

    for (const name of ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']) {
      for (const doc of docs(name)) {
        expect(doc).not.toHaveProperty('syncHash')
        expect(doc).not.toHaveProperty('contentHash')
      }
    }
    const [show] = docs('FlatTVShows')
    expect(show.syncGates?.default).toEqual(expect.stringMatching(/^g\d+:/))
  })
})

// ---------------------------------------------------------------- URLs

describe('the URLs a pass stores for a server behind a prefix', () => {
  const PREFIX = '/media'
  const BASE = 'https://default.example'
  // The processor run with PREFIX_PATH puts the prefix on every path it publishes.
  const underPrefix = (value) => {
    if (typeof value === 'string') return value.startsWith('/movies/') || value.startsWith('/tv/') ? `${PREFIX}${value}` : value
    if (Array.isArray(value)) return value.map(underPrefix)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([field, v]) => [field, underPrefix(v)]))
    }
    return value
  }
  const movieWithEveryFile = () => {
    const movie = moviePayload()
    return underPrefix({
      ...movie,
      urls: {
        ...movie.urls,
        sources: [{ url: movie.urls.mp4, container: 'mkv', isPrimary: true }],
        chapters: `${MOVIE_FOLDER}/chapters/Example%20Movie_chapters.vtt`,
        subtitles: {
          English: { srcLang: 'en', url: `${MOVIE_FOLDER}/Example%20Movie.en.srt`, lastModified: '2024-01-01T00:00:00.000Z' },
          'Spanish (Auto)': { srcLang: 'es', url: 'https://default-node.example/api/captions/track/1.vtt', autoGenerated: true, pending: true },
        },
      },
    })
  }
  const showWithEveryFile = () => {
    const show = showPayload([1])
    const episode = show.seasons['Season 1'].episodes[key(1)]
    episode.chapters = `${SEASON_FOLDER}/chapters/${encodeURIComponent(`${SHOW} - S1E01_chapters.vtt`)}`
    episode.subtitles = { English: { srcLang: 'en', url: `${SEASON_FOLDER}/E01.en.srt`, lastModified: '2024-01-01T00:00:00.000Z' } }
    return underPrefix(show)
  }

  it('is the baseURL followed by the path the payload gives, for every file of a movie and of a show', async () => {
    const movie = movieWithEveryFile()
    const show = showWithEveryFile()

    const result = await runSync(oneServer({ prefixPath: PREFIX, movies: { [MOVIE]: movie }, tv: { [SHOW]: show } }))

    expect(result.errors).toEqual([])
    const [storedMovie] = docs('FlatMovies')
    expect(storedMovie.videoURL).toBe(`${BASE}/media/movies/Example%20Movie%20(2020)/Example%20Movie.mkv`)
    expect(storedMovie).toMatchObject({
      videoURL: `${BASE}${movie.urls.mp4}`,
      sources: [expect.objectContaining({ url: `${BASE}${movie.urls.mp4}` })],
      chapterURL: `${BASE}${movie.urls.chapters}`,
      posterURL: `${BASE}${movie.urls.poster}`,
    })
    expect(storedMovie.captionURLs).toEqual({
      English: { srcLang: 'en', url: `${BASE}${movie.urls.subtitles.English.url}`, lastModified: '2024-01-01T00:00:00.000Z', sourceServerId: 'default' },
      'Spanish (Auto)': { srcLang: 'es', url: 'https://default-node.example/api/captions/track/1.vtt', sourceServerId: 'default', autoGenerated: true, pending: true },
    })

    const season = show.seasons['Season 1']
    const episode = season.episodes[key(1)]
    const [storedShow] = docs('FlatTVShows')
    expect(storedShow.posterURL).toBe(`${BASE}${show.poster}`)
    expect(docs('FlatSeasons')[0].posterURL).toBe(`${BASE}${season.season_poster}`)
    const [storedEpisode] = docs('FlatEpisodes')
    expect(storedEpisode.videoURL).toBe(`${BASE}/media/tv/Example%20Show%20(2019)/Season%201/${encodeURIComponent(`${SHOW} - S01E01.mkv`)}`)
    expect(storedEpisode).toMatchObject({
      videoURL: `${BASE}${episode.videoURL}`,
      sources: [expect.objectContaining({ url: `${BASE}${episode.videoURL}` })],
      thumbnail: `${BASE}${episode.thumbnail}`,
      chapterURL: `${BASE}${episode.chapters}`,
      captionURLs: { English: expect.objectContaining({ url: `${BASE}${episode.subtitles.English.url}` }) },
    })
  })
})

// ---------------------------------------------------------------- the run's own jobs

describe('the run’s own jobs', () => {
  const twoServers = (movies = { [MOVIE]: moviePayload() }) => ({
    ...oneServer({ movies }),
    server2: { config: config('server2'), movies, tv: { [SHOW]: showPayload() } },
  })

  it('run once per run, after every server’s pass and after post-sync cleanup', async () => {
    await runSync(twoServers())

    expect(mockSideJobs).toEqual([{ job: 'cleanup' }, { job: 'migration' }, { job: 'validation' }])
  })

  it('end with the new-content notices, once, for both servers’ titles', async () => {
    await runSync(twoServers({ [MOVIE]: playableMovie() }), { baselineStarted: true })

    expect(mockSideJobs).toEqual([
      { job: 'cleanup' },
      { job: 'migration' },
      { job: 'validation' },
      { job: 'notifications', movies: [MOVIE], episodes: [`${SHOW} S1E1`, `${SHOW} S1E2`] },
    ])
    expect(mockLogLines.filter((line) => line.msg === 'Notification processing completed')).toEqual([
      expect.objectContaining({ component: 'FlatSync.NewArch', obj: expect.objectContaining({ phase: 'notifications' }) }),
    ])
  })

  it('still run when post-sync cleanup throws', async () => {
    runPostSyncCleanup.mockImplementationOnce(async () => {
      mockSideJobs.push({ job: 'cleanup' })
      throw new Error('cleanup blew up')
    })

    await runSync(oneServer())

    expect(mockSideJobs).toEqual([{ job: 'cleanup' }, { job: 'migration' }, { job: 'validation' }])
  })

  it('remove the stale title hashes after cleanup, once per run (it applies once per database)', async () => {
    runPostSyncCleanup.mockImplementationOnce(async () => {
      mockSideJobs.push({ job: 'cleanup' })
      expect(dropTitleHashesOnce).not.toHaveBeenCalled()
      return {}
    })
    dropTitleHashesOnce.mockClear()

    await runSync(twoServers())

    expect(dropTitleHashesOnce).toHaveBeenCalledTimes(1)
  })

  it('validate watch history after every full pass, however recent the last validation', async () => {
    await runSync(oneServer())
    await runSync(oneServer())

    expect(mockSideJobs.filter((job) => job.job === 'validation')).toHaveLength(2)
  })
})

// ---------------------------------------------------------------- new content

describe('the new-content notices', () => {
  const announced = () => mockSideJobs.filter((job) => job.job === 'notifications')
  const completed = () => logLine('Notification processing completed')?.obj
  const announcedSet = () => docs('AnnouncedTitles').map((d) => d._id).sort()
  const outbox = () => docs('NewContentOutbox')
  const movieKey = (title) => `movie:${title}`
  const episodeKey = (n, show = SHOW) => `episode:${show}:S1E${n}`
  const nextRun = () => {
    mockSideJobs.length = 0
    mockLogLines.length = 0
  }
  // A run on a database whose announced-titles set was started earlier
  const started = (fileServers, options = {}) => runSync(fileServers, { baselineStarted: true, ...options })
  const HIDDEN_MOVIE = 'Hidden Movie (2021)'
  const hiddenMovie = () => ({ ...moviePayload(), mediaIdentity: { id: 'mid:hidden', scheme: 'mid', firstSeen: null } })
  /** The same movie under another folder name (the identity sidecar moves with the folder). */
  const RENAMED = 'Example Movie (2019)'
  const renamedFolder = (payload, from, to) =>
    JSON.parse(JSON.stringify(payload).split(encodeURIComponent(from)).join(encodeURIComponent(to)))

  describe('the baseline', () => {
    it('the first complete run announces nothing and puts the whole library, hidden titles and identities included, in the set', async () => {
      const result = await runSync(oneServer({ movies: { [MOVIE]: playableMovie(), [HIDDEN_MOVIE]: hiddenMovie() } }))

      expect(result.added).toEqual({ movies: 2, shows: 1, episodes: 2 })
      expect(announced()).toEqual([])
      expect(announcedSet()).toEqual(
        [
          episodeKey(1), episodeKey(2), movieKey(HIDDEN_MOVIE), movieKey(MOVIE),
          'media:mid:hidden', 'media:mid:movie', 'media:mid:show:e1', 'media:mid:show:e2',
        ].sort()
      )
      expect(docs('AnnouncedTitles')[0]).toMatchObject({ by: 'baseline' })
      expect(completed()).toMatchObject({ baseline: { movies: 2, episodes: 2, keys: 8 } })
      expect(mockCollection('app_config', 'migrations').docs.map((d) => d._id)).toContain('new-content-baseline')
    })

    it('waits for a complete run: an incomplete one starts nothing and announces nothing', async () => {
      // A server did not answer
      await runSync(oneServer({ movies: { [MOVIE]: playableMovie() } }), { allEnabledServersProbed: false })

      expect(announced()).toEqual([])
      expect(announcedSet()).toEqual([])
      expect(mockCollection('app_config', 'migrations').docs.map((d) => d._id)).not.toContain('new-content-baseline')
      expect(completed()).toMatchObject({ baseline: { waiting: ['not every enabled server answered'] } })
      nextRun()

      // The next complete run starts it, and still announces nothing
      await runSync(oneServer({ movies: { [MOVIE]: playableMovie() } }))
      expect(announced()).toEqual([])
      expect(announcedSet()).toContain(movieKey(MOVIE))
      nextRun()

      await runSync(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: { [SHOW]: showPayload([1, 2, 3]) } }))
      expect(announced()).toEqual([{ job: 'notifications', movies: [], episodes: [`${SHOW} S1E3`] }])
    })

    it('a baseline that fails announces nothing, writes no flag, and is seeded by the next complete run', async () => {
      const set = mockCollection('Media', 'AnnouncedTitles')
      const bulkWrite = set.bulkWrite
      set.bulkWrite = async () => {
        throw new Error('not primary')
      }
      await runSync(oneServer({ movies: { [MOVIE]: playableMovie() } }))
      expect(announced()).toEqual([])
      expect(mockCollection('app_config', 'migrations').docs.map((d) => d._id)).not.toContain('new-content-baseline')

      set.bulkWrite = bulkWrite
      nextRun()
      await runSync(oneServer({ movies: { [MOVIE]: playableMovie() } }))

      // The run that seeds announces nothing
      expect(announced()).toEqual([])
      expect(announcedSet()).toContain(movieKey(MOVIE))
    })
  })

  describe('after the baseline', () => {
    it('announce the movie and the episodes the library did not have, once each', async () => {
      await started(oneServer({ movies: { [MOVIE]: playableMovie() } }))

      expect(announced()).toEqual([
        { job: 'notifications', movies: [MOVIE], episodes: [`${SHOW} S1E1`, `${SHOW} S1E2`] },
      ])
      expect(announcedSet()).toEqual(
        [episodeKey(1), episodeKey(2), movieKey(MOVIE), 'media:mid:movie', 'media:mid:show:e1', 'media:mid:show:e2'].sort()
      )
      expect(docs('AnnouncedTitles').every((d) => d.by === 'notice')).toBe(true)
      expect(outbox()).toEqual([])
      // The posters the digest's list shows: the movie's, and the episodes' show's
      const [composed] = MediaNotificationOrchestrator.composeNewContentNotices.mock.calls.at(-1)
      expect(composed.movies[0].posterURL).toBe(`https://default.example${MOVIE_FOLDER}/poster.jpg?hash=p1`)
      expect(composed.episodes[0].showPosterURL).toBe(`https://default.example${SHOW_ROOT}/show_poster.jpg?hash=p1`)
    })

    it('find a title whose notice was lost before it was queued on the next full run, though it is not written again', async () => {
      const queue = mockCollection('Media', 'NewContentOutbox')
      const insertOne = queue.insertOne
      queue.insertOne = async () => {
        throw new Error('connection reset')
      }
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))
      expect(announced()).toEqual([])
      expect(outbox()).toEqual([])
      queue.insertOne = insertOne
      nextRun()

      // The movie is skipped on its gate: nothing writes it
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))

      expect(announced()).toEqual([{ job: 'notifications', movies: [MOVIE], episodes: [] }])
    })

    it('announce a movie whose folder came before its video when the video arrives', async () => {
      // A placeholder folder: metadata and poster, no video yet
      const placeholder = moviePayload()
      delete placeholder.urls.mp4
      await started(oneServer({ movies: { [MOVIE]: placeholder }, tv: {} }))
      expect(announced()).toEqual([])
      expect(announcedSet()).toEqual([])
      nextRun()

      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))

      expect(announced()).toEqual([{ job: 'notifications', movies: [MOVIE], episodes: [] }])
    })

    it('announce a title an admin override makes visible, with no pass writing it', async () => {
      // A transcoder link the file server does not offer as eligible: hidden
      const movie = moviePayload()
      movie.urls = { ...movie.urls, jitEligible: false, jitUrl: 'https://jit.example/stream/movie/master.m3u8' }
      await started(oneServer({ movies: { [MOVIE]: movie }, tv: {} }))
      expect(announced()).toEqual([])
      docs('FlatMovies')[0].jitServeOverride = 'on'
      nextRun()

      await started(oneServer({ movies: { [MOVIE]: movie }, tv: {} }))

      expect(announced()).toEqual([{ job: 'notifications', movies: [MOVIE], episodes: [] }])
    })

    it('do not announce a title removed from the library and added back later', async () => {
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))
      // Post-sync cleanup deletes the movie on a run no server had it ...
      docs('FlatMovies').length = 0
      nextRun()

      // ... and a later run creates it again
      const result = await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))

      expect(result.added.movies).toBe(1)
      expect(announced()).toEqual([])
      expect(completed()).toMatchObject({ candidates: 0, alreadyAnnounced: 1 })
    })

    it('do not announce a movie whose folder was renamed: its identity was announced', async () => {
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))
      // The folder is renamed (a year fixed); the old document goes with cleanup
      docs('FlatMovies').length = 0
      nextRun()

      await started(oneServer({ movies: { [RENAMED]: renamedFolder(playableMovie(), MOVIE, RENAMED) }, tv: {} }))

      expect(docs('FlatMovies').map((d) => d.originalTitle)).toEqual([RENAMED])
      expect(announced()).toEqual([])
      // The new folder name joins the set beside the identity
      expect(announcedSet()).toContain(movieKey(RENAMED))
      expect(docs('AnnouncedTitles').find((d) => d._id === movieKey(RENAMED))).toMatchObject({ by: 'alias' })
    })

    it('do not announce the episodes of a show whose folder was renamed: their identities were announced', async () => {
      const RENAMED_SHOW = 'Example Show (2019) [Renamed]'
      await started(oneServer({ movies: {}, tv: { [SHOW]: showPayload([1, 2]) } }))
      expect(announced()).toHaveLength(1)
      docs('FlatTVShows').length = 0
      docs('FlatSeasons').length = 0
      docs('FlatEpisodes').length = 0
      nextRun()

      await started(oneServer({ movies: {}, tv: { [RENAMED_SHOW]: renamedFolder(showPayload([1, 2]), SHOW, RENAMED_SHOW) } }))

      expect(docs('FlatEpisodes')).toHaveLength(2)
      expect(announced()).toEqual([])
      expect(completed()).toMatchObject({ candidates: 0, alreadyAnnounced: 2 })
    })

    it('announce no episode of a show re-created under a new _id, except one new to the library', async () => {
      await runSync(oneServer({ movies: {}, tv: { [SHOW]: showPayload([1, 2]) } }))
      const [firstShow] = docs('FlatTVShows')
      // The show's document is deleted and its episodes are left pointing at it
      docs('FlatTVShows').length = 0
      nextRun()

      const result = await runSync(oneServer({ movies: {}, tv: { [SHOW]: showPayload([1, 2, 3]) } }))

      expect(docs('FlatTVShows')[0]._id).not.toBe(firstShow._id)
      expect(result.added).toEqual({ movies: 0, shows: 1, episodes: 3 })
      expect(announced()).toEqual([{ job: 'notifications', movies: [], episodes: [`${SHOW} S1E3`] }])
    })

    it('announce a title two servers add in the same run once', async () => {
      await started({
        ...oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }),
        server2: { config: config('server2'), movies: { [MOVIE]: playableMovie() }, tv: {} },
      })

      expect(announced()).toEqual([{ job: 'notifications', movies: [MOVIE], episodes: [] }])
    })

    it('announce nothing a list would not show, and keep it out of the set', async () => {
      // A .mkv the browser cannot play, and no transcoder
      await started(oneServer({ movies: { [MOVIE]: moviePayload() }, tv: {} }))

      expect(announced()).toEqual([])
      expect(announcedSet()).toEqual([])
    })

    it('announce nothing post-sync cleanup deleted in the same run', async () => {
      runPostSyncCleanup.mockImplementationOnce(async () => {
        mockSideJobs.push({ job: 'cleanup' })
        docs('FlatMovies').length = 0
        return {}
      })

      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))

      expect(announced()).toEqual([])
      expect(announcedSet()).toEqual([])
    })

    it('announce nothing again on a later run', async () => {
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))
      nextRun()

      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }), { forceSync: true })

      expect(completed()).toMatchObject({ candidates: 0, alreadyAnnounced: 1 })
      expect(announced()).toEqual([])
    })
  })

  describe('delivery', () => {
    it('keeps a failed delivery queued and sends it on a later run that rewrites nothing, once', async () => {
      mockDeliveryFailures.push(new Error('connection reset'))
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))

      // Not announced, and not in the set: it is queued, with both its keys
      expect(announced()).toEqual([])
      expect(announcedSet()).toEqual([])
      expect(outbox()).toEqual([
        expect.objectContaining({
          state: 'pending',
          titleKeys: [movieKey(MOVIE), 'media:mid:movie'],
          attempts: 1,
          lastError: 'connection reset',
        }),
      ])
      nextRun()

      // The next run skips the movie on its gate, and still delivers the notice
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))

      expect(completed()).toMatchObject({ candidates: 0, alreadyQueued: 1, delivery: { delivered: 1, failed: 0 } })
      expect(announced()).toEqual([{ job: 'notifications', movies: [MOVIE], episodes: [] }])
      expect(announcedSet()).toEqual(['media:mid:movie', movieKey(MOVIE)])
      expect(outbox()).toEqual([])
      nextRun()

      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }), { forceSync: true })
      expect(announced()).toEqual([])
    })

    it('hands a queued notice to delivery under the same id every time, so a retry adds nothing twice', async () => {
      MediaNotificationOrchestrator.deliverNewContentNotices.mockClear()
      mockDeliveryFailures.push(new Error('connection reset'))
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))

      const ids = MediaNotificationOrchestrator.deliverNewContentNotices.mock.calls.map(([, deliveryId]) => deliveryId)
      expect(ids).toHaveLength(2)
      expect(ids[0]).toBe(ids[1])
    })

    it('gives up on an entry after 10 failed attempts, logs it once, and finds its titles again once the entry has expired', async () => {
      MediaNotificationOrchestrator.deliverNewContentNotices.mockClear()
      const gaveUp = () => mockLogLines.filter((line) => /^Gave up delivering/.test(line.msg ?? ''))
      mockDeliveryFailures.push(...Array.from({ length: 10 }, () => new Error('not primary')))
      const lines = []
      for (let run = 1; run <= 11; run++) {
        await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))
        lines.push(...gaveUp())
        nextRun()
      }

      expect(outbox()).toEqual([
        expect.objectContaining({ state: 'dead', attempts: 10, deadAt: expect.any(String), lastError: 'not primary' }),
      ])
      // Ten attempts, none on the eleventh run, and one line
      expect(MediaNotificationOrchestrator.deliverNewContentNotices).toHaveBeenCalledTimes(10)
      expect(lines).toHaveLength(1)
      expect(announced()).toEqual([])
      // Dead entries expire (a TTL index on deadAt, 30 days)
      expect(mockCollection('Media', 'NewContentOutbox').indexes).toContainEqual({
        key: { deadAt: 1 },
        options: { name: 'deadAt_ttl', expireAfterSeconds: 30 * 24 * 60 * 60 },
      })

      // Once the TTL has removed it, the movie is a candidate again
      docs('NewContentOutbox').length = 0
      await started(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: {} }))
      expect(announced()).toEqual([{ job: 'notifications', movies: [MOVIE], episodes: [] }])
    })
  })
})

// ---------------------------------------------------------------- the popup's report

describe('the report the admin’s sync popup shows', () => {
  it('counts each server’s titles as checked, updated, unchanged and failed', async () => {
    const first = await runSync(oneServer())
    expect(first.titleCounts.default).toEqual({ checked: 2, updated: 2, unchanged: 0, failed: 0, failures: [] })

    // Nothing changed: both titles are skipped on their gates
    const second = await runSync(oneServer())
    expect(second.titleCounts.default).toEqual({ checked: 2, updated: 0, unchanged: 2, failed: 0, failures: [] })
  })

  it('counts nothing as updated on a forced sync of a settled library: every write ran, none changed a document', async () => {
    await runSync(oneServer())
    await runSync(oneServer())

    const forced = await runSync(oneServer(), { forceSync: true })

    expect(forced.titleCounts.default).toEqual({ checked: 2, updated: 0, unchanged: 2, failed: 0, failures: [] })
    // The writes did run: the changed-media list (cache invalidation) still names them
    expect(forced.changedMedia.shows).toContain(SHOW)
  })

  it('lists a failed title with its error', async () => {
    const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
    const movie = { ...moviePayload(), urls: { ...moviePayload().urls, metadata: `${MOVIE_FOLDER}/metadata.json?hash=d9` } }
    await runSync(oneServer())
    const real = fetchMetadataMultiServer.getMockImplementation()
    fetchMetadataMultiServer.mockImplementation(async (serverId, url, type) => {
      if (url === movie.urls.metadata) throw new Error('file server timed out')
      return real(serverId, url, type)
    })
    try {
      const result = await runSync(oneServer({ movies: { [MOVIE]: movie } }))
      expect(result.titleCounts.default).toMatchObject({ checked: 2, failed: 1 })
      expect(result.titleCounts.default.failures).toEqual([
        { kind: 'movies', title: MOVIE, error: expect.stringContaining('metadata fetch failed') },
      ])
    } finally {
      fetchMetadataMultiServer.mockImplementation(real)
    }
  })

  describe('the titles the library hides although they have a video (cantPlay)', () => {
    const file = (folder, name, container, isPrimary) => ({
      url: `${folder}/${encodeURIComponent(name)}`,
      container,
      isPrimary,
    })
    const aviMovie = () => {
      const avi = file(MOVIE_FOLDER, 'Example Movie.avi', 'avi', true)
      return { ...moviePayload(), fileNames: ['Example Movie.avi'], urls: { ...moviePayload().urls, mp4: avi.url, sources: [avi] } }
    }
    const aviEpisode = (n) => {
      const avi = file(SEASON_FOLDER, `${SHOW} - ${key(n)}.avi`, 'avi', true)
      const { jitEligible: _eligible, jitUrl: _jit, ...episode } = episodePayload(n)
      return { ...episode, videoURL: avi.url, sources: [avi] }
    }
    const showWith = (episodes) => {
      const show = showPayload(Object.keys(episodes).map(Number))
      for (const [n, episode] of Object.entries(episodes)) show.seasons['Season 1'].episodes[key(Number(n))] = episode
      return show
    }

    it('lists an avi-only movie and an avi-only episode, by season, under the server their video came from', async () => {
      const result = await runSync(oneServer({ movies: { [MOVIE]: aviMovie() }, tv: { [SHOW]: showWith({ 1: aviEpisode(1), 2: episodePayload(2) }) } }))

      expect(result.cantPlay).toEqual({
        default: {
          movies: [{ title: MOVIE, reason: 'unsupported format (.avi)' }],
          tv: [{ title: SHOW, season: 1, episodes: [{ episode: 1, reason: 'unsupported format (.avi)' }] }],
          count: 2,
        },
      })
    })

    it('does not list a movie whose primary video is an mp4 beside an avi', async () => {
      const mp4 = file(MOVIE_FOLDER, 'Example Movie.mp4', 'mp4', true)
      const avi = file(MOVIE_FOLDER, 'Example Movie.avi', 'avi', false)
      const movie = { ...moviePayload(), fileNames: ['Example Movie.mp4', 'Example Movie.avi'], urls: { ...moviePayload().urls, mp4: mp4.url, sources: [mp4, avi] } }

      const result = await runSync(oneServer({ movies: { [MOVIE]: movie }, tv: { [SHOW]: showPayload() } }))

      expect(result.cantPlay).toEqual({})
    })

    it('is not read on a webhook tick, even one over every title', async () => {
      const result = await runSync(oneServer({ movies: { [MOVIE]: aviMovie() } }), { startedByAdmin: false })
      expect(result.cantPlay).toEqual({})
    })

    it('is listed in full again when every title is skipped on its gate', async () => {
      await runSync(oneServer({ movies: { [MOVIE]: aviMovie() } }))
      // A second `all` run that skips every title still lists it
      expect((await runSync(oneServer({ movies: { [MOVIE]: aviMovie() } }))).cantPlay.default.count).toBe(1)
    })
  })

  it('lists the titles with no video file yet under noVideo, with their reason', async () => {
    const noVideo = { ...moviePayload(), fileNames: ['poster.jpg', 'metadata.json'], urls: { poster: moviePayload().urls.poster } }

    const result = await runSync(oneServer({ movies: { [MOVIE]: noVideo }, tv: { [SHOW]: showPayload([]) } }))

    expect(result.noVideo.default).toEqual({
      movies: [{ title: MOVIE, reason: 'no video file' }],
      tv: [
        { title: SHOW, season: 'Season 1', reason: 'no video file' },
        { title: SHOW, season: null, reason: 'no video file' },
      ],
    })
    expect(result).not.toHaveProperty('missingMp4')
  })
})

// ---------------------------------------------------------------- the operation id

describe('the operation id on the run’s warm-up and completion', () => {
  const { syncEventBus } = require('@src/utils/sync/core/events')
  const { tryAcquireSyncLock } = require('@src/utils/sync/run/runState')
  const completions = (spy) => spy.mock.calls.filter(([entityId]) => entityId === '__sync_complete__').map((call) => call[4])

  it('stamps both, and says the run completed', async () => {
    const started = jest.spyOn(syncEventBus, 'emitStarted')
    const completed = jest.spyOn(syncEventBus, 'emitComplete')

    const result = await runSync(oneServer(), { operationId: 'op-admin' })

    expect(started.mock.calls.find(([entityId]) => entityId === '__sync_warmup__')[4]).toEqual({ operationId: 'op-admin' })
    expect(completions(completed)).toEqual([{ summary: result, operationId: 'op-admin', outcome: 'completed' }])
  })

  it('emits a completion that says another sync is still finishing when the lock is held', async () => {
    const completed = jest.spyOn(syncEventBus, 'emitComplete')
    // The previous run's cleanup and jobs still hold the orchestration lock
    expect(tryAcquireSyncLock('previous-run')).toBe(true)
    try {
      const result = await syncAllServers({ mode: 'all', servers: new Map() }, { operationId: 'op-busy', startedByAdmin: true })

      expect(result).toMatchObject({ skipped: true, reason: 'orchestration_in_progress' })
      expect(completions(completed)).toEqual([{ operationId: 'op-busy', outcome: 'busy', summary: result }])
    } finally {
      releaseSyncLock('previous-run')
    }
  })
})

// ---------------------------------------------------------------- added

describe('what the admins’ sync notice counts as added', () => {
  it('counts the documents a run created', async () => {
    const result = await runSync(oneServer())

    expect(result.added).toEqual({ movies: 1, shows: 1, episodes: 2 })
  })

  it('does not count a document a run only rewrote', async () => {
    // No hash on the metadata URL, so the forced pass fetches the metadata again
    const movie = { ...moviePayload(), urls: { ...moviePayload().urls, metadata: `${MOVIE_FOLDER}/metadata.json` } }
    await runSync(oneServer({ movies: { [MOVIE]: movie } }))

    // A forced pass runs every title in full and rewrites what differs
    const forced = await runSync(oneServer({ movies: { [MOVIE]: movie } }), { forceSync: true })

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
    ['no priority', { priority: undefined }, /priority undefined for server default is not a positive integer/],
    ['a priority that is a string', { priority: '1' }, /priority "1" for server default is not a positive integer/],
    ['a priority that is not a finite number', { priority: NaN }, /priority NaN for server default is not a positive integer/],
    ['a priority of 0', { priority: 0 }, /priority 0 for server default is not a positive integer/],
    ['a negative priority', { priority: -1 }, /priority -1 for server default is not a positive integer/],
    ['a priority that is not a whole number', { priority: 1.5 }, /priority 1.5 for server default is not a positive integer/],
    ['no baseURL', { baseURL: undefined }, /missing baseURL for server default/],
  ])('fails the server’s pass on %s, writing nothing and recording nothing', async (_label, overrides, message) => {
    const result = await runSync(oneServer(overrides))

    expect(result.errors).toEqual([expect.objectContaining({ serverId: 'default', error: expect.stringMatching(message) })])
    expect(result.flatSyncResults?.default).toBeUndefined()
    expect(docs('FlatMovies')).toEqual([])
    expect(docs('FlatTVShows')).toEqual([])
    // The run's own jobs still run once, with nothing to announce
    expect(mockSideJobs).toEqual([{ job: 'cleanup' }, { job: 'migration' }, { job: 'validation' }])
    expect(appliedRecord()).toMatchObject({ state: 'running', syncRunId: result.syncRunId })
  })

  it('hands movies and shows one server config, with the priority config gives', async () => {
    const syncMovie = MovieSyncService.prototype.syncMovie
    const syncTVShow = TVShowSyncService.prototype.syncTVShow
    const seen = []
    jest.spyOn(MovieSyncService.prototype, 'syncMovie').mockImplementation(function (title, payload, parts) {
      seen.push(parts.run.serverConfig)
      return syncMovie.call(this, title, payload, parts)
    })
    jest.spyOn(TVShowSyncService.prototype, 'syncTVShow').mockImplementation(function (title, payload, parts) {
      seen.push(parts.run.serverConfig)
      return syncTVShow.call(this, title, payload, parts)
    })

    const result = await runSync(oneServer({ priority: 3 }))

    expect(result.errors).toEqual([])
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
    expect(seen[0]).toEqual({
      id: 'default',
      priority: 3,
      baseUrl: 'https://default.example',
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
    expect(mockSideJobs).toEqual([{ job: 'cleanup' }, { job: 'migration' }, { job: 'validation' }])
    expect(appliedRecord()).toMatchObject({ state: 'running', syncRunId: result.syncRunId })
  })

  it('a show whose sync throws is one failed result; the other titles are written and the pass goes on', async () => {
    const OTHER = 'Another Show (2021)'
    const syncTVShow = TVShowSyncService.prototype.syncTVShow
    jest.spyOn(TVShowSyncService.prototype, 'syncTVShow').mockImplementation(function (title, payload, parts) {
      if (title === OTHER) return Promise.reject(new Error('show sync blew up'))
      return syncTVShow.call(this, title, payload, parts)
    })

    const result = await runSync(oneServer({ tv: { [SHOW]: showPayload(), [OTHER]: showPayload() } }))

    expect(result.errors).toEqual([])
    const pass = result.flatSyncResults.default
    expect(pass.tvShows).toMatchObject({ processed: 1, errors: 1 })
    expect(pass.errors).toEqual([expect.objectContaining({ phase: 'tvContentSync', error: 'show sync blew up' })])
    expect(docs('FlatTVShows').map((d) => d.originalTitle)).toEqual([SHOW])
    expect(docs('FlatMovies')).toHaveLength(1)
    // The run's own jobs still run, and the failure keeps the pass from being recorded
    expect(mockSideJobs.map((s) => s.job)).toEqual(['cleanup', 'migration', 'validation'])
    expect(appliedRecord()).toMatchObject({ state: 'running' })
  })

  it('a pass that throws after its movies has already handed the run what it wrote', async () => {
    // The pass throws between its movies and its shows (as it starts its TV
    // phase), out of reach of the per-title catch.
    mockFailTvPhase = 'TV payload unreadable'
    const movie = playableMovie()
    const fileServers = oneServer({ movies: { [MOVIE]: movie } })

    let result
    try {
      result = await runSync(fileServers, { baselineStarted: true })
    } finally {
      mockFailTvPhase = null
    }

    expect(result.errors).toEqual([expect.objectContaining({ serverId: 'default', error: 'TV payload unreadable' })])
    expect(result.flatSyncResults?.default).toBeUndefined()
    expect(docs('FlatMovies')).toHaveLength(1)
    // The admins' count, the cache invalidation and the new-content notice all
    // still have the movie the pass wrote before it threw
    expect(result.added).toEqual({ movies: 1, shows: 0, episodes: 0 })
    // (by folder name, as the media pages tag their caches)
    expect(result.changedMedia.movies).toContain(MOVIE)
    expect(mockSideJobs).toContainEqual({ job: 'notifications', movies: [MOVIE], episodes: [] })
  })
})

// ---------------------------------------------------------------- per-title completion

describe('onTitleFinished: what the pass tells the run about each title', () => {
  const { runServerPass } = require('@src/utils/sync/run/serverPass')
  const { buildFieldAvailability } = require('@src/utils/sync/run/availability')

  async function passOver(fileServers) {
    const fieldAvailability = await buildFieldAvailability(fileServers)
    const finished = []
    let error = null
    try {
      await runServerPass(fileServers.default, { id: 'default', ...fileServers.default.config }, fieldAvailability, {
        allEnabledServersProbed: true,
        onTitleFinished: (kind, title, clean) => finished.push([kind, title, clean]),
      })
    } catch (thrown) {
      error = thrown
    }
    return { finished, error }
  }

  it('reports each title once, clean when it finished cleanly; a movie with nothing to sync is clean', async () => {
    const { finished, error } = await passOver(oneServer({ movies: { [MOVIE]: playableMovie(), 'Empty Folder (2001)': {} } }))
    expect(error).toBeNull()
    expect(finished).toHaveLength(3)
    expect(finished).toEqual(
      expect.arrayContaining([['movies', 'Empty Folder (2001)', true], ['movies', MOVIE, true], ['tv', SHOW, true]])
    )
  })

  it('reports a title whose sync throws as not clean', async () => {
    const OTHER = 'Another Show (2021)'
    const syncTVShow = TVShowSyncService.prototype.syncTVShow
    jest.spyOn(TVShowSyncService.prototype, 'syncTVShow').mockImplementation(function (title, payload, parts) {
      if (title === OTHER) return Promise.reject(new Error('show sync blew up'))
      return syncTVShow.call(this, title, payload, parts)
    })
    const { finished } = await passOver(oneServer({ tv: { [SHOW]: showPayload(), [OTHER]: showPayload() } }))
    expect(finished).toEqual(expect.arrayContaining([['tv', SHOW, true], ['tv', OTHER, false]]))
  })

  it('does not report a title the pass never reached because it threw first', async () => {
    const unreadable = new Proxy({}, {
      ownKeys() {
        if (docs('FlatMovies').length > 0) throw new Error('TV payload unreadable')
        return []
      },
    })
    const { finished, error } = await passOver(oneServer({ movies: { [MOVIE]: playableMovie() }, tv: unreadable }))
    expect(error?.message).toBe('TV payload unreadable')
    expect(finished).toEqual([['movies', MOVIE, true]])
  })
})

describe('the pass inputs the run builds under its lock', () => {
  it('fail closed when they cannot be built: no pass, no delete, nothing recorded', async () => {
    mockCollection('Media', 'FlatMovies').docs.push({ _id: 'orphan', originalTitle: 'Orphan (1999)', syncRunId: 'old', updatedAt: new Date(0) })
    // A probe whose manifests cannot be read
    const broken = { mode: 'all', servers: new Map([['default', { ok: true, manifests: { tv: null, movies: null } }]]) }

    const result = await runSync(oneServer(), { baselineStarted: true, tick: broken })

    expect(result.errors).toEqual([expect.objectContaining({ phase: 'pass_inputs' })])
    // Cleanup (stood in for here) is handed no listing and the every-server
    // flag off: its own gates then delete nothing (postSyncCleanupDeleteGate)
    const { runPostSyncCleanup } = require('@src/utils/sync/run/postSync')
    const [listings, cleanupOptions] = runPostSyncCleanup.mock.calls.at(-1)
    expect(listings.size).toBe(0)
    expect(cleanupOptions.allEnabledServersProbed).toBe(false)
    expect(result.flatSyncResults).toBeUndefined()
    expect(docs('FlatMovies').map((d) => d._id)).toEqual(['orphan'])
    expect(docs('FlatTVShows')).toHaveLength(0)
    expect(appliedRecord()).toMatchObject({ state: 'running' })
  })
})

// ---------------------------------------------------------------- the pool

describe('the HTTP limiter', () => {
  const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')

  it('is not held by the caller of a file fetch: the fetch takes its own slot', async () => {
    // A caller that held a ResourceManager slot around fetchMetadataMultiServer
    // would wait for a second slot while holding one: with every slot held that
    // way, the pass would never finish.
    const fetchFile = fetchMetadataMultiServer.getMockImplementation()
    const heldByCaller = []
    fetchMetadataMultiServer.mockImplementation(async (...args) => {
      heldByCaller.push(ResourceManager.getInstance().getStats().activeHttpRequests)
      return fetchFile(...args)
    })
    // The asset step cannot read the movie's poster blurhash, so the blurhash
    // step fetches it; the show, its season and its episode publish one too.
    const { httpGet } = require('@src/lib/httpHelper')
    httpGet.mockRejectedValueOnce(new Error('timeout of 3000ms exceeded'))
    const show = showPayload([1])
    show.posterBlurhash = `${SHOW_ROOT}/show_poster.jpg.blurhash`
    show.seasons['Season 1'].seasonPosterBlurhash = `${SEASON_FOLDER}/season_poster.jpg.blurhash`
    show.seasons['Season 1'].episodes[key(1)].thumbnailBlurhash = `${SEASON_FOLDER}/1 - Thumbnail.jpg.blurhash`
    fetchMetadataMultiServer.mockClear()
    try {
      const result = await runSync(oneServer({ tv: { [SHOW]: show } }))

      expect(result.errors).toEqual([])
      const fetched = fetchMetadataMultiServer.mock.calls.map(([, url, type]) => `${type} ${url}`)
      // The metadata of the movie, the show and the episode; the blurhashes of
      // the movie's poster, the show's poster, the season's and the episode's
      expect(fetched).toHaveLength(7)
      expect(fetched.filter((call) => call.startsWith('blurhash '))).toHaveLength(4)
      expect(fetched).toContain(`blurhash ${moviePayload().urls.posterBlurhash}`)
      expect(heldByCaller).toEqual(Array(7).fill(0))
    } finally {
      fetchMetadataMultiServer.mockImplementation(fetchFile)
    }
  })
})

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
