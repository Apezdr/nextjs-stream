/**
 * @jest-environment node
 *
 * Interactive-search results as the services send them (Radarr 6.4 / Sonarr
 * 4.0 ReleaseResource), mapped to what the picker shows; and the two calls.
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

const { grabRelease, searchParams, searchReleases, toStoredRelease, SEARCH_TIMEOUT_MS } = require('@src/lib/arr/releases')

const config = { service: 'radarr', baseUrl: 'http://radarr.test:7878', apiKey: 'radarr-secret-key' }

const radarrRelease = {
  guid: 'https://api.nzbgeek.info/api?t=get&id=abc&apikey=INDEXER-KEY',
  indexerId: 3,
  indexer: 'NZBgeek',
  title: 'Star.Wars.1977.1080p.BluRay.x264-GROUP',
  quality: { quality: { id: 7, name: 'Bluray-1080p', resolution: 1080 }, revision: { version: 1 } },
  size: 10_737_418_240,
  age: 3,
  ageHours: 75.5,
  protocol: 'usenet',
  languages: [{ id: 1, name: 'English' }],
  customFormats: [{ id: 1, name: 'x264' }],
  customFormatScore: 50,
  releaseGroup: 'GROUP',
  edition: '',
  approved: false,
  temporarilyRejected: false,
  rejections: ['Not an upgrade for existing movie file(s)'],
  downloadUrl: 'https://api.nzbgeek.info/api?t=get&id=abc&apikey=INDEXER-KEY',
  infoUrl: 'https://nzbgeek.info/geekseek.php?guid=abc',
}

test('a Radarr release: the summary carries nothing that can hold an indexer key', () => {
  const stored = toStoredRelease(radarrRelease)
  expect(stored).toMatchObject({ guid: radarrRelease.guid, indexerId: 3, episodeIds: [], fullSeason: null })
  expect(stored.summary).toEqual({
    title: 'Star.Wars.1977.1080p.BluRay.x264-GROUP',
    indexer: 'NZBgeek',
    protocol: 'usenet',
    quality: 'Bluray-1080p',
    sizeBytes: 10_737_418_240,
    ageHours: 75.5,
    seeders: null,
    leechers: null,
    languages: ['English'],
    customFormats: ['x264'],
    customFormatScore: 50,
    releaseGroup: 'GROUP',
    edition: null,
    coverage: null,
    approved: false,
    temporarilyRejected: false,
    rejections: ['Not an upgrade for existing movie file(s)'],
  })
  expect(JSON.stringify(stored.summary)).not.toContain('INDEXER-KEY')
})

test('Sonarr releases: season packs and episodes, labelled from the mapping, with the episode ids kept', () => {
  const pack = toStoredRelease({
    guid: 'g1',
    indexerId: 1,
    fullSeason: true,
    seasonNumber: 2,
    mappedSeasonNumber: 2,
    episodeNumbers: [],
    mappedEpisodeInfo: [
      { id: 201, seasonNumber: 2, episodeNumber: 1 },
      { id: 202, seasonNumber: 2, episodeNumber: 2 },
    ],
    protocol: 'torrent',
    seeders: 40,
    leechers: 3,
  })
  expect(pack.summary.coverage).toBe('Season 2')
  expect(pack.fullSeason).toBe(2)
  expect(pack.episodeIds).toEqual([201, 202])
  expect(pack.summary).toMatchObject({ protocol: 'torrent', seeders: 40, leechers: 3 })

  const double = toStoredRelease({ guid: 'g2', indexerId: 1, seasonNumber: 1, episodeNumbers: [4, 3], mappedEpisodeNumbers: [], age: 2 })
  expect(double.summary.coverage).toBe('S01E03–E04')
  expect(double.summary.ageHours).toBe(48)
  expect(double.fullSeason).toBeNull()

  expect(toStoredRelease({ guid: 'g3', indexerId: 1, seasonNumber: 0, fullSeason: true }).summary.coverage).toBe('Specials')
})

test('a result without a guid or indexer id can’t be grabbed, so it is dropped', () => {
  expect(toStoredRelease({ indexerId: 1, title: 'x' })).toBeNull()
  expect(toStoredRelease({ guid: 'g', title: 'x' })).toBeNull()
})

test('rejections as strings, or objects with a message', () => {
  expect(toStoredRelease({ guid: 'g', indexerId: 1, rejections: ['A', { message: 'B' }, { reason: 'x' }] }).summary.rejections).toEqual(['A', 'B'])
})

test('searchParams per target', () => {
  expect(searchParams({ kind: 'movie', movieId: 186 })).toEqual({ movieId: 186 })
  expect(searchParams({ kind: 'season', seriesId: 7, seasonNumber: 2 })).toEqual({ seriesId: 7, seasonNumber: 2 })
  expect(searchParams({ kind: 'episode', seriesId: 7, episodeId: 201 })).toEqual({ episodeId: 201 })
})

test('searchReleases waits long enough for slow indexers; grabRelease sends only guid and indexerId', async () => {
  mockRequest.mockResolvedValueOnce({ data: JSON.stringify([radarrRelease, { title: 'no guid' }]) })
  const releases = await searchReleases(config, { kind: 'movie', movieId: 186 })
  expect(releases).toHaveLength(1)
  const [search] = mockRequest.mock.calls[0]
  expect(search).toMatchObject({ method: 'GET', url: 'http://radarr.test:7878/api/v3/release', params: { movieId: 186 } })
  expect(SEARCH_TIMEOUT_MS).toBeGreaterThan(100_000)

  mockRequest.mockResolvedValueOnce({ data: '' })
  await grabRelease(config, releases[0])
  const [grab] = mockRequest.mock.calls[1]
  expect(grab).toMatchObject({ method: 'POST', url: 'http://radarr.test:7878/api/v3/release' })
  expect(grab.data).toEqual({ guid: radarrRelease.guid, indexerId: 3 })
})
