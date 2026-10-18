/**
 * @jest-environment node
 *
 * Cleanup deletes the records no file server has any more. That is only known
 * on a run where every enabled server answered. A server that failed to respond
 * is simply missing from the run, its titles are not stamped, and they used to
 * be deleted as orphans (then re-created, with new ids, when it came back).
 */

process.env.SYNC_FK_ORPHAN_CHECK = 'false'

const RUN_ID = 'run-1'
const mockDb = { collections: {} }

jest.mock('@opentelemetry/api', () => ({
  trace: { getTracer: () => ({ startActiveSpan: (_name, fn) => fn({ setAttribute() {}, setAttributes() {}, end() {} }) }) },
}))
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({ db: () => ({ collection: (name) => mockDb.collections[name] }) }),
}))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  logError: jest.fn(),
}))
jest.mock('@src/utils/watchHistory/migrate', () => ({ migratePlaybackStatusIfNeeded: jest.fn(async () => ({})) }))
jest.mock('@src/utils/sync/run/watchHistoryValidation', () => ({
  validateWatchHistoryAgainstDatabase: jest.fn(async () => ({ markedInvalid: 0 })),
}))
jest.mock('@src/utils/sync/run/newContent', () => ({ announceNewContent: jest.fn() }))
jest.mock('@src/utils/sync/run/runState', () => ({
  getCurrentSyncRunId: jest.fn(() => null),
  getSyncLockHolder: jest.fn(() => ({ syncRunId: 'run-1' })),
}))
jest.mock('@src/utils/sync/run/preTag', () => ({ isCollectionFullyCovered: jest.fn(() => true) }))
jest.mock('@src/utils/cache/postSyncRevalidation', () => ({ requestMediaRevalidation: jest.fn(async () => {}) }))

const { runPostSyncCleanup } = require('@src/utils/sync/run/postSync')
const { validateWatchHistoryAgainstDatabase } = require('@src/utils/sync/run/watchHistoryValidation')

/** A collection of `total` documents, of which `orphans` are not stamped with this run. */
function collection(orphans, total = 100) {
  return {
    orphans,
    deleted: 0,
    find: () => ({ toArray: async () => orphans }),
    estimatedDocumentCount: async () => total,
    countDocuments: async () => 0,
    findOne: async () => null,
    updateOne: async () => ({}),
    deleteMany: jest.fn(async function () {
      this.deleted += orphans.length
      return { deletedCount: orphans.length }
    }),
  }
}

function install() {
  mockDb.collections = {
    FlatMovies: collection([{ _id: 'm1', title: 'Only On The Second Server', originalTitle: 'Only On The Second Server' }]),
    FlatTVShows: collection([]),
    FlatSeasons: collection([]),
    FlatEpisodes: collection([{ _id: 'e1', showId: 's1', showTitle: 'Show', seasonNumber: 1, episodeNumber: 4 }]),
  }
  return mockDb.collections
}

const fileServers = { main: { movies: { 'Some Film': {} }, tv: { 'Some Show': {} } } }
const coverage = { coverage: { movies: {}, shows: {}, seasons: {}, episodes: {} } }
const options = (allEnabledServersProbed) => ({
  syncRunId: RUN_ID,
  preTagCoverage: coverage,
  runStartedAt: Date.now(),
  ...(allEnabledServersProbed === undefined ? {} : { allEnabledServersProbed }),
})

beforeEach(() => {
  jest.clearAllMocks()
  for (const method of ['log', 'warn', 'info', 'error']) jest.spyOn(console, method).mockImplementation(() => {})
})

describe('runPostSyncCleanup', () => {
  it('deletes orphans on a run where every enabled server answered', async () => {
    const collections = install()
    const result = await runPostSyncCleanup(fileServers, {}, options(true))

    expect(collections.FlatMovies.deleteMany).toHaveBeenCalledTimes(1)
    expect(collections.FlatEpisodes.deleteMany).toHaveBeenCalledTimes(1)
    expect(result.removed.movies).toEqual(['Only On The Second Server'])
    expect(result.removed.tvEpisodes).toEqual(['Show S1E4'])
  })

  it('deletes nothing on a run where a server did not answer', async () => {
    const collections = install()
    const result = await runPostSyncCleanup(fileServers, {}, options(false))

    for (const name of Object.keys(collections)) {
      expect(collections[name].deleteMany).not.toHaveBeenCalled()
    }
    // Nothing is reported as removed either, so no cache entry is evicted for
    // a record that is still there.
    expect(result.removed).toEqual({ movies: [], tvShows: [], tvSeasons: [], tvEpisodes: [] })
  })

  it('leaves the watch-history validation to the run, which runs it after cleanup however cleanup ends', async () => {
    // (syncAllServers runs runAfterSyncJobs after cleanup: serverPass.test)
    install()
    const result = await runPostSyncCleanup(fileServers, {}, options(false))

    expect(validateWatchHistoryAgainstDatabase).not.toHaveBeenCalled()
    expect(result).not.toHaveProperty('watchHistoryValidation')
  })

  it('asks for the removed movies and shows to be revalidated by folder name, which the media pages tag their caches with', async () => {
    const { requestMediaRevalidation } = require('@src/utils/cache/postSyncRevalidation')
    install()
    mockDb.collections.FlatMovies = collection([{ _id: 'm1', title: 'Gone Film', originalTitle: 'Gone Film (2001)' }])
    mockDb.collections.FlatTVShows = collection([{ _id: 's1', title: 'Gone Show', originalTitle: 'Gone Show (2019)' }])

    const result = await runPostSyncCleanup(fileServers, {}, options(true))

    // (`removed` keeps naming display titles, for the Redis keys and the log)
    expect(result.removed.movies).toEqual(['Gone Film'])
    expect(result.removed.tvShows).toEqual(['Gone Show'])
    expect(requestMediaRevalidation).toHaveBeenCalledTimes(1)
    expect(requestMediaRevalidation).toHaveBeenCalledWith(
      { movies: ['Gone Film (2001)'], shows: ['Gone Show (2019)'], seasons: [], episodes: [] },
      { label: 'Post-cleanup' }
    )
  })

  it('deletes nothing for a caller that does not say either way', async () => {
    // Fail-closed: only an explicit "every server answered" allows a delete.
    const collections = install()
    await runPostSyncCleanup(fileServers, {}, options(undefined))

    for (const name of Object.keys(collections)) {
      expect(collections[name].deleteMany).not.toHaveBeenCalled()
    }
  })
})
