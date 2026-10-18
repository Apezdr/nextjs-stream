/**
 * @jest-environment node
 *
 * A show's display title and titleSource follow the shared rule (core/title),
 * applied by TVShowSyncService on every pass: the `name` of the metadata the
 * show ends the pass with, trimmed, credited to that metadata's source; or,
 * with no name, the folder name, credited to the highest-priority server that
 * has the folder. The builder used to copy a fresh copy's `name` as it came
 * (untrimmed), only on a pass that wrote metadata, and left titleSource as the
 * document was created.
 */

const mockServers = {
  A: { id: 'A', priority: 1 },
  C: { id: 'C', priority: 2 },
}
// serverId -> the show's metadata.json on that server
let mockMetadata = {}

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
  getServer: (id) => {
    if (!mockServers[id]) throw new Error(`No server found with ID: ${id}`)
    return mockServers[id]
  },
  multiServerHandler: {},
}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: (url) => `nid:${url}` }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({
  fetchMetadataMultiServer: jest.fn(async (serverId, _url, type) => {
    if (type === 'blurhash') return null
    return mockMetadata[serverId] === undefined ? null : JSON.parse(JSON.stringify(mockMetadata[serverId]))
  }),
}))

const { TVShowSyncService } = require('@src/utils/sync/domain/tv/TVShowSyncService')
const { MediaType, SyncOperation } = require('@src/utils/sync/core')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')

const SHOW = 'A Show (2020)'
const ROOT = `/tv/${encodeURIComponent(SHOW)}`

/** What a processor publishes for the show, with no seasons. */
const showPayload = (over = {}) => ({
  metadata: `${ROOT}/metadata.json?hash=s1`,
  poster: `${ROOT}/show_poster.jpg?hash=p1`,
  posterBlurhash: null,
  logo: null,
  logoBlurhash: null,
  backdrop: null,
  backdropBlurhash: null,
  backdropFocal: null,
  backdropFocalSuggested: null,
  seasons: {},
  ...over,
})

// MongoDB stores a field set to `undefined` as `null`.
const stored = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)))

/**
 * The show collection, one document. Admin-locked top-level fields are kept,
 * as the write chokepoint (BaseRepository.computeDiff) keeps them.
 */
function showRepository(initial = null) {
  let doc = initial ? stored(initial) : null
  const writes = []
  return {
    doc: () => doc,
    writes,
    findByOriginalTitle: jest.fn(async () => (doc ? stored(doc) : null)),
    smartUpsert: jest.fn(async (entity, existing, options = {}) => {
      writes.push(stored(entity))
      const next = stored({ _id: 'show-1', ...entity })
      for (const [field, locked] of Object.entries(existing?.lockedFields ?? {})) {
        if (locked === true) next[field] = existing[field]
      }
      for (const field of options.unset ?? []) delete next[field]
      doc = next
    }),
  }
}

/** One server's pass over the show, the availability map built from every payload. */
async function pass(repository, serverId, payloads) {
  const availability = { movies: {}, tv: { [SHOW]: {} } }
  for (const [id, payload] of Object.entries(payloads)) {
    collectFieldAvailability(payload, '', id, availability.tv[SHOW])
  }
  const service = new TVShowSyncService(
    repository,
    { syncShow: async () => [] },
    { syncShow: async () => [] },
    { getVisibleEpisodeCount: async () => 0, getEpisodeCount: async () => 0 },
    { getSeasonCount: async () => 0 }
  )
  return service.syncTVShow(SHOW, {
    mediaType: MediaType.TVShow,
    operation: SyncOperation.Metadata,
    serverConfig: { ...mockServers[serverId], baseUrl: `https://${serverId}.example`, prefix: '', enabled: true },
    fieldAvailability: availability,
    forceSync: true,
    fileServerData: { tv: { [SHOW]: payloads[serverId] } },
    cleanup: undefined,
    allEnabledServersProbed: true,
  })
}

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})
beforeEach(() => {
  mockMetadata = {}
})

describe('a show\'s title and titleSource', () => {
  it('is the metadata\'s name, trimmed, credited to the metadata owner', async () => {
    mockMetadata = { A: { name: '  A Show  ' } }
    const repository = showRepository()
    await pass(repository, 'A', { A: showPayload() })

    expect(repository.doc()).toMatchObject({ title: 'A Show', titleSource: 'A', metadataSource: 'A' })
    expect(repository.doc().metadata.name).toBe('  A Show  ') // the metadata itself is stored as fetched
  })

  it('is re-derived from the stored metadata on a pass that writes none, and credited to its owner', async () => {
    // C does not own the metadata (A has a copy), so its pass writes none.
    const repository = showRepository({
      originalTitle: SHOW, title: 'A Stale Title', titleSource: 'C', type: 'tvShow',
      metadata: { name: 'A Show' }, metadataSource: 'A',
    })
    await pass(repository, 'C', { A: showPayload(), C: showPayload() })

    expect(repository.doc()).toMatchObject({ title: 'A Show', titleSource: 'A', metadata: { name: 'A Show' } })
  })

  it('follows the stored metadata while an admin has it locked', async () => {
    mockMetadata = { A: { name: 'A Fetched Name' } }
    const repository = showRepository({
      originalTitle: SHOW, title: 'A Stale Title', titleSource: 'A', type: 'tvShow',
      metadata: { name: 'A Kept Name' }, metadataSource: 'A', lockedFields: { metadata: true },
    })
    await pass(repository, 'A', { A: showPayload() })

    expect(repository.doc()).toMatchObject({ title: 'A Kept Name', metadata: { name: 'A Kept Name' } })
  })

  it('is the folder name when the metadata has no name, credited to the best server with the folder', async () => {
    const repository = showRepository({
      originalTitle: SHOW, title: 'A Stale Title', titleSource: 'C', type: 'tvShow',
      metadata: { overview: 'no name' }, metadataSource: 'A',
    })
    const payloads = { A: showPayload({ metadata: null }), C: showPayload({ metadata: null }) }

    // C's pass: A has the folder and outranks C, so C credits nobody.
    await pass(repository, 'C', payloads)
    expect(repository.doc()).toMatchObject({ title: SHOW, titleSource: 'C' })

    await pass(repository, 'A', payloads)
    expect(repository.doc()).toMatchObject({ title: SHOW, titleSource: 'A' })
  })

  it('leaves a locked title, and its source, as the admin set them', async () => {
    mockMetadata = { A: { name: 'A Show' } }
    const repository = showRepository({
      originalTitle: SHOW, title: 'An Admin Title', titleSource: 'C', type: 'tvShow',
      metadata: { name: 'A Show' }, metadataSource: 'A', lockedFields: { title: true },
    })
    await pass(repository, 'A', { A: showPayload() })

    expect(repository.doc()).toMatchObject({ title: 'An Admin Title', titleSource: 'C' })
    // The source is not offered at all; the title is dropped at the chokepoint.
    expect(repository.writes[0].titleSource).toBe('C')
  })
})
