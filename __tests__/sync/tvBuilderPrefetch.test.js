/**
 * @jest-environment node
 *
 * The TV builders (show, season, episode) do no I/O: the files they read are
 * fetched by the prefetch step, which calls a builder again until it needs
 * nothing more. These cases pin what a builder names, the order the files
 * are fetched in, a failed fetch reaching the builder as a failed file, an
 * episode whose fallback throws only without its metadata file, and the
 * episode's warnings logged once for the call that is kept.
 */

const mockServers = { A: { id: 'A', priority: 1 } }
const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }

jest.mock('@src/utils/sync/core/ResourceManager', () => ({
  ResourceManager: { getInstance: () => ({ config: { syncConcurrency: 1, httpConcurrency: 1 }, dbWriteLimitFor: () => (fn) => fn() }) },
  getResourceManager: () => ({}),
}))
jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog, logError: jest.fn() }))
jest.mock('@src/utils/config', () => ({ getServer: (id) => mockServers[id], multiServerHandler: {} }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({ fetchMetadataMultiServer: jest.fn() }))

const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
const { buildWithResources } = require('@src/utils/sync/infrastructure/fileSystem/prefetch')
const { planTVShow } = require('@src/utils/sync/domain/tv/showPlan')
const { planEpisode } = require('@src/utils/sync/domain/tv/episodePlan')
const { EpisodeSyncService } = require('@src/utils/sync/domain/tv/EpisodeSyncService')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')

const SHOW = 'Show (2020)'
const ROOT = `/tv/${encodeURIComponent(SHOW)}`
const SF = `${ROOT}/Season%201`
const run = { serverConfig: { ...mockServers.A, baseUrl: 'https://A.example', prefix: '', enabled: true }, allEnabledServersProbed: true }
const episodeData = () => ({
  episodeNumber: 1,
  videoURL: `${SF}/S01E01.mkv`,
  metadata: `${SF}/S01E01.json`,
  mediaIdentity: { id: 'mid:new' },
  thumbnail: `${SF}/S01E01.jpg?hash=1`,
  thumbnailBlurhash: `${SF}/S01E01.jpg.blurhash`,
})
const showPayload = () => ({
  metadata: `${ROOT}/metadata.json`,
  poster: `${ROOT}/poster.jpg?hash=1`,
  posterBlurhash: `${ROOT}/poster.jpg.blurhash`,
  backdrop: `${ROOT}/backdrop.jpg?hash=1`,
  backdropBlurhash: `${ROOT}/backdrop.jpg.blurhash`,
  seasons: { 'Season 1': { episodes: { S01E01: episodeData() } } },
})
const availabilityOf = (payload) => {
  const fieldAvailability = { movies: {}, tv: { [SHOW]: {} } }
  collectFieldAvailability(payload, '', 'A', fieldAvailability.tv[SHOW])
  return { fieldAvailability }
}
const prefetch = { mediaType: 'tv', title: SHOW }
const calls = () => fetchMetadataMultiServer.mock.calls.map(([serverId, path, type]) => [serverId, path, type])

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) jest.spyOn(console, method).mockImplementation(() => {})
})
beforeEach(() => {
  jest.clearAllMocks()
  fetchMetadataMultiServer.mockImplementation(async (serverId, path, type) =>
    type === 'blurhash' ? `blurhash-of:${path}` : path.endsWith('S01E01.json') ? { name: 'Pilot' } : { name: 'Show Name' }
  )
})

describe('the show builder', () => {
  const input = () => ({ showTitle: SHOW, fileData: showPayload(), run, availability: availabilityOf(showPayload()), existing: null })

  it('names its metadata file and both blurhashes, read as files that failed, when called before they are fetched', () => {
    const { plan } = planTVShow(input())
    expect(plan.needs).toEqual([
      { kind: 'metadata', serverId: 'A', path: `${ROOT}/metadata.json` },
      { kind: 'blurhash', serverId: 'A', path: `https://A.example${ROOT}/poster.jpg.blurhash` },
      { kind: 'blurhash', serverId: 'A', path: `https://A.example${ROOT}/backdrop.jpg.blurhash` },
    ])
    expect(plan.deferrals).toEqual(['metadata', 'posterBlurhash', 'backdropBlurhash'])
    expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
  })

  it('has them fetched once each, in that order, and builds with them', async () => {
    const { plan } = await buildWithResources((resources) => planTVShow(input(), resources), prefetch)
    expect(calls()).toEqual([
      ['A', `${ROOT}/metadata.json`, 'file'],
      ['A', `https://A.example${ROOT}/poster.jpg.blurhash`, 'blurhash'],
      ['A', `https://A.example${ROOT}/backdrop.jpg.blurhash`, 'blurhash'],
    ])
    expect(plan).toMatchObject({ needs: [], incomplete: false, deferrals: [] })
    expect(plan.set).toMatchObject({ title: 'Show Name', posterBlurhash: `blurhash-of:https://A.example${ROOT}/poster.jpg.blurhash` })
  })

  it('holds the gate open for a file whose fetch failed', async () => {
    fetchMetadataMultiServer.mockRejectedValueOnce(new Error('file server timed out'))
    const { plan } = await buildWithResources((resources) => planTVShow(input(), resources), prefetch)
    expect(plan).toMatchObject({ needs: [], incomplete: true, deferrals: ['metadata'] })
    expect(plan.set).not.toHaveProperty('metadata')
  })
})

describe('an episode whose show lists its seasons in an object', () => {
  // The parent-show fallback for missing episode metadata calls .find on it, and throws.
  const parentShow = { _id: 'show-1', title: 'Show Name', metadata: { seasons: { 1: {} } } }
  const input = () => ({
    showOriginalTitle: SHOW, displayTitle: 'Show Name', seasonNumber: 1, episodeNumber: 1, fileData: episodeData(),
    showPayload: showPayload(), run, availability: availabilityOf(showPayload()), existing: null,
    showId: 'show-1', seasonId: null, parentShow, seasonFileData: showPayload().seasons['Season 1'], episodeFileName: 'S01E01',
  })
  const log = { warn: jest.fn(), error: jest.fn() }

  it('is built when its metadata file is fetched: both files are fetched, metadata first', async () => {
    const { plan } = await buildWithResources((resources) => planEpisode(input(), resources, log), prefetch)
    expect(calls()).toEqual([
      ['A', `${SF}/S01E01.json`, 'file'],
      ['A', `https://A.example${SF}/S01E01.jpg.blurhash`, 'blurhash'],
    ])
    expect(plan.set).toMatchObject({ title: 'Pilot', thumbnailBlurhash: `blurhash-of:https://A.example${SF}/S01E01.jpg.blurhash` })
  })

  it('throws when its metadata file fails, after fetching only that file', async () => {
    fetchMetadataMultiServer.mockRejectedValueOnce(new Error('file server timed out'))
    await expect(buildWithResources((resources) => planEpisode(input(), resources, log), prefetch)).rejects.toThrow(TypeError)
    expect(calls()).toEqual([['A', `${SF}/S01E01.json`, 'file']])
  })
})

describe('the episode service', () => {
  it('logs a builder warning once, for the call whose plan it keeps', async () => {
    const payload = showPayload()
    const existing = { _id: 'e1', episodeNumber: 1, seasonNumber: 1, showTitle: 'Show Name', originalTitle: SHOW, mediaId: 'mid:old' }
    const episodes = { findByShowAndSeason: jest.fn(async () => [existing]), smartBulkUpsert: jest.fn(async () => {}) }
    const seasons = { findSeason: jest.fn(async () => ({ _id: 'season-1' })) }
    const service = new EpisodeSyncService(episodes, seasons)

    await service.syncSeason(SHOW, 1, payload, { run: { ...run, forceSync: false }, availability: availabilityOf(payload) }, { _id: 'show-1', title: 'Show Name' })

    // The builder was called twice: once naming its files, once with them.
    expect(fetchMetadataMultiServer).toHaveBeenCalledTimes(2)
    const mismatch = mockLog.warn.mock.calls.filter(([, message]) => message === 'mediaId mismatch for episode — video owner wins')
    expect(mismatch).toHaveLength(1)
    expect(episodes.smartBulkUpsert.mock.calls[0][0][0].merged).toMatchObject({ mediaId: 'mid:new', title: 'Pilot' })
  })
})
