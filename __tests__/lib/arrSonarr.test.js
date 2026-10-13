/**
 * @jest-environment node
 *
 * Sonarr requests. How an add is scoped follows Sonarr 4's own rules: a new
 * episode starts with its season's flag, and the add's monitoring pass runs
 * once, at the end of the show's first refresh. These pin what each scope
 * sends, and that searches only ever add monitoring.
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

const config = { service: 'sonarr', baseUrl: 'http://sonarr.test:8989/sonarr', apiKey: 'sonarr-secret-key' }

const json = (body) => ({ data: body === null ? '' : JSON.stringify(body) })

function respondWith(routes) {
  mockRequest.mockImplementation(async (request) => {
    const key = `${request.method} ${new URL(request.url).pathname.replace('/sonarr', '')}`
    const handler = routes[key]
    if (!handler) throw new Error(`unexpected request ${key}`)
    return json(typeof handler === 'function' ? handler(request) : handler)
  })
}

const requestsTo = (key) =>
  mockRequest.mock.calls
    .map(([request]) => request)
    .filter((request) => `${request.method} ${new URL(request.url).pathname.replace('/sonarr', '')}` === key)

let sonarr
let ArrError

beforeEach(() => {
  jest.resetModules()
  mockRequest.mockReset()
  sonarr = require('@src/lib/arr/sonarr')
  ArrError = require('@src/lib/arr/http').ArrError
})

// The shape Sonarr 4.0.20's lookup answered for The Wire (2026-10-12), trimmed.
const theWire = {
  title: 'The Wire',
  year: 2002,
  tvdbId: 79126,
  tmdbId: 1438,
  status: 'ended',
  folder: 'The Wire',
  seasonFolder: false,
  monitored: true,
  monitorNewItems: 'all',
  seriesType: 'standard',
  seasons: [
    { seasonNumber: 0, monitored: false },
    { seasonNumber: 1, monitored: true },
    { seasonNumber: 2, monitored: true },
    { seasonNumber: 3, monitored: true },
  ],
}

const add = (scope, search = true) =>
  sonarr.addSeries(config, theWire, {
    qualityProfileId: 8,
    rootFolderPath: '/processed_tv',
    folder: 'The Wire',
    scope,
    search,
  })

const postedSeries = () => requestsTo('POST /api/v3/series')[0].data

describe('addSeries', () => {
  beforeEach(() => respondWith({ 'POST /api/v3/series': (request) => ({ ...request.data, id: 500 }) }))

  test('all episodes: every season but specials, new seasons followed, searched', async () => {
    await add({ type: 'all' })
    expect(postedSeries()).toMatchObject({
      tvdbId: 79126,
      qualityProfileId: 8,
      rootFolderPath: '/processed_tv',
      path: '/processed_tv/The Wire',
      seasonFolder: true,
      monitored: true,
      monitorNewItems: 'all',
      seasons: [
        { seasonNumber: 0, monitored: false },
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
        { seasonNumber: 3, monitored: true },
      ],
      addOptions: { monitor: 'all', searchForMissingEpisodes: true, searchForCutoffUnmetEpisodes: false },
    })
  })

  test('chosen seasons: only those flagged, Sonarr’s legacy pass (no monitor), new seasons not followed', async () => {
    await add({ type: 'seasons', seasons: [2] }, false)
    const body = postedSeries()
    expect(body.seasons).toEqual([
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 1, monitored: false },
      { seasonNumber: 2, monitored: true },
      { seasonNumber: 3, monitored: false },
    ])
    expect(body.monitorNewItems).toBe('none')
    expect(body.addOptions).not.toHaveProperty('monitor')
    expect(body.addOptions).toMatchObject({
      ignoreEpisodesWithFiles: false,
      ignoreEpisodesWithoutFiles: false,
      searchForMissingEpisodes: false,
    })
  })

  test('chosen episodes: added with nothing monitored and nothing searched, whatever was asked', async () => {
    await add({ type: 'episodes', episodeIds: [] }, true)
    const body = postedSeries()
    expect(body.seasons.every((season) => season.monitored === false)).toBe(true)
    expect(body.addOptions).toEqual({ monitor: 'none', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false })
  })
})

describe('lookupSeries', () => {
  test('Sonarr resolves tmdb:<id> itself', async () => {
    respondWith({ 'GET /api/v3/series/lookup': [theWire] })
    await expect(sonarr.lookupSeries(config, 1438, 'The Wire')).resolves.toMatchObject({ tvdbId: 79126 })
    expect(requestsTo('GET /api/v3/series/lookup')[0].params).toEqual({ term: 'tmdb:1438' })
  })

  test('falls back to a title search matched on the TMDB id', async () => {
    respondWith({
      'GET /api/v3/series/lookup': (request) =>
        request.params.term === 'tmdb:1438' ? [] : [{ ...theWire, tmdbId: 9999 }, theWire],
    })
    await expect(sonarr.lookupSeries(config, 1438, 'The Wire')).resolves.toMatchObject({ tmdbId: 1438 })
  })

  test('null when neither finds it', async () => {
    respondWith({ 'GET /api/v3/series/lookup': (request) => (request.params.term.startsWith('tmdb:') ? [] : [{ ...theWire, tmdbId: 9999 }]) })
    await expect(sonarr.lookupSeries(config, 1438, 'The Wire')).resolves.toBeNull()
  })
})

test('resolveSeries finds a series by its index first, else through the lookup’s library id', async () => {
  respondWith({
    'GET /api/v3/series': [{ id: 143, tmdbId: 1399, title: 'Game of Thrones' }, { id: 7, tmdbId: 0, title: 'No TMDB id' }],
    'GET /api/v3/series/143': { id: 143, tmdbId: 1399, title: 'Game of Thrones' },
    'GET /api/v3/series/7': { id: 7, tmdbId: 0, title: 'No TMDB id' },
    'GET /api/v3/series/lookup': [{ id: 7, tmdbId: 0, tvdbId: 1, title: 'No TMDB id' }],
  })

  await expect(sonarr.resolveSeries(config, 1399, null)).resolves.toMatchObject({ entry: { id: 143 }, candidate: null })
  await expect(sonarr.resolveSeries(config, 4242, 'No TMDB id')).resolves.toMatchObject({ entry: { id: 7 } })
})

describe('refreshPending', () => {
  test.each([
    [[{ name: 'RefreshSeries', status: 'queued', body: { seriesIds: [7] } }], true],
    [[{ name: 'RefreshSeries', status: 'started', body: { seriesId: 7 } }], true],
    [[{ name: 'RefreshSeries', status: 'completed', body: { seriesIds: [7] } }], false],
    [[{ name: 'RefreshSeries', status: 'started', body: { seriesIds: [8] } }], false],
    [[{ name: 'RssSync', status: 'started', body: {} }], false],
  ])('%j → %s', async (commands, expected) => {
    respondWith({ 'GET /api/v3/command': commands })
    await expect(sonarr.refreshPending(config, 7)).resolves.toBe(expected)
  })
})

describe('monitorAndSearch', () => {
  const series = {
    id: 7,
    title: 'The Wire',
    monitored: true,
    monitorNewItems: 'none',
    seasons: [
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: false },
    ],
  }
  const episodes = [
    { id: 100, seasonNumber: 0, episodeNumber: 1, monitored: false, hasFile: false },
    { id: 101, seasonNumber: 1, episodeNumber: 1, monitored: true, hasFile: true },
    { id: 201, seasonNumber: 2, episodeNumber: 1, monitored: false, hasFile: false },
    { id: 202, seasonNumber: 2, episodeNumber: 2, monitored: true, hasFile: false },
  ]
  beforeEach(() =>
    respondWith({
      'GET /api/v3/series/7': series,
      'GET /api/v3/episode': episodes,
      'PUT /api/v3/series/7': (request) => request.data,
      'PUT /api/v3/episode/monitor': [],
      'POST /api/v3/command': { id: 1 },
    })
  )

  test('seasons: monitors the season and its unmonitored episodes, then searches that season', async () => {
    await expect(sonarr.monitorAndSearch(config, 7, { type: 'seasons', seasons: [2] })).resolves.toEqual({ episodes: 2 })

    const [put] = requestsTo('PUT /api/v3/series/7')
    expect(put.params).toEqual({ moveFiles: false })
    expect(put.data.seasons).toEqual([
      { seasonNumber: 0, monitored: false },
      { seasonNumber: 1, monitored: true },
      { seasonNumber: 2, monitored: true },
    ])
    expect(requestsTo('PUT /api/v3/episode/monitor')[0].data).toEqual({ episodeIds: [201], monitored: true })
    expect(requestsTo('POST /api/v3/command').map((request) => request.data)).toEqual([
      { name: 'SeasonSearch', seriesId: 7, seasonNumber: 2 },
    ])
  })

  test('episodes: only the chosen ones that belong to the show; no series change when it is monitored', async () => {
    await expect(
      sonarr.monitorAndSearch(config, 7, { type: 'episodes', episodeIds: [201, 202, 999] })
    ).resolves.toEqual({ episodes: 2 })

    expect(requestsTo('PUT /api/v3/series/7')).toHaveLength(0)
    expect(requestsTo('PUT /api/v3/episode/monitor')[0].data).toEqual({ episodeIds: [201], monitored: true })
    expect(requestsTo('POST /api/v3/command')[0].data).toEqual({ name: 'EpisodeSearch', episodeIds: [201, 202] })
  })

  test('all: every season but specials, new seasons followed, one series search', async () => {
    await sonarr.monitorAndSearch(config, 7, { type: 'all' })

    const [put] = requestsTo('PUT /api/v3/series/7')
    expect(put.data.monitorNewItems).toBe('all')
    expect(put.data.seasons.find((season) => season.seasonNumber === 0).monitored).toBe(false)
    expect(put.data.seasons.find((season) => season.seasonNumber === 2).monitored).toBe(true)
    expect(requestsTo('PUT /api/v3/episode/monitor')[0].data).toEqual({ episodeIds: [201], monitored: true })
    expect(requestsTo('POST /api/v3/command')[0].data).toEqual({ name: 'SeriesSearch', seriesId: 7 })
  })

  test('a selection with no episodes Sonarr knows is refused before anything changes', async () => {
    const failure = await sonarr.monitorAndSearch(config, 7, { type: 'episodes', episodeIds: [999] }).catch((error) => error)
    expect(failure).toBeInstanceOf(ArrError)
    expect(failure.reason).toBe('rejected')
    expect(requestsTo('PUT /api/v3/episode/monitor')).toHaveLength(0)
    expect(requestsTo('POST /api/v3/command')).toHaveLength(0)
  })
})

test.each([
  [null, null, { state: 'absent' }],
  [{ id: 1, monitored: true, statistics: { episodeFileCount: 10, episodeCount: 10 } }, null, { state: 'downloaded' }],
  [{ id: 1, monitored: true, statistics: { episodeFileCount: 3, episodeCount: 10 } }, null, { state: 'partial', episodeFileCount: 3, episodeCount: 10 }],
  [{ id: 1, monitored: true, status: 'upcoming', statistics: { episodeFileCount: 0, episodeCount: 0 } }, null, { state: 'wanted', released: false }],
  [{ id: 1, monitored: false, statistics: { episodeFileCount: 0, episodeCount: 0 } }, null, { state: 'unmonitored' }],
  [{ id: 1, monitored: true, statistics: {} }, { progress: null, timeLeftSeconds: null, records: 2 }, { state: 'downloading', progress: null, timeLeftSeconds: null }],
])('seriesItemStatus(%j, %j)', (series, download, expected) => {
  expect(sonarr.seriesItemStatus(series, download)).toEqual(expected)
})
