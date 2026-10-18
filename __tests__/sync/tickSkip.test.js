/**
 * @jest-environment node
 *
 * A sync tick is skipped — no entries, no fieldAvailability, no pass, no
 * cleanup — only when a pass would change nothing: forceSync is off, a
 * complete pass is on record under the current gate version, server set and
 * process, this process's tick state tracks that pass and selects no title,
 * every document that pass covered is still there and carries every enabled
 * server's gate, and every server answers 304 for both manifests to the ETags
 * that pass recorded. Any other tick runs: `select` when the tick state can be
 * trusted, `all` (manifests asked for unconditionally) when it cannot.
 */

const mockCollections = {}
let mockServers = []

jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({ collection: (name) => mockCollections[name] }),
  }),
}))
jest.mock('@src/utils/config', () => ({ getAllServers: () => mockServers, getServer: (id) => mockServers.find((s) => s.id === id) }))
// The file servers' manifests and entries (run/manifestSource), faked
const { createFakeProcessor, titleHash } = require('../helpers/fakeProcessor')
const mockProcessor = createFakeProcessor()
jest.mock('@src/utils/sync/run/manifestSource', () => ({
  ...jest.requireActual('@src/utils/sync/run/manifestSource'),
  fetchManifest: (...args) => mockProcessor.fetchManifest(...args),
  fetchEntries: (...args) => mockProcessor.fetchEntries(...args),
}))
jest.mock('@src/utils/watchHistory/migrate', () => ({ migratePlaybackStatusIfNeeded: jest.fn(async () => {}) }))
jest.mock('@src/utils/sync/run/watchHistoryValidation', () => ({
  validateWatchHistoryAgainstDatabase: jest.fn(async () => ({ markedValid: 1, markedInvalid: 0 })),
}))
jest.mock('@src/utils/sync/core/events', () => ({
  syncEventBus: { emitStarted: jest.fn(), emitComplete: jest.fn() },
}))

const { fetchSyncTick, currentBootId, serversFingerprint } = require('@src/utils/sync/run/tickSkip')
const { SYNC_GATE_VERSION } = require('@src/utils/sync/core/syncGate')
const { probeServers } = require('@src/utils/sync/run/manifestTick')
const { beginRun, recordApplied, resetTickState, getTickState } = require('@src/utils/sync/run/tickState')
const { tryAcquireSyncLock, releaseSyncLock } = require('@src/utils/sync/run/runState')
const { validateWatchHistoryAgainstDatabase } = require('@src/utils/sync/run/watchHistoryValidation')
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
const KINDS = ['tv', 'movies']

/** What the default server serves; any other server serves nothing. */
const LIBRARY = {
  movies: { 'Movie A': { urls: { mp4: '/a.mkv' } }, 'Movie B': { urls: { mp4: '/b.mkv' } } },
  tv: { 'Show A': { seasons: { 'Season 1': { episodes: { S01E01: { videoURL: '/1.mkv' }, S01E02: { videoURL: '/2.mkv' } } } } } },
}

/** Per server id, the ETags of the manifests its library has now. */
const etagsNow = () =>
  Object.fromEntries(
    mockServers.map((server) => [
      server.id,
      Object.fromEntries(KINDS.map((kind) => [kind, mockProcessor.manifestOf(server.id, kind).etag])),
    ])
  )

function record(overrides = {}) {
  return {
    _id: 'appliedPayloads',
    state: 'complete',
    recordFormat: 2,
    bootId: currentBootId(),
    servers: etagsNow(),
    gateVersion: SYNC_GATE_VERSION,
    serversFingerprint: serversFingerprint(mockServers),
    syncRunId: RUN,
    documentCounts: { FlatMovies: 2, FlatTVShows: 1, FlatSeasons: 1, FlatEpisodes: 2 },
    ...overrides,
  }
}

/** The tick state the complete pass `runId` left: its manifests, every title applied. */
async function settleState(runId = RUN) {
  resetTickState()
  // Only the run holding the lock changes the state
  if (!tryAcquireSyncLock(runId)) throw new Error('the lock is held')
  const probes = await probeServers(mockServers, null)
  const manifests = new Map([...probes].map(([serverId, probe]) => [serverId, probe.manifests]))
  const state = beginRun({
    syncRunId: runId,
    mode: 'all',
    bootId: currentBootId(),
    gateVersion: SYNC_GATE_VERSION,
    serversFingerprint: serversFingerprint(mockServers),
    manifests,
    selected: { tv: [], movies: [] },
  })
  for (const kind of KINDS) {
    const titles = new Map()
    for (const serverId of manifests.keys()) {
      for (const [title, entry] of Object.entries(mockProcessor.server(serverId).library[kind])) {
        if (!titles.has(title)) titles.set(title, new Map())
        titles.get(title).set(serverId, titleHash(entry))
      }
    }
    for (const [title, servers] of titles) recordApplied(state, kind, title, servers, runId)
  }
  releaseSyncLock(runId)
  mockProcessor.calls.manifests.length = 0
}

const WRITTEN = new Date('2026-10-16T12:00:00Z')

async function install({ syncInfo = null } = {}) {
  mockProcessor.reset()
  for (const server of mockServers) mockProcessor.serve(server.id, server.id === 'default' ? LIBRARY : {})
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
  mockCollections.syncInfo = memoryCollection(syncInfo ?? [record()])
  await settleState()
}

beforeEach(async () => {
  mockServers = [{ id: 'default', priority: 1 }]
  await install()
  // Each case starts with no validation run in this process
  delete globalThis.__watchHistoryValidationState
  validateWatchHistoryAgainstDatabase.mockClear()
  migratePlaybackStatusIfNeeded.mockClear()
  syncEventBus.emitStarted.mockClear()
  syncEventBus.emitComplete.mockClear()
  for (const method of ['info', 'error', 'warn']) jest.spyOn(console, method).mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

const conditional = () =>
  mockServers.flatMap((server) => KINDS.map((kind) => ({ server: server.id, kind, etag: etagsNow()[server.id][kind] })))

describe('a tick that would change nothing', () => {
  it('is skipped: the held manifests are asked for conditionally, they answer 304, and no entry is asked for', async () => {
    const tick = await fetchSyncTick()

    expect(mockProcessor.calls.manifests).toEqual(conditional())
    expect(mockProcessor.calls.entries).toEqual([])
    expect(tick.skipped).toBe(true)
    expect(tick.result).toMatchObject({
      skipped: true,
      reason: 'manifests_unchanged',
      servers: { default: { tv: 304, movies: 304 } },
      lastCompleteSyncRunId: RUN,
      errors: [],
      changedMedia: { movies: [], shows: [], seasons: [], episodes: [] },
    })
  })

  it('logs the skip in one line with each server’s statuses, and the tick’s [SYNC PERF] line', async () => {
    await fetchSyncTick()

    const lines = console.info.mock.calls.map(([line]) => line)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('Tick skipped')
    expect(lines[0]).toContain('default tv=304 movies=304')
    expect(lines[1]).toBe(
      '[SYNC PERF] tick=skip selected tv=0/1 movies=0/2 | default tv: manifest 304, 0 entries, 0.0 KB received, 0.0 KB parsed; ' +
        'movies: manifest 304, 0 entries, 0.0 KB received, 0.0 KB parsed'
    )
  })

  it('still records the sync time, revalidates watch history when due and closes the sync popup', async () => {
    const { result } = await fetchSyncTick()

    expect(mockCollections.syncInfo.docs.find((d) => d._id === 'lastSyncTime')?.timestamp).toBeTruthy()
    // No validation has run in this process yet, so one is due
    expect(validateWatchHistoryAgainstDatabase).toHaveBeenCalledTimes(1)
    expect(result.watchHistoryValidation).toEqual({ markedValid: 1, markedInvalid: 0 })
    expect(migratePlaybackStatusIfNeeded).toHaveBeenCalledTimes(1)
    expect(syncEventBus.emitStarted).toHaveBeenCalledWith('__sync_warmup__', expect.anything(), 'server-all')
    expect(syncEventBus.emitComplete).toHaveBeenCalledWith(
      '__sync_complete__', expect.anything(), 'server-all', expect.anything(), { summary: result }
    )
  })

  it('does not validate watch history again within 15 minutes of the last validation', async () => {
    const now = Date.now()
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now)

    await fetchSyncTick()
    clock.mockReturnValue(now + 14 * 60 * 1000)
    const second = await fetchSyncTick()
    clock.mockReturnValue(now + 15 * 60 * 1000)
    const third = await fetchSyncTick()

    expect(second.result.watchHistoryValidation).toBeNull()
    expect(third.result.watchHistoryValidation).toEqual({ markedValid: 1, markedInvalid: 0 })
    expect(validateWatchHistoryAgainstDatabase).toHaveBeenCalledTimes(2)
  })

  it('even with a document post-sync cleanup never deletes (no updatedAt) left from an older run', async () => {
    mockCollections.FlatEpisodes.docs.push(stored({ _id: 'legacy', showId: 's1', seasonNumber: 9, syncRunId: 'older-run' }))

    expect((await fetchSyncTick()).skipped).toBe(true)
  })

  it('leaves the record of the last complete pass, and the tick state, as they were', async () => {
    const before = stored(mockCollections.syncInfo.docs.find((d) => d._id === 'appliedPayloads'))
    const state = getTickState()
    const applied = [...state.applied.movies.keys()]

    await fetchSyncTick()

    expect(mockCollections.syncInfo.docs.find((d) => d._id === 'appliedPayloads')).toEqual(before)
    expect(getTickState()).toBe(state)
    expect([...state.applied.movies.keys()]).toEqual(applied)
  })
})

describe('a tick that runs', () => {
  const expectPass = async (reasonPart, { mode = 'select', options } = {}) => {
    const tick = await fetchSyncTick(options)
    expect(tick.skipped).toBe(false)
    expect(tick.mode).toBe(mode)
    expect(tick.reason).toContain(reasonPart)
    // The entries are asked for under the lock (syncAllServers), never here
    expect(mockProcessor.calls.entries).toEqual([])
    expect(mockProcessor.calls.manifests).toEqual(
      mode === 'select' ? conditional() : conditional().map((call) => ({ ...call, etag: null }))
    )
    expect(validateWatchHistoryAgainstDatabase).not.toHaveBeenCalled()
    return tick
  }

  it.each([
    ['a movie', 'FlatMovies', 'm1'],
    ['a show', 'FlatTVShows', 's1'],
    ['an episode', 'FlatEpisodes', 'e2'],
  ])('when %s lacks the server’s gate (an admin edit removes them all)', async (_label, name, id) => {
    delete mockCollections[name].docs.find((d) => d._id === id).syncGates
    await expectPass(`${name}=1`)
  })

  it('when a document holds another server’s gate but not this one’s', async () => {
    mockCollections.FlatTVShows.docs[0].syncGates = { server2: gate(9) }
    await expectPass('open gates (default: FlatTVShows=1)')
  })

  it('when a gate was stored as null', async () => {
    mockCollections.FlatEpisodes.docs[0].syncGates = stored({ default: undefined })
    expect(mockCollections.FlatEpisodes.docs[0].syncGates).toEqual({ default: null })
    await expectPass('FlatEpisodes=1')
  })

  it('when a document the last pass covered was deleted', async () => {
    mockCollections.FlatMovies.docs = mockCollections.FlatMovies.docs.filter((d) => d._id !== 'm2')
    await expectPass('FlatMovies 2 -> 1')
  })

  it('when the last pass’s post-sync cleanup left an orphan behind (it failed or refused)', async () => {
    mockCollections.FlatMovies.docs.push(
      stored({ _id: 'gone', originalTitle: 'Removed From Disk', syncRunId: 'older-run', updatedAt: WRITTEN })
    )
    await expectPass('documents left for post-sync cleanup (FlatMovies=1)')
  })

  it('over every title when the sync was started from the admin UI (only webhook ticks skip)', async () => {
    await expectPass('started from the admin UI (only webhook ticks skip)', { mode: 'all', options: { allowSkip: false } })
    expect(mockCollections.syncInfo.docs.find((d) => d._id === 'lastSyncTime')).toBeUndefined()
  })

  it('over every title when forceSync is on', async () => {
    await expectPass('force sync requested', { mode: 'all', options: { forceSync: true } })
    expect(mockCollections.FlatMovies.countDocuments).not.toHaveBeenCalled()
  })

  it('when SYNC_GATE_VERSION changed since the last complete pass', async () => {
    await install({ syncInfo: [record({ gateVersion: SYNC_GATE_VERSION - 1 })] })
    await expectPass('gate version changed')
  })

  it('over every title when a server’s priority changed (the tick state was built under the old one)', async () => {
    mockServers = [{ id: 'default', priority: 2 }]
    await expectPass('servers or priorities changed', { mode: 'all' })
  })

  it('over every title when a server was added', async () => {
    mockServers = [{ id: 'default', priority: 1 }, { id: 'server2', priority: 2 }]
    mockProcessor.serve('server2', {})
    await expectPass('servers or priorities changed', { mode: 'all' })
  })

  it('over every title when no pass is on record (an admin delete forgot it)', async () => {
    mockCollections.syncInfo.docs = []
    await expectPass('no pass on record', { mode: 'all' })
  })

  it('when the last pass left only its running marker (still running, or it did not complete)', async () => {
    mockCollections.syncInfo.docs = [stored({ _id: 'appliedPayloads', state: 'running', syncRunId: RUN })]
    await expectPass('the last pass is still running or did not complete')
  })

  it('over every title when the run on record is one this tick state did not see (another process wrote its marker)', async () => {
    mockCollections.syncInfo.docs = [stored({ _id: 'appliedPayloads', state: 'running', syncRunId: 'run-of-another-process' })]
    await expectPass('not the one this state saw', { mode: 'all' })
  })

  it('over every title on the first tick of a process (no tick state: a restart or a deploy)', async () => {
    resetTickState()
    await expectPass('no tick state in this process', { mode: 'all' })
  })

  it('when the record was written by the sync before manifests (payload ETags, no recordFormat)', async () => {
    const { recordFormat: _old, ...older } = record({ servers: { default: { tv: 'W/"tv-1"', movies: '"movies-1"' } } })
    mockCollections.syncInfo.docs = [stored(older)]
    await expectPass('recorded by an older sync')
  })

  it('when the skip check itself fails', async () => {
    mockCollections.FlatEpisodes.countDocuments.mockRejectedValue(new Error('connection reset'))
    await expectPass('skip check failed: connection reset')
  })

  it('when a document only one of two servers has lacks the other’s gate (fails safe)', async () => {
    mockServers = [{ id: 'default', priority: 1 }, { id: 'server2', priority: 2 }]
    await install()
    await expectPass('server2: FlatMovies=2')
  })

  it('when every manifest answers 304 but they are not the ones the last complete pass recorded', async () => {
    mockCollections.syncInfo.docs = [stored(record({ servers: { default: { tv: 'W/"older"', movies: etagsNow().default.movies } } }))]
    await expectPass('tv manifest is not the one the last complete pass recorded')
  })

  it('when a title is pending in the tick state (its last pass did not finish cleanly)', async () => {
    getTickState().applied.movies.delete('Movie A')
    await expectPass('1 title(s) pending in the tick state')
  })
})

describe('when a manifest changed', () => {
  it('hands the probes on for a select tick, with their statuses', async () => {
    mockProcessor.server('default').library.movies['Movie A'] = { urls: { mp4: '/a-remux.mkv' } }

    const tick = await fetchSyncTick()

    expect(tick).toMatchObject({ skipped: false, mode: 'select' })
    expect(tick.servers.get('default')).toMatchObject({ ok: true, statuses: { tv: 304, movies: 200 } })
    expect(tick.servers.get('default').manifests.movies.titles.get('Movie A').hash).toBe(titleHash({ urls: { mp4: '/a-remux.mkv' } }))
    // Undefined when every server answered
    expect(tick.errors).toBeUndefined()
    expect(console.info.mock.calls[0][0]).toContain('Pass (select)')
    expect(console.info.mock.calls[0][0]).toContain('default tv=304 movies=200')
  })

  it('reports a server that did not answer as an error', async () => {
    mockProcessor.server('default').down = true

    const tick = await fetchSyncTick()

    expect(tick.skipped).toBe(false)
    expect(tick.errors).toEqual([{ serverId: 'default', error: expect.stringContaining('ECONNREFUSED') }])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('default did not answer this tick'))
  })

  it.each([
    ['a 404 (no manifest route)', (server) => { server.notFound = true }, /404/],
    ['manifest format 1', (server) => { server.format = 1 }, /format 1/],
  ])('logs a server whose processor answers %s as not answering, naming the contract it needs, on every tick', async (_label, arrange, answer) => {
    arrange(mockProcessor.server('default'))

    const first = await fetchSyncTick()
    await fetchSyncTick()

    expect(first.errors).toEqual([{ serverId: 'default', error: expect.stringMatching(answer) }])
    const logged = console.error.mock.calls.map(([line]) => line).filter((line) => line.includes('default did not answer'))
    expect(logged).toHaveLength(2)
    expect(logged[0]).toMatch(answer)
    expect(logged[0]).toContain('manifest format 2')
  })
})
