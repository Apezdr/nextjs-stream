/**
 * @jest-environment node
 *
 * Picking a release by hand, with the real job store: what may be searched,
 * that a grab sends the stored guid (never one from the browser), and that
 * the title stays monitored afterwards (the owner's call): the movie, or
 * exactly what the grabbed release covers.
 */

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))
jest.mock('@src/lib/arr/radarr', () => ({
  ...jest.requireActual('@src/lib/arr/radarr'),
  findMovie: jest.fn(),
  ensureMovieMonitored: jest.fn(),
}))
jest.mock('@src/lib/arr/sonarr', () => ({
  ...jest.requireActual('@src/lib/arr/sonarr'),
  resolveSeries: jest.fn(),
  listEpisodes: jest.fn(),
  applyMonitoring: jest.fn(),
}))
jest.mock('@src/lib/arr/releases', () => ({
  ...jest.requireActual('@src/lib/arr/releases'),
  searchReleases: jest.fn(),
  grabRelease: jest.fn(),
}))
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/arr/requestLog', () => ({ logArrActivity: jest.fn(async () => {}), requestedBy: jest.fn(async () => false) }))

const originalEnv = process.env
let picks
let radarr
let sonarr
let releases
let ArrError
let requestLog

// A manager (what an admin is): no limits.
const MANAGER = {
  userId: 'admin-1',
  userName: 'Adam',
  permissions: { profiles: { radarr: 'all', sonarr: 'all' }, manual: true, anyTitle: true, manage: true },
}
// A requester who may pick by hand, HD-1080p movies only.
const PICKER = {
  userId: 'user-2',
  userName: 'Robin',
  permissions: { profiles: { radarr: [4], sonarr: [] }, manual: true, anyTitle: false, manage: false },
}

const movieRef = { mediaType: 'movie', tmdbId: 11 }
const showRef = { mediaType: 'tv', tmdbId: 1438 }
const settle = () => new Promise((resolve) => setImmediate(resolve))

const stored = (title, extra = {}) => ({
  guid: `guid-${title}`,
  indexerId: 4,
  summary: { title, approved: true, rejections: [] },
  episodeIds: [],
  fullSeason: null,
  ...extra,
})

beforeEach(() => {
  jest.resetModules()
  process.env = {
    ...originalEnv,
    RADARR_URL: 'http://radarr.test',
    RADARR_API_KEY: 'k1',
    SONARR_URL: 'http://sonarr.test',
    SONARR_API_KEY: 'k2',
  }
  radarr = require('@src/lib/arr/radarr')
  sonarr = require('@src/lib/arr/sonarr')
  releases = require('@src/lib/arr/releases')
  ArrError = require('@src/lib/arr/http').ArrError
  picks = require('@src/lib/arr/picks')
  requestLog = require('@src/lib/arr/requestLog')

  radarr.findMovie.mockResolvedValue({ id: 186, tmdbId: 11, monitored: true, qualityProfileId: 4 })
  radarr.ensureMovieMonitored.mockResolvedValue(undefined)
  sonarr.resolveSeries.mockResolvedValue({
    entry: {
      id: 7,
      title: 'The Wire',
      seasons: [
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: false },
      ],
    },
    candidate: null,
  })
  sonarr.listEpisodes.mockResolvedValue([{ id: 201, seasonNumber: 2, episodeNumber: 1 }])
  sonarr.applyMonitoring.mockResolvedValue({ wanted: [], seasonNumbers: [] })
  releases.grabRelease.mockResolvedValue(undefined)
})

afterAll(() => {
  process.env = originalEnv
})

async function finishedSearch(ref, target, found, actor = MANAGER) {
  releases.searchReleases.mockResolvedValue(found)
  const view = await picks.startPick(ref, target, null, actor)
  await settle()
  return view.id
}

test('parsePickTarget: nothing for a movie; a season (specials included) or an episode for a show', () => {
  expect(picks.parsePickTarget({ seasonNumber: 3 }, 'movie')).toBeNull()
  expect(picks.parsePickTarget({ seasonNumber: 0 }, 'tv')).toEqual({ seasonNumber: 0 })
  expect(picks.parsePickTarget({ episodeId: 201 }, 'tv')).toEqual({ episodeId: 201 })
  expect(() => picks.parsePickTarget({}, 'tv')).toThrow('Choose a season or an episode')
  expect(() => picks.parsePickTarget({ episodeId: -1 }, 'tv')).toThrow('episodeId')
})

test('a movie search runs on Radarr against the library id, and finishes in the background', async () => {
  releases.searchReleases.mockResolvedValue([stored('A')])
  const view = await picks.startPick(movieRef, null, null, MANAGER)
  expect(view).toMatchObject({ state: 'searching', service: 'radarr', target: { kind: 'movie' } })
  expect(releases.searchReleases).toHaveBeenCalledWith(expect.objectContaining({ service: 'radarr' }), {
    kind: 'movie',
    movieId: 186,
  })

  await settle()
  expect(picks.readPick(view.id, MANAGER)).toMatchObject({ state: 'done', releases: [{ id: '0', title: 'A' }] })
})

test('only titles the service has can be searched', async () => {
  radarr.findMovie.mockResolvedValue(null)
  await expect(picks.startPick(movieRef, null, null, MANAGER)).rejects.toMatchObject({ status: 404, code: 'not_added' })
  expect(releases.searchReleases).not.toHaveBeenCalled()
})

test('a show’s season or episode must be one Sonarr lists', async () => {
  await expect(picks.startPick(showRef, { seasonNumber: 9 }, null, MANAGER)).rejects.toMatchObject({ status: 400 })
  await expect(picks.startPick(showRef, { episodeId: 999 }, null, MANAGER)).rejects.toMatchObject({ status: 400 })

  releases.searchReleases.mockResolvedValue([])
  await picks.startPick(showRef, { episodeId: 201 }, 'The Wire', MANAGER)
  expect(sonarr.resolveSeries).toHaveBeenCalledWith(expect.anything(), 1438, 'The Wire')
  expect(releases.searchReleases).toHaveBeenLastCalledWith(expect.anything(), { kind: 'episode', seriesId: 7, episodeId: 201 })

  await picks.startPick(showRef, { seasonNumber: 2 }, null, MANAGER)
  expect(releases.searchReleases).toHaveBeenLastCalledWith(expect.anything(), { kind: 'season', seriesId: 7, seasonNumber: 2 })
})

test('a grab sends the stored guid and indexer, marks the release, and keeps the movie monitored', async () => {
  const searchId = await finishedSearch(movieRef, null, [stored('A'), stored('B', { indexerId: 9 })])

  await expect(picks.grabPick(searchId, '1', MANAGER)).resolves.toEqual({ service: 'radarr', title: 'B', monitored: true })

  expect(releases.grabRelease).toHaveBeenCalledWith(
    expect.objectContaining({ service: 'radarr' }),
    expect.objectContaining({ guid: 'guid-B', indexerId: 9 })
  )
  expect(radarr.ensureMovieMonitored).toHaveBeenCalledWith(expect.anything(), 186)
  expect(picks.readPick(searchId, MANAGER).releases.map((release) => release.grabbed)).toEqual([false, true])
})

test('a grab is refused before the search finishes, or for a release it didn’t find', async () => {
  releases.searchReleases.mockReturnValue(new Promise(() => {}))
  const running = await picks.startPick(movieRef, null, null, MANAGER)
  await expect(picks.grabPick(running.id, '0', MANAGER)).rejects.toMatchObject({ status: 409, code: 'not_ready' })

  // A different movie, so a new search rather than the running one joined.
  radarr.findMovie.mockResolvedValueOnce({ id: 187, tmdbId: 12, monitored: true })
  const searchId = await finishedSearch({ mediaType: 'movie', tmdbId: 12 }, null, [stored('A')])
  await expect(picks.grabPick(searchId, '5', MANAGER)).rejects.toMatchObject({ status: 400 })
  await expect(picks.grabPick(searchId, 'guid-A', MANAGER)).rejects.toMatchObject({ status: 400 })
  expect(releases.grabRelease).not.toHaveBeenCalled()
})

test('results the service has dropped are a 410, and the search is forgotten', async () => {
  const searchId = await finishedSearch(movieRef, null, [stored('A')])
  releases.grabRelease.mockRejectedValue(new ArrError('not_found', 404))

  await expect(picks.grabPick(searchId, '0', MANAGER)).rejects.toMatchObject({ status: 410, code: 'expired' })
  expect(() => picks.readPick(searchId, MANAGER)).toThrow('expired')
  expect(radarr.ensureMovieMonitored).not.toHaveBeenCalled()
})

test('a Sonarr grab keeps exactly what the release covers monitored; failing that does not undo the grab', async () => {
  const searchId = await finishedSearch(showRef, { seasonNumber: 2 }, [
    stored('pack', { fullSeason: 2, episodeIds: [201, 202] }),
    stored('episode', { episodeIds: [201] }),
  ])

  await picks.grabPick(searchId, '0', MANAGER)
  expect(sonarr.applyMonitoring).toHaveBeenLastCalledWith(expect.anything(), 7, { type: 'seasons', seasons: [2] })

  await picks.grabPick(searchId, '1', MANAGER)
  expect(sonarr.applyMonitoring).toHaveBeenLastCalledWith(expect.anything(), 7, { type: 'episodes', episodeIds: [201] })

  sonarr.applyMonitoring.mockRejectedValue(new ArrError('timeout'))
  await expect(picks.grabPick(searchId, '1', MANAGER)).resolves.toMatchObject({ monitored: false })
  expect(mockLog.warn).toHaveBeenCalled()
})

describe('a requester’s role', () => {
  test('picking by hand needs the role’s manual flag, and a title they may act on', async () => {
    const autoOnly = { ...PICKER, permissions: { ...PICKER.permissions, manual: false } }
    await expect(picks.startPick(movieRef, null, null, autoOnly)).rejects.toMatchObject({
      status: 403,
      message: 'Picking releases by hand isn’t part of your role.',
    })
    await expect(picks.startPick(movieRef, null, null, PICKER)).rejects.toMatchObject({
      status: 403,
      message: 'You can search only for titles you requested.',
    })
    expect(releases.searchReleases).not.toHaveBeenCalled()
  })

  test('their own title: they search, read and grab; nobody else’s search is theirs', async () => {
    requestLog.requestedBy.mockResolvedValue(true)
    const searchId = await finishedSearch(movieRef, null, [stored('A')], PICKER)

    expect(() => picks.readPick(searchId, { ...PICKER, userId: 'someone-else' })).toThrow('That search isn’t yours.')
    // A manager may look at anyone's.
    expect(picks.readPick(searchId, MANAGER).state).toBe('done')

    await expect(picks.grabPick(searchId, '0', PICKER)).resolves.toMatchObject({ title: 'A' })
    expect(requestLog.logArrActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'grab', ref: movieRef, detail: expect.objectContaining({ release: 'A', rejected: false }) })
    )
  })

  test('a release the service rejected is for managers only', async () => {
    requestLog.requestedBy.mockResolvedValue(true)
    const rejected = stored('4K', { summary: { title: '4K', approved: false, rejections: ['Not wanted in profile'] } })
    const searchId = await finishedSearch(movieRef, null, [rejected], PICKER)

    await expect(picks.grabPick(searchId, '0', PICKER)).rejects.toMatchObject({
      status: 403,
      message: 'Only managers can grab a release Radarr rejected.',
    })
    expect(releases.grabRelease).not.toHaveBeenCalled()

    await expect(picks.grabPick(searchId, '0', MANAGER)).resolves.toMatchObject({ title: '4K' })
  })
})
