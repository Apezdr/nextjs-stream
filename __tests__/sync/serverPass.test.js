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
jest.mock('@src/utils/fetchAllServerData', () => ({ fetchAllServerData: jest.fn() }))
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
// What the new-content job hands over for delivery
jest.mock('@src/utils/notifications/MediaNotificationOrchestrator', () => ({
  MediaNotificationOrchestrator: {
    announceNewContent: jest.fn(async (newContent) => {
      mockSideJobs.push({
        job: 'notifications',
        movies: newContent.movies.map((m) => m.originalTitle),
        episodes: newContent.episodes.map((e) => `${e.originalTitle} S${e.seasonNumber}E${e.episodeNumber}`),
      })
      return { summary: { totalGenerated: 1 } }
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
const { buildFieldAvailability } = require('@src/utils/sync/run/availability')
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

// A title that first reached the library an hour ago (the processor's
// first-seen date), and that a list shows: the movie is served through the
// transcoder (its .mkv alone is hidden), like the episodes.
const HOUR = 60 * 60 * 1000
const recently = () => new Date(Date.now() - HOUR).toISOString()
const recentMovie = (firstSeen = recently()) => {
  const movie = moviePayload()
  return {
    ...movie,
    mediaIdentity: { ...movie.mediaIdentity, firstSeen },
    urls: { ...movie.urls, jitEligible: true, jitUrl: 'https://jit.example/stream/movie/master.m3u8' },
  }
}
/** A show whose episodes `recent` first reached the library an hour ago; the rest in 2024. */
const showWithRecent = (episodes, recent) => {
  const show = showPayload(episodes)
  for (const n of recent) {
    show.seasons['Season 1'].episodes[key(n)].mediaIdentity.firstSeen = recently()
  }
  return show
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

async function runSync(fileServers, { availabilityOf = fileServers, ...options } = {}) {
  const fieldAvailability = await buildFieldAvailability(availabilityOf)
  const result = await syncAllServers(fileServers, fieldAvailability, {
    allEnabledServersProbed: true,
    payloadETags: ETAGS,
    ...options,
  })
  await settled()
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
  // Each case gets an adapter over its own collections, and its own
  // watch-history validation schedule.
  delete globalThis.__syncDatabaseAdapter
  delete globalThis.__watchHistoryValidationState
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

describe('the title hashes a pass fetches from the server’s Node.js API: the movies’ only', () => {
  const NODE = 'https://default-node.example'
  const MOVIE_HASH = 'movie-metadata-hash-1'
  const SHOW_HASH = 'show-hash-1'
  const SHOW_CONTENT_HASH = 'show-content-hash-1'
  const answer = (body) => ({ ok: true, status: 200, json: async () => body })
  const entry = (hash, extra = {}) => ({ hash, lastModified: '2024-01-01T00:00:00.000Z', generated: '2024-01-01T00:00:00.000Z', ...extra })

  // Each list answers only at its own URL, so a pass that asked for the
  // movies' list at the TV URL gets the show's titles, which do not name the
  // movie. The TV list is served, as the processor serves it, and never asked
  // for: nothing reads it.
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

  const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
  const movieMetadataFetches = () =>
    fetchMetadataMultiServer.mock.calls.filter(([, url, type]) => type === 'file' && url === moviePayload().urls.metadata)
      .length

  beforeEach(() => {
    global.fetch = hashEndpoints()
    fetchMetadataMultiServer.mockClear()
  })

  it('asks the server’s Node.js URL for the movie list once, and never for the TV list', async () => {
    await runSync(oneServer())

    const asked = global.fetch.mock.calls.map(([url]) => url).filter((url) => url.includes('/api/metadata-hashes/'))
    expect(asked).toEqual([`${NODE}/api/metadata-hashes/movies`])
  })

  it('hands the movie list to the metadata step: a hash that matches the stored one skips the metadata fetch', async () => {
    await runSync(oneServer())
    const [movie] = docs('FlatMovies')
    expect(movie).toMatchObject({ metadataHash: MOVIE_HASH, metadataSource: 'default' })
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
    await runSync(twoServers({ [MOVIE]: recentMovie() }))

    expect(mockSideJobs).toEqual([
      { job: 'cleanup' },
      { job: 'migration' },
      { job: 'validation' },
      { job: 'notifications', movies: [MOVIE], episodes: [] },
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
  const notAnnounced = () => logLine('Notification processing completed')?.obj?.notAnnounced
  const LONG_AGO = '2024-01-01T00:00:00.000Z'

  it('announce the movie and the episodes that first reached the library within the day', async () => {
    await runSync(oneServer({ movies: { [MOVIE]: recentMovie() }, tv: { [SHOW]: showWithRecent([1, 2, 3], [2, 3]) } }))

    expect(announced()).toEqual([
      { job: 'notifications', movies: [MOVIE], episodes: [`${SHOW} S1E2`, `${SHOW} S1E3`] },
    ])
    expect(notAnnounced()).toEqual({ gone: 0, hidden: 0, arrivedBefore: 1, alreadyAnnounced: 0 })
  })

  it('announce nothing on a first sync of a library whose titles arrived long ago', async () => {
    const result = await runSync(oneServer({ movies: { [MOVIE]: recentMovie(LONG_AGO) } }))

    // Every document is new to the database, none is new to the library
    expect(result.added).toEqual({ movies: 1, shows: 1, episodes: 2 })
    expect(announced()).toEqual([])
    expect(notAnnounced()).toEqual({ gone: 0, hidden: 0, arrivedBefore: 3, alreadyAnnounced: 0 })
  })

  it('announce nothing for a movie re-created after cleanup deleted it: it keeps the day it first arrived', async () => {
    const threeDaysAgo = new Date(Date.now() - 72 * HOUR).toISOString()
    await runSync(oneServer({ movies: { [MOVIE]: recentMovie(threeDaysAgo) }, tv: {} }))
    // Post-sync cleanup deletes the movie on a run no server had it ...
    docs('FlatMovies').length = 0
    mockSideJobs.length = 0
    mockLogLines.length = 0

    // ... and a later run creates it again, from the same identity sidecar
    const result = await runSync(oneServer({ movies: { [MOVIE]: recentMovie(threeDaysAgo) }, tv: {} }))

    expect(result.added.movies).toBe(1)
    expect(new Date(docs('FlatMovies')[0].initialDiscoveryDate).toISOString()).toBe(threeDaysAgo)
    expect(announced()).toEqual([])
    expect(notAnnounced()).toMatchObject({ arrivedBefore: 1 })
  })

  it('announce a title once when it is deleted and re-created within the day it arrived', async () => {
    const arrived = recently()
    await runSync(oneServer({ movies: { [MOVIE]: recentMovie(arrived) }, tv: {} }))
    expect(announced()).toHaveLength(1)
    docs('FlatMovies').length = 0
    mockSideJobs.length = 0
    mockLogLines.length = 0

    const result = await runSync(oneServer({ movies: { [MOVIE]: recentMovie(arrived) }, tv: {} }))

    expect(result.added.movies).toBe(1)
    expect(announced()).toEqual([])
    expect(notAnnounced()).toMatchObject({ alreadyAnnounced: 1 })
  })

  it('announce no episode of a show re-created under a new _id, except the one new to the library', async () => {
    await runSync(oneServer({ movies: {}, tv: { [SHOW]: showPayload([1, 2]) } }))
    const [firstShow] = docs('FlatTVShows')
    // The show's document is deleted and its episodes are left pointing at it
    docs('FlatTVShows').length = 0
    mockSideJobs.length = 0
    mockLogLines.length = 0

    const result = await runSync(oneServer({ movies: {}, tv: { [SHOW]: showWithRecent([1, 2, 3], [3]) } }))

    // A new show document, and every episode inserted again under it
    expect(docs('FlatTVShows')[0]._id).not.toBe(firstShow._id)
    expect(result.added).toEqual({ movies: 0, shows: 1, episodes: 3 })
    expect(announced()).toEqual([{ job: 'notifications', movies: [], episodes: [`${SHOW} S1E3`] }])
    expect(notAnnounced()).toMatchObject({ arrivedBefore: 2 })
  })

  it('announce a title two servers add in the same run once', async () => {
    await runSync({
      ...oneServer({ movies: { [MOVIE]: recentMovie() }, tv: {} }),
      server2: { config: config('server2'), movies: { [MOVIE]: recentMovie() }, tv: {} },
    })

    expect(announced()).toEqual([{ job: 'notifications', movies: [MOVIE], episodes: [] }])
  })

  it('announce nothing a list would not show', async () => {
    // A .mkv the browser cannot play, and no transcoder
    const movie = moviePayload()
    movie.mediaIdentity = { ...movie.mediaIdentity, firstSeen: recently() }

    await runSync(oneServer({ movies: { [MOVIE]: movie }, tv: {} }))

    expect(announced()).toEqual([])
    expect(notAnnounced()).toMatchObject({ hidden: 1 })
  })

  it('announce nothing post-sync cleanup deleted in the same run', async () => {
    runPostSyncCleanup.mockImplementationOnce(async () => {
      mockSideJobs.push({ job: 'cleanup' })
      docs('FlatMovies').length = 0
      return {}
    })

    await runSync(oneServer({ movies: { [MOVIE]: recentMovie() }, tv: {} }))

    expect(announced()).toEqual([])
    expect(notAnnounced()).toMatchObject({ gone: 1 })
  })

  it('announce nothing on a run that only updated what was there', async () => {
    MediaNotificationOrchestrator.announceNewContent.mockClear()
    await runSync(oneServer({ movies: { [MOVIE]: recentMovie() }, tv: {} }))
    mockSideJobs.length = 0

    await runSync(oneServer({ movies: { [MOVIE]: recentMovie() }, tv: {} }), { forceSync: true })

    expect(announced()).toEqual([])
    expect(MediaNotificationOrchestrator.announceNewContent).toHaveBeenCalledTimes(1)
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
    jest.spyOn(MovieSyncService.prototype, 'syncMovie').mockImplementation(function (title, context, ...rest) {
      seen.push(context.serverConfig)
      return syncMovie.call(this, title, context, ...rest)
    })
    jest.spyOn(TVShowSyncService.prototype, 'syncTVShow').mockImplementation(function (title, context) {
      seen.push(context.serverConfig)
      return syncTVShow.call(this, title, context)
    })

    const result = await runSync(oneServer({ priority: 3 }))

    expect(result.errors).toEqual([])
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
    expect(seen[0]).toEqual({
      id: 'default',
      priority: 3,
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
    expect(mockSideJobs).toEqual([{ job: 'cleanup' }, { job: 'migration' }, { job: 'validation' }])
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
    // The run's own jobs still run, and the failure keeps the pass from being recorded
    expect(mockSideJobs.map((s) => s.job)).toEqual(['cleanup', 'migration', 'validation'])
    expect(appliedRecord()).toMatchObject({ state: 'running' })
  })

  it('a pass that throws after its movies has already handed the run what it wrote', async () => {
    // The TV payload cannot even be listed: the pass throws between its movies
    // and its shows, out of reach of the per-title catch.
    const unreadable = new Proxy({}, {
      ownKeys() {
        throw new Error('TV payload unreadable')
      },
    })
    const movie = recentMovie()
    const fileServers = oneServer({ movies: { [MOVIE]: movie }, tv: unreadable })

    const result = await runSync(fileServers, { availabilityOf: oneServer({ movies: { [MOVIE]: movie }, tv: {} }) })

    expect(result.errors).toEqual([expect.objectContaining({ serverId: 'default', error: 'TV payload unreadable' })])
    expect(result.flatSyncResults?.default).toBeUndefined()
    expect(docs('FlatMovies')).toHaveLength(1)
    // The admins' count, the cache invalidation and the new-content notice all
    // still have the movie the pass wrote before it threw
    expect(result.added).toEqual({ movies: 1, shows: 0, episodes: 0 })
    expect(result.changedMedia.movies).toContain('Example Movie')
    expect(mockSideJobs).toContainEqual({ job: 'notifications', movies: [MOVIE], episodes: [] })
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
