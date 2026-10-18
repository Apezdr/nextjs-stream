/**
 * @jest-environment node
 *
 * A season's or an episode's field belongs to the highest-priority server
 * among those the availability map lists for the field's exact path
 * (core/ownership). A server the map does not list never owns the field, even
 * when its own payload has something there.
 *
 * The season and episode checks used to count the syncing server as a
 * reporter whenever its payload had a value. For a payload the map records
 * under another leaf (an episode thumbnail published as `thumbnailURL`), the
 * builder then wrote the field while field-absence cleanup, seeing no server
 * report it, removed it in the same write: MongoDB rejects a `$set` and an
 * `$unset` of one path, the season's episodes failed to write on every run,
 * and the show's gate never closed.
 *
 * The real services and repositories run here against in-memory collections
 * that reject that conflict as MongoDB does.
 */

const mockServers = { A: { id: 'A', priority: 1 }, B: { id: 'B', priority: 2 } }

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: { getInstance: () => ({ config: { syncConcurrency: 1, httpConcurrency: 1 }, dbWriteLimitFor: () => (fn) => fn() }) },
  getResourceManager: () => ({}),
}))
jest.mock('p-limit', () => () => (fn) => fn())
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  logError: jest.fn(),
}))
jest.mock('@src/utils/config', () => ({
  getServer: (id) => {
    if (!mockServers[id]) throw new Error(`No server found with ID: ${id}`)
    return mockServers[id]
  },
  multiServerHandler: { getHandler: (id) => ({ createFullURL: (path) => `https://${id}.example${path}` }) },
}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: (url) => `nid:${url}` }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({
  fetchMetadataMultiServer: jest.fn(async (serverId, url, type) => {
    if (!url) return {}
    if (type === 'blurhash') return `blurhash-of:${url}`
    return { name: `Named by ${serverId}` }
  }),
}))

const isEqual = require('lodash/isEqual')
const { TVShowSyncService } = require('@src/utils/sync/domain/tv/TVShowSyncService')
const { SeasonSyncService } = require('@src/utils/sync/domain/tv/SeasonSyncService')
const { EpisodeSyncService } = require('@src/utils/sync/domain/tv/EpisodeSyncService')
const { TVShowRepository } = require('@src/utils/sync/infrastructure/database/TVShowRepository')
const { SeasonRepository } = require('@src/utils/sync/infrastructure/database/SeasonRepository')
const { EpisodeRepository } = require('@src/utils/sync/infrastructure/database/EpisodeRepository')
const { resolveCleanupConfig } = require('@src/utils/sync/core/FieldAbsenceCleaner')
const { MediaType, SyncOperation } = require('@src/utils/sync/core')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')

// ---------------------------------------------------------------- in-memory MongoDB

// MongoDB stores a field set to `undefined` as `null`.
const stored = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)))
const copy = (doc) => JSON.parse(JSON.stringify(doc))

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

let nextId = 1
function makeCollection() {
  const docs = []
  const collection = {
    docs,
    async findOne(filter) {
      const doc = docs.find((d) => matches(d, filter))
      return doc ? copy(doc) : null
    },
    find(filter) {
      const found = docs.filter((d) => matches(d, filter))
      const cursor = { sort: () => cursor, toArray: async () => found.map(copy) }
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
  return {
    collections,
    repositories: {
      tvShows: new TVShowRepository(client),
      seasons: new SeasonRepository(client),
      episodes: new EpisodeRepository(client),
    },
    show: () => collections.FlatTVShows.docs[0],
    season: () => collections.FlatSeasons.docs[0],
    episode: () => collections.FlatEpisodes.docs[0],
  }
}

// ---------------------------------------------------------------- payloads and passes

const SHOW = 'A Show (2020)'
const FOLDER = `/tv/${encodeURIComponent(SHOW)}/Season%201`

/** A show with one season and one episode; `episode` and `season` add or override fields. */
function showPayload({ episode = {}, season = {}, episodeKey = 'S01E01' } = {}) {
  return {
    metadata: null,
    poster: null,
    seasons: {
      'Season 1': {
        seasonNumber: 1,
        episodes: { [episodeKey]: { episodeNumber: 1, videoURL: `${FOLDER}/e1.mkv`, ...episode } },
        lengths: { [episodeKey]: 2880000 },
        dimensions: {},
        ...season,
      },
    },
  }
}

/** A map built from the payloads, as the sync route builds it. */
function availabilityOf(payloads) {
  const fieldAvailability = { movies: {}, tv: { [SHOW]: {} } }
  for (const [id, payload] of Object.entries(payloads)) {
    collectFieldAvailability(payload, '', id, fieldAvailability.tv[SHOW])
  }
  return fieldAvailability
}

/** One server's pass over the show; returns its results. */
async function pass(db, serverId, payload, { fieldAvailability = availabilityOf({ [serverId]: payload }), cleanup = resolveCleanupConfig(true) } = {}) {
  const { tvShows, seasons, episodes } = db.repositories
  const service = new TVShowSyncService(
    tvShows,
    new SeasonSyncService(seasons),
    new EpisodeSyncService(episodes, seasons),
    episodes,
    seasons
  )
  return service.syncTVShow(SHOW, {
    mediaType: MediaType.TVShow,
    operation: SyncOperation.Metadata,
    serverConfig: { ...mockServers[serverId], baseUrl: `https://${serverId}.example`, prefix: '', enabled: true },
    fieldAvailability,
    forceSync: true,
    fileServerData: { tv: { [SHOW]: payload } },
    cleanup,
    allEnabledServersProbed: true,
  })
}

const failures = (results) => results.filter((r) => r.status === 'failed').flatMap((r) => r.errors)
const url = (serverId, path) => `https://${serverId}.example${path}`

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})
beforeEach(() => {
  delete process.env.SYNC_FIELD_CLEANUP
})

// ---------------------------------------------------------------- cases

describe('an episode thumbnail published only under the old `thumbnailURL` key', () => {
  it('is not written, and the stored one nobody reports any more is removed in a write that succeeds', async () => {
    const db = makeDatabase()
    await pass(db, 'A', showPayload({ episode: { thumbnail: `${FOLDER}/t1.jpg` } }))
    expect(db.episode().thumbnail).toBe(url('A', `${FOLDER}/t1.jpg`))

    const results = await pass(db, 'A', showPayload({ episode: { thumbnailURL: `${FOLDER}/t2.jpg` } }))

    // It used to be written and removed in one update, which MongoDB rejects.
    expect(failures(results)).toEqual([])
    expect(db.episode().thumbnail).toBeUndefined()
    expect(db.episode().thumbnailSource).toBeUndefined()
    // The pass is complete, so the episode's and the show's gates close.
    expect(db.episode().syncGates?.A).toEqual(expect.any(String))
    expect(db.show().syncGates?.A).toEqual(expect.any(String))
  })

  it('is not written to an episode that has none', async () => {
    const db = makeDatabase()
    const results = await pass(db, 'A', showPayload({ episode: { thumbnailURL: `${FOLDER}/t1.jpg` } }))

    expect(failures(results)).toEqual([])
    expect(db.episode().thumbnail).toBeUndefined()
    expect(db.show().syncGates?.A).toEqual(expect.any(String))
  })
})

describe('season and episode fields the availability map does not list for the server', () => {
  // The pass's payload has every field; the map was built from one without
  // them, so it lists the server for none of them.
  const full = () =>
    showPayload({
      episode: {
        thumbnail: `${FOLDER}/t1.jpg`,
        chapters: `${FOLDER}/chapters/e1.vtt`,
        metadata: `${FOLDER}/E01_metadata.json`,
        subtitles: { English: { url: `${FOLDER}/e1.en.srt`, srcLang: 'en' } },
      },
      season: { season_poster: `${FOLDER}/season_poster.jpg` },
    })
  const bare = () => {
    const payload = showPayload()
    delete payload.seasons['Season 1'].episodes.S01E01.videoURL
    return payload
  }

  it('are not written', async () => {
    const db = makeDatabase()
    // Cleanup is off: this case is about who may write, not what is removed.
    await pass(db, 'A', full(), { fieldAvailability: availabilityOf({ A: bare() }), cleanup: undefined })

    expect(db.season().posterURL).toBeUndefined()
    const episode = db.episode()
    for (const field of ['videoURL', 'thumbnail', 'chapterURL', 'metadata', 'captionURLs']) {
      expect(episode[field]).toBeUndefined()
    }
  })

  it('do not replace another server\'s', async () => {
    const db = makeDatabase()
    const fromB = full()
    await pass(db, 'B', fromB)
    const before = { season: { ...db.season() }, episode: { ...db.episode() } }

    await pass(db, 'A', full(), { fieldAvailability: availabilityOf({ A: bare(), B: fromB }), cleanup: undefined })

    expect(db.season().posterURL).toBe(before.season.posterURL)
    expect(db.season().posterSource).toBe('B')
    for (const field of ['videoURL', 'videoSource', 'thumbnail', 'thumbnailSource', 'chapterURL', 'chapterSource', 'metadata', 'metadataSource', 'captionURLs']) {
      expect(db.episode()[field]).toEqual(before.episode[field])
    }
  })

  it('are written when the map lists the server', async () => {
    const db = makeDatabase()
    await pass(db, 'A', full(), { cleanup: undefined })

    expect(db.season().posterURL).toBe(url('A', `${FOLDER}/season_poster.jpg`))
    expect(db.episode()).toMatchObject({
      videoURL: url('A', `${FOLDER}/e1.mkv`),
      thumbnail: url('A', `${FOLDER}/t1.jpg`),
      chapterURL: url('A', `${FOLDER}/chapters/e1.vtt`),
      metadata: { name: 'Named by A' },
      captionURLs: { English: expect.objectContaining({ url: url('A', `${FOLDER}/e1.en.srt`) }) },
    })
  })
})

describe('an episode whose availability path cannot be built (an empty episode key)', () => {
  it('still takes the fields its own payload has, and loses none', async () => {
    const db = makeDatabase()
    const payload = showPayload({ episodeKey: '', episode: { thumbnail: `${FOLDER}/t1.jpg` } })
    const results = await pass(db, 'A', payload)

    expect(failures(results)).toEqual([])
    expect(db.episode()).toMatchObject({
      episodeNumber: 1,
      videoURL: url('A', `${FOLDER}/e1.mkv`),
      thumbnail: url('A', `${FOLDER}/t1.jpg`),
    })

    // Nothing reports a path for it, and still nothing is removed.
    await pass(db, 'A', payload)
    expect(db.episode().thumbnail).toBe(url('A', `${FOLDER}/t1.jpg`))
  })
})
