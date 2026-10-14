/**
 * @jest-environment node
 *
 * Radarr requests: what an add sends (the folder the dialog showed, as an
 * explicit path), how the library is asked (its lookup never says whether a
 * movie is already added), and how failures are classified. The key travels
 * only in a header.
 */

const mockRequest = jest.fn()
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    request: (...args) => mockRequest(...args),
    isAxiosError: (error) => Boolean(error && error.isAxiosError),
    isCancel: (error) => Boolean(error && error.__CANCEL__),
  },
}))

const API_KEY = 'radarr-secret-key'
const config = { service: 'radarr', baseUrl: 'http://radarr.test:7878/radarr', apiKey: API_KEY }

const json = (body) => ({ data: body === null ? '' : JSON.stringify(body) })
const httpError = (status, data = '') =>
  Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: typeof data === 'string' ? data : JSON.stringify(data) },
  })

/** Answers by "METHOD /path"; anything else fails the test. */
function respondWith(routes) {
  mockRequest.mockImplementation(async (request) => {
    const key = `${request.method} ${new URL(request.url).pathname.replace('/radarr', '')}`
    const handler = routes[key]
    if (!handler) throw new Error(`unexpected request ${key}`)
    const body = typeof handler === 'function' ? handler(request) : handler
    if (body instanceof Error) throw body
    return json(body)
  })
}

const requestsTo = (key) =>
  mockRequest.mock.calls
    .map(([request]) => request)
    .filter((request) => `${request.method} ${new URL(request.url).pathname.replace('/radarr', '')}` === key)

let radarr
let ArrError

beforeEach(() => {
  jest.resetModules()
  mockRequest.mockReset()
  radarr = require('@src/lib/arr/radarr')
  ArrError = require('@src/lib/arr/http').ArrError
})

const starWars = { title: 'Star Wars', year: 1977, tmdbId: 11, isAvailable: true, folderName: '', images: [] }

test('findMovie asks the library by TMDB id, with the key in a header only', async () => {
  respondWith({ 'GET /api/v3/movie': [{ id: 186, tmdbId: 603, title: 'The Matrix', hasFile: true }] })

  await expect(radarr.findMovie(config, 603)).resolves.toMatchObject({ id: 186 })

  const [request] = requestsTo('GET /api/v3/movie')
  expect(request.params).toEqual({ tmdbId: 603 })
  expect(request.headers['X-Api-Key']).toBe(API_KEY)
  expect(request.url).not.toContain(API_KEY)
})

test('findMovie is null when the library has no such movie', async () => {
  respondWith({ 'GET /api/v3/movie': [] })
  await expect(radarr.findMovie(config, 11)).resolves.toBeNull()
})

test('lookupMovie treats a 404 as "not found", not as a failure', async () => {
  respondWith({ 'GET /api/v3/movie/lookup/tmdb': httpError(404) })
  await expect(radarr.lookupMovie(config, 999999999)).resolves.toBeNull()
})

test('addMovie sends the lookup resource with the choices and the folder as an explicit path', async () => {
  respondWith({ 'POST /api/v3/movie': (request) => ({ ...request.data, id: 900 }) })

  const added = await radarr.addMovie(config, starWars, {
    qualityProfileId: 4,
    rootFolderPath: '/processed_movies',
    folder: 'Star Wars (1977)',
    minimumAvailability: 'released',
    search: true,
  })

  expect(added.id).toBe(900)
  const [request] = requestsTo('POST /api/v3/movie')
  expect(request.data).toMatchObject({
    title: 'Star Wars',
    tmdbId: 11,
    qualityProfileId: 4,
    rootFolderPath: '/processed_movies',
    path: '/processed_movies/Star Wars (1977)',
    monitored: true,
    minimumAvailability: 'released',
    tags: [],
    addOptions: { searchForMovie: true, monitor: 'movieOnly' },
  })
})

test('addMovie without a folder leaves the name to Radarr', async () => {
  respondWith({ 'POST /api/v3/movie': (request) => ({ ...request.data, id: 901 }) })

  await radarr.addMovie(config, starWars, {
    qualityProfileId: 4,
    rootFolderPath: '/processed_movies',
    folder: null,
    minimumAvailability: 'announced',
    search: false,
  })

  const [request] = requestsTo('POST /api/v3/movie')
  expect(request.data).not.toHaveProperty('path')
  expect(request.data.addOptions).toEqual({ searchForMovie: false, monitor: 'movieOnly' })
})

test('a refused add carries Radarr’s own validation messages', async () => {
  respondWith({
    'POST /api/v3/movie': httpError(400, [
      { propertyName: 'Path', errorMessage: 'Path is already configured for an existing movie', attemptedValue: '/x' },
    ]),
  })

  const failure = await radarr
    .addMovie(config, starWars, {
      qualityProfileId: 4,
      rootFolderPath: '/processed_movies',
      folder: 'Star Wars',
      minimumAvailability: 'released',
      search: true,
    })
    .catch((error) => error)

  expect(failure).toBeInstanceOf(ArrError)
  expect(failure.reason).toBe('rejected')
  expect(failure.messages).toEqual(['Path is already configured for an existing movie'])
})

test('updateMovie puts the whole resource back with only the change, never moving files', async () => {
  const matrix = { id: 186, tmdbId: 603, title: 'The Matrix', qualityProfileId: 4, monitored: true, path: '/processed_movies/The Matrix' }
  respondWith({
    'GET /api/v3/movie/186': matrix,
    'PUT /api/v3/movie/186': (request) => request.data,
  })

  const updated = await radarr.updateMovie(config, 186, { qualityProfileId: 5 })

  const [put] = requestsTo('PUT /api/v3/movie/186')
  expect(put.params).toEqual({ moveFiles: false })
  expect(put.data).toEqual({ ...matrix, qualityProfileId: 5 })
  expect(updated.qualityProfileId).toBe(5)
})

test('searchMovie queues Radarr’s automatic search for that movie', async () => {
  respondWith({ 'POST /api/v3/command': { id: 1, name: 'MoviesSearch' } })
  await radarr.searchMovie(config, 186)
  expect(requestsTo('POST /api/v3/command')[0].data).toEqual({ name: 'MoviesSearch', movieIds: [186] })
})

test('options: the most-used profile is the default; losing that list still answers', async () => {
  const routes = {
    'GET /api/v3/qualityprofile': [
      { id: 4, name: 'HD-1080p' },
      { id: 5, name: 'Ultra-HD - 1080p' },
    ],
    'GET /api/v3/rootfolder': [{ path: '/processed_movies', accessible: true, freeSpace: 2564 * 1024 ** 3 }],
    'GET /api/v3/config/naming': { movieFolderFormat: '{Movie Title}', replaceIllegalCharacters: true, colonReplacementFormat: 'delete' },
    'GET /api/v3/movie': [{ qualityProfileId: 5 }, { qualityProfileId: 4 }, { qualityProfileId: 4 }, { qualityProfileId: 99 }],
  }
  respondWith(routes)
  await expect(radarr.getRadarrOptions(config)).resolves.toMatchObject({
    defaultQualityProfileId: 4,
    rootFolders: [{ path: '/processed_movies', accessible: true }],
    naming: { movieFolderFormat: '{Movie Title}' },
  })

  jest.resetModules()
  radarr = require('@src/lib/arr/radarr')
  respondWith({ ...routes, 'GET /api/v3/movie': httpError(500) })
  await expect(radarr.getRadarrOptions(config)).resolves.toMatchObject({ defaultQualityProfileId: null })
})

test.each([
  [null, null, { state: 'absent' }],
  [{ id: 1, hasFile: false, monitored: true }, { progress: 42, timeLeftSeconds: 60, records: 1 }, { state: 'downloading', progress: 42, timeLeftSeconds: 60 }],
  [{ id: 1, hasFile: true, monitored: true }, null, { state: 'downloaded' }],
  [{ id: 1, hasFile: false, monitored: false }, null, { state: 'unmonitored' }],
  [{ id: 1, hasFile: false, monitored: true, isAvailable: false }, null, { state: 'wanted', released: false }],
])('movieItemStatus(%j, %j)', (movie, download, expected) => {
  expect(radarr.movieItemStatus(movie, download)).toEqual(expected)
})

test('movieStatuses joins each movie with its queue progress', async () => {
  respondWith({
    'GET /api/v3/queue': { records: [{ movieId: 186, size: 1000, sizeleft: 250, timeleft: '00:10:00' }] },
    'GET /api/v3/movie': (request) =>
      request.params.tmdbId === 603 ? [{ id: 186, tmdbId: 603, hasFile: false, monitored: true }] : [],
  })

  const statuses = await radarr.movieStatuses(config, [603, 11])

  expect(statuses.get(603)).toEqual({ state: 'downloading', progress: 75, timeLeftSeconds: 600 })
  expect(statuses.get(11)).toEqual({ state: 'absent' })
})
