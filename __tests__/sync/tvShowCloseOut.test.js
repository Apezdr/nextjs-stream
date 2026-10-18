/**
 * @jest-environment node
 *
 * A show's pass ends by closing the show out: its visible-episode count and
 * its skip gate, in one write. When that write fails, the show keeps the gates
 * it had before the pass — and a pass that changed the show's subtree should
 * have reset them. The failure is reported as a Failed result, so the run is
 * not recorded as complete (sync/run/tickSkip: a failed title keeps the record
 * from being written) and no tick is skipped on those gates.
 */

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: { getInstance: () => ({ dbWriteLimitFor: () => (fn) => fn() }) },
  getResourceManager: () => ({}),
}))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
  logError: jest.fn(),
}))
jest.mock('@src/utils/config', () => ({
  getServer: () => ({ id: 'A', priority: 1 }),
  multiServerHandler: { getHandler: () => ({ createFullURL: (path) => `https://A.example${path}` }) },
}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: (url) => `nid:${url}` }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({ fetchMetadataMultiServer: jest.fn(async () => ({})) }))

const { TVShowSyncService } = require('@src/utils/sync/domain/tv/TVShowSyncService')
const { resolveCleanupConfig } = require('@src/utils/sync/core/FieldAbsenceCleaner')
const { MediaType } = require('@src/utils/sync/core')

const SHOW = 'A Show (2020)'

/** A show repository whose close-out write (the second write of the pass) can fail. */
function showRepository({ closeOutFails }) {
  let stored = null
  let writes = 0
  return {
    findByOriginalTitle: jest.fn(async () => (stored ? { ...stored } : null)),
    smartUpsert: jest.fn(async (entity) => {
      writes += 1
      if (writes === 2 && closeOutFails) throw new Error('connection reset')
      stored = { _id: 'show-1', ...entity }
    }),
  }
}

async function syncShow({ closeOutFails }) {
  const service = new TVShowSyncService(
    showRepository({ closeOutFails }),
    { syncShow: async () => [] },
    { syncShow: async () => [] },
    { getVisibleEpisodeCount: async () => 0, getEpisodeCount: async () => 0 },
    { getSeasonCount: async () => 0 }
  )
  return service.syncTVShow(SHOW, { seasons: {} }, {
    run: {
      serverConfig: { id: 'A', priority: 1, baseUrl: 'https://A.example', prefix: '', enabled: true },
      forceSync: false,
      cleanup: resolveCleanupConfig(true),
      allEnabledServersProbed: true,
    },
    availability: { fieldAvailability: { movies: {}, tv: { [SHOW]: {} } } },
  })
}

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})

it('reports a show whose close-out failed as failed', async () => {
  const results = await syncShow({ closeOutFails: true })

  const failed = results.filter((r) => r.status === 'failed')
  expect(failed).toHaveLength(1)
  expect(failed[0]).toMatchObject({ entityId: SHOW, mediaType: MediaType.TVShow })
})

it('reports no failure when the close-out succeeds', async () => {
  const results = await syncShow({ closeOutFails: false })

  expect(results.filter((r) => r.status === 'failed')).toHaveLength(0)
  expect(results).toContainEqual(expect.objectContaining({ entityId: SHOW, status: 'completed' }))
})
