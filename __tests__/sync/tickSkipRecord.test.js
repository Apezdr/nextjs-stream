/**
 * @jest-environment node
 *
 * The ETags a tick sends are those of the last COMPLETE pass. syncAllServers
 * replaces the record with its running marker when a pass starts, and turns
 * the marker into a complete record only when every enabled server answered,
 * pre-tag stamped every collection and every server's pass ran to the end
 * with nothing failed — so a failed or partial pass is retried with a full
 * fetch. A Flat* delete outside the sync removes the marker, and the pass can
 * then not record itself.
 */

const mockCollections = {}
let mockServers = []

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection: (name) => mockCollections[name] }),
  }),
}))
jest.mock('@src/utils/config', () => ({ getAllServers: () => mockServers }))
jest.mock('chalk', () => {
  const paint = new Proxy((text) => text, { get: () => paint })
  return { __esModule: true, default: paint }
})
jest.mock('@src/utils/flatSync', () => ({ syncToFlatStructure: jest.fn() }))
jest.mock('@src/utils/flatSync/postSyncCleanup', () => ({ runPostSyncCleanup: jest.fn(async () => ({})) }))
jest.mock('@src/utils/flatSync/preTagSyncRunId', () => ({ preTagSyncRunId: jest.fn() }))
jest.mock('@src/utils/flatSync/computeMissingMedia', () => ({
  computeMissingMedia: jest.fn(async () => ({ missingMovies: [], missingTVShows: [] })),
}))
jest.mock('@src/utils/sync/core', () => ({ MediaType: { Movie: 'movie' }, SyncOperation: { Metadata: 'metadata' } }))
jest.mock('@src/utils/sync/core/events', () => ({
  syncEventBus: { emitStarted: jest.fn(), emitComplete: jest.fn() },
}))
jest.mock('@src/utils/fetchAllServerData', () => ({ fetchAllServerData: jest.fn() }))
jest.mock('@src/utils/watchHistory/migrate', () => ({ migratePlaybackStatusIfNeeded: jest.fn() }))
jest.mock('@src/utils/flatSync/watchHistoryValidation', () => ({ validateWatchHistoryAgainstDatabase: jest.fn() }))
jest.mock('@src/utils/sync/utils', () => ({ MediaType: { TV: 'tv', MOVIE: 'movie' } }))
jest.mock('@src/utils/admin_frontend_database', () => ({ updateMediaUpdates: jest.fn() }))

const { syncAllServers } = require('@src/utils/sync.js')
const { currentBootId, startPassRecord, recordCompletePass } = require('@src/utils/sync/tickSkip')
const { forgetAppliedPayloads, markPassRunning } = require('@src/utils/sync/appliedPayloads')
const { getSyncLockHolder, releaseSyncLock, tryAcquireSyncLock } = require('@src/utils/flatSync/syncContext')
const { SYNC_GATE_VERSION } = require('@src/utils/sync/core/syncGate')
const { syncToFlatStructure } = require('@src/utils/flatSync')
const { preTagSyncRunId } = require('@src/utils/flatSync/preTagSyncRunId')

const stored = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)))
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => doc[key] === value)

function memoryCollection(docs = []) {
  const collection = {
    docs: docs.map(stored),
    countDocuments: async (filter = {}) => collection.docs.filter((doc) => matches(doc, filter)).length,
    findOne: async (filter) => {
      const doc = collection.docs.find((d) => matches(d, filter))
      return doc ? stored(doc) : null
    },
    replaceOne: async (filter, replacement, { upsert } = {}) => {
      const i = collection.docs.findIndex((d) => matches(d, filter))
      if (i >= 0) collection.docs[i] = stored(replacement)
      else if (upsert) collection.docs.push(stored(replacement))
      return { matchedCount: i >= 0 ? 1 : 0 }
    },
    updateOne: async (filter, update, { upsert } = {}) => {
      let doc = collection.docs.find((d) => matches(d, filter))
      if (!doc && upsert) {
        doc = { ...filter }
        collection.docs.push(doc)
      }
      if (doc) Object.assign(doc, stored(update.$set || {}))
    },
    deleteOne: async (filter) => {
      collection.docs = collection.docs.filter((d) => !matches(d, filter))
    },
  }
  return collection
}

const ETAGS = {
  default: { tv: 'W/"tv-2"', movies: '"movies-1"' },
  server2: { tv: '"s2-tv-1"', movies: '"s2-movies-1"' },
}

const fileServers = {
  default: { config: { priority: 1, baseURL: 'https://files.example' }, movies: { 'Movie A': {} }, tv: { 'Show A': {} } },
  server2: { config: { priority: 2, baseURL: 'https://files2.example' }, movies: {}, tv: {} },
}

/** What the new architecture reports for a server's pass with nothing failed. */
const cleanPass = () => ({
  movies: { processed: 0, errors: 0, skipped: 1, details: [] },
  tvShows: { processed: 0, errors: 0, details: [] },
  seasons: { processed: 0, errors: 0, details: [] },
  episodes: { processed: 0, errors: 0, details: [] },
  errors: [],
  changedMedia: { movies: [], shows: [], seasons: [], episodes: [] },
})

const appliedRecord = () => mockCollections.syncInfo.docs.find((d) => d._id === 'appliedPayloads') ?? null

/** Pre-tag as it runs for real: stamp what the servers have, report full coverage. */
function preTagCovers({ ok = true } = {}) {
  preTagSyncRunId.mockImplementation(async (_fileServers, syncRunId) => {
    for (const name of ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']) {
      for (const doc of mockCollections[name].docs) {
        if (!doc.manualEntry) doc.syncRunId = syncRunId
      }
    }
    return { ok, skipped: false, syncRunId, coverage: {} }
  })
}

async function runPass(options = {}) {
  const result = await syncAllServers(fileServers, { movies: {}, tv: {} }, {
    allEnabledServersProbed: true,
    payloadETags: ETAGS,
    ...options,
  })
  // Let the background cleanup settle and release the orchestration lock
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
  return result
}

beforeEach(() => {
  mockServers = [{ id: 'default', priority: 1 }, { id: 'server2', priority: 2 }]
  mockCollections.FlatMovies = memoryCollection([
    { _id: 'm1', originalTitle: 'Movie A' },
    { _id: 'm2', originalTitle: 'Home Video', manualEntry: true },
  ])
  mockCollections.FlatTVShows = memoryCollection([{ _id: 's1', originalTitle: 'Show A' }])
  mockCollections.FlatSeasons = memoryCollection([{ _id: 'se1', showId: 's1', seasonNumber: 1 }])
  mockCollections.FlatEpisodes = memoryCollection([
    { _id: 'e1', showId: 's1', seasonNumber: 1, episodeNumber: 1 },
    { _id: 'e2', showId: 's1', seasonNumber: 1, episodeNumber: 2 },
  ])
  // A record from an earlier complete pass
  mockCollections.syncInfo = memoryCollection([{ _id: 'appliedPayloads', syncRunId: 'earlier-run', servers: {} }])
  syncToFlatStructure.mockReset()
  syncToFlatStructure.mockImplementation(async () => cleanPass())
  preTagCovers()
  jest.spyOn(console, 'info').mockImplementation(() => {})
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  // A case that hands the lock to a "newer run" gives it back here
  const holder = getSyncLockHolder()
  if (holder) releaseSyncLock(holder.syncRunId)
  jest.restoreAllMocks()
})

it('records the ETags a complete pass applied, with what the skip check compares against', async () => {
  const result = await runPass()

  expect(appliedRecord()).toEqual({
    _id: 'appliedPayloads',
    state: 'complete',
    servers: ETAGS,
    gateVersion: SYNC_GATE_VERSION,
    serversFingerprint: 'default:1,server2:2',
    bootId: currentBootId(),
    syncRunId: result.syncRunId,
    // The manual entry no server has is not counted
    documentCounts: { FlatMovies: 1, FlatTVShows: 1, FlatSeasons: 1, FlatEpisodes: 2 },
    recordedAt: expect.any(String),
  })
})

it('replaces the earlier record with its running marker before it writes anything', async () => {
  let recordWhenPreTagRan = 'not run'
  let runId = null
  preTagSyncRunId.mockImplementation(async (_fileServers, syncRunId) => {
    recordWhenPreTagRan = appliedRecord()
    runId = syncRunId
    return { ok: true, skipped: false, syncRunId, coverage: {} }
  })

  await runPass({ allEnabledServersProbed: false })

  expect(recordWhenPreTagRan).toMatchObject({ _id: 'appliedPayloads', state: 'running', syncRunId: runId })
  // Not complete, so the marker is all that is left
  expect(appliedRecord()).toMatchObject({ state: 'running', syncRunId: runId })
})

it('cannot record itself when a Flat* document was deleted outside the sync during the pass', async () => {
  // What deleteMovieAction does while the pass runs: delete, then forget.
  syncToFlatStructure.mockImplementation(async (_fs, serverConfig) => {
    if (serverConfig.id === 'server2') {
      mockCollections.FlatMovies.docs = mockCollections.FlatMovies.docs.filter((d) => d._id !== 'm1')
      await forgetAppliedPayloads()
    }
    return cleanPass()
  })

  await runPass()

  // The pass would have counted the database after the delete; nothing is
  // recorded, so the next tick is a full pass that puts the movie back.
  expect(appliedRecord()).toBeNull()
})

describe('a pass that did not complete is not recorded, so the next tick fetches in full', () => {
  it.each([
    ['a title failed on one server', () => {
      syncToFlatStructure.mockImplementation(async (_fs, serverConfig) =>
        serverConfig.id === 'server2' ? { ...cleanPass(), episodes: { processed: 0, errors: 1, details: [] } } : cleanPass()
      )
    }, {}],
    ['a show’s close-out failed (its gate not settled: one Failed show result, counted by the adapter)', () => {
      syncToFlatStructure.mockImplementation(async (_fs, serverConfig) =>
        serverConfig.id === 'default' ? { ...cleanPass(), tvShows: { processed: 1, errors: 1, details: [] } } : cleanPass()
      )
    }, {}],
    ['a whole phase of one server failed', () => {
      syncToFlatStructure.mockImplementation(async () => ({
        ...cleanPass(),
        errors: [{ phase: 'tvContentSync', error: 'TV sync failed' }],
      }))
    }, {}],
    ['one server’s pass threw', () => {
      syncToFlatStructure.mockImplementation(async (_fs, serverConfig) => {
        if (serverConfig.id === 'default') throw new Error('Mongo went away')
        return cleanPass()
      })
    }, {}],
    ['not every enabled server answered', () => {}, { allEnabledServersProbed: false }],
    ['pre-tag did not cover every collection', () => preTagCovers({ ok: false }), {}],
    ['a server sent no ETag for a payload', () => {}, { payloadETags: { ...ETAGS, server2: { tv: '"s2-tv-1"', movies: null } } }],
    ['the caller passed no ETags', () => {}, { payloadETags: undefined }],
  ])('when %s', async (_label, arrange, options) => {
    arrange()

    await runPass(options)

    expect(appliedRecord()).toMatchObject({ state: 'running' })
  })
})

describe('a run that no longer holds the sync lock neither marks nor records', () => {
  // The watchdog released a hung pass's lock, and a stale takeover may have
  // started a newer pass: the old one must not write the record.
  const client = { db: () => ({ collection: (name) => mockCollections[name] }) }

  it('does not replace a newer pass’s running marker with its own', async () => {
    expect(tryAcquireSyncLock('newer-run')).toBe(true)
    await markPassRunning(client, 'newer-run')

    await startPassRecord(client, 'zombie-run')

    expect(appliedRecord()).toMatchObject({ state: 'running', syncRunId: 'newer-run' })
  })

  it('does not mark itself running when no run holds the lock', async () => {
    await startPassRecord(client, 'zombie-run')

    expect(appliedRecord()).toEqual({ _id: 'appliedPayloads', syncRunId: 'earlier-run', servers: {} })
  })

  it.each([
    ['a newer run holds it', () => expect(tryAcquireSyncLock('newer-run')).toBe(true)],
    ['no run holds it', () => {}],
  ])('does not record itself complete over its own marker when %s', async (_label, arrange) => {
    await markPassRunning(client, 'zombie-run')
    arrange()

    const recorded = await recordCompletePass({
      client,
      syncRunId: 'zombie-run',
      results: { errors: [], flatSyncResults: { default: cleanPass(), server2: cleanPass() } },
      preTagResult: { ok: true, skipped: false },
      fileServers,
      allEnabledServersProbed: true,
      payloadETags: ETAGS,
    })

    expect(recorded).toBe(false)
    expect(appliedRecord()).toMatchObject({ state: 'running', syncRunId: 'zombie-run' })
  })

  it('a pass whose lock the watchdog released while it ran is not recorded', async () => {
    // The pass hangs long enough for the watchdog; nothing else has started yet
    syncToFlatStructure.mockImplementation(async () => {
      const holder = getSyncLockHolder()
      if (holder) releaseSyncLock(holder.syncRunId)
      return cleanPass()
    })

    const result = await runPass()

    // Every server's pass completed and its own marker is still there, so only
    // the lock check stops the record
    expect(result.errors).toEqual([])
    expect(appliedRecord()).toMatchObject({ state: 'running', syncRunId: result.syncRunId })
  })
})
