/**
 * @jest-environment node
 *
 * The rules around an add: a profile and root folder the service has, a folder
 * name no other title in the library uses, no double add, and every service
 * failure turned into something the dialog can say.
 */

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

jest.mock('@src/lib/arr/radarr', () => ({
  ...jest.requireActual('@src/lib/arr/radarr'),
  findMovie: jest.fn(),
  lookupMovie: jest.fn(),
  getRadarrOptions: jest.fn(),
  addMovie: jest.fn(),
  updateMovie: jest.fn(),
  searchMovie: jest.fn(),
  movieDownload: jest.fn(),
}))
jest.mock('@src/lib/arr/sonarr', () => ({
  ...jest.requireActual('@src/lib/arr/sonarr'),
  resolveSeries: jest.fn(),
  getSonarrOptions: jest.fn(),
  addSeries: jest.fn(),
  seriesDownload: jest.fn(),
  monitorAndSearch: jest.fn(),
}))
jest.mock('@src/lib/arr/catalog', () => ({ checkCatalog: jest.fn() }))
jest.mock('@src/lib/arr/requestLog', () => ({ logArrActivity: jest.fn(async () => {}), requestedBy: jest.fn(async () => false) }))

const radarr = require('@src/lib/arr/radarr')
const sonarr = require('@src/lib/arr/sonarr')
const { checkCatalog } = require('@src/lib/arr/catalog')
const { ArrError } = require('@src/lib/arr/http')
const titles = require('@src/lib/arr/titles')
const { logArrActivity, requestedBy } = require('@src/lib/arr/requestLog')

// A manager (what an admin is): every service and profile, no limits.
const MANAGER = {
  userId: 'admin-1',
  userName: 'Adam',
  permissions: { profiles: { radarr: 'all', sonarr: 'all' }, manual: true, anyTitle: true, manage: true },
}
// A requester: HD-1080p movies only by default.
const requester = (permissions = {}) => ({
  userId: 'user-2',
  userName: 'Robin',
  permissions: { profiles: { radarr: [4], sonarr: [] }, manual: false, anyTitle: false, manage: false, ...permissions },
})

const ENV = {
  RADARR_URL: 'http://radarr.test:7878/radarr',
  RADARR_API_KEY: 'radarr-secret-key',
  SONARR_URL: 'http://sonarr.test:8989/sonarr',
  SONARR_API_KEY: 'sonarr-secret-key',
}
const originalEnv = process.env

const radarrOptions = {
  qualityProfiles: [
    { id: 4, name: 'HD-1080p' },
    { id: 5, name: 'Ultra-HD - 1080p' },
  ],
  rootFolders: [{ path: '/processed_movies', accessible: true, freeSpaceBytes: 1 }],
  defaultQualityProfileId: 4,
  naming: { movieFolderFormat: '{Movie Title}', replaceIllegalCharacters: true, colonReplacementFormat: 'delete' },
}
const sonarrOptions = {
  qualityProfiles: [{ id: 8, name: 'Ultra-HD - 1080p - with Upgrades' }],
  rootFolders: [{ path: '/processed_tv', accessible: true, freeSpaceBytes: 1 }],
  defaultQualityProfileId: 8,
}
const starWars = { title: 'Star Wars', year: 1977, tmdbId: 11, isAvailable: true }
const theWire = {
  title: 'The Wire',
  year: 2002,
  tmdbId: 1438,
  folder: 'The Wire',
  status: 'ended',
  seasons: [
    { seasonNumber: 0, monitored: false },
    { seasonNumber: 1, monitored: true },
  ],
}
const movieRef = { mediaType: 'movie', tmdbId: 11 }
const showRef = { mediaType: 'tv', tmdbId: 1438 }
const addInput = (overrides = {}) =>
  titles.parseAddInput({ qualityProfileId: 4, ...overrides })

beforeEach(() => {
  jest.clearAllMocks()
  process.env = { ...originalEnv, ...ENV }
  radarr.getRadarrOptions.mockResolvedValue(radarrOptions)
  radarr.findMovie.mockResolvedValue(null)
  radarr.lookupMovie.mockResolvedValue(starWars)
  radarr.addMovie.mockImplementation(async (_config, movie) => ({ ...movie, id: 900, monitored: true, qualityProfileId: 4 }))
  sonarr.getSonarrOptions.mockResolvedValue(sonarrOptions)
  sonarr.resolveSeries.mockResolvedValue({ entry: null, candidate: theWire })
  sonarr.addSeries.mockImplementation(async (_config, series) => ({ ...series, id: 500 }))
  checkCatalog.mockResolvedValue({ inLibrary: false, folderTakenBy: null })
})

afterAll(() => {
  process.env = originalEnv
})

const refusal = (promise) => promise.then(() => null, (error) => error)

describe('input', () => {
  test('parseTitleRef takes movie or tv and a positive id', () => {
    expect(titles.parseTitleRef({ mediaType: 'tv', tmdbId: '1438' })).toEqual(showRef)
    expect(() => titles.parseTitleRef({ mediaType: 'music', tmdbId: '1' })).toThrow(titles.ArrRequestError)
    expect(() => titles.parseTitleRef({ mediaType: 'movie', tmdbId: '0' })).toThrow('positive integer')
    expect(() => titles.parseTitleRef({ mediaType: 'movie', tmdbId: '1.5' })).toThrow('positive integer')
  })

  test('parseAddInput defaults to searching now, released, the whole show', () => {
    expect(titles.parseAddInput({ qualityProfileId: 4 })).toEqual({
      qualityProfileId: 4,
      rootFolderPath: null,
      folder: null,
      minimumAvailability: 'released',
      scope: { type: 'all' },
      search: true,
    })
    expect(() => titles.parseAddInput({})).toThrow('Choose a quality profile.')
    expect(() => titles.parseAddInput({ qualityProfileId: 4, minimumAvailability: 'tba' })).toThrow('minimumAvailability')
  })

  test('on an add, an episodes scope carries no ids: they are picked afterwards', () => {
    expect(titles.parseAddInput({ qualityProfileId: 4, scope: { type: 'episodes', episodeIds: [1, 2] } }).scope).toEqual({
      type: 'episodes',
      episodeIds: [],
    })
  })

  test('a search scope must name something', () => {
    expect(() => titles.parseScope({ type: 'episodes', episodeIds: [] }, { forAdd: false })).toThrow('Pick at least one episode.')
    expect(() => titles.parseScope({ type: 'seasons', seasons: [-1] }, { forAdd: false })).toThrow('Pick at least one season.')
    expect(titles.parseScope({ type: 'seasons', seasons: [0, 2, 2] }, { forAdd: false })).toEqual({ type: 'seasons', seasons: [0, 2] })
  })
})

describe('getArrTitle', () => {
  test('a movie Radarr lacks: the candidate with its predicted folder, checked against the library', async () => {
    const title = await titles.getArrTitle(movieRef, null, MANAGER)

    expect(title).toMatchObject({
      state: 'absent',
      service: 'radarr',
      candidate: { title: 'Star Wars', year: 1977, folder: 'Star Wars', released: true },
      rootFolderPath: '/processed_movies',
      catalog: { inLibrary: false, folderTakenBy: null },
    })
    // Radarr's naming config is server-side detail.
    expect(title.options).not.toHaveProperty('naming')
    expect(checkCatalog).toHaveBeenCalledWith('movie', 11, 'Star Wars')
  })

  test('a movie Radarr has: its entry; a lost queue only drops the progress', async () => {
    radarr.findMovie.mockResolvedValue({ id: 186, tmdbId: 11, title: 'Star Wars', monitored: true, hasFile: false, qualityProfileId: 5 })
    radarr.movieDownload.mockRejectedValue(new ArrError('timeout'))

    await expect(titles.getArrTitle(movieRef, null, MANAGER)).resolves.toMatchObject({
      state: 'present',
      entry: { id: 186, qualityProfileId: 5, hasFile: false },
      download: null,
    })
  })

  test('service trouble is a state; a bug is not swallowed', async () => {
    radarr.getRadarrOptions.mockRejectedValue(new ArrError('unauthorized', 401))
    await expect(titles.getArrTitle(movieRef, null, MANAGER)).resolves.toEqual({
      state: 'unreachable',
      service: 'radarr',
      reason: 'unauthorized',
      httpStatus: 401,
    })

    radarr.getRadarrOptions.mockRejectedValue(new TypeError('boom'))
    await expect(titles.getArrTitle(movieRef, null, MANAGER)).rejects.toThrow('boom')
  })

  test('unset environment names the missing variables', async () => {
    delete process.env.SONARR_API_KEY
    await expect(titles.getArrTitle(showRef, null, MANAGER)).resolves.toEqual({
      state: 'not_configured',
      service: 'sonarr',
      missing: ['SONARR_API_KEY'],
    })
  })

  test('a show Sonarr can’t match', async () => {
    sonarr.resolveSeries.mockResolvedValue({ entry: null, candidate: null })
    await expect(titles.getArrTitle(showRef, 'The Wire', MANAGER)).resolves.toEqual({ state: 'not_found', service: 'sonarr' })
    expect(sonarr.resolveSeries).toHaveBeenCalledWith(expect.anything(), 1438, 'The Wire')
  })
})

describe('addArrTitle', () => {
  test('a movie goes in under the folder the dialog showed, in the first root folder', async () => {
    const result = await titles.addArrTitle(movieRef, addInput(), null, MANAGER)

    expect(radarr.addMovie).toHaveBeenCalledWith(expect.anything(), starWars, {
      qualityProfileId: 4,
      rootFolderPath: '/processed_movies',
      folder: 'Star Wars',
      minimumAvailability: 'released',
      search: true,
    })
    expect(result).toMatchObject({ service: 'radarr', entry: { id: 900 }, inLibrary: false, next: null })
  })

  test('a typed folder name is the one checked and used', async () => {
    await titles.addArrTitle(movieRef, addInput({ folder: 'Star Wars (1977)' }), null, MANAGER)
    expect(checkCatalog).toHaveBeenCalledWith('movie', 11, 'Star Wars (1977)')
    expect(radarr.addMovie.mock.calls[0][2].folder).toBe('Star Wars (1977)')
  })

  test('a folder another title already lives in is refused, and nothing is added', async () => {
    checkCatalog.mockResolvedValue({ inLibrary: false, folderTakenBy: { title: 'Star Wars (Holiday Special)' } })
    const failure = await refusal(titles.addArrTitle(movieRef, addInput(), null, MANAGER))
    expect(failure).toMatchObject({ status: 409, code: 'folder_taken' })
    expect(failure.message).toContain('Choose a different folder name')
    expect(radarr.addMovie).not.toHaveBeenCalled()
  })

  test('refused before asking Radarr to add: bad folder, unknown profile or root, already added, unknown id', async () => {
    expect(await refusal(titles.addArrTitle(movieRef, addInput({ folder: 'AC/DC' }), null, MANAGER))).toMatchObject({ status: 400, code: 'invalid_folder' })
    expect(await refusal(titles.addArrTitle(movieRef, addInput({ qualityProfileId: 99 }), null, MANAGER))).toMatchObject({ status: 400 })
    expect(await refusal(titles.addArrTitle(movieRef, addInput({ rootFolderPath: '/elsewhere' }), null, MANAGER))).toMatchObject({ status: 400 })

    radarr.findMovie.mockResolvedValueOnce({ id: 186, tmdbId: 11 })
    expect(await refusal(titles.addArrTitle(movieRef, addInput(), null, MANAGER))).toMatchObject({ status: 409, code: 'already_added' })

    radarr.lookupMovie.mockResolvedValueOnce(null)
    expect(await refusal(titles.addArrTitle(movieRef, addInput(), null, MANAGER))).toMatchObject({ status: 404, code: 'not_found' })

    expect(radarr.addMovie).not.toHaveBeenCalled()
  })

  test('not configured is a 503 that names the variables', async () => {
    delete process.env.RADARR_URL
    expect(await refusal(titles.addArrTitle(movieRef, addInput(), null, MANAGER))).toMatchObject({
      status: 503,
      code: 'not_configured',
      details: { missing: ['RADARR_URL'] },
    })
  })

  test('a show: seasons must be ones Sonarr lists; an episodes add asks for the pick next', async () => {
    const unknownSeason = await refusal(
      titles.addArrTitle(showRef, titles.parseAddInput({ qualityProfileId: 8, scope: { type: 'seasons', seasons: [5] } }), null, MANAGER)
    )
    expect(unknownSeason).toMatchObject({ status: 400 })

    const result = await titles.addArrTitle(
      showRef,
      titles.parseAddInput({ qualityProfileId: 8, scope: { type: 'episodes' } }),
      'The Wire',
      MANAGER
    )
    expect(sonarr.addSeries).toHaveBeenCalledWith(expect.anything(), theWire, {
      qualityProfileId: 8,
      rootFolderPath: '/processed_tv',
      folder: 'The Wire',
      scope: { type: 'episodes', episodeIds: [] },
      search: true,
    })
    expect(result).toMatchObject({ service: 'sonarr', next: 'choose_episodes' })
  })

  test('a show Sonarr already has is not added twice', async () => {
    sonarr.resolveSeries.mockResolvedValue({ entry: { id: 7 }, candidate: null })
    expect(await refusal(titles.addArrTitle(showRef, titles.parseAddInput({ qualityProfileId: 8 }), null, MANAGER))).toMatchObject({
      status: 409,
      code: 'already_added',
    })
  })
})

test('searchArrTitle monitors an unmonitored movie before searching, so RSS keeps looking', async () => {
  radarr.findMovie.mockResolvedValue({ id: 186, tmdbId: 11, monitored: false })
  radarr.updateMovie.mockResolvedValue({ id: 186, monitored: true })

  await expect(titles.searchArrTitle(movieRef, { type: 'all' }, null, MANAGER)).resolves.toEqual({ service: 'radarr', episodes: null })
  expect(radarr.updateMovie).toHaveBeenCalledWith(expect.anything(), 186, { monitored: true })
  expect(radarr.searchMovie).toHaveBeenCalledWith(expect.anything(), 186)
})

describe('arrErrorResponse', () => {
  test('the service’s own validation messages, as a 422', async () => {
    const response = titles.arrErrorResponse(new ArrError('rejected', 400, ['Path is already configured']), 'radarr')
    expect(response.status).toBe(422)
    await expect(response.json()).resolves.toEqual({
      error: 'rejected',
      message: 'Radarr: Path is already configured',
      messages: ['Path is already configured'],
    })
  })

  test('an unreachable service is a 502 that says why', async () => {
    const response = titles.arrErrorResponse(new ArrError('timeout'), 'sonarr')
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ error: 'unreachable', reason: 'timeout', message: 'Sonarr didn’t answer: it timed out.' })
  })

  test('a refusal from here keeps its status and code; anything else is a logged 500', async () => {
    const refused = titles.arrErrorResponse(new titles.ArrRequestError(409, 'folder_taken', 'Taken.'), 'radarr')
    expect(refused.status).toBe(409)
    await expect(refused.json()).resolves.toEqual({ error: 'folder_taken', message: 'Taken.' })

    const crashed = titles.arrErrorResponse(new TypeError('boom'), 'radarr')
    expect(crashed.status).toBe(500)
    expect(mockLog.error).toHaveBeenCalled()
  })
})

describe('a requester’s role', () => {
  test('the add form offers only the profiles their role allows, and the default root folder', async () => {
    radarr.getRadarrOptions.mockResolvedValue({
      ...radarrOptions,
      rootFolders: [...radarrOptions.rootFolders, { path: '/more_movies', accessible: true, freeSpaceBytes: 1 }],
      defaultQualityProfileId: 5,
    })

    const title = await titles.getArrTitle(movieRef, null, requester())

    expect(title.options.qualityProfiles).toEqual([{ id: 4, name: 'HD-1080p' }])
    // The library's usual profile isn't theirs to choose, so the default is their first.
    expect(title.options.defaultQualityProfileId).toBe(4)
    expect(title.options.rootFolders.map((folder) => folder.path)).toEqual(['/processed_movies'])
    expect(title.permissions).toEqual({ manage: false, manual: false, canAct: true })
  })

  test('a service outside their role is refused before anything is asked', async () => {
    expect(await refusal(titles.getArrTitle(showRef, null, requester()))).toMatchObject({
      status: 403,
      message: 'Your role doesn’t include Sonarr.',
    })
    expect(sonarr.resolveSeries).not.toHaveBeenCalled()
  })

  test('an add is limited to their profiles and the folder Radarr would use, and is logged', async () => {
    expect(await refusal(titles.addArrTitle(movieRef, addInput({ qualityProfileId: 5 }), null, requester()))).toMatchObject({
      status: 403,
      message: 'That quality profile isn’t one your role allows.',
    })
    expect(await refusal(titles.addArrTitle(movieRef, addInput({ folder: 'Star Wars (1977)' }), null, requester()))).toMatchObject({
      status: 403,
      message: 'Choosing the folder name is for managers.',
    })
    expect(await refusal(titles.addArrTitle(movieRef, addInput({ rootFolderPath: '/other' }), null, requester()))).toMatchObject({
      status: 403,
    })
    expect(radarr.addMovie).not.toHaveBeenCalled()

    // The predicted folder, sent back unchanged, is fine.
    await titles.addArrTitle(movieRef, addInput({ folder: 'Star Wars' }), null, requester())
    expect(radarr.addMovie.mock.calls[0][2]).toMatchObject({ folder: 'Star Wars', rootFolderPath: '/processed_movies' })
    expect(logArrActivity).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'add', actor: expect.objectContaining({ userId: 'user-2' }), ref: movieRef, service: 'radarr' })
    )
  })

  test('a folder clash tells a requester to ask a manager', async () => {
    checkCatalog.mockResolvedValue({ inLibrary: false, folderTakenBy: { title: 'Star Wars (Holiday Special)' } })
    const failure = await refusal(titles.addArrTitle(movieRef, addInput(), null, requester()))
    expect(failure).toMatchObject({ status: 409, code: 'folder_taken' })
    expect(failure.message).toContain('Ask a manager')
  })

  test('changing a title’s quality profile is for managers', async () => {
    expect(await refusal(titles.updateArrTitle(movieRef, { qualityProfileId: 4 }, null, requester()))).toMatchObject({
      status: 403,
    })
    expect(radarr.updateMovie).not.toHaveBeenCalled()
  })

  describe('searching a title Radarr has', () => {
    beforeEach(() => radarr.findMovie.mockResolvedValue({ id: 186, tmdbId: 11, monitored: true, qualityProfileId: 4 }))

    test('only their own, by default', async () => {
      expect(await refusal(titles.searchArrTitle(movieRef, { type: 'all' }, null, requester()))).toMatchObject({
        status: 403,
        message: 'You can search only for titles you requested.',
      })
      requestedBy.mockResolvedValueOnce(true)
      await expect(titles.searchArrTitle(movieRef, { type: 'all' }, null, requester())).resolves.toMatchObject({ service: 'radarr' })
      expect(requestedBy).toHaveBeenLastCalledWith('user-2', movieRef)
      expect(logArrActivity).toHaveBeenCalledWith(expect.objectContaining({ kind: 'search' }))
    })

    test('with “any title”, any title whose profile their role allows', async () => {
      await expect(titles.searchArrTitle(movieRef, { type: 'all' }, null, requester({ anyTitle: true }))).resolves.toMatchObject({
        service: 'radarr',
      })
      radarr.findMovie.mockResolvedValue({ id: 186, tmdbId: 11, monitored: true, qualityProfileId: 5 })
      expect(await refusal(titles.searchArrTitle(movieRef, { type: 'all' }, null, requester({ anyTitle: true })))).toMatchObject({
        status: 403,
        message: 'This title’s quality profile isn’t one your role allows.',
      })
    })

    test('the dialog is told whether they may', async () => {
      const own = await titles.getArrTitle(movieRef, null, requester())
      expect(own.permissions.canAct).toBe(false)
      requestedBy.mockResolvedValueOnce(true)
      expect((await titles.getArrTitle(movieRef, null, requester())).permissions.canAct).toBe(true)
    })
  })
})
