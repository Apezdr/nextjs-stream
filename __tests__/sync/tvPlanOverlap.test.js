/**
 * @jest-environment node
 *
 * No TV write plan sets a field that a plan merged with it removes.
 *
 * mergeWritePlans lets a set win over a removal of the same field. The TV
 * writes used to send both, which MongoDB rejects ($set and $unset of one
 * path), so the merge must never have to choose: a field a builder writes
 * is one its server owns, and field-absence cleanup removes only a field no
 * server reports (core/ownership, fail closed). This drives the real show,
 * season and episode services over a seeded matrix of payloads, stored
 * documents, locks, cleanup modes and failed fetches, and checks every merge.
 */

const mockServers = { A: { id: 'A', priority: 1 }, B: { id: 'B', priority: 2 } }
const mockMerges = []
const mockFailing = new Set()

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
    if ([...mockFailing].some((part) => String(url).includes(part))) return type === 'blurhash' ? '' : null
    if (type === 'blurhash') return `bh:${serverId}:${url}`
    if (String(url).includes('metadata.json')) {
      return { name: 'Show Name', seasons: [{ season_number: 2, name: 'Other season', episode_count: 4 }] }
    }
    return { name: 'Episode Name' }
  }),
}))
// Every merge the TV services make, with the plans they merge.
jest.mock('@src/utils/sync/core/writePlan', () => {
  const actual = jest.requireActual('@src/utils/sync/core/writePlan')
  return {
    ...actual,
    mergeWritePlans: (plans, entityKey) => {
      mockMerges.push(plans.map((p) => ({ set: Object.keys(p.set), unset: [...p.unset] })))
      return actual.mergeWritePlans(plans, entityKey)
    },
  }
})

const { TVShowSyncService } = require('@src/utils/sync/domain/tv/TVShowSyncService')
const { SeasonSyncService } = require('@src/utils/sync/domain/tv/SeasonSyncService')
const { EpisodeSyncService } = require('@src/utils/sync/domain/tv/EpisodeSyncService')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')

function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
let rand = rng(1)
const pick = (values) => values[Math.floor(rand() * values.length)]
const maybe = (value, p = 0.5) => (rand() < p ? value : undefined)
const defined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined))
const locks = (fields) => {
  const locked = fields.filter(() => rand() < 0.15)
  return locked.length ? { lockedFields: Object.fromEntries(locked.map((f) => [f, true])) } : {}
}

const SHOW = 'A Show (2020)'
const ROOT = `/tv/${encodeURIComponent(SHOW)}`
const url = (server, path) => `https://${server}.example${path}`

function payload() {
  const key = pick(['Season 1', 'Season 01'])
  const folder = `${ROOT}/${encodeURIComponent(key)}`
  const episodes = {}
  for (const n of [1, 2]) {
    if (rand() < 0.2) continue
    const code = `S01E0${n}`
    episodes[code] = defined({
      episodeNumber: n,
      videoURL: maybe(`${folder}/${code}.mkv`, 0.8),
      thumbnail: maybe(`${folder}/${code}.jpg?hash=${pick([1, 2])}`),
      thumbnailBlurhash: maybe(`${folder}/${code}.jpg.blurhash`),
      chapters: maybe(`${folder}/${code}.vtt`),
      metadata: maybe(`${folder}/${code}.json`),
      subtitles: maybe({ English: { url: `${folder}/${code}.en.srt`, srcLang: 'en' } }),
    })
  }
  const season = defined({
    seasonNumber: 1,
    // A season folder with no episode list leaves its count to the metadata.
    episodes: rand() < 0.15 ? undefined : episodes,
    lengths: maybe({ S01E01: 100, S01E02: 100 }),
    dimensions: {},
    season_poster: maybe(`${folder}/season_poster.jpg?hash=1`),
    seasonPosterBlurhash: maybe(`${folder}/season_poster.jpg.blurhash`),
  })
  return defined({
    metadata: maybe(`${ROOT}/metadata.json`),
    poster: pick([`${ROOT}/poster.jpg?hash=1`, null]),
    posterBlurhash: maybe(`${ROOT}/poster.jpg.blurhash`),
    backdrop: pick([`${ROOT}/backdrop.jpg?hash=1`, null]),
    backdropBlurhash: maybe(`${ROOT}/backdrop.jpg.blurhash`),
    logo: pick([`${ROOT}/logo.png?hash=1`, null]),
    seasons: { [key]: season },
  })
}

function storedDocuments() {
  const show = {
    _id: 'show-1', originalTitle: SHOW, title: pick(['Show Name', 'Old']), type: 'tvShow',
    ...defined({
      posterURL: maybe(url('B', `${ROOT}/poster.jpg?hash=0`)), posterSource: maybe('B'),
      posterBlurhash: maybe('old'), posterBlurhashSource: maybe(pick(['A', 'B'])),
      backdrop: maybe(url('A', `${ROOT}/backdrop.jpg?hash=0`)), backdropBlurhash: maybe('old'),
      logo: maybe(url('A', `${ROOT}/logo.png`)), seasonCount: maybe(3),
      metadata: maybe({ name: 'Stored', seasons: [{ season_number: 1, name: 'S1', episode_count: 5 }] }),
    }),
    ...locks(['title', 'metadata', 'posterURL', 'posterBlurhash', 'backdrop']),
  }
  const seasons = rand() < 0.8 ? [{
    _id: 'season-1', showId: 'show-1', seasonNumber: 1, type: 'season', title: 'S1', showTitle: 'Show Name',
    ...defined({
      metadata: maybe({ season_number: 1, name: 'S1', episode_count: 5 }), metadataSource: maybe('A'),
      episodeCount: maybe(5), posterURL: maybe(url('B', `${ROOT}/old_poster.jpg`)), posterSource: maybe('B'),
      posterBlurhash: maybe('old'), posterBlurhashSource: maybe(pick(['A', 'B'])),
    }),
    ...locks(['metadata', 'episodeCount', 'posterURL', 'posterBlurhash', 'title']),
  }] : []
  const episodes = [1, 2].filter(() => rand() < 0.8).map((n) => ({
    _id: `ep-${n}`, showId: 'show-1', seasonId: 'season-1', seasonNumber: 1, episodeNumber: n, type: 'episode',
    originalTitle: SHOW, showTitle: 'Show Name', title: `Episode ${n}`,
    ...defined({
      videoURL: maybe(url('A', `/v${n}.mkv`)), duration: maybe(100), hdr: maybe('HDR10'),
      thumbnail: maybe(url('B', `/t${n}.jpg`)), thumbnailSource: maybe('B'),
      thumbnailBlurhash: maybe('old'), thumbnailBlurhashSource: maybe(pick(['A', 'B'])),
      chapterURL: maybe(url('B', `/c${n}.vtt`)), chapterSource: maybe('B'),
      captionURLs: maybe({ French: { srcLang: 'fr', url: url('B', `/f${n}.srt`), sourceServerId: 'B' } }),
    }),
    ...locks(['thumbnail', 'captionURLs', 'metadata', 'title']),
  }))
  return { show: rand() < 0.85 ? show : null, seasons, episodes }
}

/** Repositories over plain documents: each write applies its set, then its removals. */
function repositories(docs) {
  const clone = (value) => structuredClone(value ?? null)
  const apply = (existing, merged, unset = []) => {
    const next = { ...(existing || {}), ...merged }
    for (const field of unset) delete next[field]
    return next
  }
  const bulk = (key, same) => async (ops) => {
    for (const { existing, merged, unset } of ops) {
      const next = apply(existing, merged, unset)
      docs[key] = [...docs[key].filter((d) => !same(d, next)), next]
    }
  }
  return {
    tvShows: {
      findByOriginalTitle: async () => clone(docs.show),
      smartUpsert: async (entity, existing, options) => {
        docs.show = { _id: 'show-1', ...apply(existing, entity, options?.unset) }
      },
    },
    seasons: {
      findByShow: async () => clone(docs.seasons),
      findSeason: async (_title, n) => clone(docs.seasons.find((s) => s.seasonNumber === n)),
      getSeasonCount: async () => docs.seasons.length,
      smartBulkUpsert: bulk('seasons', (a, b) => a.seasonNumber === b.seasonNumber),
    },
    episodes: {
      findByShowAndSeason: async (_title, n) => clone(docs.episodes.filter((e) => e.seasonNumber === n)),
      getEpisodeCount: async () => docs.episodes.length,
      getVisibleEpisodeCount: async () => docs.episodes.length,
      smartBulkUpsert: bulk('episodes', (a, b) => a.episodeNumber === b.episodeNumber),
    },
  }
}

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) {
    jest.spyOn(console, method).mockImplementation(() => {})
  }
})

it('never merges a plan that sets a field with one that removes it', async () => {
  const overlaps = []
  const removed = new Set()
  let failedPasses = 0
  for (let i = 0; i < 600; i++) {
    rand = rng(4242 * 1000 + i)
    mockMerges.length = 0
    mockFailing.clear()
    for (const part of ['poster.jpg.blurhash', 'backdrop.jpg.blurhash', 'E01.jpg.blurhash', 'E02.json', 'metadata.json']) {
      if (rand() < 0.15) mockFailing.add(part)
    }
    const syncing = pick(['A', 'B'])
    const payloads = { [syncing]: payload() }
    const other = syncing === 'A' ? 'B' : 'A'
    if (rand() < 0.6) payloads[other] = payload()
    const fieldAvailability = { movies: {}, tv: { [SHOW]: {} } }
    for (const [id, p] of Object.entries(payloads)) collectFieldAvailability(p, '', id, fieldAvailability.tv[SHOW])
    const probed = rand() < 0.5
    const docs = storedDocuments()
    if (!docs.show) Object.assign(docs, { seasons: [], episodes: [] })
    const repos = repositories(docs)
    const service = new TVShowSyncService(
      repos.tvShows,
      new SeasonSyncService(repos.seasons),
      new EpisodeSyncService(repos.episodes, repos.seasons),
      repos.episodes,
      repos.seasons
    )
    const results = await service.syncTVShow(SHOW, payloads[syncing], {
      run: {
        serverConfig: { ...mockServers[syncing], baseUrl: `https://${syncing}.example`, prefix: '', enabled: true },
        forceSync: true,
        cleanup: { enabled: true, mode: 'enforce', maxFieldsPerEntity: 10, allEnabledServersProbed: probed },
        allEnabledServersProbed: probed,
      },
      availability: { fieldAvailability },
    })
    if (results.some((r) => r.status === 'failed')) failedPasses++

    for (const plans of mockMerges) {
      const setFields = new Set(plans.flatMap((p) => p.set))
      for (const field of plans.flatMap((p) => p.unset)) {
        removed.add(field)
        if (setFields.has(field)) overlaps.push({ case: i, field })
      }
    }
  }

  expect(overlaps).toEqual([])
  expect(failedPasses).toBe(0)
  // The matrix reaches the removals that could collide with a write: the
  // cleanup's (show and season posters, episode thumbnails and chapters) and
  // the builders' own (blurhashes, captions, a season's metadata and count).
  for (const field of ['posterURL', 'backdrop', 'logo', 'thumbnail', 'chapterURL', 'posterBlurhash', 'thumbnailBlurhash', 'captionURLs', 'metadata', 'episodeCount']) {
    expect([field, removed.has(field)]).toEqual([field, true])
  }
})
