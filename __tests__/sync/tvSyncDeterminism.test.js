/**
 * @jest-environment node
 *
 * The TV sync has to end in the same documents whatever order the file servers
 * are synced in, however many times the run repeats, and whether or not the
 * run is forced. These cases drive the real TVShowSyncService, SeasonSyncService
 * and EpisodeSyncService, through the real repositories, against in-memory
 * collections, with the payload shape a media processor publishes.
 *
 * What the old sync got wrong, each of which has a case here:
 *
 *  - every episode field was ranked against a path no server reports, so with
 *    two servers the thumbnail, chapters, metadata and captions were whichever
 *    server synced last;
 *  - a server whose own payload was unchanged was skipped at the moment it
 *    became the only one with an episode, and the dead link stayed;
 *  - the show's gate was stamped before its seasons and episodes were written,
 *    so a failed episode was never retried;
 *  - a replaced file kept the old one's HDR label, and a removed subtitle stayed;
 *  - an episode numbered 0 was synced on top of episode 1.
 *
 * The later describe blocks are the cases a review of the first fix turned up:
 * two servers naming a season folder differently, a file the server could not
 * probe, a run with a server missing, and values that depended on which server
 * created a document.
 */

const mockServers = { A: { id: 'A', priority: 1 }, B: { id: 'B', priority: 2 }, C: { id: 'C', priority: 3 } }
// Files a file server publishes but cannot serve right now: exact URLs, or
// patterns matched against the URL.
const mockFailingUrls = new Set()
const mockFails = (url) =>
  [...mockFailingUrls].some((failing) => (failing instanceof RegExp ? failing.test(url) : failing === url))
// The show's metadata file, as each server would serve it.
const defaultShowMetadata = () => ({
  id: 1396,
  name: 'Breaking Bad',
  first_air_date: '2008-01-20',
  last_air_date: '2013-09-29',
  seasons: [
    { season_number: 1, name: 'Season One', episode_count: 7, air_date: '2008-01-20' },
    { season_number: 2, name: 'Season Two', episode_count: 13, air_date: '2009-03-08' },
  ],
})
let mockShowMetadata = defaultShowMetadata()
// The version of the image a blurhash file is of, so a case can tell a stale
// blurhash from a fresh one.
let mockImageVersion = 'v1'

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: { getInstance: () => ({ dbWriteLimitFor: () => (fn) => fn() }) },
  getResourceManager: () => ({}),
}))
jest.mock('@src/utils/sync/captions', () => ({ sortSubtitleEntries: (entries) => entries }))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  logError: jest.fn(),
}))
jest.mock('@src/utils/config', () => ({
  getServer: (id) => mockServers[id],
  multiServerHandler: {
    getHandler: (id) => ({ createFullURL: (path) => `https://${id}.example${path}` }),
  },
}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  generateNormalizedVideoId: (url) => `nid:${url}`,
}))
jest.mock('@src/utils/admin_utils', () => ({
  // Stands in for the HTTP fetch of a metadata or blurhash file.
  fetchMetadataMultiServer: jest.fn(async (serverId, url, type) => {
    // Like the real one: no file to fetch is an empty answer, not an error.
    if (!url) return {}
    if (mockFails(url)) throw new Error(`fetch failed: ${url}`)
    if (type === 'blurhash') return `blurhash-of:${url}#${mockImageVersion}`
    if (/E\d+_metadata/.test(url)) {
      const episode = Number(url.match(/E(\d+)_metadata/)[1])
      return { episode_number: episode, name: `Named by ${serverId}: episode ${episode}` }
    }
    return JSON.parse(JSON.stringify(mockShowMetadata))
  }),
}))

const { TVShowSyncService } = require('@src/utils/sync/domain/tv/TVShowSyncService')
const { SeasonSyncService } = require('@src/utils/sync/domain/tv/SeasonSyncService')
const { EpisodeSyncService } = require('@src/utils/sync/domain/tv/EpisodeSyncService')
const { TVShowRepository } = require('@src/utils/sync/infrastructure/database/TVShowRepository')
const { SeasonRepository } = require('@src/utils/sync/infrastructure/database/SeasonRepository')
const { EpisodeRepository } = require('@src/utils/sync/infrastructure/database/EpisodeRepository')
const { resolveCleanupConfig } = require('@src/utils/sync/core/FieldAbsenceCleaner')
const { MediaType, SyncOperation } = require('@src/utils/sync/core')
const isEqual = require('lodash/isEqual')
// The availability map is built by the same function the admin sync route uses.
const { collectFieldAvailability } = require('@src/utils/sync/fieldAvailability')

// ---------------------------------------------------------------- in-memory MongoDB

const DATE_FIELDS = ['createdAt', 'updatedAt', 'lastSynced', 'initialDiscoveryDate', 'mediaLastModified', 'airDate', 'firstAirDate', 'lastAirDate']
const clone = (doc) => {
  const copy = JSON.parse(JSON.stringify(doc))
  for (const field of DATE_FIELDS) {
    if (typeof copy[field] === 'string') copy[field] = new Date(copy[field])
  }
  return copy
}

// Just enough of MongoDB's matching for the queries the repositories issue.
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
      if (op === '$in') return operand.includes(value)
      if (op === '$ne') return value !== operand
      if (op === '$exists') return (value !== undefined) === operand
      if (op === '$type') return operand === 'string' ? typeof value === 'string' : false
      if (op === '$gt') return value > operand
      throw new Error(`unsupported operator ${op}`)
    })
  })
}

// MongoDB stores a field that is set to `undefined` as `null`; a plain JSON
// round trip would drop it instead, and hide every comparison that tells the
// two apart.
const stored = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)))

let nextId = 1
function makeCollection() {
  const docs = []
  const collection = {
    docs,
    failNextBulkWrite: false,
    async findOne(filter) {
      const doc = docs.find((d) => matches(d, filter))
      return doc ? clone(doc) : null
    },
    find(filter) {
      let found = docs.filter((d) => matches(d, filter))
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
    async countDocuments(filter) {
      return docs.filter((d) => matches(d, filter)).length
    },
    async updateOne(filter, update, options = {}) {
      let doc = docs.find((d) => matches(d, filter))
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 }
        doc = { _id: `id${nextId++}`, ...filter, ...stored(update.$setOnInsert || {}) }
        docs.push(doc)
        return { upsertedCount: 1 }
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
    async bulkWrite(operations) {
      if (collection.failNextBulkWrite) {
        collection.failNextBulkWrite = false
        throw new Error('write concern timeout')
      }
      for (const { updateOne } of operations) {
        await collection.updateOne(updateOne.filter, updateOne.update, { upsert: updateOne.upsert })
      }
      return {}
    },
  }
  return collection
}

function makeDatabase() {
  const collections = { FlatTVShows: makeCollection(), FlatSeasons: makeCollection(), FlatEpisodes: makeCollection() }
  const client = { db: () => ({ collection: (name) => collections[name] }) }
  const shows = new TVShowRepository(client)
  const seasons = new SeasonRepository(client)
  const episodes = new EpisodeRepository(client)
  const service = new TVShowSyncService(
    shows,
    new SeasonSyncService(seasons, shows),
    new EpisodeSyncService(episodes, seasons, shows),
    episodes,
    seasons
  )
  return {
    collections,
    service,
    show: () => collections.FlatTVShows.docs[0],
    season: (number) => collections.FlatSeasons.docs.find((d) => d.seasonNumber === number),
    episode: (number, season = 1) =>
      collections.FlatEpisodes.docs.find((d) => d.seasonNumber === season && d.episodeNumber === number),
  }
}

// ---------------------------------------------------------------- payloads

const SHOW = 'Breaking Bad (2008)'
const ROOT = `/tv/${encodeURIComponent(SHOW)}`
const HDR = { format: 'HDR10', bitDepth: 10, isHDR: true }
const SDR = { format: '8-bit SDR (BT.709)', bitDepth: 8, isHDR: false }

const pad = (n) => String(n).padStart(2, '0')
const key = (n, season = 1) => `S${pad(season)}E${pad(n)}`

/** One episode entry of a season's `episodes` map. */
const episodePayload = (n, { season = 1, seasonFolder = 'Season 1', file, subtitles, ...over } = {}) => {
  const name = file ?? `${SHOW} - ${key(n, season)}.mkv`
  const folder = `${ROOT}/${encodeURIComponent(seasonFolder)}`
  return {
    _id: `uuid-${key(n, season)}`,
    filename: name,
    videoURL: `${folder}/${encodeURIComponent(name)}`,
    mediaLastModified: '2024-01-01T00:00:00.000Z',
    hdr: 'HDR10',
    mediaQuality: HDR,
    additionalMetadata: { size: { gb: 2 } },
    episodeNumber: n,
    derivedEpisodeName: `Derived ${n}`,
    thumbnail: `${folder}/${pad(n)} - Thumbnail.jpg?hash=t1`,
    thumbnailBlurhash: `${folder}/${pad(n)} - Thumbnail.jpg.blurhash`,
    metadata: `${folder}/E${pad(n)}_metadata.json?hash=m1`,
    chapters: `${folder}/chapters/${key(n, season)}_chapters.vtt`,
    ...(subtitles === null
      ? {}
      : { subtitles: subtitles ?? { English: { url: `${folder}/${key(n, season)}.en.srt`, srcLang: 'en', lastModified: 'm1' } } }),
    mediaIdentity: { id: `mid:show:s${pad(season)}e${pad(n)}`, scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
    sources: [{ url: `${folder}/${encodeURIComponent(name)}`, filename: name, container: 'mkv', isPrimary: true }],
    jitEligible: true,
    jitUrl: `https://jit.example/stream/${encodeURIComponent(name)}/master.m3u8`,
    ...over,
  }
}

/** A show with the given episodes (numbers, or [number, overrides] pairs) in one season. */
const showPayload = (episodes = [1, 2], { seasonFolder = 'Season 1', season = 1, seasonPoster = true, ...over } = {}) => {
  const entries = {}
  const lengths = {}
  const dimensions = {}
  for (const item of episodes) {
    const [n, overrides] = Array.isArray(item) ? item : [item, {}]
    entries[key(n, season)] = episodePayload(n, { season, seasonFolder, ...overrides })
    lengths[key(n, season)] = 2880000 + n
    dimensions[key(n, season)] = '3840x2160'
  }
  const folder = `${ROOT}/${encodeURIComponent(seasonFolder)}`
  return {
    // Every show-level key is always published; one the folder has no file
    // for is null (or an empty string).
    metadata: `${ROOT}/metadata.json?hash=s1`,
    poster: `${ROOT}/show_poster.jpg?hash=p1`,
    posterBlurhash: null,
    logo: '',
    logoBlurhash: null,
    backdrop: null,
    backdropBlurhash: null,
    backdropFocal: null,
    backdropFocalSuggested: null,
    mediaIdentity: { id: 'mid:show', scheme: 'mid', firstSeen: '2024-01-01T00:00:00.000Z' },
    seasons:
      episodes.length === 0
        ? {}
        : {
            [seasonFolder]: {
              seasonNumber: season,
              ...(seasonPoster ? { season_poster: `${folder}/season_poster.jpg?hash=sp1` } : {}),
              episodes: entries,
              lengths,
              dimensions,
            },
          },
    ...over,
  }
}

// ---------------------------------------------------------------- driving a run

// The processor's hash surface, in miniature: an episode hash over the episode
// entry and its length/dimensions, a show hash over the show-level fields, and
// a content hash over everything under the seasons.
const hashOf = (value) => `h${JSON.stringify(value).length}:${JSON.stringify(value)}`
function hashesFor(payload) {
  const episodeHashes = new Map()
  for (const [seasonKey, season] of Object.entries(payload.seasons)) {
    const perEpisode = {}
    for (const [episodeKey, entry] of Object.entries(season.episodes)) {
      perEpisode[episodeKey] = {
        hash: hashOf([entry, season.lengths?.[episodeKey], season.dimensions?.[episodeKey]]),
      }
    }
    episodeHashes.set(season.seasonNumber, { episodes: perEpisode, seasonKey })
  }
  const { seasons, ...showLevel } = payload
  return {
    show: { hash: hashOf([showLevel, Object.keys(seasons)]), contentHash: hashOf(seasons) },
    episodeHashes,
  }
}

/** One server's pass over the show. `payloads` is every server that answered this run. */
async function pass(db, serverId, payloads, { forceSync = false, allProbed = true, hashesOf = payloads, hashes: withHashes = true } = {}) {
  const fieldAvailability = { movies: {}, tv: { [SHOW]: {} } }
  for (const [id, payload] of Object.entries(payloads)) {
    collectFieldAvailability(payload, '', id, fieldAvailability.tv[SHOW])
  }
  // `hashesOf` lets a case hand over the hashes of a DIFFERENT payload than the
  // one applied — what happens when a scan commits between the two fetches.
  const hashes = hashesFor(hashesOf[serverId])
  const context = {
    mediaType: MediaType.TVShow,
    operation: SyncOperation.Metadata,
    serverConfig: { id: serverId, priority: mockServers[serverId].priority, baseUrl: `https://${serverId}.example`, prefix: '', enabled: true },
    fieldAvailability,
    forceSync,
    fileServerData: { tv: { [SHOW]: payloads[serverId] } },
    // `hashes: false` is a run on which the file server's hash requests failed.
    ...(withHashes
      ? { tvShowHashesCache: { titles: { [SHOW]: hashes.show } }, tvEpisodeHashesCache: new Map([[SHOW, hashes.episodeHashes]]) }
      : {}),
    cleanup: resolveCleanupConfig(allProbed),
    allEnabledServersProbed: allProbed,
  }
  return db.service.syncTVShow(SHOW, context)
}

async function run(db, payloads, order, options) {
  const results = []
  for (const serverId of order) {
    if (payloads[serverId]) results.push(...(await pass(db, serverId, payloads, options)))
  }
  return results
}

// The documents without what legitimately differs between runs or orders:
// ids and write timestamps, the sync's own bookkeeping, and which server
// happened to create a document. A season has no first-seen date from the file
// server, so its discovery date is the moment it was first synced.
const VOLATILE = ['_id', 'showId', 'seasonId', 'lastSynced', 'updatedAt', 'createdAt', 'syncHash', 'contentHash', 'syncGates', 'syncRunId', 'originalTitleSource', 'titleSource']
function settled(db) {
  const strip = (doc) => {
    const copy = JSON.parse(JSON.stringify(doc))
    for (const field of VOLATILE) delete copy[field]
    if (copy.type === 'season') {
      delete copy.initialDiscoveryDate
      delete copy.initialDiscoveryServer
    }
    return copy
  }
  const byNumbers = (a, b) => a.seasonNumber - b.seasonNumber || (a.episodeNumber ?? 0) - (b.episodeNumber ?? 0)
  return {
    shows: db.collections.FlatTVShows.docs.map(strip),
    seasons: db.collections.FlatSeasons.docs.map(strip).sort(byNumbers),
    episodes: db.collections.FlatEpisodes.docs.map(strip).sort(byNumbers),
  }
}
const statuses = (results) => results.map((r) => r.status)
const ORDERS = [['A', 'B'], ['B', 'A']]

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})
beforeEach(() => {
  mockFailingUrls.clear()
  mockShowMetadata = defaultShowMetadata()
  mockImageVersion = 'v1'
  nextId = 1
})

// ---------------------------------------------------------------- one server

describe('one server', () => {
  it('stores the show, its season and its episodes', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1, 2]) }, ['A'])

    expect(db.show()).toMatchObject({ originalTitle: SHOW, title: 'Breaking Bad', visibleEpisodeCount: 2 })
    expect(db.season(1)).toMatchObject({ seasonNumber: 1, posterSource: 'A' })
    expect(db.episode(1)).toMatchObject({
      videoURL: `https://A.example${ROOT}/Season%201/${encodeURIComponent(`${SHOW} - S01E01.mkv`)}`,
      videoSource: 'A',
      hdr: 'HDR10',
      duration: 2880001,
      dimensions: '3840x2160',
      size: 2 * 1024 * 1024 * 1024,
      primaryContainer: 'mkv',
      thumbnailSource: 'A',
      chapterSource: 'A',
      metadataSource: 'A',
      mediaId: 'mid:show:s01e01',
    })
    expect(Object.keys(db.episode(1).captionURLs)).toEqual(['English'])
    expect(db.collections.FlatEpisodes.docs).toHaveLength(2)
  })

  it('skips the whole show on a second, identical run and writes nothing', async () => {
    const db = makeDatabase()
    const payloads = { A: showPayload([1, 2]) }
    await run(db, payloads, ['A'])
    const before = JSON.stringify(db.collections)

    expect(statuses(await pass(db, 'A', payloads))).toEqual(['skipped'])
    expect(JSON.stringify(db.collections)).toBe(before)
  })

  it('drops the HDR label when an episode\'s HDR file is replaced by an SDR one', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1, 2]) }, ['A'])

    await run(db, { A: showPayload([[1, { hdr: null, mediaQuality: SDR }], 2]) }, ['A'])

    expect(db.episode(1)).not.toHaveProperty('hdr')
    expect(db.episode(1).mediaQuality.isHDR).toBe(false)
    expect(db.episode(2).hdr).toBe('HDR10')
  })

  it('leaves a fact alone when the file server is too old to publish it at all', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1]) }, ['A'])

    const withoutHdrKey = showPayload([1])
    delete withoutHdrKey.seasons['Season 1'].episodes.S01E01.hdr
    delete withoutHdrKey.seasons['Season 1'].lengths
    await run(db, { A: withoutHdrKey }, ['A'])

    expect(db.episode(1).hdr).toBe('HDR10')
    expect(db.episode(1).duration).toBe(2880001)
  })

  it('removes a subtitle that was deleted, including the last one', async () => {
    const two = {
      English: { url: `${ROOT}/Season%201/S01E01.en.srt`, srcLang: 'en', lastModified: 'm1' },
      Spanish: { url: `${ROOT}/Season%201/S01E01.es.srt`, srcLang: 'es', lastModified: 'm1' },
    }
    const db = makeDatabase()
    await run(db, { A: showPayload([[1, { subtitles: two }]]) }, ['A'])
    expect(Object.keys(db.episode(1).captionURLs).sort()).toEqual(['English', 'Spanish'])

    await run(db, { A: showPayload([[1, { subtitles: { English: two.English } }]]) }, ['A'])
    expect(Object.keys(db.episode(1).captionURLs)).toEqual(['English'])

    await run(db, { A: showPayload([[1, { subtitles: null }]]) }, ['A'])
    expect(db.episode(1)).not.toHaveProperty('captionURLs')
    expect(db.episode(1)).not.toHaveProperty('captionSource')
  })

  it('processes only the new episode when one is added', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1, 2]) }, ['A'])

    const results = await pass(db, 'A', { A: showPayload([1, 2, 3]) })
    const episodeResults = results.filter((r) => r.mediaType === MediaType.Episode)

    expect(episodeResults.map((r) => [r.entityId, r.status])).toEqual([
      [`${SHOW} S1E1`, 'skipped'],
      [`${SHOW} S1E2`, 'skipped'],
      [`${SHOW} S1E3`, 'completed'],
    ])
    expect(db.show().visibleEpisodeCount).toBe(3)
  })

  it('uses the file server\'s name for an episode until its metadata has one', async () => {
    const db = makeDatabase()
    const payload = showPayload([1])
    delete payload.seasons['Season 1'].episodes.S01E01.metadata
    await run(db, { A: payload }, ['A'])

    expect(db.episode(1).title).toBe('Derived 1')
  })

  it('keeps an episode numbered 0 apart from episode 1', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([0, 1]) }, ['A'])

    expect(db.collections.FlatEpisodes.docs.map((d) => d.episodeNumber).sort()).toEqual([0, 1])
    expect(db.episode(0).videoURL).toMatch(/S01E00\.mkv$/)
    expect(db.episode(1).videoURL).toMatch(/S01E01\.mkv$/)
  })

  it('reads the episode number from an "S01E05" key when the entry carries none', async () => {
    const db = makeDatabase()
    const payload = showPayload([5])
    delete payload.seasons['Season 1'].episodes.S01E05.episodeNumber
    await run(db, { A: payload }, ['A'])

    expect(db.collections.FlatEpisodes.docs.map((d) => d.episodeNumber)).toEqual([5])
  })

  it('reaches the same documents through forced runs', async () => {
    const steps = [showPayload([1, 2]), showPayload([[1, { hdr: null, mediaQuality: SDR, subtitles: null }], 2, 3])]
    const [batch, forced] = [makeDatabase(), makeDatabase()]
    for (const payload of steps) {
      await run(batch, { A: payload }, ['A'])
      await run(forced, { A: payload }, ['A'], { forceSync: true })
      await run(forced, { A: payload }, ['A'], { forceSync: true })
    }
    expect(settled(forced)).toEqual(settled(batch))
  })
})

// ---------------------------------------------------------------- the show gate

describe('the show gate is stamped after its seasons and episodes', () => {
  const episodeMetadataUrl = `https://A.example${ROOT}/Season%201/E02_metadata.json?hash=m1`

  it('retries an episode whose metadata fetch failed, instead of skipping the show', async () => {
    const db = makeDatabase()
    const payloads = { A: showPayload([1, 2]) }
    mockFailingUrls.add(`${ROOT}/Season%201/E02_metadata.json?hash=m1`)
    mockFailingUrls.add(episodeMetadataUrl)
    await run(db, payloads, ['A'])
    expect(db.episode(2).metadata?.name).toBeUndefined()

    // The file server recovers. Nothing in the payload or its hashes changed.
    mockFailingUrls.clear()
    const retry = await pass(db, 'A', payloads)

    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(db.episode(2).metadata.name).toBe('Named by A: episode 2')
    // The episode that was fine the first time is not fetched again.
    expect(retry.find((r) => r.entityId === `${SHOW} S1E1`).status).toBe('skipped')
    // And once everything is in, the show is skipped.
    expect(statuses(await pass(db, 'A', payloads))).toEqual(['skipped'])
  })

  it('retries the episodes of a season whose write failed', async () => {
    const db = makeDatabase()
    const payloads = { A: showPayload([1, 2]) }
    db.collections.FlatEpisodes.failNextBulkWrite = true
    const first = await pass(db, 'A', payloads)
    expect(first.some((r) => r.status === 'failed')).toBe(true)
    expect(db.collections.FlatEpisodes.docs).toHaveLength(0)

    const retry = await pass(db, 'A', payloads)

    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(db.collections.FlatEpisodes.docs).toHaveLength(2)
    expect(db.show().visibleEpisodeCount).toBe(2)
    expect(statuses(await pass(db, 'A', payloads))).toEqual(['skipped'])
  })

  it('does not skip the show when its metadata fetch failed', async () => {
    const db = makeDatabase()
    const payloads = { A: showPayload([1]) }
    mockFailingUrls.add(`${ROOT}/metadata.json?hash=s1`)
    await run(db, payloads, ['A'])

    mockFailingUrls.clear()
    const retry = await pass(db, 'A', payloads)
    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(db.show().title).toBe('Breaking Bad')
  })
})

// ---------------------------------------------------------------- two servers

describe('two servers that both have the show', () => {
  // B's files differ from A's: another release, SDR, its own artwork and subtitles.
  const fromB = { file: 'bb.s01e01.720p.mkv', hdr: null, mediaQuality: SDR }
  const payloads = { A: showPayload([1]), B: showPayload([[1, fromB]]) }

  it.each(ORDERS)('takes every episode field from the higher-priority server, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, payloads, order)

    expect(db.episode(1)).toMatchObject({
      videoSource: 'A',
      videoInfoSource: 'A',
      hdr: 'HDR10',
      thumbnailSource: 'A',
      thumbnailBlurhashSource: 'A',
      chapterSource: 'A',
      metadataSource: 'A',
      captionSource: 'A',
    })
    expect(db.episode(1).videoURL).toMatch(/^https:\/\/A\.example/)
    expect(db.episode(1).thumbnail).toMatch(/^https:\/\/A\.example/)
    expect(db.episode(1).chapterURL).toMatch(/^https:\/\/A\.example/)
    expect(db.episode(1).metadata.name).toBe('Named by A: episode 1')
    expect(db.episode(1).captionURLs.English.sourceServerId).toBe('A')
    expect(db.season(1).posterSource).toBe('A')
  })

  it('ends in the same documents in either order, and stays there', async () => {
    const [first, second] = [makeDatabase(), makeDatabase()]
    await run(first, payloads, ['A', 'B'])
    await run(second, payloads, ['B', 'A'])
    expect(settled(second)).toEqual(settled(first))

    const before = settled(first)
    await run(first, payloads, ['B', 'A'])
    await run(first, payloads, ['A', 'B'], { forceSync: true })
    expect(settled(first)).toEqual(before)
  })

  it('skips both servers once each has completed a pass against this picture', async () => {
    const db = makeDatabase()
    await run(db, payloads, ['A', 'B'])
    await run(db, payloads, ['A', 'B'])

    expect(statuses(await pass(db, 'A', payloads))).toEqual(['skipped'])
    expect(statuses(await pass(db, 'B', payloads))).toEqual(['skipped'])
  })

  it.each(ORDERS)('hands an episode to the other server when the owner loses its file, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, payloads, order)
    await run(db, payloads, order)

    // A still has the show and episode 2, but episode 1's file is gone.
    // B's payload is byte for byte what it was.
    const afterLoss = { A: showPayload([2]), B: showPayload([[1, fromB]]) }
    await run(db, afterLoss, order)

    expect(db.episode(1).videoURL).toMatch(/^https:\/\/B\.example.*bb\.s01e01\.720p\.mkv$/)
    expect(db.episode(1)).toMatchObject({ videoSource: 'B', thumbnailSource: 'B', metadataSource: 'B', captionSource: 'B' })
    // B's file is SDR: the HDR label that described A's file must not survive.
    expect(db.episode(1)).not.toHaveProperty('hdr')
    expect(db.episode(1).mediaQuality.isHDR).toBe(false)
    expect(db.episode(2).videoSource).toBe('A')
  })

  it('hands the show over the same way when the owner no longer has it at all', async () => {
    const db = makeDatabase()
    await run(db, payloads, ['A', 'B'])
    await run(db, payloads, ['A', 'B'])

    await run(db, { B: payloads.B }, ['A', 'B'])

    expect(db.episode(1).videoSource).toBe('B')
    expect(db.episode(1).videoURL).toMatch(/^https:\/\/B\.example/)
  })

  it('gives the title back when the owner returns after an outage', async () => {
    const db = makeDatabase()
    await run(db, payloads, ['A', 'B'])
    await run(db, payloads, ['A', 'B'])

    // A is down: B is the only server with the episode this run, and serves it.
    await run(db, { B: payloads.B }, ['B'], { allProbed: false })
    expect(db.episode(1).videoSource).toBe('B')

    // A is back with exactly the payload it had before.
    await run(db, payloads, ['A', 'B'])
    expect(db.episode(1).videoSource).toBe('A')
    expect(db.episode(1).hdr).toBe('HDR10')
    expect(db.episode(1).thumbnailSource).toBe('A')
  })
})

describe('two servers with subtitles for the same episode', () => {
  const english = { English: { url: `${ROOT}/Season%201/S01E01.en.srt`, srcLang: 'en', lastModified: 'm1' } }
  const spanish = { Spanish: { url: `${ROOT}/Season%201/S01E01.es.srt`, srcLang: 'es', lastModified: 'm1' } }

  it.each(ORDERS)('keeps both servers\' languages, synced %s then %s', async (...order) => {
    const payloads = { A: showPayload([[1, { subtitles: english }]]), B: showPayload([[1, { subtitles: spanish }]]) }
    const db = makeDatabase()
    await run(db, payloads, order)
    await run(db, payloads, order, { forceSync: true })

    expect(Object.keys(db.episode(1).captionURLs).sort()).toEqual(['English', 'Spanish'])
    expect(db.episode(1).captionURLs.English.sourceServerId).toBe('A')
    expect(db.episode(1).captionURLs.Spanish.sourceServerId).toBe('B')
  })

  it.each(ORDERS)('removes only the language a server withdrew, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, { A: showPayload([[1, { subtitles: english }]]), B: showPayload([[1, { subtitles: spanish }]]) }, order)

    await run(db, { A: showPayload([[1, { subtitles: english }]]), B: showPayload([[1, { subtitles: null }]]) }, order)

    expect(Object.keys(db.episode(1).captionURLs)).toEqual(['English'])
  })
})

describe('a season folder that is not named "Season N"', () => {
  // "Season 01" is what the file server sends; the availability paths carry it.
  const zeroPadded = (serverPoster) =>
    showPayload([1], { seasonFolder: 'Season 01', ...(serverPoster === false ? { seasonPoster: false } : {}) })

  it.each(ORDERS)('still takes the season poster from the higher-priority server, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, { A: zeroPadded(), B: zeroPadded() }, order)

    expect(db.season(1).posterSource).toBe('A')
    expect(db.season(1).posterURL).toMatch(/^https:\/\/A\.example.*Season%2001/)
    expect(db.episode(1).thumbnailSource).toBe('A')
  })

  it.each(ORDERS)('uses the other server\'s poster when the higher-priority one has none, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, { A: zeroPadded(false), B: zeroPadded() }, order)

    expect(db.season(1).posterSource).toBe('B')
  })
})

describe('the main server holding the show folder without any episodes', () => {
  // The placeholder shape for a show: artwork and metadata on the main server,
  // the episodes on the other.
  const payloads = { A: showPayload([]), B: showPayload([1, 2]) }

  it.each(ORDERS)('keeps the other server\'s episodes and the main server\'s artwork, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, payloads, order)
    await run(db, payloads, order)

    expect(db.collections.FlatEpisodes.docs).toHaveLength(2)
    expect(db.episode(1).videoSource).toBe('B')
    expect(db.show().posterSource).toBe('A')
    expect(db.show().posterURL).toMatch(/^https:\/\/A\.example/)
    expect(db.show().visibleEpisodeCount).toBe(2)
    // The season is only on B, and its metadata is in the show's, which is A's.
    expect(db.season(1)).toMatchObject({ title: 'Season One', episodeCount: 7, metadataSource: 'A' })
    expect(db.season(1).metadata.name).toBe('Season One')
    expect(new Date(db.season(1).airDate).toISOString()).toBe('2008-01-20T00:00:00.000Z')
  })

  it('ends in the same documents in either order', async () => {
    const [first, second] = [makeDatabase(), makeDatabase()]
    await run(first, payloads, ['A', 'B'])
    await run(first, payloads, ['A', 'B'])
    await run(second, payloads, ['B', 'A'])
    await run(second, payloads, ['B', 'A'])

    expect(settled(second)).toEqual(settled(first))
  })
})

describe('file-server hashes that are ahead of the payload they came with', () => {
  // A scan can commit between the request for the payload and the requests for
  // its hashes. The skip decision used to be made on the hashes, so the new
  // ones were stamped on documents built from the old payload and the change
  // was skipped from then on. The hashes are no longer part of the decision.
  it('change nothing by themselves, and the changed payload is applied when it arrives', async () => {
    const before = showPayload([1, 2])
    const after = showPayload([[1, { hdr: null, mediaQuality: SDR, file: 'replaced.s01e01.mkv' }], 2])
    const db = makeDatabase()
    await run(db, { A: before }, ['A'])
    const stored = JSON.stringify(db.collections)

    // Old payload, new hashes: nothing to apply, and nothing recorded either.
    expect(statuses(await pass(db, 'A', { A: before }, { hashesOf: { A: after } }))).toEqual(['skipped'])
    expect(JSON.stringify(db.collections)).toBe(stored)
    // The same on a forced run, which does everything a normal pass would.
    await pass(db, 'A', { A: before }, { hashesOf: { A: after }, forceSync: true })
    expect(db.episode(1).hdr).toBe('HDR10')

    // The payload catches up. Its hashes are ones this run has already seen.
    const results = await pass(db, 'A', { A: after })

    expect(statuses(results)).not.toEqual(['skipped'])
    expect(db.episode(1).videoURL).toMatch(/replaced\.s01e01\.mkv$/)
    expect(db.episode(1)).not.toHaveProperty('hdr')
    // The episode that did not change is still skipped, and then it all settles.
    expect(results.find((r) => r.entityId === `${SHOW} S1E2`).status).toBe('skipped')
    expect(statuses(await pass(db, 'A', { A: after }))).toEqual(['skipped'])
  })
})

// ---------------------------------------------------------------- one season, two folder names

describe('two servers that name the same season folder differently', () => {
  // "Season 1" on one server and "Season 01" on the other are the same season.
  const fromB = { file: 'bb.s01e01.720p.mkv', hdr: null, mediaQuality: SDR }
  const payloads = {
    A: showPayload([1], { seasonFolder: 'Season 1' }),
    B: showPayload([[1, fromB]], { seasonFolder: 'Season 01' }),
  }

  it.each(ORDERS)('stores one season and one episode, owned by the higher-priority server, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, payloads, order)
    await run(db, payloads, order, { forceSync: true })

    expect(db.collections.FlatSeasons.docs).toHaveLength(1)
    expect(db.collections.FlatEpisodes.docs).toHaveLength(1)
    expect(db.season(1).posterSource).toBe('A')
    expect(db.episode(1)).toMatchObject({
      videoSource: 'A',
      hdr: 'HDR10',
      thumbnailSource: 'A',
      chapterSource: 'A',
      metadataSource: 'A',
      captionSource: 'A',
    })
    expect(db.episode(1).videoURL).toMatch(/^https:\/\/A\.example.*Season%201\//)
  })

  it('ends in the same documents in either order, and settles', async () => {
    const [first, second] = [makeDatabase(), makeDatabase()]
    await run(first, payloads, ['A', 'B'])
    await run(second, payloads, ['B', 'A'])
    expect(settled(second)).toEqual(settled(first))

    await run(first, payloads, ['A', 'B'])
    expect(statuses(await pass(first, 'A', payloads))).toEqual(['skipped'])
    expect(statuses(await pass(first, 'B', payloads))).toEqual(['skipped'])
  })

  it.each(ORDERS)('hands the episode over when the owner loses its file, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, payloads, order)
    await run(db, payloads, order)

    await run(db, { A: showPayload([2], { seasonFolder: 'Season 1' }), B: payloads.B }, order)

    expect(db.episode(1).videoSource).toBe('B')
    expect(db.episode(1).videoURL).toMatch(/^https:\/\/B\.example.*Season%2001\//)
    expect(db.episode(1)).not.toHaveProperty('hdr')
    expect(db.collections.FlatSeasons.docs).toHaveLength(1)
  })
})

// ---------------------------------------------------------------- a file the server could not probe

describe('an episode the file server could not probe this scan', () => {
  // What a processor publishes for a file it cannot read yet: the episode is
  // listed, and every fact about the file is null.
  const unprobed = () => {
    const payload = showPayload([[1, { hdr: null, mediaQuality: null, additionalMetadata: {} }], 2])
    payload.seasons['Season 1'].lengths.S01E01 = null
    payload.seasons['Season 1'].dimensions.S01E01 = null
    return payload
  }

  it('keeps the facts already stored instead of clearing them', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1, 2]) }, ['A'])

    await run(db, { A: unprobed() }, ['A'])

    expect(db.episode(1)).toMatchObject({ hdr: 'HDR10', duration: 2880001, dimensions: '3840x2160', size: 2 * 1024 * 1024 * 1024 })
    expect(db.episode(1).mediaQuality.isHDR).toBe(true)
  })

  it('takes the facts again once the probe succeeds', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1, 2]) }, ['A'])
    await run(db, { A: unprobed() }, ['A'])

    await run(db, { A: showPayload([[1, { hdr: null, mediaQuality: SDR }], 2]) }, ['A'])

    expect(db.episode(1)).not.toHaveProperty('hdr')
    expect(db.episode(1).mediaQuality.isHDR).toBe(false)
  })
})

// ---------------------------------------------------------------- a removal held back

describe('a removal held back because a server did not answer', () => {
  const english = { English: { url: `${ROOT}/Season%201/S01E01.en.srt`, srcLang: 'en', lastModified: 'm1' } }
  const spanish = { Spanish: { url: `${ROOT}/Season%201/S01E01.es.srt`, srcLang: 'es', lastModified: 'm1' } }
  const onlyA = { A: showPayload([[1, { subtitles: english }]]) }

  it('is carried out on the next run where every server answers, without a forced sync', async () => {
    const db = makeDatabase()
    const both = { ...onlyA, B: showPayload([[1, { subtitles: spanish }]]) }
    await run(db, both, ['A', 'B'])
    await run(db, both, ['A', 'B'])

    // B does not answer. Its subtitle is listed by nobody, and may not be removed.
    await run(db, onlyA, ['A'], { allProbed: false })
    expect(Object.keys(db.episode(1).captionURLs)).toEqual(['English', 'Spanish'])

    // Every server answers and B no longer has the show. A's payload and the
    // who-has-what picture are exactly what they were on the last run.
    const results = await pass(db, 'A', onlyA, { allProbed: true })

    expect(statuses(results)).not.toEqual(['skipped'])
    expect(Object.keys(db.episode(1).captionURLs)).toEqual(['English'])
    // And now it settles.
    expect(statuses(await pass(db, 'A', onlyA))).toEqual(['skipped'])
  })

  it('does not count the seasons of a server that did not answer as gone', async () => {
    const db = makeDatabase()
    const both = { A: showPayload([1]), B: showPayload([1], { seasonFolder: 'Season 2', season: 2 }) }
    await run(db, both, ['A', 'B'])
    expect(db.show().seasonCount).toBe(2)

    await run(db, { A: both.A }, ['A'], { allProbed: false })
    expect(db.show().seasonCount).toBe(2)

    await run(db, { A: both.A }, ['A'], { allProbed: true })
    expect(db.show().seasonCount).toBe(1)
  })
})

// ---------------------------------------------------------------- the same value whoever syncs first

describe('values that used to depend on which server synced first', () => {
  it.each(ORDERS)('names an episode from its metadata, whichever server has it, synced %s then %s', async (...order) => {
    const withoutMetadata = showPayload([1])
    delete withoutMetadata.seasons['Season 1'].episodes.S01E01.metadata
    const db = makeDatabase()
    await run(db, { A: withoutMetadata, B: showPayload([1]) }, order)

    expect(db.episode(1).title).toBe('Named by B: episode 1')
    expect(db.episode(1).metadataSource).toBe('B')
    expect(db.episode(1).videoSource).toBe('A')
  })

  it.each(ORDERS)('names an episode with no metadata from the video owner\'s file, synced %s then %s', async (...order) => {
    const bare = (derived) => {
      const payload = showPayload([[1, { derivedEpisodeName: derived }]])
      delete payload.seasons['Season 1'].episodes.S01E01.metadata
      return payload
    }
    const db = makeDatabase()
    await run(db, { A: bare('Pilot'), B: bare('pilot.720p') }, order)

    expect(db.episode(1).title).toBe('Pilot')
  })

  it.each(ORDERS)('counts a season\'s episodes across both servers when its metadata has no count, synced %s then %s', async (...order) => {
    mockShowMetadata = { id: 1396, name: 'Breaking Bad', seasons: [{ season_number: 1, name: 'Season One' }] }
    const db = makeDatabase()
    await run(db, { A: showPayload([1]), B: showPayload([1, 2, 3]) }, order)

    expect(db.season(1).episodeCount).toBe(3)
  })

  it.each(ORDERS)('takes the show\'s metadata from the server that has it, synced %s then %s', async (...order) => {
    // A show folder with no metadata file is published with `metadata: null`.
    const payloads = { A: showPayload([1], { metadata: null }), B: showPayload([1]) }
    const db = makeDatabase()
    await run(db, payloads, order)
    await run(db, payloads, order, { forceSync: true })

    expect(db.show().title).toBe('Breaking Bad')
    expect(db.show().metadata).toMatchObject({ id: 1396, name: 'Breaking Bad' })
    expect(db.episode(1).showTitle).toBe('Breaking Bad')
  })
})

// ---------------------------------------------------------------- the gate's own bookkeeping

describe('the skip gates without the file server\'s hashes', () => {
  it('skips an unchanged show on a run where the hash requests failed', async () => {
    const db = makeDatabase()
    const payloads = { A: showPayload([1, 2]) }
    await run(db, payloads, ['A'], { hashes: false })

    expect(statuses(await pass(db, 'A', payloads, { hashes: false }))).toEqual(['skipped'])
  })

  it('keeps the gates through such a run', async () => {
    const db = makeDatabase()
    const payloads = { A: showPayload([1, 2]) }
    await run(db, payloads, ['A'])
    const before = JSON.stringify(db.collections)

    expect(statuses(await pass(db, 'A', payloads, { hashes: false }))).toEqual(['skipped'])
    expect(JSON.stringify(db.collections)).toBe(before)
  })

  it('skips a show whose season folder is zero-padded', async () => {
    // The file server's per-season hash route cannot resolve "Season 01".
    const db = makeDatabase()
    const payloads = { A: showPayload([1, 2], { seasonFolder: 'Season 01' }) }
    await run(db, payloads, ['A'])

    expect(statuses(await pass(db, 'A', payloads))).toEqual(['skipped'])
  })

  it('skips a show that has a folder with no season number in its name', async () => {
    const payload = showPayload([1, 2])
    payload.seasons.Specials = {
      episodes: { 'Behind the Scenes': episodePayload(1, { seasonFolder: 'Specials' }) },
      lengths: {},
      dimensions: {},
    }
    const db = makeDatabase()
    await run(db, { A: payload }, ['A'])

    // Nothing is stored for a folder that is not a season...
    expect(db.collections.FlatSeasons.docs).toHaveLength(1)
    expect(db.collections.FlatEpisodes.docs).toHaveLength(2)
    // ...and its episodes are not counted as missing on every run.
    expect(statuses(await pass(db, 'A', { A: payload }))).toEqual(['skipped'])
  })
})

// ---------------------------------------------------------------- reading an episode number

describe('the episode number of a payload entry', () => {
  const service = new EpisodeSyncService(null, null, null)
  const number = (key, data = {}) => service.parseEpisodeNumber(key, data)

  it('is the number the file server sends, including 0', () => {
    expect(number('S01E05', { episodeNumber: 7 })).toBe(7)
    expect(number('S01E05', { episodeNumber: 0 })).toBe(0)
  })

  it.each([
    ['S01E05', 5],
    ['s02e00', 0],
    ['Show - S01E12 - Title.mkv', 12],
    ['1x07', 7],
    ['episode_5', 5],
    ['05 - Pilot.mp4', 5],
  ])('is read from the key "%s" as %i', (key, expected) => {
    expect(number(key)).toBe(expected)
  })

  it.each(['Show 2008 - 05.mkv', 'Pilot', ''])('is not guessed from the key "%s"', (key) => {
    expect(number(key)).toBeNull()
  })

  it('leaves an entry it cannot number out of the sync, without touching its neighbours', async () => {
    const payload = showPayload([1])
    payload.seasons['Season 1'].episodes['Show 2008 - 05.mkv'] = episodePayload(5)
    delete payload.seasons['Season 1'].episodes['Show 2008 - 05.mkv'].episodeNumber
    const db = makeDatabase()
    await run(db, { A: payload }, ['A'])

    expect(db.collections.FlatEpisodes.docs.map((d) => d.episodeNumber)).toEqual([1])
  })
})

// ---------------------------------------------------------------- a key published without a value

describe('a show-level file the main server\'s folder does not have', () => {
  // The file server publishes `logo`, `backdrop`, `poster` and `metadata` for
  // every show, null or '' when the folder has no such file.
  const LOGO = `${ROOT}/show_logo.png?hash=l1`
  const BACKDROP = `${ROOT}/show_backdrop.jpg?hash=b1`

  it.each(ORDERS)('is taken from the server that does have it, synced %s then %s', async (...order) => {
    const payloads = { A: showPayload([1]), B: showPayload([1], { logo: LOGO, backdrop: BACKDROP }) }
    const db = makeDatabase()
    await run(db, payloads, order)
    await run(db, payloads, order, { forceSync: true })

    expect(db.show()).toMatchObject({
      logo: `https://B.example${LOGO}`,
      logoSource: 'B',
      backdrop: `https://B.example${BACKDROP}`,
      backdropSource: 'B',
      // What both have still comes from the higher-priority server.
      posterSource: 'A',
    })
  })

  it('is removed from the show when the only server that had it loses it', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1], { logo: LOGO }) }, ['A'])
    expect(db.show().logo).toBe(`https://A.example${LOGO}`)

    await run(db, { A: showPayload([1], { logo: '' }) }, ['A'])

    expect(db.show()).not.toHaveProperty('logo')
    expect(db.show()).not.toHaveProperty('logoSource')
    expect(db.show().posterURL).toMatch(/show_poster\.jpg/)
  })

  it('is kept while the server that had it is not answering', async () => {
    const db = makeDatabase()
    const both = { A: showPayload([1]), B: showPayload([1], { logo: LOGO }) }
    await run(db, both, ['A', 'B'])

    await run(db, { A: both.A }, ['A'], { allProbed: false })
    expect(db.show().logo).toBe(`https://B.example${LOGO}`)

    // B answers again and no longer has the show: now it goes, with no forced sync.
    const results = await pass(db, 'A', { A: both.A }, { allProbed: true })
    expect(statuses(results)).not.toEqual(['skipped'])
    expect(db.show()).not.toHaveProperty('logo')
  })
})

// ---------------------------------------------------------------- season metadata

describe('a season the show-metadata owner does not hold', () => {
  it.each(ORDERS)('still gets its metadata from the show, synced %s then %s', async (...order) => {
    // A has the show's metadata and season 1; season 2 is only on B.
    const payloads = { A: showPayload([1]), B: showPayload([1], { seasonFolder: 'Season 2', season: 2, metadata: null }) }
    const db = makeDatabase()
    await run(db, payloads, order)
    await run(db, payloads, order)

    expect(db.season(1)).toMatchObject({ title: 'Season One', episodeCount: 7 })
    expect(db.season(2)).toMatchObject({ title: 'Season Two', episodeCount: 13, metadataSource: 'A' })
  })

  it('ends in the same documents in either order', async () => {
    const payloads = { A: showPayload([1]), B: showPayload([1], { seasonFolder: 'Season 2', season: 2, metadata: null }) }
    const [first, second] = [makeDatabase(), makeDatabase()]
    for (const [db, order] of [[first, ['A', 'B']], [second, ['B', 'A']]]) {
      await run(db, payloads, order)
      await run(db, payloads, order)
    }
    expect(settled(second)).toEqual(settled(first))
  })
})

// ---------------------------------------------------------------- dates

describe('dates taken from the metadata', () => {
  it('are stored as dates and not rewritten by a pass that changes nothing', async () => {
    const db = makeDatabase()
    const payloads = { A: showPayload([1]) }
    await run(db, payloads, ['A'])
    expect(new Date(db.show().firstAirDate).toISOString()).toBe('2008-01-20T00:00:00.000Z')
    const before = JSON.stringify(db.collections)

    // A forced pass rebuilds everything; with nothing changed it writes nothing.
    await pass(db, 'A', payloads, { forceSync: true })

    expect(JSON.stringify(db.collections)).toBe(before)
  })
})

// ---------------------------------------------------------------- blurhashes

describe('a blurhash the file server could not serve', () => {
  it('is fetched on the next run for an episode thumbnail, instead of the show being skipped without it', async () => {
    const db = makeDatabase()
    const payloads = { A: showPayload([1, 2]) }
    mockFailingUrls.add(/01 - Thumbnail\.jpg\.blurhash$/)
    await run(db, payloads, ['A'])
    expect(db.episode(1)).not.toHaveProperty('thumbnailBlurhash')
    expect(db.episode(2).thumbnailBlurhash).toMatch(/^blurhash-of:/)

    mockFailingUrls.clear()
    const retry = await pass(db, 'A', payloads)

    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(db.episode(1).thumbnailBlurhash).toMatch(/^blurhash-of:/)
    // The episode that was complete is not processed again.
    expect(retry.find((r) => r.entityId === `${SHOW} S1E2`).status).toBe('skipped')
    expect(statuses(await pass(db, 'A', payloads))).toEqual(['skipped'])
  })

  it('is fetched on the next run for the show poster and a season poster', async () => {
    const withBlurhashes = () => {
      const payload = showPayload([1], { posterBlurhash: `${ROOT}/show_poster.jpg.blurhash` })
      payload.seasons['Season 1'].seasonPosterBlurhash = `${ROOT}/Season%201/season_poster.jpg.blurhash`
      return payload
    }
    const db = makeDatabase()
    mockFailingUrls.add(/poster\.jpg\.blurhash$/)
    await run(db, { A: withBlurhashes() }, ['A'])
    expect(db.show()).not.toHaveProperty('posterBlurhash')
    expect(db.season(1)).not.toHaveProperty('posterBlurhash')

    mockFailingUrls.clear()
    const retry = await pass(db, 'A', { A: withBlurhashes() })

    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(db.show()).toMatchObject({ posterBlurhashSource: 'A' })
    expect(db.show().posterBlurhash).toMatch(/show_poster\.jpg\.blurhash#v1$/)
    expect(db.season(1).posterBlurhash).toMatch(/season_poster\.jpg\.blurhash#v1$/)
    expect(statuses(await pass(db, 'A', { A: withBlurhashes() }))).toEqual(['skipped'])
  })

  it('is fetched on the next run when only a season poster\'s failed', async () => {
    const payload = () => {
      const p = showPayload([1])
      p.seasons['Season 1'].seasonPosterBlurhash = `${ROOT}/Season%201/season_poster.jpg.blurhash`
      return p
    }
    const db = makeDatabase()
    mockFailingUrls.add(/season_poster\.jpg\.blurhash$/)
    await run(db, { A: payload() }, ['A'])
    expect(db.season(1)).not.toHaveProperty('posterBlurhash')

    mockFailingUrls.clear()
    const retry = await pass(db, 'A', { A: payload() })

    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(db.season(1)).toMatchObject({ posterBlurhashSource: 'A' })
    expect(db.season(1).posterBlurhash).toMatch(/season_poster\.jpg\.blurhash#v1$/)
  })

  it('does not leave the old image\'s blurhash when the thumbnail changed and the fetch failed', async () => {
    const withThumbnail = (hash) =>
      showPayload([[1, { thumbnail: `${ROOT}/Season%201/01 - Thumbnail.jpg?hash=${hash}` }]])
    const db = makeDatabase()
    await run(db, { A: withThumbnail('t1') }, ['A'])
    expect(db.episode(1).thumbnailBlurhash).toMatch(/#v1$/)

    mockImageVersion = 'v2'
    mockFailingUrls.add(/01 - Thumbnail\.jpg\.blurhash$/)
    await run(db, { A: withThumbnail('t2') }, ['A'])
    expect(db.episode(1).thumbnail).toMatch(/hash=t2$/)
    expect(db.episode(1)).not.toHaveProperty('thumbnailBlurhash')
    expect(db.episode(1)).not.toHaveProperty('thumbnailBlurhashSource')

    mockFailingUrls.clear()
    const retry = await pass(db, 'A', { A: withThumbnail('t2') })
    expect(statuses(retry)).not.toEqual(['skipped'])
    expect(db.episode(1).thumbnailBlurhash).toMatch(/#v2$/)
  })

  it('does not leave another server\'s blurhash under the owner\'s poster when the owner publishes none', async () => {
    const BLURHASH = `${ROOT}/show_poster.jpg.blurhash`
    const payloads = { A: showPayload([1]), B: showPayload([1], { posterBlurhash: BLURHASH }) }
    const [outage, steady] = [makeDatabase(), makeDatabase()]
    await run(outage, { B: payloads.B }, ['B'], { allProbed: false })
    expect(outage.show().posterBlurhashSource).toBe('B')
    await run(outage, payloads, ['A', 'B'])
    await run(steady, payloads, ['A', 'B'])

    expect(outage.show().posterSource).toBe('A')
    expect(outage.show()).not.toHaveProperty('posterBlurhash')
    expect(outage.show()).not.toHaveProperty('posterBlurhashSource')
    expect(steady.show()).not.toHaveProperty('posterBlurhash')
  })
})

describe('a blurhash and the image it is of', () => {
  const BLURHASH = `${ROOT}/show_poster.jpg.blurhash`

  it.each(ORDERS)('come from the same server, synced %s then %s', async (...order) => {
    const payloads = { A: showPayload([1], { posterBlurhash: BLURHASH }), B: showPayload([1], { posterBlurhash: BLURHASH }) }
    const db = makeDatabase()
    await run(db, payloads, order)

    expect(db.show()).toMatchObject({ posterSource: 'A', posterBlurhashSource: 'A' })
    expect(db.show().posterBlurhash).toBe(`blurhash-of:https://A.example${BLURHASH}#v1`)
  })

  it.each(ORDERS)('are not mixed when the image\'s owner has no blurhash, synced %s then %s', async (...order) => {
    // A owns the poster and publishes no blurhash for it; B has both.
    const payloads = { A: showPayload([1]), B: showPayload([1], { posterBlurhash: BLURHASH }) }
    const db = makeDatabase()
    await run(db, payloads, order)
    await run(db, payloads, order, { forceSync: true })

    expect(db.show().posterSource).toBe('A')
    expect(db.show()).not.toHaveProperty('posterBlurhash')
  })

  it.each(ORDERS)('move together when the owner returns after being down at the start, synced %s then %s', async (...order) => {
    const payloads = { A: showPayload([1], { posterBlurhash: BLURHASH }), B: showPayload([1], { posterBlurhash: BLURHASH }) }
    const db = makeDatabase()
    await run(db, { B: payloads.B }, ['B'], { allProbed: false })
    expect(db.show().posterBlurhashSource).toBe('B')

    await run(db, payloads, order)

    expect(db.show()).toMatchObject({ posterSource: 'A', posterBlurhashSource: 'A' })
    expect(db.episode(1)).toMatchObject({ thumbnailSource: 'A', thumbnailBlurhashSource: 'A' })
  })
})

// ---------------------------------------------------------------- counts held during an outage

describe('a season\'s episode count while a server is not answering', () => {
  it('does not drop, and is corrected once every server answers', async () => {
    // Without a count in the metadata, it is the episodes the servers hold between them.
    mockShowMetadata = { id: 1396, name: 'Breaking Bad', seasons: [{ season_number: 1, name: 'Season One' }] }
    const db = makeDatabase()
    const both = { A: showPayload([1, 2, 3]), B: showPayload([1]) }
    await run(db, both, ['A', 'B'])
    await run(db, both, ['A', 'B'])
    expect(db.season(1).episodeCount).toBe(3)

    // A does not answer: only B's one episode is in sight.
    await run(db, { B: both.B }, ['B'], { allProbed: false })
    expect(db.season(1).episodeCount).toBe(3)

    // Every server answers, and A no longer has the show.
    const results = await pass(db, 'B', { B: both.B }, { allProbed: true })
    expect(statuses(results)).not.toEqual(['skipped'])
    expect(db.season(1).episodeCount).toBe(1)
  })
})

// ---------------------------------------------------------------- when an episode entered the library

describe('an episode\'s library-add date with two servers', () => {
  const EARLY = '2023-03-01T00:00:00.000Z'
  const LATE = '2025-06-01T00:00:00.000Z'
  const seenOn = (firstSeen, extra = {}) =>
    showPayload([[1, { mediaIdentity: { id: 'mid:show:s01e01', scheme: 'mid', firstSeen }, ...extra }]])

  it.each(ORDERS)('is the earliest date any server holds, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, { A: seenOn(LATE), B: seenOn(EARLY) }, order)

    expect(new Date(db.episode(1).initialDiscoveryDate).toISOString()).toBe(EARLY)
    expect(db.episode(1).initialDiscoveryServer).toBe('B')
    expect(db.episode(1).videoSource).toBe('A')
  })

  it('does not depend on which server was down when the episode was first synced', async () => {
    const payloads = { A: seenOn(LATE), B: seenOn(EARLY) }
    const [aDown, steady] = [makeDatabase(), makeDatabase()]
    await run(aDown, { B: payloads.B }, ['B'], { allProbed: false })
    await run(aDown, payloads, ['A', 'B'])
    await run(aDown, payloads, ['A', 'B'])
    await run(steady, payloads, ['A', 'B'])
    await run(steady, payloads, ['A', 'B'])

    expect(settled(aDown).episodes).toEqual(settled(steady).episodes)
  })

  it.each(ORDERS)('names the higher-priority server when both hold the same date, synced %s then %s', async (...order) => {
    const db = makeDatabase()
    await run(db, { A: seenOn(EARLY), B: seenOn(EARLY) }, order)
    await run(db, { A: seenOn(EARLY), B: seenOn(EARLY) }, order)

    expect(db.episode(1).initialDiscoveryServer).toBe('A')
    expect(db.show().initialDiscoveryServer).toBe('A')
  })
})

// ---------------------------------------------------------------- a hand-over to a file not probed yet

describe('an episode handed to a server that has not probed its file yet', () => {
  it.each(ORDERS)('does not keep the previous file\'s facts, synced %s then %s', async (...order) => {
    const unprobedOnB = () => {
      const payload = showPayload([[1, { file: 'bb.s01e01.720p.mkv', hdr: null, mediaQuality: null, additionalMetadata: {} }]])
      payload.seasons['Season 1'].lengths.S01E01 = null
      payload.seasons['Season 1'].dimensions.S01E01 = null
      return payload
    }
    const db = makeDatabase()
    await run(db, { A: showPayload([1, 2]), B: unprobedOnB() }, order)
    expect(db.episode(1).hdr).toBe('HDR10')

    // A loses episode 1's file; B's has still not been probed.
    await run(db, { A: showPayload([2]), B: unprobedOnB() }, order)

    expect(db.episode(1).videoSource).toBe('B')
    for (const field of ['duration', 'dimensions', 'size', 'hdr', 'mediaQuality']) {
      expect(db.episode(1)).not.toHaveProperty(field)
    }
  })
})

// ---------------------------------------------------------------- three servers

describe('three servers', () => {
  const ALL_ORDERS = [
    ['A', 'B', 'C'], ['A', 'C', 'B'], ['B', 'A', 'C'], ['B', 'C', 'A'], ['C', 'A', 'B'], ['C', 'B', 'A'],
  ]
  // The main server has the show folder with its metadata and artwork only;
  // the episodes are split over the other two, which share episode 2.
  const payloads = {
    A: showPayload([]),
    B: showPayload([1, 2], { metadata: null }),
    C: showPayload([[2, { file: 'bb.s01e02.720p.mkv', hdr: null, mediaQuality: SDR }], 3], { metadata: null, seasonFolder: 'Season 01' }),
  }

  it('end in the same documents in every order, and every server is then skipped', async () => {
    const reference = makeDatabase()
    await run(reference, payloads, ALL_ORDERS[0])
    await run(reference, payloads, ALL_ORDERS[0])

    expect(reference.collections.FlatEpisodes.docs).toHaveLength(3)
    expect(reference.episode(2)).toMatchObject({ videoSource: 'B', hdr: 'HDR10' })
    expect(reference.episode(3).videoSource).toBe('C')
    expect(reference.show()).toMatchObject({ title: 'Breaking Bad', metadataSource: 'A', posterSource: 'A', visibleEpisodeCount: 3 })
    expect(reference.season(1)).toMatchObject({ title: 'Season One', posterSource: 'B' })

    for (const order of ALL_ORDERS.slice(1)) {
      const db = makeDatabase()
      await run(db, payloads, order)
      await run(db, payloads, order)

      expect(settled(db)).toEqual(settled(reference))
      // The documents are final after two runs. A pass that changed one in the
      // second run reopened the other servers' gates, so the third run is the
      // one in which each of them confirms it has nothing left to do.
      await run(db, payloads, order)
      expect(settled(db)).toEqual(settled(reference))
      for (const serverId of order) {
        expect(statuses(await pass(db, serverId, payloads))).toEqual(['skipped'])
      }
    }
  })
})

// ---------------------------------------------------------------- season metadata, withdrawn and locked

describe('a season the show\'s metadata stops listing', () => {
  it('loses what was copied from it, as a first sync against the same metadata would leave it', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1, 2]) }, ['A'])
    expect(db.season(1)).toMatchObject({ title: 'Season One', episodeCount: 7 })

    // The show's metadata file changes and no longer has an entry for season 1.
    mockShowMetadata = { id: 1396, name: 'Breaking Bad', seasons: [{ season_number: 2, name: 'Season Two', episode_count: 13 }] }
    const changed = showPayload([1, 2], { metadata: `${ROOT}/metadata.json?hash=s2` })
    await run(db, { A: changed }, ['A'])

    const fresh = makeDatabase()
    await run(fresh, { A: changed }, ['A'])

    expect(db.season(1).title).toBe('Season 1')
    expect(db.season(1).episodeCount).toBe(2)
    for (const field of ['metadata', 'metadataSource', 'airDate']) expect(db.season(1)).not.toHaveProperty(field)
    expect(settled(db).seasons).toEqual(settled(fresh).seasons)
  })

  it('keeps it all while the show\'s metadata says nothing about seasons', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1]) }, ['A'])

    // The show's metadata file is replaced by one with no seasons list at all
    // (an older generator's output): that is "unknown", not "withdrawn".
    mockShowMetadata = { id: 1396, name: 'Breaking Bad' }
    await run(db, { A: showPayload([1], { metadata: `${ROOT}/metadata.json?hash=s2` }) }, ['A'])

    expect(db.show().metadata).not.toHaveProperty('seasons')
    expect(db.season(1)).toMatchObject({ title: 'Season One', episodeCount: 7 })
    expect(db.season(1).metadata.name).toBe('Season One')
  })

  it('keeps it all when the show\'s metadata could not be fetched', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1]) }, ['A'])
    mockFailingUrls.add(/metadata\.json\?hash=s2$/)
    await run(db, { A: showPayload([1], { metadata: `${ROOT}/metadata.json?hash=s2` }) }, ['A'])

    expect(db.season(1)).toMatchObject({ title: 'Season One', episodeCount: 7 })
  })
})

describe('metadata an admin locked', () => {
  it('names the season, not the show\'s copy the lock discards', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1]) }, ['A'])
    Object.assign(db.season(1), {
      metadata: { season_number: 1, name: 'Book One', episode_count: 3 },
      title: 'Book One',
      episodeCount: 3,
      lockedFields: { metadata: true },
    })

    await run(db, { A: showPayload([1]) }, ['A'], { forceSync: true })

    expect(db.season(1).metadata.name).toBe('Book One')
    expect(db.season(1)).toMatchObject({ title: 'Book One', episodeCount: 3 })
  })

  it('names the episode, not the fetched copy the lock discards', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1]) }, ['A'])
    Object.assign(db.episode(1), {
      metadata: { episode_number: 1, name: 'Pilot (Extended)' },
      title: 'Pilot (Extended)',
      lockedFields: { metadata: true },
    })

    await run(db, { A: showPayload([1]) }, ['A'], { forceSync: true })

    expect(db.episode(1).metadata.name).toBe('Pilot (Extended)')
    expect(db.episode(1).title).toBe('Pilot (Extended)')
  })

  it('names the show, not the fetched copy the lock discards', async () => {
    const db = makeDatabase()
    await run(db, { A: showPayload([1]) }, ['A'])
    Object.assign(db.show(), {
      metadata: { ...db.show().metadata, name: 'Breaking Bad (Remastered)' },
      title: 'Breaking Bad (Remastered)',
      lockedFields: { metadata: true },
    })

    await run(db, { A: showPayload([1], { metadata: `${ROOT}/metadata.json?hash=s2` }) }, ['A'])

    expect(db.show().metadata.name).toBe('Breaking Bad (Remastered)')
    expect(db.show().title).toBe('Breaking Bad (Remastered)')
    // The locked copy still lists the season, so the season keeps its metadata.
    expect(db.season(1).title).toBe('Season One')
  })
})
