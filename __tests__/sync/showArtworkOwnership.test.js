/**
 * @jest-environment node
 *
 * A show's poster, backdrop and logo belong to the highest-priority server
 * among those that report the field (core/ownership), ties broken on server
 * id. They used to be ranked with the fail-open check, which answers "yes"
 * for a field no server reports and lets every server of the best priority
 * through. The two agree for every payload a processor publishes today: each
 * show-level key is in the availability map exactly when the server has a
 * value for it, and server priorities are distinct. These are the inputs
 * where they do not, and what the show then gets.
 */

const mockServers = {
  A: { id: 'A', priority: 1 },
  B: { id: 'B', priority: 1 }, // the same priority as A
  C: { id: 'C', priority: 2 },
}

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
  fetchMetadataMultiServer: jest.fn(async (serverId, url, type) => {
    if (type === 'blurhash') return `blurhash-of:${url}`
    return { name: 'A Show' }
  }),
}))

const { TVShowSyncService } = require('@src/utils/sync/domain/tv/TVShowSyncService')
const { MediaType, SyncOperation } = require('@src/utils/sync/core')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')

const SHOW = 'A Show (2020)'
const ROOT = `/tv/${encodeURIComponent(SHOW)}`

/** What a processor publishes for the show (buildTvPayloadEntry), with no seasons. */
const showPayload = (over = {}) => ({
  metadata: `${ROOT}/metadata.json?hash=s1`,
  poster: `${ROOT}/show_poster.jpg?hash=p1`,
  posterBlurhash: `${ROOT}/show_poster.jpg.blurhash`,
  logo: `${ROOT}/show_logo.png?hash=l1`,
  logoBlurhash: null,
  backdrop: `${ROOT}/show_backdrop.jpg?hash=b1`,
  backdropBlurhash: null,
  backdropFocal: null,
  backdropFocalSuggested: null,
  seasons: {},
  ...over,
})

// MongoDB stores a field set to `undefined` as `null`.
const stored = (value) => JSON.parse(JSON.stringify(value, (_key, v) => (v === undefined ? null : v)))

/** The show collection, one document. */
function showRepository(initial = null) {
  let doc = initial ? stored(initial) : null
  return {
    doc: () => doc,
    findByOriginalTitle: jest.fn(async () => (doc ? stored(doc) : null)),
    smartUpsert: jest.fn(async (entity, _existing, options = {}) => {
      const next = stored({ _id: 'show-1', ...entity })
      for (const field of options.unset ?? []) delete next[field]
      doc = next
    }),
  }
}

/**
 * One server's pass over the show. The availability map is built from every
 * server's payload, as the sync route builds it, unless a case hands one in.
 */
async function pass(repository, serverId, payloads, { fieldAvailability } = {}) {
  let availability = fieldAvailability
  if (!availability) {
    availability = { movies: {}, tv: { [SHOW]: {} } }
    for (const [id, payload] of Object.entries(payloads)) {
      collectFieldAvailability(payload, '', id, availability.tv[SHOW])
    }
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
    // Field-absence cleanup is off: these cases are about who may write.
    cleanup: undefined,
    allEnabledServersProbed: true,
  })
}

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})

describe('two servers configured with the same priority, both with artwork', () => {
  const payloads = { A: showPayload(), B: showPayload() }

  it.each([[['A', 'B']], [['B', 'A']]])('take it from the lower id, synced in order %j', async (order) => {
    const repository = showRepository()
    for (const serverId of order) await pass(repository, serverId, payloads)

    // Fail-open let both through, and the show held whichever synced last.
    expect(repository.doc()).toMatchObject({
      posterURL: `https://A.example${ROOT}/show_poster.jpg?hash=p1`,
      posterSource: 'A',
      posterBlurhash: `blurhash-of:https://A.example${ROOT}/show_poster.jpg.blurhash`,
      posterBlurhashSource: 'A',
      backdropSource: 'A',
      logoSource: 'A',
    })
  })
})

describe('artwork the availability map does not list for the server', () => {
  // The map leaves the server out: a payload that names the image `posterURL`
  // (no processor does), or a map not built from this payload.
  const withoutArtwork = (payload) => {
    const availability = { movies: {}, tv: { [SHOW]: {} } }
    collectFieldAvailability({ metadata: payload.metadata }, '', 'A', availability.tv[SHOW])
    return availability
  }

  it('is not written to a new show', async () => {
    const payloads = { A: showPayload() }
    const repository = showRepository()
    await pass(repository, 'A', payloads, { fieldAvailability: withoutArtwork(payloads.A) })

    // Fail-open wrote all three, and fetched the poster's blurhash.
    const doc = repository.doc()
    for (const field of ['posterURL', 'posterSource', 'posterBlurhash', 'backdrop', 'backdropSource', 'logo', 'logoSource']) {
      expect(doc).not.toHaveProperty(field)
    }
  })

  it('does not replace the artwork another server supplied', async () => {
    const posterOfC = `https://C.example${ROOT}/show_poster.jpg?hash=p0`
    const repository = showRepository({
      title: 'A Show',
      originalTitle: SHOW,
      type: 'tvShow',
      posterURL: posterOfC,
      posterSource: 'C',
    })
    // The legacy key: the map records `posterURL`, so nobody reports `poster`.
    const payloads = { A: showPayload({ poster: null, posterBlurhash: null, posterURL: `${ROOT}/show_poster.jpg?hash=p1` }) }
    await pass(repository, 'A', payloads)

    expect(repository.doc()).toMatchObject({ posterURL: posterOfC, posterSource: 'C' })
  })
})

describe('what the two checks agree on', () => {
  it('takes artwork from the server that has it when a higher-priority one does not', async () => {
    const payloads = { A: showPayload({ logo: '' }), C: showPayload() }
    const repository = showRepository()
    for (const serverId of ['A', 'C']) await pass(repository, serverId, payloads)

    expect(repository.doc()).toMatchObject({ logoSource: 'C', posterSource: 'A', backdropSource: 'A' })
  })
})
