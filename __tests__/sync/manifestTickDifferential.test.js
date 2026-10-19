/**
 * @jest-environment node
 *
 * The differential of WP T4b: the manifest tick against a pass over every
 * title, on the same libraries and the same changes.
 *
 * Two worlds, each with its own database, file servers and tick state, run the
 * real sync end to end (fetchSyncTick, syncAllServers with the real services,
 * pre-tag, post-sync cleanup and the record) over the same sequence of library
 * changes:
 *
 *   - reference: every tick is started from the admin UI, so it passes over
 *     every title (an `all` tick), as every sync did before manifests;
 *   - candidate: every tick is a webhook tick: skipped, or passing over only
 *     the titles run/selectTitles picks.
 *
 * After each tick both databases must hold the same documents (ids mapped to
 * keys, write times and run ids left out), the same gates, and the same
 * deletes; and the candidate must parse no more bytes than the reference.
 */

process.env.SYNC_FK_ORPHAN_CHECK = 'false'
process.env.SYNC_MAX_ORPHAN_FRACTION = '1'

const { createMemoryMongo } = require('../helpers/memoryMongo')
const { createFakeProcessor } = require('../helpers/fakeProcessor')

/** The world a tick runs in: its database, file servers, tick state and byte counts. */
let mockWorld = null
let mockServers = []
/** A message the TV phase of the named server's pass throws with (a pass that throws after writing its movies). */
let mockThrowTvPhaseOf = null
let mockPassingServer = null
/** Parts of file-server URLs whose fetch fails (a metadata file that cannot be read). */
const mockFailUrls = new Set()

jest.mock('@src/lib/mongodb', () => {
  const route = (dbName, name) =>
    new Proxy({}, {
      get(_target, prop) {
        const collection = mockWorld.mongo.collection(dbName, name)
        const value = collection[prop]
        return typeof value === 'function' ? value.bind(collection) : value
      },
    })
  const client = { db: (dbName) => ({ collection: (name) => route(dbName, name) }) }
  return { __esModule: true, default: Promise.resolve(client), getSyncClientPromise: async () => client }
})
jest.mock('@src/utils/config', () => ({
  getAllServers: () => mockServers,
  getServer: (id) => mockServers.find((server) => server.id === id),
  multiServerHandler: { getHandler: (id) => ({ createFullURL: (path) => `https://${id}.example${path}` }) },
}))
jest.mock('@src/utils/sync/run/manifestSource', () => ({
  ...jest.requireActual('@src/utils/sync/run/manifestSource'),
  fetchManifest: async (...args) => {
    const answer = await mockWorld.processor.fetchManifest(...args)
    if (answer.ok) mockWorld.bytes.manifests += answer.parsed
    return answer
  },
  fetchEntries: async (...args) => {
    const answer = await mockWorld.processor.fetchEntries(...args)
    if (answer.ok) mockWorld.bytes.entries += answer.parsed
    return answer
  },
}))
jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: {
    getInstance: () => ({ config: { syncConcurrency: 1, httpConcurrency: 1 }, dbWriteLimitFor: () => (fn) => fn() }),
  },
  getResourceManager: () => ({}),
}))
jest.mock('p-limit', () => () => (fn) => fn())
jest.mock('chalk', () => {
  const paint = new Proxy((text) => text, { get: () => paint })
  return { __esModule: true, default: paint }
})
jest.mock('@src/lib/logger', () => ({
  createLogger: (component) => {
    if (component === 'FlatSync.NewArch.TV' && mockThrowTvPhaseOf && mockThrowTvPhaseOf === mockPassingServer) {
      throw new Error('TV phase failed')
    }
    return {
      // Which server's pass is running (runServerPass logs it first)
      info: (obj, msg) => {
        if (msg === 'Starting NEW architecture sync') mockPassingServer = obj?.serverId ?? null
      },
      warn: () => {},
      error: () => {},
      debug: () => {},
    }
  },
  logError: () => {},
}))
jest.mock('@opentelemetry/api', () => {
  const span = new Proxy({}, { get: () => () => {} })
  return { trace: { getTracer: () => ({ startActiveSpan: (_name, fn) => fn(span) }) } }
})
jest.mock('@src/lib/redisClient', () => ({ getRedisClient: async () => null }))
jest.mock('@src/utils/cache/postSyncRevalidation', () => ({ requestMediaRevalidation: jest.fn(async () => {}) }))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn(async (url) => ({ data: `blurhash-of:${url}`, headers: {} })) }))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: (url) => `nid:${url}` }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({
  fetchMetadataMultiServer: jest.fn(async (serverId, url, type) => {
    if (!url) return {}
    if ([...mockFailUrls].some((part) => url.includes(part))) throw new Error(`fetch failed: ${url}`)
    if (type === 'blurhash') return `blurhash-of:${url}`
    const episode = url.match(/E(\d+)_metadata/)
    if (episode) return { episode_number: Number(episode[1]), name: `Episode ${Number(episode[1])}` }
    const folder = decodeURIComponent(url.split('/')[2] || '')
    if (url.startsWith('/tv/')) {
      return { id: folder.length, name: `Show ${folder}`, seasons: [{ season_number: 1, name: 'Season One', episode_count: 9 }] }
    }
    return { id: folder.length, title: `Movie ${folder}`, overview: 'x' }
  }),
}))
jest.mock('@src/utils/notifications/MediaNotificationOrchestrator', () => ({ MediaNotificationOrchestrator: {} }))
jest.mock('@src/utils/sync/run/newContent', () => ({ announceNewContent: jest.fn(async () => ({})) }))
jest.mock('@src/utils/sync/run/dropTitleHashes', () => ({ dropTitleHashesOnce: jest.fn(async () => ({ applied: false })) }))
jest.mock('@src/utils/watchHistory/migrate', () => ({ migratePlaybackStatusIfNeeded: jest.fn(async () => {}) }))
jest.mock('@src/utils/sync/run/validateWatchHistory', () => ({
  validateWatchHistory: jest.fn(async () => ({})),
  validateWatchHistoryIfDue: jest.fn(async () => null),
}))

const { fetchSyncTick, syncAllServers } = require('@src/utils/sync/run/syncAllServers')
const { getSyncLockHolder, releaseSyncLock } = require('@src/utils/sync/run/runState')

const realFetch = global.fetch
// Each case takes a few seconds of real time; more under a loaded full run
jest.setTimeout(120_000)

// ---------------------------------------------------------------- libraries

const enc = encodeURIComponent
const pad = (n) => String(n).padStart(2, '0')

/** A movie entry; `v` is its version (a re-encode, a new poster, HDR, ...). */
function movie(title, v = 1) {
  const folder = `/movies/${enc(title)}`
  return {
    _id: `uuid-${title}`,
    mediaIdentity: { id: `mid:${title}`, scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
    fileNames: [`${title}.mkv`, 'metadata.json'],
    length: { [`${title}.mkv`]: 6000000 + v },
    dimensions: { [`${title}.mkv`]: v % 2 ? '1920x1080' : '3840x2160' },
    urls: {
      mp4: `${folder}/${enc(title)}.v${v}.mkv`,
      mediaLastModified: `2024-01-0${(v % 9) + 1}T00:00:00.000Z`,
      metadata: `${folder}/metadata.json?hash=d${v}`,
      poster: `${folder}/poster.jpg?hash=p${v}`,
      posterBlurhash: `${folder}/poster.jpg.blurhash`,
      jitEligible: true,
      jitUrl: `https://jit.example/stream/${enc(title)}/v${v}/master.m3u8`,
    },
    hdr: v % 3 === 0 ? 'HDR10' : null,
    mediaQuality: null,
    additional_metadata: { duration: 6000000 + v, dimensions: '1920x1080', size: { gb: 4 } },
  }
}

/** An episode entry of a show's season 1. */
function episode(title, n, v = 1) {
  const folder = `/tv/${enc(title)}/Season%201`
  const file = `${folder}/${enc(`${title} - S01E${pad(n)}.v${v}.mkv`)}`
  return {
    _id: `uuid-${title}-${n}`,
    videoURL: file,
    sources: [{ url: file, container: 'mkv', isPrimary: true }],
    jitEligible: true,
    jitUrl: `https://jit.example/stream/${enc(title)}/e${n}/v${v}/master.m3u8`,
    mediaLastModified: `2024-01-0${(v % 9) + 1}T00:00:00.000Z`,
    hdr: null,
    episodeNumber: n,
    thumbnail: `${folder}/${n} - Thumbnail.jpg?hash=t${v}`,
    metadata: `${folder}/E${pad(n)}_metadata.json?hash=m${v}`,
    mediaIdentity: { id: `mid:${title}:e${n}`, scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
  }
}

/** A show entry; `episodes` maps an episode number to its version. */
function show(title, episodes, v = 1) {
  const root = `/tv/${enc(title)}`
  const numbers = Object.keys(episodes).map(Number)
  return {
    metadata: `${root}/metadata.json?hash=s${v}`,
    poster: `${root}/show_poster.jpg?hash=p${v}`,
    posterBlurhash: null,
    logo: v % 2 ? '' : `${root}/logo.png?hash=l${v}`,
    backdrop: null,
    mediaIdentity: { id: `mid:${title}`, scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
    seasons: {
      'Season 1': {
        seasonNumber: 1,
        season_poster: `${root}/Season%201/season_poster.jpg?hash=sp${v}`,
        episodes: Object.fromEntries(numbers.map((n) => [`S01E${pad(n)}`, episode(title, n, episodes[n])])),
        lengths: Object.fromEntries(numbers.map((n) => [`S01E${pad(n)}`, 2880000 + n * 10 + episodes[n]])),
        dimensions: Object.fromEntries(numbers.map((n) => [`S01E${pad(n)}`, '1920x1080'])),
      },
    },
  }
}

/** Set `key` as an own property, whatever its name (`__proto__` included). */
function put(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true })
}

// ---------------------------------------------------------------- worlds

const FLAT = ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']
/** Fields that record when, or by which run, a document was written: they differ between worlds by design. */
const VOLATILE = new Set(['_id', 'createdAt', 'updatedAt', 'lastSynced', 'syncRunId', 'initialDiscoveryDate'])

function createWorld(name) {
  return { name, mongo: createMemoryMongo(), processor: createFakeProcessor(), state: null, bytes: { manifests: 0, entries: 0 } }
}

/** Serve `library` (server id to {movies, tv}) from the world's file servers, with the given failures. */
function serve(world, library, { down = [], notFound = [], format = {}, entriesFail = [], beforeEntries = {} } = {}) {
  for (const { id } of mockServers) {
    const served = world.processor.serve(id, JSON.parse(JSON.stringify(library[id] ?? {})))
    served.down = down.includes(id)
    served.notFound = notFound.includes(id)
    served.format = format[id] ?? 2
    served.entriesFail = entriesFail.includes(id)
    served.beforeEntries = beforeEntries[id] ?? null
  }
}

/** The ids of a world's shows and seasons (deleted ones included), as natural keys. */
function keysOf(world) {
  const col = (name) => world.mongo.collection('Media', name)
  const all = (name) => [...col(name).docs, ...col(name).deleted]
  const shows = new Map(all('FlatTVShows').map((d) => [String(d._id), d.originalTitle]))
  const seasons = new Map(all('FlatSeasons').map((d) => [String(d._id), `${shows.get(String(d.showId))}|${d.seasonNumber}`]))
  const keyOf = (name, d) => {
    if (name === 'FlatMovies' || name === 'FlatTVShows') return d.originalTitle
    if (name === 'FlatSeasons') return `${shows.get(String(d.showId))}|${d.seasonNumber}`
    return `${shows.get(String(d.showId))}|${d.seasonNumber}|${d.episodeNumber}`
  }
  return { shows, seasons, keyOf }
}

/** Every Flat* document, by natural key, without what differs between worlds by design. */
function snapshot(world) {
  const { shows, seasons, keyOf } = keysOf(world)
  const out = {}
  for (const name of FLAT) {
    out[name] = new Map()
    for (const doc of world.mongo.collection('Media', name).docs) {
      const norm = {}
      for (const [field, value] of Object.entries(doc)) {
        if (VOLATILE.has(field)) continue
        norm[field] = field === 'showId' ? shows.get(String(value)) : field === 'seasonId' ? seasons.get(String(value)) : value
      }
      out[name].set(keyOf(name, doc), norm)
    }
  }
  return out
}

const short = (value) => {
  const text = JSON.stringify(value)
  return text === undefined ? 'undefined' : text.length > 120 ? `${text.slice(0, 117)}...` : text
}

/** What differs between two snapshots, one short line per field (never whole documents). */
function differences(reference, candidate) {
  const out = []
  for (const name of FLAT) {
    const keys = new Set([...reference[name].keys(), ...candidate[name].keys()])
    for (const key of [...keys].sort()) {
      const a = reference[name].get(key)
      const b = candidate[name].get(key)
      if (!a || !b) {
        out.push(`${name} ${key}: ${a ? 'only in reference' : 'only in candidate'}`)
        continue
      }
      for (const field of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (JSON.stringify(a[field]) !== JSON.stringify(b[field])) {
          out.push(`${name} ${key} .${field}: reference ${short(a[field])} candidate ${short(b[field])}`)
        }
      }
    }
  }
  return out
}

/** One tick in one world. */
async function tick(world, { allowSkip }) {
  mockWorld = world
  globalThis.__syncTickState = world.state
  world.bytes = { manifests: 0, entries: 0 }
  world.processor.calls.entries.length = 0
  const deletedBefore = Object.fromEntries(FLAT.map((name) => [name, world.mongo.collection('Media', name).deleted.length]))
  try {
    const probed = await fetchSyncTick({ allowSkip })
    let result = null
    if (!probed.skipped) {
      result = await syncAllServers(probed, {})
      for (let i = 0; i < 5000 && getSyncLockHolder(); i++) await new Promise((resolve) => setImmediate(resolve))
      if (getSyncLockHolder()) throw new Error(`${world.name}: the run did not settle`)
    }
    const { keyOf } = keysOf(world)
    const deleted = FLAT.flatMap((name) =>
      world.mongo.collection('Media', name).deleted.slice(deletedBefore[name]).map((d) => `${name} ${keyOf(name, d)}`)
    ).sort()
    return {
      skipped: probed.skipped,
      mode: probed.mode,
      reason: probed.reason,
      result,
      deleted,
      bytes: { ...world.bytes },
      entries: world.processor.calls.entries.map(({ server, kind, request }) => [server, kind, request]),
    }
  } finally {
    world.state = globalThis.__syncTickState ?? null
    // The next run starts strictly after this one's writes (cleanup's updatedAt backstop)
    await new Promise((resolve) => setTimeout(resolve, 3))
  }
}

const changed = (result) =>
  result ? Object.fromEntries(Object.entries(result.changedMedia).map(([kind, titles]) => [kind, [...new Set(titles)].sort()])) : null
const noChanges = { movies: [], shows: [], seasons: [], episodes: [] }

// ---------------------------------------------------------------- the two worlds, tick by tick

const SHOW_ONE = 'Show One (2010)'
const SHOW_TWO = 'Show Two (2011)'

function initialLibrary() {
  const A = { movies: {}, tv: {} }
  const B = { movies: {}, tv: {} }
  const C = { movies: {}, tv: {} }
  for (const title of ['Alpha (2001)', 'Beta (2002)', 'Gamma (2003)', 'Delta (2004)', 'Epsilon (2005)', 'Zeta (2006)']) {
    A.movies[title] = movie(title)
  }
  put(A.movies, '__proto__', movie('__proto__'))
  A.movies['1234'] = movie('1234')
  // A folder named `version` is a title like any other, beside an integer-like one
  A.movies.version = movie('version')
  A.tv[SHOW_ONE] = show(SHOW_ONE, { 1: 1, 2: 1 })
  A.tv[SHOW_TWO] = show(SHOW_TWO, { 1: 1, 2: 1, 3: 1 })
  B.movies['Alpha (2001)'] = movie('Alpha (2001)', 2)
  B.movies['Beta (2002)'] = movie('Beta (2002)')
  B.movies['Eta (2007)'] = movie('Eta (2007)')
  B.tv[SHOW_ONE] = show(SHOW_ONE, { 1: 1, 2: 2, 3: 1 }, 2)
  C.movies['Theta (2008)'] = movie('Theta (2008)')
  C.tv['Show Three (2012)'] = show('Show Three (2012)', { 1: 1 })
  return { A, B, C }
}

/**
 * Both worlds, driven together: `step(change)` applies a change to the shared
 * library (and anything else both worlds must see), serves it, runs one tick in
 * each world and compares them.
 */
function createPair() {
  const reference = createWorld('reference')
  const candidate = createWorld('candidate')
  const library = initialLibrary()
  const log = []
  return {
    reference,
    candidate,
    library,
    log,
    /** Apply `change` to both worlds' databases (an admin edit, an out-of-band delete). */
    inBoth(change) {
      for (const world of [reference, candidate]) change(world.mongo.collection.bind(null, 'Media'), world)
    },
    async step(label, { failures = {}, throwTvPhaseOf = null, compare = true } = {}) {
      const ticks = {}
      // The candidate first: an entries route that fails can only fail a request
      // that is made, and the candidate asks a server for entries only when it
      // selected something there (design D6: a server that answered its
      // manifests and was asked for nothing answered). So the reference sees the
      // failure only where the candidate did.
      for (const world of [candidate, reference]) {
        const asked = (id) => ticks.candidate.entries.some(([server]) => server === id)
        const served = world === candidate ? failures : { ...failures, entriesFail: (failures.entriesFail ?? []).filter(asked) }
        serve(world, library, served)
        mockThrowTvPhaseOf = throwTvPhaseOf
        try {
          ticks[world.name] = await tick(world, { allowSkip: world === candidate })
        } finally {
          mockThrowTvPhaseOf = null
        }
      }
      const ref = ticks.reference
      const cand = ticks.candidate
      const entry = {
        label,
        mode: cand.skipped ? 'skip' : cand.mode,
        reason: cand.reason,
        differences: compare ? differences(snapshot(reference), snapshot(candidate)) : [],
        deleted: { reference: ref.deleted, candidate: cand.deleted },
        changed: { reference: changed(ref.result), candidate: cand.skipped ? noChanges : changed(cand.result) },
        bytes: { reference: ref.bytes, candidate: cand.bytes },
        entries: cand.entries,
        candidate: cand,
      }
      log.push(entry)
      return entry
    },
  }
}

/** A skipped tick: no entry asked for, nothing parsed (every manifest answered 304). */
function expectSkipped(entry) {
  expect([entry.mode, entry.reason, entry.entries, entry.bytes.candidate]).toEqual(['skip', undefined, [], { manifests: 0, entries: 0 }])
}

/**
 * A tick's comparison: no field differs, the same deletes and changes, no
 * more bytes parsed. `since`: earlier ticks this one is compared through (their
 * deletes and changes count with this one's).
 */
function expectSame(entry, since = []) {
  expect({ label: entry.label, differences: entry.differences }).toEqual({ label: entry.label, differences: [] })
  const stretch = [...since, entry]
  const merge = (key, world) => {
    if (key === 'deleted') return stretch.flatMap((e) => e.deleted[world]).sort()
    return Object.fromEntries(
      Object.keys(noChanges).map((kind) => [kind, [...new Set(stretch.flatMap((e) => e.changed[world][kind]))].sort()])
    )
  }
  expect(merge('deleted', 'candidate')).toEqual(merge('deleted', 'reference'))
  expect(merge('changed', 'candidate')).toEqual(merge('changed', 'reference'))
  const parsed = (bytes) => bytes.manifests + bytes.entries
  expect(parsed(entry.bytes.candidate)).toBeLessThanOrEqual(parsed(entry.bytes.reference))
}

beforeEach(() => {
  mockServers = [
    { id: 'A', priority: 1, baseURL: 'https://A.example', prefixPath: '', syncEndpoint: 'https://A-node.example' },
    { id: 'B', priority: 2, baseURL: 'https://B.example', prefixPath: '', syncEndpoint: 'https://B-node.example' },
    { id: 'C', priority: 3, baseURL: 'https://C.example', prefixPath: '', syncEndpoint: 'https://C-node.example' },
  ]
  delete globalThis.__syncDatabaseAdapter
  // No request leaves a pass here: anything fetched answers 404
  global.fetch = jest.fn(async () => ({ ok: false, status: 404 }))
  for (const method of ['log', 'info', 'warn', 'error', 'debug']) jest.spyOn(console, method).mockImplementation(() => {})
})

afterEach(() => {
  // A case that failed part way must not leave its run holding the lock
  const holder = getSyncLockHolder()
  if (holder) releaseSyncLock(holder.syncRunId)
  global.fetch = realFetch
  jest.restoreAllMocks()
})

describe('the scripted sequence', () => {
  it('writes, gates and deletes what a pass over every title does, tick after tick, parsing less', async () => {
    const pair = createPair()
    const { library } = pair

    // 1. The first tick of the process: every title, in both worlds
    let entry = await pair.step('first tick')
    expect(entry.mode).toBe('all')
    expectSame(entry)
    expect(pair.reference.mongo.collection('Media', 'FlatMovies').docs.map((d) => d.originalTitle)).toContain('__proto__')
    expect(pair.reference.mongo.collection('Media', 'FlatMovies').docs.map((d) => d.originalTitle)).toEqual(expect.arrayContaining(['version', '1234']))
    // (New shows have no document when pre-tag runs, so that pass is not
    // recorded complete, and the next tick runs, as it always did)
    entry = await pair.step('second tick')
    expect([entry.mode, entry.reason]).toEqual(['select', 'the last pass is still running or did not complete'])
    expectSame(entry)

    // 2. Nothing changed. A movie only one of the three servers has lacks the
    //    others' gates, but they do not list it, so those gates are not open:
    //    the tick is skipped, and no entry is asked for
    entry = await pair.step('no change')
    expectSkipped(entry)
    expectSame(entry)
    expect(entry.changed.reference).toEqual(noChanges)

    // 3. One title changed on one of three servers: only its entry is parsed,
    //    plus the one manifest that changed (the done-when)
    library.A.movies['Gamma (2003)'] = movie('Gamma (2003)', 2)
    entry = await pair.step('one title changed on one server')
    expect(entry.mode).toBe('select')
    expectSame(entry)
    expect(entry.entries).toEqual([['A', 'movies', { titles: ['Gamma (2003)'] }]])
    const gammaManifest = Buffer.byteLength(pair.candidate.processor.manifestOf('A', 'movies').body)
    const gammaLine = Buffer.byteLength(JSON.stringify({ title: 'Gamma (2003)', hash: 'x'.repeat(16), entry: library.A.movies['Gamma (2003)'] }))
    const endLine = Buffer.byteLength('{"end":true,"count":1}')
    expect(entry.bytes.candidate).toEqual({ manifests: gammaManifest, entries: gammaLine + endLine })

    // 4. A title two servers list changed on one: both servers' entries are asked for
    library.B.movies['Alpha (2001)'] = movie('Alpha (2001)', 3)
    entry = await pair.step('a two-server title changed on one server')
    expectSame(entry)
    // (Gamma, changed last tick, is asked for again: its new poster's blurhash
    // waited a pass, so its gate stayed open, R3, and a full pass redoes it too)
    expect(entry.entries.find(([id, kind]) => id === 'B' && kind === 'movies')).toEqual(['B', 'movies', { titles: ['Alpha (2001)'] }])
    expect(entry.entries.find(([id, kind]) => id === 'A' && kind === 'movies')[2].titles).toContain('Alpha (2001)')

    // 5. An episode of a show two servers list
    library.B.tv[SHOW_ONE] = show(SHOW_ONE, { 1: 1, 2: 3, 3: 1 }, 2)
    entry = await pair.step('an episode changed on the second server')
    expectSame(entry)

    // 6. A title one of its two servers removed (ownership moves)
    delete library.B.movies['Beta (2002)']
    entry = await pair.step('removed from one of two servers')
    expectSame(entry)

    // 7. A title removed everywhere: post-sync cleanup deletes it in both
    delete library.A.movies['Epsilon (2005)']
    entry = await pair.step('removed everywhere')
    expectSame(entry)
    expect(entry.deleted.candidate).toEqual(['FlatMovies Epsilon (2005)'])

    // 8. A server down for a tick, then back: no deletes while it is down
    entry = await pair.step('server C down', { failures: { down: ['C'] } })
    expectSame(entry)
    expect(entry.deleted.candidate).toEqual([])
    entry = await pair.step('server C back')
    expectSame(entry)

    // 9. An admin edit removes a movie's gates: the candidate passes over it again
    pair.inBoth((col) => {
      const doc = col('FlatMovies').docs.find((d) => d.originalTitle === 'Delta (2004)')
      delete doc.syncGates
    })
    entry = await pair.step('an admin edit')
    expect(entry.mode).toBe('select')
    expectSame(entry)

    // 10. An episode deleted outside the sync, nothing forgotten: the drift rule re-creates it
    pair.inBoth((col) => {
      const showDoc = col('FlatTVShows').docs.find((d) => d.originalTitle === SHOW_TWO)
      const episodes = col('FlatEpisodes')
      episodes.docs = episodes.docs.filter((d) => !(String(d.showId) === String(showDoc._id) && d.episodeNumber === 3))
    })
    entry = await pair.step('an episode deleted out of band')
    expectSame(entry)
    expect(pair.candidate.mongo.collection('Media', 'FlatEpisodes').docs.length).toBe(
      pair.reference.mongo.collection('Media', 'FlatEpisodes').docs.length
    )

    // 11. Nothing changed again: skipped again
    entry = await pair.step('quiet again')
    expectSkipped(entry)
    expectSame(entry)

  })
})

/** Ticks, modes and bytes over a log, for the report. */
function summarize(log) {
  const modes = {}
  let referenceBytes = 0
  let candidateBytes = 0
  let mismatches = 0
  for (const entry of log) {
    modes[entry.mode] = (modes[entry.mode] || 0) + 1
    referenceBytes += entry.bytes.reference.manifests + entry.bytes.reference.entries
    candidateBytes += entry.bytes.candidate.manifests + entry.bytes.candidate.entries
    if (entry.differences.length > 0) mismatches += 1
  }
  return { ticks: log.length, modes, mismatches, referenceBytes, candidateBytes }
}

describe('the cases the review named', () => {
  /** A pair past its first two ticks (the first leaves pre-tag incomplete: new shows). */
  async function settledPair() {
    const pair = createPair()
    expectSame(await pair.step('first tick'))
    expectSame(await pair.step('second tick'))
    return pair
  }

  it('the comparison can fail: a field changed in one world is reported, in one short line', async () => {
    const pair = await settledPair()
    const doc = pair.candidate.mongo.collection('Media', 'FlatMovies').docs.find((d) => d.originalTitle === 'Alpha (2001)')
    const saved = doc.hdr
    doc.hdr = 'Dolby Vision'
    expect(differences(snapshot(pair.reference), snapshot(pair.candidate))).toEqual([
      'FlatMovies Alpha (2001) .hdr: reference undefined candidate "Dolby Vision"',
    ])
    doc.hdr = saved
  })

  it('R-B: written at a new hash, the run fails, the server goes back to the old one: the title is passed over again', async () => {
    const pair = await settledPair()
    const { library } = pair
    const before = { zeta: library.A.movies['Zeta (2006)'], show: library.A.tv[SHOW_TWO] }

    // A movie and a show change on A; A's pass writes the movie, then throws
    // as its TV phase starts, so the show is never reported finished
    library.A.movies['Zeta (2006)'] = movie('Zeta (2006)', 2)
    library.A.tv[SHOW_TWO] = show(SHOW_TWO, { 1: 1, 2: 2, 3: 1 })
    let entry = await pair.step('changed, then the pass throws', { throwTvPhaseOf: 'A' })
    expectSame(entry)
    expect(entry.candidate.result.errors).toEqual([expect.objectContaining({ serverId: 'A', error: 'TV phase failed' })])

    // A show whose episode cannot be read: written in part, its pass failed
    mockFailUrls.add('E02_metadata.json?hash=m2')
    try {
      entry = await pair.step('the show fails part way')
      expectSame(entry)
    } finally {
      mockFailUrls.clear()
    }

    // Back at the old versions: both are selected and healed
    library.A.movies['Zeta (2006)'] = before.zeta
    library.A.tv[SHOW_TWO] = before.show
    entry = await pair.step('back at the old versions')
    expectSame(entry)
    const asked = entry.entries.flatMap(([, , request]) => request.titles ?? ['(all)'])
    expect(asked).toEqual(expect.arrayContaining(['Zeta (2006)', SHOW_TWO]))
    expectSame(await pair.step('settled'))
  })

  it('R-B: a running marker this process did not write (another process) makes the next tick pass over every title', async () => {
    const pair = await settledPair()
    pair.inBoth((_col, world) => {
      const syncInfo = world.mongo.collection('app_config', 'syncInfo')
      syncInfo.docs = syncInfo.docs.filter((d) => d._id !== 'appliedPayloads')
      syncInfo.docs.push({ _id: 'appliedPayloads', state: 'running', syncRunId: 'run-of-another-process' })
    })
    const entry = await pair.step('a marker from another process')
    expect([entry.mode, entry.reason]).toEqual(['all', expect.stringContaining('not the one this state saw')])
    expectSame(entry)
  })

  it('R-E: a library that moved between manifest and entries is adopted, and the new title follows a tick later', async () => {
    const pair = await settledPair()
    const { library } = pair
    library.A.movies['Beta (2002)'] = movie('Beta (2002)', 2)
    const addIota = (lib, kind) => {
      if (kind !== 'movies') return false
      lib.movies['Iota (2009)'] = movie('Iota (2009)')
    }
    let entry = await pair.step('moved during the tick', { failures: { beforeEntries: { A: addIota } } })
    expectSame(entry)
    expect(entry.candidate.result.errors).toEqual([])
    library.A.movies['Iota (2009)'] = movie('Iota (2009)')
    entry = await pair.step('the tick after')
    expectSame(entry)
    expect(pair.candidate.mongo.collection('Media', 'FlatMovies').docs.map((d) => d.originalTitle)).toContain('Iota (2009)')
  })

  it('R-E: a re-read in another format leaves the server out (no deletes); it is back a tick later', async () => {
    const pair = await settledPair()
    const { library } = pair
    library.A.movies['Beta (2002)'] = movie('Beta (2002)', 2)
    delete library.A.movies['Zeta (2006)']
    const toFormat3 = (lib, kind) => {
      if (kind !== 'movies') return false
      mockWorld.processor.server('A').format = 3
    }
    let entry = await pair.step('re-read in format 3', { failures: { beforeEntries: { A: toFormat3 } } })
    expectSame(entry)
    expect(entry.deleted.candidate).toEqual([])
    entry = await pair.step('format 2 again')
    expectSame(entry)
    expect(entry.deleted.candidate).toEqual(['FlatMovies Zeta (2006)'])
  })

  it('a server without manifests (404, or format 1) did not answer: no deletes, and nothing it lists changes hands on its account', async () => {
    const pair = await settledPair()
    delete pair.library.A.movies['Zeta (2006)']
    let entry = await pair.step('B answers 404', { failures: { notFound: ['B'] } })
    expectSame(entry)
    expect(entry.deleted.candidate).toEqual([])
    entry = await pair.step('B answers format 1', { failures: { format: { B: 1 } } })
    expectSame(entry)
    entry = await pair.step('B is back')
    expectSame(entry)
    expect(entry.deleted.candidate).toEqual(['FlatMovies Zeta (2006)'])
  })

  it('an entries request that fails leaves its server out, and the others are asked for what it shared', async () => {
    const pair = await settledPair()
    pair.library.B.movies['Alpha (2001)'] = movie('Alpha (2001)', 4)
    const entry = await pair.step('B entries fail', { failures: { entriesFail: ['B'] } })
    expectSame(entry)
    expectSame(await pair.step('B entries back'))
  })
})

describe('a folder named `version`', () => {
  async function settledPair() {
    const pair = createPair()
    expectSame(await pair.step('first tick'))
    expectSame(await pair.step('second tick'))
    return pair
  }
  const titles = (world, name) => world.mongo.collection('Media', name).docs.map((d) => d.originalTitle)

  it('is selected, fetched, listed, pre-tagged and synced like any other movie, and deleted when it goes', async () => {
    const pair = await settledPair()
    expect(titles(pair.candidate, 'FlatMovies')).toEqual(expect.arrayContaining(['version', '1234']))

    // A new file: only its entry is asked for, and the pass writes it
    pair.library.A.movies.version = movie('version', 2)
    let entry = await pair.step('version changed')
    expect(entry.mode).toBe('select')
    expect(entry.entries).toEqual([['A', 'movies', { titles: ['version'] }]])
    expectSame(entry)
    const doc = pair.candidate.mongo.collection('Media', 'FlatMovies').docs.find((d) => d.originalTitle === 'version')
    expect(doc.videoURL).toContain('version.v2.mkv')

    // Its new poster's blurhash takes a second pass (R3), which stamps its gate;
    // pre-tag keeps it through the ticks that do not select it
    expectSame(await pair.step('settled'))
    const settled = pair.candidate.mongo.collection('Media', 'FlatMovies').docs.find((d) => d.originalTitle === 'version')
    expect(settled.syncGates?.A).toEqual(expect.any(String))
    entry = await pair.step('quiet')
    expectSame(entry)
    expect(titles(pair.candidate, 'FlatMovies')).toContain('version')

    // Removed from its only server: post-sync cleanup deletes it, in both worlds
    delete pair.library.A.movies.version
    entry = await pair.step('version removed')
    expectSame(entry)
    expect(entry.deleted.candidate).toEqual(['FlatMovies version'])
  })

  it('is a show like any other beside an integer-like one, its seasons and episodes included', async () => {
    const pair = await settledPair()
    pair.library.A.tv.version = show('version', { 1: 1, 2: 1 })
    pair.library.A.tv['2012'] = show('2012', { 1: 1 })

    let entry = await pair.step('two shows added')
    expectSame(entry)
    expect(entry.entries.find(([id, kind]) => id === 'A' && kind === 'tv')[2].titles.sort()).toEqual(['2012', 'version'])
    expect(titles(pair.candidate, 'FlatTVShows')).toEqual(expect.arrayContaining(['version', '2012']))
    const { keyOf } = keysOf(pair.candidate)
    const episodes = pair.candidate.mongo.collection('Media', 'FlatEpisodes').docs.map((d) => keyOf('FlatEpisodes', d))
    expect(episodes).toEqual(expect.arrayContaining(['version|1|1', 'version|1|2', '2012|1|1']))

    entry = await pair.step('settled')
    expectSame(entry)
    expect(entry.deleted.candidate).toEqual([])
  })
})

describe('one file server', () => {
  it('skips the quiet ticks, and parses only the title that changed', async () => {
    const pair = createPair()
    mockServers = mockServers.slice(0, 1)
    expectSame(await pair.step('first tick'))
    expectSame(await pair.step('second tick'))
    let entry = await pair.step('quiet')
    expect([entry.mode, entry.reason]).toEqual(['skip', undefined])
    expectSame(entry)
    pair.library.A.tv[SHOW_ONE] = show(SHOW_ONE, { 1: 1, 2: 2 })
    entry = await pair.step('one episode changed')
    expectSame(entry)
    expect(entry.entries).toEqual([['A', 'tv', { titles: [SHOW_ONE] }]])
    expect(entry.bytes.candidate.manifests).toBe(Buffer.byteLength(pair.candidate.processor.manifestOf('A', 'tv').body))
    entry = await pair.step('settled')
    expectSame(entry)
    entry = await pair.step('quiet again')
    expect([entry.mode, entry.reason]).toEqual(['skip', undefined])
    expectSame(entry)
  })
})

// ---------------------------------------------------------------- a seeded random walk

/** mulberry32: a small seeded PRNG, so a failing walk can be replayed. */
function prng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MOVIE_POOL = ['Kappa (2010)', 'Lambda (2011)', 'Mu (2012)', 'Nu (2013)', 'Xi (2014)', 'Omicron (2015)', 'Alpha (2001)', 'Gamma (2003)']
const SHOW_POOL = ['Show Four (2013)', 'Show Five (2014)', SHOW_ONE, SHOW_TWO]
const SERVERS = ['A', 'B', 'C']
/** The versions of each entry in the library, so a change can raise them. */
const versionOf = (entry) => Number(String(entry?.urls?.mp4 ?? entry?.metadata ?? '').match(/[.=][a-z]?v?(\d+)(?:\.mkv|$)/)?.[1] ?? 1)

const walkTotals = { ticks: 0, modes: {}, comparedNextTick: 0, longestCatchUp: 0, referenceBytes: 0, candidateBytes: 0, chunks: 0 }
/** Ticks after a move during a tick within which the two worlds must agree again. */
const CONVERGE_TICKS = 3
let longestCatchUp = 0

/** One random tick: changes to the library and the databases, and failures, the same in both worlds. */
function randomChanges(random, pair) {
  const { library } = pair
  const pick = (list) => list[Math.floor(random() * list.length)]
  const changes = []
  const failures = {}
  const after = []
  const count = Math.floor(random() * 4)
  for (let i = 0; i < count; i++) {
    const server = pick(SERVERS)
    const lib = library[server]
    const movies = Object.keys(lib.movies)
    const shows = Object.keys(lib.tv)
    const roll = random()
    if (roll < 0.25 && movies.length > 0) {
      const title = pick(movies)
      lib.movies[title] = movie(title, versionOf(lib.movies[title]) + 1 + Math.floor(random() * 3))
      changes.push(`${server} movie ${title} changed`)
    } else if (roll < 0.35) {
      const title = pick(MOVIE_POOL)
      if (!lib.movies[title]) {
        lib.movies[title] = movie(title, 1 + Math.floor(random() * 5))
        changes.push(`${server} movie ${title} added`)
      }
    } else if (roll < 0.45 && movies.length > 0) {
      const title = pick(movies)
      delete lib.movies[title]
      changes.push(`${server} movie ${title} removed`)
    } else if (roll < 0.65 && shows.length > 0) {
      const title = pick(shows)
      const episodes = Object.fromEntries(
        Object.values(lib.tv[title].seasons['Season 1'].episodes).map((e) => [e.episodeNumber, versionOf({ urls: { mp4: e.videoURL } })])
      )
      const n = 1 + Math.floor(random() * 4)
      if (episodes[n] && random() < 0.3 && Object.keys(episodes).length > 1) delete episodes[n]
      else episodes[n] = (episodes[n] ?? 0) + 1
      lib.tv[title] = show(title, episodes, random() < 0.2 ? 2 : 1)
      changes.push(`${server} show ${title} episode ${n}`)
    } else if (roll < 0.72) {
      const title = pick(SHOW_POOL)
      if (lib.tv[title] && random() < 0.5) {
        delete lib.tv[title]
        changes.push(`${server} show ${title} removed`)
      } else if (!lib.tv[title]) {
        lib.tv[title] = show(title, { 1: 1, 2: 1 })
        changes.push(`${server} show ${title} added`)
      }
    } else if (roll < 0.78) {
      // An admin edit: the document's gates go
      const name = random() < 0.5 ? 'FlatMovies' : 'FlatTVShows'
      const titles = pair.reference.mongo.collection('Media', name).docs.map((d) => d.originalTitle).sort()
      if (titles.length > 0) {
        const title = pick(titles)
        pair.inBoth((col) => {
          const doc = col(name).docs.find((d) => d.originalTitle === title)
          if (doc) delete doc.syncGates
        })
        changes.push(`admin edit ${name} ${title}`)
      }
    } else if (roll < 0.82) {
      // An episode deleted outside the sync, nothing forgotten
      const keys = pair.reference.mongo.collection('Media', 'FlatEpisodes').docs.map((d) => `${d.showTitle}|${d.episodeNumber}`).sort()
      if (keys.length > 0) {
        const key = pick(keys)
        pair.inBoth((col) => {
          const episodes = col('FlatEpisodes')
          const index = episodes.docs.findIndex((d) => `${d.showTitle}|${d.episodeNumber}` === key)
          if (index >= 0) episodes.docs.splice(index, 1)
        })
        changes.push(`episode ${key} deleted out of band`)
      }
    } else if (roll < 0.86) {
      failures.down = [server]
      changes.push(`${server} down`)
    } else if (roll < 0.89) {
      failures.entriesFail = [server]
      changes.push(`${server} entries fail`)
    } else if (roll < 0.91) {
      failures.notFound = [server]
      changes.push(`${server} answers 404`)
    } else if (roll < 0.96) {
      // The library moves while the tick runs: a movie appears between manifest and entries
      const title = pick(MOVIE_POOL)
      const entry = movie(title, 7)
      failures.beforeEntries = {
        [server]: (served, kind) => {
          if (kind !== 'movies') return false
          served.movies[title] = entry
        },
      }
      after.push(() => {
        library[server].movies[title] = entry
      })
      changes.push(`${server} gains ${title} during the tick`)
    }
  }
  return { changes, failures, after }
}

async function walk(seed, ticks) {
  const random = prng(seed)
  const pair = createPair()
  let movedTicks = 0
  let since = []
  let waited = 0
  expectSame(await pair.step('first tick'))
  expectSame(await pair.step('second tick'))
  for (let i = 0; i < ticks; i++) {
    const { changes, failures, after } = randomChanges(random, pair)
    const entry = await pair.step(`seed ${seed} tick ${i}: ${changes.join('; ') || 'nothing'}`, { failures })
    for (const apply of after) apply()
    // A library that moved during the tick is seen in that tick only where it
    // was asked for, which differs between the worlds (the reference asks every
    // server for everything). From such a tick the worlds must agree again
    // within CONVERGE_TICKS quiet ticks (a new poster's blurhash takes a second
    // pass), their deletes and changes counted over the whole stretch.
    if (failures.beforeEntries) {
      movedTicks += 1
      since.push(entry)
      waited = 0
    } else if (since.length > 0 && entry.differences.length > 0 && waited < CONVERGE_TICKS) {
      since.push(entry)
      waited += 1
    } else {
      expectSame(entry, since)
      if (since.length > 0) longestCatchUp = Math.max(longestCatchUp, waited + 1)
      since = []
    }
  }
  walkTotals.comparedNextTick += movedTicks
  walkTotals.longestCatchUp = Math.max(walkTotals.longestCatchUp, longestCatchUp)
  const summary = summarize(pair.log)
  walkTotals.ticks += summary.ticks
  // No mismatch count: expectSame throws on the first unexplained difference
  walkTotals.referenceBytes += summary.referenceBytes
  walkTotals.candidateBytes += summary.candidateBytes
  walkTotals.chunks += 1
  for (const [mode, n] of Object.entries(summary.modes)) walkTotals.modes[mode] = (walkTotals.modes[mode] || 0) + n
  return summary
}

describe('a seeded random walk (changes, failures, admin edits, out-of-band deletes, moves during a tick)', () => {
  // In chunks, each well inside a few seconds
  it.each([[1], [2], [3], [4]])('seed %i: 50 ticks, the same in both worlds every tick', async (seed) => {
    await walk(seed, 50)
  }, 120_000)

  afterAll(() => {
    // For the report: totals over the walk
    process.stdout.write(`[DIFFERENTIAL] ${JSON.stringify(walkTotals)}\n`)
  })
})

describe('a three-server walk skips its quiet ticks', () => {
  // A gate counts as open only where a server that lists the title lacks it,
  // so titles one server has no longer hold every tick open
  it.each([[21], [22], [23], [24]])('seed %i: 50 ticks, the same in both worlds every tick, and the candidate skips', async (seed) => {
    const summary = await walk(seed, 50)
    process.stdout.write(`[WALK3 seed ${seed}] ${JSON.stringify({ all: 0, select: 0, skip: 0, ...summary.modes, differingInMoveStretches: summary.mismatches })}\n`)
    expect(summary.modes.skip ?? 0).toBeGreaterThan(0)
  }, 120_000)
})

// ---------------------------------------------------------------- the review's scenarios
describe('failed passes, out-of-band deletes and a one-server walk', () => {
  async function settled3() {
    const pair = createPair()
    expectSame(await pair.step('first tick'))
    expectSame(await pair.step('second tick'))
    return pair
  }

  it('RV1: a show two servers list changes on B, and B throws as its TV phase starts: the worlds still agree after', async () => {
    const pair = await settled3()
    pair.library.B.tv[SHOW_ONE] = show(SHOW_ONE, { 1: 1, 2: 5, 3: 1 }, 2)
    let entry = await pair.step('B changed, B TV throws', { throwTvPhaseOf: 'B' })
    expectSame(entry)
    for (const label of ['after 1', 'after 2', 'after 3']) {
      entry = await pair.step(label)
      expectSame(entry)
    }
  })

  it('RV2: a movie and a show document deleted out of band (nothing forgotten) are re-created in both worlds', async () => {
    const pair = await settled3()
    pair.inBoth((col) => {
      col('FlatMovies').docs = col('FlatMovies').docs.filter((d) => d.originalTitle !== 'Delta (2004)')
      col('FlatTVShows').docs = col('FlatTVShows').docs.filter((d) => d.originalTitle !== SHOW_TWO)
    })
    let entry = await pair.step('deleted out of band')
    expectSame(entry)
    entry = await pair.step('after')
    expectSame(entry)
    expect(pair.candidate.mongo.collection('Media', 'FlatMovies').docs.map((d) => d.originalTitle)).toContain('Delta (2004)')
  })

  async function walk1(seed, ticks) {
    const random = prng(seed)
    const pair = createPair()
    mockServers = mockServers.slice(0, 1)
    let since = []
    let waited = 0
    const modes = {}
    expectSame(await pair.step('first tick'))
    expectSame(await pair.step('second tick'))
    for (let i = 0; i < ticks; i++) {
      const { changes, failures, after } = randomChanges(random, pair)
      const entry = await pair.step('w1 seed ' + seed + ' tick ' + i + ': ' + (changes.join('; ') || 'nothing'), { failures })
      modes[entry.mode] = (modes[entry.mode] || 0) + 1
      for (const apply of after) apply()
      if (failures.beforeEntries) {
        since.push(entry)
        waited = 0
      } else if (since.length > 0 && entry.differences.length > 0 && waited < CONVERGE_TICKS) {
        since.push(entry)
        waited += 1
      } else {
        expectSame(entry, since)
        since = []
      }
    }
    // Tick kinds over the 60 ticks after the first two; `all` stays 0 once the state is held
    process.stdout.write('[WALK1 seed ' + seed + '] ' + JSON.stringify({ all: 0, select: 0, skip: 0, ...modes }) + '\n')
    expect(modes.skip ?? 0).toBeGreaterThan(0)
  }

  it.each([[11], [12], [13], [14]])('RV3: one server, seed %i, 60 ticks: the same in both worlds, and the candidate skips', async (seed) => {
    await walk1(seed, 60)
  }, 120000)
})
describe('a move during a tick outside the selection', () => {
  it('RV4: one server; a move during the tick changes a title outside the selection; the quiet ticks after it agree', async () => {
    const pair = createPair()
    mockServers = mockServers.slice(0, 1)
    expectSame(await pair.step('first tick'))
    expectSame(await pair.step('second tick'))
    let entry = await pair.step('quiet')
    expect(entry.mode).toBe('skip')
    const lib = pair.library.A.movies
    // Gamma changes in a way that needs no second pass (no new poster)
    lib['Gamma (2003)'] = { ...lib['Gamma (2003)'], hdr: 'HDR10' }
    const zeta = { ...lib['Zeta (2006)'], hdr: 'HDR10' }
    const moved = entry = await pair.step('moved', {
      failures: { beforeEntries: { A: (served, kind) => { if (kind !== 'movies') return false; served.movies['Zeta (2006)'] = zeta } } },
    })
    lib['Zeta (2006)'] = zeta
    const after = []
    for (const label of ['quiet 1', 'quiet 2', 'quiet 3']) {
      entry = await pair.step(label)
      after.push(entry)
    }
    // The moved title was left pending in the tick state, so the next tick does not skip
    expect(after[0].mode).toBe('select')
    expect(after[0].reason).toMatch(/pending in the tick state/)
    expectSame(after[2], [moved, after[0], after[1]])
  })
})
describe('a write reported failed', () => {
  it('RV5: one server; a movie written and gated, then reported failed; the server goes back to the old version', async () => {
    const { syncEventBus } = require('@src/utils/sync/core/events')
    const original = syncEventBus.emitComplete
    let throwFor = null
    jest.spyOn(syncEventBus, 'emitComplete').mockImplementation(function (title, ...rest) {
      if (throwFor && title === throwFor) throw new Error('emit failed after the write')
      return original.call(this, title, ...rest)
    })
    const pair = createPair()
    mockServers = mockServers.slice(0, 1)
    expectSame(await pair.step('first tick'))
    expectSame(await pair.step('second tick'))
    const lib = pair.library.A.movies
    const before = lib['Zeta (2006)']
    lib['Zeta (2006)'] = { ...before, hdr: 'HDR10' }
    throwFor = 'Zeta (2006)'
    let entry
    try {
      entry = await pair.step('written, then reported failed')
    } finally {
      throwFor = null
    }
    const zetaDoc = pair.candidate.mongo.collection('Media', 'FlatMovies').docs.find((d) => d.originalTitle === 'Zeta (2006)')
    expect(entry.candidate.result.flatSyncResults.A.movies.errors).toBeGreaterThan(0)
    expect(zetaDoc.hdr).toBe('HDR10')
    expect(zetaDoc.syncGates?.A).toBeDefined()
    lib['Zeta (2006)'] = before
    // The failed title was cleared before the pass, so the next tick passes over it again
    entry = await pair.step('back at the old version')
    expect(entry.mode).toBe('select')
    expect(entry.entries).toEqual([['A', 'movies', { titles: ['Zeta (2006)'] }]])
    for (const label of ['quiet 1', 'quiet 2']) {
      entry = await pair.step(label)
    }
    expectSame(entry)
  })
})
describe('every difference in a stretch after a move is explained by the move', () => {
  async function walkStrict(seed, ticks) {
    const random = prng(seed)
    const pair = createPair()
    let since = []
    let waited = 0
    let moved = new Set()
    const stretches = []
    expectSame(await pair.step('first tick'))
    expectSame(await pair.step('second tick'))
    for (let i = 0; i < ticks; i++) {
      const { changes, failures, after } = randomChanges(random, pair)
      const entry = await pair.step('seed ' + seed + ' tick ' + i + ': ' + (changes.join('; ') || 'nothing'), { failures })
      for (const apply of after) apply()
      const gains = changes.map((c) => c.match(/gains (.+) during the tick/)?.[1]).filter(Boolean)
      if (failures.beforeEntries) {
        for (const t of gains) moved.add(t)
        since.push(entry)
        waited = 0
      } else if (since.length > 0 && entry.differences.length > 0 && waited < CONVERGE_TICKS) {
        since.push(entry)
        waited += 1
      } else {
        expectSame(entry, since)
        if (since.length > 0) {
          // Every difference seen inside the stretch is about a title a move added
          const all = since.flatMap((e) => e.differences)
          const unexplained = all.filter((line) => ![...moved].some((t) => line.startsWith('FlatMovies ' + t + ' ') || line.startsWith('FlatMovies ' + t + ':')))
          stretches.push({ len: since.length, diffs: all.length, unexplained: unexplained.length })
          expect({ seed, tick: i, unexplained }).toEqual({ seed, tick: i, unexplained: [] })
          // Deletes and changes inside the stretch: only moved titles may differ per tick
        }
        since = []
        moved = new Set()
      }
    }
    process.stdout.write('[STRICT seed ' + seed + '] stretches=' + JSON.stringify(stretches) + '\n')
  }
  it.each([[1], [2], [3], [4]])('RV6: walk seed %i with every in-stretch difference explained by the move', async (seed) => {
    await walkStrict(seed, 50)
  }, 120000)
})

describe('confirmTickMode (the mode as it stands once the run holds the lock)', () => {
  async function probeThenLose(loseState) {
    const pair = createPair()
    expectSame(await pair.step('first tick'))
    expectSame(await pair.step('second tick'))
    pair.library.A.movies['Gamma (2003)'] = movie('Gamma (2003)', 4)
    const world = pair.candidate
    serve(world, pair.library, {})
    mockWorld = world
    globalThis.__syncTickState = world.state
    world.processor.calls.entries.length = 0
    const probed = await fetchSyncTick({ allowSkip: true })
    expect([probed.skipped, probed.mode]).toEqual([false, 'select'])
    // Between the probe and the lock the tick state is lost (a reset, another run's record)
    loseState(world)
    const result = await syncAllServers(probed, {})
    for (let i = 0; i < 5000 && getSyncLockHolder(); i++) await new Promise((resolve) => setImmediate(resolve))
    world.state = globalThis.__syncTickState ?? null
    return { pair, result, entries: world.processor.calls.entries.map(({ server, kind, request }) => [server, kind, request]) }
  }

  it('runs the tick over every title when the tick state was reset after the probe', async () => {
    const { entries, result } = await probeThenLose(() => {
      globalThis.__syncTickState = null
    })
    // Every server is asked for everything, and the change is written
    expect(entries).toEqual(['A', 'B', 'C'].flatMap((id) => ['tv', 'movies'].map((kind) => [id, kind, { all: true }])))
    expect(changed(result).movies).toEqual(['Gamma (2003)'])
  })

  it('runs the tick over every title when another run replaced the record after the probe', async () => {
    const { entries } = await probeThenLose((world) => {
      globalThis.__syncTickState = { ...world.state, lastRunId: 'another-run' }
    })
    expect(entries.length).toBe(6)
    expect(entries.every(([, , request]) => request.all === true)).toBe(true)
  })
})
