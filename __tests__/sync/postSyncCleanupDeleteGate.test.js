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
jest.mock('@src/utils/flatSync/watchHistoryValidation', () => ({
  validateWatchHistoryAgainstDatabase: jest.fn(async () => ({ markedInvalid: 0 })),
}))
jest.mock('@src/utils/flatSync/syncContext', () => ({
  getCurrentSyncRunId: jest.fn(() => null),
  getSyncLockHolder: jest.fn(() => ({ syncRunId: 'run-1' })),
}))
jest.mock('@src/utils/flatSync/preTagSyncRunId', () => ({ isCollectionFullyCovered: jest.fn(() => true) }))
jest.mock('@src/utils/cache/postSyncRevalidation', () => ({ requestMediaRevalidation: jest.fn(async () => {}) }))

const { runPostSyncCleanup } = require('@src/utils/flatSync/postSyncCleanup')
const { validateWatchHistoryAgainstDatabase } = require('@src/utils/flatSync/watchHistoryValidation')

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

  it('still validates watch history on that run', async () => {
    install()
    const result = await runPostSyncCleanup(fileServers, {}, options(false))

    expect(validateWatchHistoryAgainstDatabase).toHaveBeenCalledTimes(1)
    expect(result.watchHistoryValidation).toEqual({ markedInvalid: 0 })
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
