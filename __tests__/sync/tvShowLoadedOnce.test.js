/**
 * @jest-environment node
 *
 * A pass over a show reads the show twice: before its write (the gate check,
 * the drift checks and the show's plan) and once after it. The seasons, the
 * episodes and the close-out work from that second copy, the show as stored:
 * the write drops a locked field and a new show gets its id only when it is
 * inserted, so the show the pass planned is not what they must copy. A skip,
 * and a show write that fails, read the show once.
 *
 * The real services and repositories run against in-memory collections.
 */

const mockServers = { A: { id: 'A', priority: 1 } }

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
    if (type === 'blurhash') return `blurhash-of:${url}`
    return { name: 'Show Name', seasons: [{ season_number: 1, name: 'Season One', episode_count: 1 }] }
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
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => isEqual(doc[key], value))

let nextId = 1
function makeCollection(docs = []) {
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
    // The visible-episode filter is not modelled: every episode of the show counts.
    async countDocuments(filter) {
      return docs.filter((d) => matches(d, filter.showId !== undefined ? { showId: filter.showId } : filter)).length
    },
    async updateOne(filter, update, options = {}) {
      let doc = docs.find((d) => matches(d, filter))
      if (!doc) {
        if (!options.upsert) return { matchedCount: 0 }
        doc = { _id: `id${nextId++}`, ...filter, ...stored(update.$setOnInsert || {}) }
        docs.push(doc)
        return { upsertedCount: 1 }
      }
      Object.assign(doc, stored(update.$set || {}))
      for (const key of Object.keys(update.$unset || {})) delete doc[key]
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

/**
 * The three collections behind the real repositories. The show repository
 * counts its reads; `failShowWrite` fails the show's first write and
 * `failShowRead` the read with that number.
 */
function makeDatabase({ show = null, failShowWrite = false, failShowRead = 0 } = {}) {
  const collections = {
    FlatTVShows: makeCollection(show ? [copy(show)] : []),
    FlatSeasons: makeCollection(),
    FlatEpisodes: makeCollection(),
  }
  const client = { db: () => ({ collection: (name) => collections[name] }) }
  const tvShows = new TVShowRepository(client)
  const read = tvShows.findByOriginalTitle.bind(tvShows)
  const write = tvShows.smartUpsert.bind(tvShows)
  const counts = { showReads: 0, showWrites: 0 }
  tvShows.findByOriginalTitle = async (title) => {
    counts.showReads += 1
    if (counts.showReads === failShowRead) throw new Error('read failed')
    return read(title)
  }
  tvShows.smartUpsert = async (...args) => {
    counts.showWrites += 1
    if (failShowWrite && counts.showWrites === 1) throw new Error('show write failed')
    return write(...args)
  }
  const seasons = new SeasonRepository(client)
  const episodes = new EpisodeRepository(client)
  const service = new TVShowSyncService(
    tvShows,
    new SeasonSyncService(seasons),
    new EpisodeSyncService(episodes, seasons),
    episodes,
    seasons
  )
  return { collections, counts, service }
}

const SHOW = 'A Show (2020)'
const ROOT = `/tv/${encodeURIComponent(SHOW)}`
const PAYLOAD = {
  metadata: `${ROOT}/metadata.json`,
  poster: null,
  seasons: {
    'Season 1': {
      seasonNumber: 1,
      episodes: { S01E01: { episodeNumber: 1, videoURL: `${ROOT}/Season%201/e1.mkv` } },
      lengths: { S01E01: 2880000 },
      dimensions: {},
    },
  },
}

/** Server A's pass over the show. */
function pass(db, { forceSync = false } = {}) {
  const fieldAvailability = { movies: {}, tv: { [SHOW]: {} } }
  collectFieldAvailability(PAYLOAD, '', 'A', fieldAvailability.tv[SHOW])
  return db.service.syncTVShow(SHOW, {
    mediaType: MediaType.TVShow,
    operation: SyncOperation.Metadata,
    serverConfig: { ...mockServers.A, baseUrl: 'https://A.example', prefix: '', enabled: true },
    fieldAvailability,
    forceSync,
    fileServerData: { tv: { [SHOW]: PAYLOAD } },
    cleanup: resolveCleanupConfig(true),
    allEnabledServersProbed: true,
  })
}

const statuses = (results) => results.map((r) => r.status)
const show = (db) => db.collections.FlatTVShows.docs[0]
const season = (db) => db.collections.FlatSeasons.docs[0]
const episode = (db) => db.collections.FlatEpisodes.docs[0]

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})

describe('how often a pass reads the show', () => {
  it('twice on a full pass, and once on a pass skipped on its gate', async () => {
    const db = makeDatabase()
    expect(statuses(await pass(db))).toEqual(['completed', 'completed', 'completed'])
    expect(db.counts.showReads).toBe(2)
    expect(show(db).syncGates?.A).toBeDefined()

    expect(statuses(await pass(db))).toEqual(['skipped'])
    expect(db.counts.showReads).toBe(3)
  })

  it('twice on a forced pass', async () => {
    const db = makeDatabase()
    await pass(db, { forceSync: true })
    expect(db.counts.showReads).toBe(2)
  })

  it('once when the show write fails, and nothing under the show is written', async () => {
    const db = makeDatabase({ failShowWrite: true })
    const results = await pass(db)
    expect(statuses(results)).toEqual(['failed'])
    expect(results[0].errors[0]).toContain('show write failed')
    expect(db.counts.showReads).toBe(1)
    expect(db.collections.FlatSeasons.docs).toHaveLength(0)
    expect(db.collections.FlatEpisodes.docs).toHaveLength(0)
  })

  it('fails the pass with one result when the read after the write fails, and leaves the gate unstamped', async () => {
    const db = makeDatabase({ failShowRead: 2 })
    const results = await pass(db)
    expect(statuses(results)).toEqual(['completed', 'failed'])
    expect(results[1].errors[0]).toContain('read failed')
    expect(db.collections.FlatSeasons.docs).toHaveLength(0)
    expect(db.collections.FlatEpisodes.docs).toHaveLength(0)
    expect(show(db).syncGates?.A).toBeUndefined()
  })
})

describe('the show the seasons and episodes copy', () => {
  it('is the stored show: a new show\'s inserted id', async () => {
    const db = makeDatabase()
    await pass(db)
    expect(show(db)._id).toBeDefined()
    expect(season(db).showId).toBe(show(db)._id)
    expect(episode(db).showId).toBe(show(db)._id)
    expect(season(db).showTitle).toBe('Show Name')
    expect(episode(db).showTitle).toBe('Show Name')
  })

  it('is the stored show: a locked display title, not the one the pass derived', async () => {
    const db = makeDatabase({
      show: { _id: 'show-1', originalTitle: SHOW, title: 'Admin Title', type: 'tvShow', lockedFields: { title: true } },
    })
    await pass(db)
    expect(show(db).title).toBe('Admin Title')
    expect(season(db).showTitle).toBe('Admin Title')
    expect(episode(db).showTitle).toBe('Admin Title')
    expect(season(db).showId).toBe('show-1')
  })
})

describe('the wroteDocument flag of each TV plan', () => {
  // Set where the builder stamps lastSynced, as for the movie steps.
  const agrees = (outcome) => expect(outcome.wroteDocument).toBe(Object.prototype.hasOwnProperty.call(outcome.plan.set, 'lastSynced'))
  const context = {
    serverConfig: { ...mockServers.A, baseUrl: 'https://A.example', prefix: '', enabled: true },
    fieldAvailability: { movies: {}, tv: { [SHOW]: {} } },
    fileServerData: { tv: { [SHOW]: PAYLOAD } },
    allEnabledServersProbed: true,
  }
  const seasonData = PAYLOAD.seasons['Season 1']

  it('is set by the show, season and episode builders, which always stamp lastSynced', async () => {
    const shows = await makeDatabase().service.planTVShow(SHOW, PAYLOAD, context, null)
    const seasons = await new SeasonSyncService(null).planSeason(SHOW, 'Show Name', 1, seasonData, context, null, 'show-1', null, 'Season 1')
    const episodes = await new EpisodeSyncService(null, null).planEpisode(
      SHOW, 'Show Name', 1, 1, seasonData.episodes.S01E01, context, null, 'show-1', 'season-1', null, seasonData, 'S01E01'
    )
    for (const outcome of [shows, seasons, episodes]) {
      expect(outcome.wroteDocument).toBe(true)
      agrees(outcome)
    }
  })
})
