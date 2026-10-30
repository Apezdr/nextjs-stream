/**
 * @jest-environment node
 *
 * Credits through the real passes: MovieSyncService's credits step, and the
 * show and episode builders, each run through the prefetch step that fetches
 * the credits file as text. The rule itself is pinned in core/credits.test.js;
 * these cases pin the wiring: the payload value reaches the rule, the file
 * is fetched once with the server's own path, the plan writes the credits
 * fields beside (never inside) the metadata, and a failure keeps the gate open.
 */

const { createHash } = require('crypto')

const mockServers = { A: { id: 'A', priority: 1 } }
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: { getInstance: () => ({ throttleHttp: (fn) => fn(), config: { syncConcurrency: 1, httpConcurrency: 1 } }) },
  getResourceManager: () => ({}),
}))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog, logError: jest.fn() }))
jest.mock('@src/utils/config', () => ({ getServer: (id) => mockServers[id], multiServerHandler: {} }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({ fetchMetadataMultiServer: jest.fn() }))

const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
const { buildWithResources } = require('@src/utils/sync/infrastructure/fileSystem/prefetch')
const { MovieSyncService } = require('@src/utils/sync/domain/movies/MovieSyncService')
const { planTVShow } = require('@src/utils/sync/domain/tv/showPlan')
const { planEpisode } = require('@src/utils/sync/domain/tv/episodePlan')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')
const fixtures = require('../helpers/creditsFixtures')

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const run = { serverConfig: { ...mockServers.A, baseUrl: 'https://A.example', prefix: '', enabled: true }, allEnabledServersProbed: true, forceSync: false }
// The credits files the file server has, by path; anything else fails.
let mockFiles = {}

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) jest.spyOn(console, method).mockImplementation(() => {})
})
beforeEach(() => {
  jest.clearAllMocks()
  mockFiles = {}
  fetchMetadataMultiServer.mockImplementation(async (_serverId, path, type) => {
    if (type === 'text') return mockFiles[path] ?? null
    if (type === 'blurhash') return `blurhash-of:${path}`
    return { name: 'From metadata.json', overview: 'The synopsis.' }
  })
})

const locator = (folder, text, file = 'credits.json') => {
  const hash = sha(text)
  const url = `${folder}/${file}?hash=${hash}`
  mockFiles[url] = text
  return { url, hash }
}
const textCalls = () => fetchMetadataMultiServer.mock.calls.filter(([, , type]) => type === 'text').map(([serverId, path]) => [serverId, path])

// ------------------------------------------------------------------ movies

describe('a movie pass', () => {
  const KEY = 'Film (2020)'
  const FOLDER = `/movies/${encodeURIComponent(KEY)}`
  const partsFor = (payload) => {
    const fieldAvailability = { movies: { [KEY]: {} }, tv: {} }
    collectFieldAvailability(payload, '', 'A', fieldAvailability.movies[KEY])
    return { run, availability: { fieldAvailability }, caches: {} }
  }
  const repositoryOver = (stored) => ({
    findByOriginalTitle: jest.fn(async () => (stored ? structuredClone(stored) : null)),
    upsert: jest.fn(async () => {}),
    smartUpsert: jest.fn(async () => {}),
  })
  const pass = (repository, payload) => new MovieSyncService(repository).syncMovie(KEY, payload, partsFor(payload))
  const stored = () => ({
    _id: 'm1', originalTitle: KEY, title: KEY, type: 'movie', titleSource: 'A', originalTitleSource: 'A',
    createdAt: new Date('2020-01-01'), initialDiscoveryDate: new Date('2020-01-01'), initialDiscoveryServer: 'A', metadata: {},
  })

  it('stores the owner\'s file in its own fields, apart from the metadata, and stamps the gate', async () => {
    const text = JSON.stringify(fixtures.mixedGrants())
    const payload = { urls: {}, credits: locator(FOLDER, text) }
    const repository = repositoryOver(stored())
    const results = await pass(repository, payload)

    expect(textCalls()).toEqual([['A', `${FOLDER}/credits.json?hash=${sha(text)}`]])
    expect(results.find((r) => r.operation === 'credits')).toMatchObject({ status: 'completed' })
    const [written] = repository.smartUpsert.mock.calls[0]
    expect(written.credits).toEqual(fixtures.mixedGrants())
    expect(written.creditsSource).toBe('A')
    expect(written.creditsHash).toBe(sha(text))
    expect(written.metadata).toEqual({})
    expect(written.syncGates?.A).toEqual(expect.any(String))
  })

  it('keeps the stored credits, records a rejected file and closes the gate until the file changes', async () => {
    const text = JSON.stringify({ ...fixtures.mixedGrants(), schemaVersion: 9 })
    const payload = { urls: {}, credits: locator(FOLDER, text) }
    const previous = { ...stored(), credits: fixtures.artworkByArtist(), creditsSource: 'A', creditsHash: 'old' }
    const repository = repositoryOver(previous)
    const results = await pass(repository, payload)

    expect(results.find((r) => r.operation === 'credits')).toMatchObject({ status: 'completed', errors: [] })
    const [written, , options] = repository.smartUpsert.mock.calls[0]
    expect(written.credits).toEqual(fixtures.artworkByArtist())
    expect(written.creditsHash).toBe('old')
    expect(written.creditsStatus).toMatchObject({ state: 'error', reason: 'unsupported-version', serverId: 'A' })
    // An edit moves the payload's hash, and with it the gate
    expect(written.syncGates?.A).toEqual(expect.any(String))
    expect(options.unset).toEqual([])
  })

  it('keeps the stored credits and leaves the gate open when the fetch fails', async () => {
    const payload = { urls: {}, credits: { url: `${FOLDER}/credits.json?hash=${'b'.repeat(64)}`, hash: 'b'.repeat(64) } }
    const previous = { ...stored(), credits: fixtures.artworkByArtist(), creditsSource: 'A', creditsHash: 'old' }
    const repository = repositoryOver(previous)
    const results = await pass(repository, payload)

    expect(results.find((r) => r.operation === 'credits')).toMatchObject({ status: 'failed' })
    const [written] = repository.smartUpsert.mock.calls[0]
    expect(written.credits).toEqual(fixtures.artworkByArtist())
    expect(written.creditsStatus).toMatchObject({ reason: 'fetch-failed' })
    expect(written.syncGates?.A).toBeUndefined()
  })

  it('still syncs the credits of a title whose metadata server has no metadata file', async () => {
    const text = JSON.stringify(fixtures.exactBackdropSource())
    const repository = repositoryOver(null)
    await pass(repository, { urls: {}, credits: locator(FOLDER, text) })
    const [inserted] = repository.upsert.mock.calls[0]
    expect(inserted.credits).toEqual(fixtures.exactBackdropSource())
  })

  it('removes the credits when the server confirms the file is gone', async () => {
    const previous = { ...stored(), credits: fixtures.mixedGrants(), creditsSource: 'A', creditsHash: 'h' }
    const repository = repositoryOver(previous)
    await pass(repository, { urls: {}, credits: { absent: true } })
    const [, , options] = repository.smartUpsert.mock.calls[0]
    expect(options.unset).toEqual(['credits', 'creditsSource', 'creditsHash'])
  })

  it('leaves the credits alone when the processor publishes no credits value', async () => {
    const previous = { ...stored(), credits: fixtures.mixedGrants(), creditsSource: 'A', creditsHash: 'h' }
    const repository = repositoryOver(previous)
    const results = await pass(repository, { urls: {} })
    expect(results.find((r) => r.operation === 'credits')).toMatchObject({ status: 'skipped' })
    for (const [, , options] of repository.smartUpsert.mock.calls) expect(options.unset).toEqual([])
    expect(textCalls()).toEqual([])
  })
})

// ------------------------------------------------------------------ TV

describe('the TV builders', () => {
  const SHOW = 'Show (2020)'
  const ROOT = `/tv/${encodeURIComponent(SHOW)}`
  const SF = `${ROOT}/Season%201`
  const prefetch = { mediaType: 'tv', title: SHOW }
  const availabilityOf = (payload) => {
    const fieldAvailability = { movies: {}, tv: { [SHOW]: {} } }
    collectFieldAvailability(payload, '', 'A', fieldAvailability.tv[SHOW])
    return { fieldAvailability }
  }
  const showPayload = (showCredits, episodeCredits) => ({
    metadata: `${ROOT}/metadata.json`,
    ...(showCredits ? { credits: showCredits } : {}),
    seasons: {
      'Season 1': {
        episodes: { S01E01: { episodeNumber: 1, videoURL: `${SF}/S01E01.mkv`, ...(episodeCredits ? { credits: episodeCredits } : {}) } },
      },
    },
  })

  it('the show builder stores the show\'s credits beside its metadata', async () => {
    const text = JSON.stringify(fixtures.seriesShow())
    const payload = showPayload(locator(ROOT, text))
    const { plan } = await buildWithResources(
      (resources) => planTVShow({ showTitle: SHOW, fileData: payload, run, availability: availabilityOf(payload), existing: null }, resources),
      prefetch
    )
    expect(plan.set.credits).toEqual(fixtures.seriesShow())
    expect(plan.set.creditsSource).toBe('A')
    expect(plan.set.metadata).toEqual({ name: 'From metadata.json', overview: 'The synopsis.' })
    expect(plan.incomplete).toBe(false)
  })

  it('the show builder keeps the stored credits and holds the gate when the fetch fails', async () => {
    const payload = showPayload({ url: `${ROOT}/credits.json?hash=${'a'.repeat(64)}`, hash: 'a'.repeat(64) })
    const existing = { title: SHOW, originalTitle: SHOW, type: 'tvShow', credits: fixtures.seriesShow(), creditsSource: 'A', creditsHash: 'old' }
    const { plan } = await buildWithResources(
      (resources) => planTVShow({ showTitle: SHOW, fileData: payload, run, availability: availabilityOf(payload), existing }, resources),
      prefetch
    )
    expect(plan.set).not.toHaveProperty('credits')
    expect(plan.set.creditsStatus).toMatchObject({ reason: 'fetch-failed' })
    expect(plan.deferrals).toContain('credits')
    expect(plan.incomplete).toBe(true)
  })

  it('the episode builder stores the episode\'s own file, read from the season folder', async () => {
    const text = JSON.stringify(fixtures.episodeOwn(1, 'Ep'))
    const credits = locator(SF, text, '01_credits.json')
    const payload = showPayload(null, credits)
    const fileData = payload.seasons['Season 1'].episodes.S01E01
    const { plan } = await buildWithResources(
      (resources) =>
        planEpisode(
          {
            showOriginalTitle: SHOW, displayTitle: SHOW, seasonNumber: 1, episodeNumber: 1, fileData, showPayload: payload,
            run, availability: availabilityOf(payload), existing: null, showId: 's1', seasonId: 'se1', parentShow: null,
            seasonFileData: payload.seasons['Season 1'], episodeFileName: 'S01E01',
          },
          resources,
          mockLog
        ),
      prefetch
    )
    expect(textCalls()).toEqual([['A', credits.url]])
    expect(plan.set.credits).toEqual(fixtures.episodeOwn(1, 'Ep'))
    expect(plan.set.creditsSource).toBe('A')
  })

  it('the episode builder validates the file as an episode file, which may suppress inherited entries', async () => {
    const text = JSON.stringify({ ...fixtures.episodeOwn(1, 'Ep'), suppress: ['collage-poster-1'] })
    const payload = showPayload(null, locator(SF, text, '01_credits.json'))
    const fileData = payload.seasons['Season 1'].episodes.S01E01
    const { plan } = await buildWithResources(
      (resources) =>
        planEpisode(
          {
            showOriginalTitle: SHOW, displayTitle: SHOW, seasonNumber: 1, episodeNumber: 1, fileData, showPayload: payload,
            run, availability: availabilityOf(payload), existing: null, showId: 's1', seasonId: 'se1', parentShow: null,
            seasonFileData: payload.seasons['Season 1'], episodeFileName: 'S01E01',
          },
          resources,
          mockLog
        ),
      prefetch
    )
    expect(plan.set.credits.suppress).toEqual(['collage-poster-1'])
  })
})
