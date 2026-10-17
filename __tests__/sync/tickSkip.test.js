/**
 * @jest-environment node
 *
 * A sync tick is skipped — no parse, no fieldAvailability, no pass, no
 * cleanup — only when a full pass would change nothing: forceSync is off, a
 * complete pass is on record under the current gate version, server set and
 * process, every document that pass covered is still there and carries every
 * enabled server's gate, and every server answers 304 for both payloads.
 * Anything else is a full pass, fetched without If-None-Match.
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
jest.mock('@src/utils/fetchAllServerData', () => ({ fetchAllServerData: jest.fn() }))
jest.mock('@src/utils/watchHistory/migrate', () => ({ migratePlaybackStatusIfNeeded: jest.fn(async () => {}) }))
jest.mock('@src/utils/flatSync/watchHistoryValidation', () => ({
  validateWatchHistoryAgainstDatabase: jest.fn(async () => ({ markedValid: 1, markedInvalid: 0 })),
}))
jest.mock('@src/utils/sync/core/events', () => ({
  syncEventBus: { emitStarted: jest.fn(), emitComplete: jest.fn() },
}))
// sync/database's own imports; only its syncInfo helpers are used here
jest.mock('@src/utils/sync/utils', () => ({ MediaType: { TV: 'tv', MOVIE: 'movie' } }))
jest.mock('@src/utils/admin_frontend_database', () => ({ updateMediaUpdates: jest.fn() }))

const { fetchSyncTick, currentBootId } = require('@src/utils/sync/tickSkip')
const { SYNC_GATE_VERSION } = require('@src/utils/sync/core/syncGate')
const { fetchAllServerData } = require('@src/utils/fetchAllServerData')
const { validateWatchHistoryAgainstDatabase } = require('@src/utils/flatSync/watchHistoryValidation')
const { migratePlaybackStatusIfNeeded } = require('@src/utils/watchHistory/migrate')
const { syncEventBus } = require('@src/utils/sync/core/events')

// A deep copy as MongoDB stores it: a field set to `undefined` comes back `null`.
function stored(value) {
  if (value === undefined) return null
  if (value === null || typeof value !== 'object' || value instanceof Date) return value
  if (Array.isArray(value)) return value.map(stored)
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, stored(v)]))
}

const readPath = (doc, path) => path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc)

/** Just the matching the skip check and the syncInfo helpers use. */
function matches(doc, filter) {
  return Object.entries(filter).every(([path, condition]) => {
    const value = readPath(doc, path)
    if (condition && typeof condition === 'object' && '$in' in condition) {
      return condition.$in.some((candidate) => (candidate === null ? value == null : value === candidate))
    }
    if (condition && typeof condition === 'object' && '$ne' in condition) {
      // A missing field is "not equal" to anything but null
      return condition.$ne === null ? value != null : value !== condition.$ne
    }
    if (condition && typeof condition === 'object' && '$lt' in condition) {
      // Only a date compares with a date; a missing field never matches
      return value instanceof Date && value < condition.$lt
    }
    return value === condition
  })
}

function memoryCollection(docs = []) {
  const collection = {
    docs: docs.map(stored),
    countDocuments: jest.fn(async (filter = {}) => collection.docs.filter((doc) => matches(doc, filter)).length),
    findOne: async (filter) => {
      const doc = collection.docs.find((d) => matches(d, filter))
      return doc ? stored(doc) : null
    },
    replaceOne: async (filter, replacement, { upsert } = {}) => {
      const i = collection.docs.findIndex((d) => matches(d, filter))
      if (i >= 0) collection.docs[i] = stored(replacement)
      else if (upsert) collection.docs.push(stored(replacement))
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

const RUN = 'run-of-the-last-complete-pass'
const gate = (n) => `g${SYNC_GATE_VERSION}:payload-${n}#availability-${n}`
const ETAGS = { default: { tv: 'W/"tv-1"', movies: '"movies-1"' } }

function record(overrides = {}) {
  return {
    _id: 'appliedPayloads',
    state: 'complete',
    bootId: currentBootId(),
    servers: ETAGS,
    gateVersion: SYNC_GATE_VERSION,
    serversFingerprint: 'default:1',
    syncRunId: RUN,
    documentCounts: { FlatMovies: 2, FlatTVShows: 1, FlatSeasons: 1, FlatEpisodes: 2 },
    ...overrides,
  }
}

const WRITTEN = new Date('2026-10-16T12:00:00Z')

function install({ syncInfo = [record()] } = {}) {
  mockCollections.FlatMovies = memoryCollection([
    { _id: 'm1', originalTitle: 'Movie A', syncRunId: RUN, syncGates: { default: gate(1) }, updatedAt: WRITTEN },
    { _id: 'm2', originalTitle: 'Movie B', syncRunId: RUN, syncGates: { default: gate(2) }, updatedAt: WRITTEN },
    // Made in /admin/media and on no file server: never stamped, never gated
    { _id: 'm3', originalTitle: 'Home Video', manualEntry: true, updatedAt: WRITTEN },
  ])
  mockCollections.FlatTVShows = memoryCollection([
    { _id: 's1', originalTitle: 'Show A', syncRunId: RUN, syncGates: { default: gate(3) }, updatedAt: WRITTEN },
  ])
  // Seasons carry no gate: they are gated through their show
  mockCollections.FlatSeasons = memoryCollection([
    { _id: 'se1', showId: 's1', seasonNumber: 1, syncRunId: RUN, updatedAt: WRITTEN },
  ])
  mockCollections.FlatEpisodes = memoryCollection([
    { _id: 'e1', showId: 's1', seasonNumber: 1, episodeNumber: 1, syncRunId: RUN, syncGates: { default: gate(4) }, updatedAt: WRITTEN },
    { _id: 'e2', showId: 's1', seasonNumber: 1, episodeNumber: 2, syncRunId: RUN, syncGates: { default: gate(5) }, updatedAt: WRITTEN },
  ])
  mockCollections.syncInfo = memoryCollection(syncInfo)
}

const unchanged = (statuses = { default: { tv: 304, movies: 304 } }) => ({
  fileServers: {},
  errors: [],
  notModified: true,
  statuses,
  etags: ETAGS,
})

const fullPayloads = (statuses = { default: { tv: 200, movies: 200 } }) => ({
  fileServers: { default: { config: { priority: 1 }, tv: { 'Show A': {} }, movies: { 'Movie A': {} } } },
  errors: [],
  notModified: false,
  statuses,
  etags: { default: { tv: 'W/"tv-2"', movies: '"movies-1"' } },
})

/** Answers like the servers would: 304 to a conditional fetch, the payloads otherwise. */
function serversUnchanged() {
  fetchAllServerData.mockImplementation(async (options = {}) => (options.validators ? unchanged() : fullPayloads()))
}

beforeEach(() => {
  mockServers = [{ id: 'default', priority: 1 }]
  install()
  fetchAllServerData.mockReset()
  validateWatchHistoryAgainstDatabase.mockClear()
  migratePlaybackStatusIfNeeded.mockClear()
  syncEventBus.emitStarted.mockClear()
  syncEventBus.emitComplete.mockClear()
  jest.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a tick that would change nothing', () => {
  it('is skipped: the stored ETags are sent and no payload is downloaded', async () => {
    serversUnchanged()

    const tick = await fetchSyncTick()

    expect(fetchAllServerData).toHaveBeenCalledTimes(1)
    expect(fetchAllServerData).toHaveBeenCalledWith({ validators: ETAGS })
    expect(tick.skipped).toBe(true)
    expect(tick.result).toMatchObject({
      skipped: true,
      reason: 'payloads_unchanged',
      servers: { default: { tv: 304, movies: 304 } },
      lastCompleteSyncRunId: RUN,
      errors: [],
      changedMedia: { movies: [], shows: [], seasons: [], episodes: [] },
    })
  })

  it('logs the skip once, in one line with each server’s statuses', async () => {
    serversUnchanged()

    await fetchSyncTick()

    const lines = console.info.mock.calls.map(([line]) => line)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('Tick skipped')
    expect(lines[0]).toContain('default tv=304 movies=304')
  })

  it('still records the sync time, revalidates watch history and closes the sync popup', async () => {
    serversUnchanged()

    const { result } = await fetchSyncTick()

    expect(mockCollections.syncInfo.docs.find((d) => d._id === 'lastSyncTime')?.timestamp).toBeTruthy()
    expect(validateWatchHistoryAgainstDatabase).toHaveBeenCalledTimes(1)
    expect(migratePlaybackStatusIfNeeded).toHaveBeenCalledTimes(1)
    expect(syncEventBus.emitStarted).toHaveBeenCalledWith('__sync_warmup__', expect.anything(), 'server-all')
    expect(syncEventBus.emitComplete).toHaveBeenCalledWith(
      '__sync_complete__', expect.anything(), 'server-all', expect.anything(), { summary: result }
    )
  })

  it('even with a document post-sync cleanup never deletes (no updatedAt) left from an older run', async () => {
    mockCollections.FlatEpisodes.docs.push(stored({ _id: 'legacy', showId: 's1', seasonNumber: 9, syncRunId: 'older-run' }))
    serversUnchanged()

    const tick = await fetchSyncTick()

    expect(tick.skipped).toBe(true)
  })

  it('leaves the record of the last complete pass as it was', async () => {
    serversUnchanged()
    const before = stored(mockCollections.syncInfo.docs.find((d) => d._id === 'appliedPayloads'))

    await fetchSyncTick()

    expect(mockCollections.syncInfo.docs.find((d) => d._id === 'appliedPayloads')).toEqual(before)
  })
})

describe('a full pass, fetched without If-None-Match', () => {
  const expectFullPass = async (reasonPart) => {
    serversUnchanged()
    const tick = await fetchSyncTick()
    expect(tick.skipped).toBe(false)
    expect(fetchAllServerData).toHaveBeenCalledTimes(1)
    expect(fetchAllServerData).toHaveBeenCalledWith({})
    expect(tick.reason).toContain(reasonPart)
    expect(validateWatchHistoryAgainstDatabase).not.toHaveBeenCalled()
    return tick
  }

  it.each([
    ['a movie', 'FlatMovies', 'm1'],
    ['a show', 'FlatTVShows', 's1'],
    ['an episode', 'FlatEpisodes', 'e2'],
  ])('when %s lacks the server’s gate (an admin edit removes them all)', async (_label, name, id) => {
    const doc = mockCollections[name].docs.find((d) => d._id === id)
    delete doc.syncGates

    await expectFullPass(`${name}=1`)
  })

  it('when a document holds another server’s gate but not this one’s', async () => {
    mockCollections.FlatTVShows.docs[0].syncGates = { server2: gate(9) }

    await expectFullPass('open gates (default: FlatTVShows=1)')
  })

  it('when a gate was stored as null', async () => {
    mockCollections.FlatEpisodes.docs[0].syncGates = stored({ default: undefined })
    expect(mockCollections.FlatEpisodes.docs[0].syncGates).toEqual({ default: null })

    await expectFullPass('FlatEpisodes=1')
  })

  it('when a document the last pass covered was deleted', async () => {
    mockCollections.FlatMovies.docs = mockCollections.FlatMovies.docs.filter((d) => d._id !== 'm2')

    await expectFullPass('FlatMovies 2 -> 1')
  })

  it('when the last pass’s post-sync cleanup left an orphan behind (it failed or refused)', async () => {
    mockCollections.FlatMovies.docs.push(
      stored({ _id: 'gone', originalTitle: 'Removed From Disk', syncRunId: 'older-run', updatedAt: WRITTEN })
    )

    await expectFullPass('documents left for post-sync cleanup (FlatMovies=1)')
  })

  it('when the sync was started from the admin UI (only webhook ticks skip)', async () => {
    serversUnchanged()

    const tick = await fetchSyncTick({ allowSkip: false })

    expect(tick.skipped).toBe(false)
    expect(fetchAllServerData).toHaveBeenCalledWith({})
    expect(tick.reason).toBe('started from the admin UI (only webhook ticks skip)')
    expect(mockCollections.syncInfo.docs.find((d) => d._id === 'lastSyncTime')).toBeUndefined()
  })

  it('when forceSync is on', async () => {
    serversUnchanged()

    const tick = await fetchSyncTick({ forceSync: true })

    expect(tick.skipped).toBe(false)
    expect(fetchAllServerData).toHaveBeenCalledWith({})
    expect(tick.reason).toBe('force sync requested')
    expect(mockCollections.FlatMovies.countDocuments).not.toHaveBeenCalled()
  })

  it('when SYNC_GATE_VERSION changed since the last complete pass', async () => {
    install({ syncInfo: [record({ gateVersion: SYNC_GATE_VERSION - 1 })] })

    await expectFullPass('gate version changed')
  })

  it('when a server’s priority changed', async () => {
    mockServers = [{ id: 'default', priority: 2 }]

    await expectFullPass('servers or priorities changed (default:1 -> default:2)')
  })

  it('when a server was added', async () => {
    mockServers = [{ id: 'default', priority: 1 }, { id: 'server2', priority: 2 }]

    await expectFullPass('servers or priorities changed')
  })

  it('when no complete pass is on record', async () => {
    install({ syncInfo: [] })

    await expectFullPass('no complete pass on record')
  })

  it('when the last pass left only its running marker (still running, or it did not complete)', async () => {
    install({ syncInfo: [{ _id: 'appliedPayloads', state: 'running', syncRunId: 'run-that-never-finished' }] })

    await expectFullPass('the last pass is still running or did not complete')
  })

  it('on the first tick since the app started (a restart or a deploy)', async () => {
    install({ syncInfo: [record({ bootId: 'the-process-before-this-one' })] })

    await expectFullPass('first tick since the app started')
  })

  it('when the skip check itself fails', async () => {
    mockCollections.FlatEpisodes.countDocuments.mockRejectedValue(new Error('connection reset'))

    await expectFullPass('skip check failed: connection reset')
  })

  it('when a document only one of two servers has lacks the other’s gate (fails safe)', async () => {
    mockServers = [{ id: 'default', priority: 1 }, { id: 'server2', priority: 2 }]
    install({
      syncInfo: [record({
        serversFingerprint: 'default:1,server2:2',
        servers: { ...ETAGS, server2: { tv: '"s2-tv"', movies: '"s2-movies"' } },
      })],
    })

    await expectFullPass('server2: FlatMovies=2')
  })
})

describe('when a payload changed', () => {
  it('passes every payload on for a full pass, with their ETags and statuses', async () => {
    const reply = fullPayloads({ default: { tv: 200, movies: 304 } })
    fetchAllServerData.mockResolvedValue(reply)

    const tick = await fetchSyncTick()

    // Conditional: the decision had nothing against a skip until the servers answered
    expect(fetchAllServerData).toHaveBeenCalledWith({ validators: ETAGS })
    expect(tick).toMatchObject({
      skipped: false,
      fileServers: reply.fileServers,
      etags: reply.etags,
      statuses: { default: { tv: 200, movies: 304 } },
    })
    // As getFileServerData had it: undefined when every server answered
    expect(tick.errors).toBeUndefined()
    expect(console.info.mock.calls[0][0]).toContain('Full pass')
    expect(console.info.mock.calls[0][0]).toContain('default tv=200 movies=304')
  })

  it('reports a server that did not answer as an error', async () => {
    fetchAllServerData.mockResolvedValue({
      ...fullPayloads(),
      errors: [{ serverId: 'default', error: 'timed out' }],
    })

    const tick = await fetchSyncTick()

    expect(tick.skipped).toBe(false)
    expect(tick.errors).toEqual([{ serverId: 'default', error: 'timed out' }])
  })
})
