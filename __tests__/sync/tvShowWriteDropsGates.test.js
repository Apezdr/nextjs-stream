/**
 * @jest-environment node
 *
 * A show write that changes the show drops every server's gate on it in the
 * same update. The close-out drops them too, but a pass can stop before it:
 * when the read after the show's write fails, the show has changed and the
 * other servers must not go on skipping it.
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
  getServer: (id) => ({ id, priority: id === 'A' ? 1 : 2 }),
  multiServerHandler: { getHandler: () => ({ createFullURL: (path) => `https://A.example${path}` }) },
}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: (url) => `nid:${url}` }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({ fetchMetadataMultiServer: jest.fn(async () => ({})) }))

const { TVShowSyncService } = require('@src/utils/sync/domain/tv/TVShowSyncService')
const { resolveCleanupConfig } = require('@src/utils/sync/core/FieldAbsenceCleaner')

const SHOW = 'A Show (2020)'

/**
 * The show collection as one stored document. smartUpsert writes the fields
 * it is given over it (undefined stored as null, as MongoDB does) and removes
 * the ones to unset. From `failReadAfter` reads on, a read throws.
 */
function showRepository(initial, { failReadAfter = Infinity } = {}) {
  let stored = initial ? { ...initial } : null
  let reads = 0
  return {
    stored: () => stored,
    findByOriginalTitle: jest.fn(async () => {
      reads += 1
      if (reads > failReadAfter) throw new Error('connection reset')
      return stored ? { ...stored } : null
    }),
    smartUpsert: jest.fn(async (entity, _existing, options) => {
      const next = { ...(stored ?? { _id: 'show-1' }) }
      for (const [field, value] of Object.entries(entity)) next[field] = value === undefined ? null : value
      for (const field of options?.unset ?? []) delete next[field]
      stored = next
    }),
  }
}

function pass(repository) {
  const service = new TVShowSyncService(
    repository,
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

/** A stored show this pass changes: it has no season count yet. */
const storedShow = () => ({
  _id: 'show-1',
  title: SHOW,
  originalTitle: SHOW,
  type: 'tvShow',
  createdAt: new Date('2020-01-01T00:00:00.000Z'),
  syncGates: { A: 'stale', B: 'gate-b' },
})

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})

it('drops the other servers’ gates when the read after a show write that changed it fails', async () => {
  const repository = showRepository(storedShow(), { failReadAfter: 1 })

  const results = await pass(repository)

  expect(results.some((r) => r.status === 'failed')).toBe(true)
  expect(repository.stored().seasonCount).toBe(0)
  expect(repository.stored().syncGates?.B).toBeUndefined()
  // This server's own gate is not stamped either: the pass did not finish.
  expect(repository.stored().syncGates?.A).toBeUndefined()
  // Dropped by the show write itself (the one write of this pass).
  expect(repository.smartUpsert).toHaveBeenCalledTimes(1)
  expect(repository.smartUpsert.mock.calls[0][0].syncGates).toEqual({})
})

it('leaves only this server’s gate once a pass that changed the show closes out', async () => {
  const repository = showRepository(storedShow())

  await pass(repository)

  expect(Object.keys(repository.stored().syncGates)).toEqual(['A'])
  expect(repository.stored().syncGates.A).toMatch(/^g\d+:/)
})

it('keeps the other servers’ gates when the show write changes nothing', async () => {
  const repository = showRepository(storedShow())
  await pass(repository)
  repository.stored().syncGates = { A: 'stale', B: 'gate-b' }

  await pass(repository)

  expect(repository.smartUpsert.mock.calls[2][0].syncGates).toEqual({ A: 'stale', B: 'gate-b' })
  expect(repository.stored().syncGates.B).toBe('gate-b')
  expect(repository.stored().syncGates.A).toMatch(/^g\d+:/)
})
