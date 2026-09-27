/**
 * @jest-environment node
 *
 * The banner used to send whole FlatMovies documents: 45 fields, ~142 KB for
 * 8 movies, including syncRunId, which pre-tag re-stamps on every movie every
 * sync run (every 3 minutes), so the banner's ETag changed with nothing on
 * screen changing. It now asks Mongo for the fields its readers use. This
 * pins both halves: every field the web banner and the TV app read is
 * requested, and it is an inclusion list, so new bookkeeping fields stay out.
 */

let mockFindArgs
let mockQueryError = null
const mockDocs = []
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: () => ({
        find: (...args) => {
          mockFindArgs = args
          return {
            sort: () => ({
              limit: () => ({
                toArray: async () => {
                  if (mockQueryError) throw mockQueryError
                  return mockDocs
                },
              }),
            }),
          }
        },
      }),
    }),
  }),
}))
// Outside Next, 'use cache' is inert; these record what the cached function asks for
const mockCacheLife = jest.fn()
const mockCacheTag = jest.fn()
jest.mock('next/cache', () => ({
  cacheLife: (...args) => mockCacheLife(...args),
  cacheTag: (...args) => mockCacheTag(...args),
}))
jest.mock('@src/utils/auth_utils', () => ({}))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))
jest.mock('@src/utils/watchHistory/database', () => ({}))
jest.mock('@src/utils/watchHistory/mediaIdResolver', () => ({}))

const { fetchFlatBannerMedia } = require('@src/utils/cache/bannerData')

// What the readers use (see BANNER_FIELDS in flatDatabaseUtils.js; the query is cached in cache/bannerData.js)
const WEB_BANNER_FIELDS = [
  'title',
  'originalTitle',
  'backdrop',
  'backdropBlurhash',
  'backdropFocal',
  'backdropFocalSuggested',
  'logo',
  'metadata.logo_path',
  'metadata.trailer_url',
  'metadata.id',
]
const TV_APP_FIELDS = [
  'title',
  'type',
  'backdrop',
  'backdropBlurhash',
  'logo',
  'metadata.overview',
  'metadata.genres',
  'metadata.vote_average',
  'metadata.release_date',
  'metadata.trailer_url',
]
// Inputs for the clipVideoURL the route adds for the TV app, and the
// backdrop fallback fetchFlatBannerMedia builds
const DERIVATION_FIELDS = ['videoURL', 'duration', 'videoSource', 'videoInfoSource', 'metadata.backdrop_path']

beforeEach(() => {
  mockFindArgs = undefined
  mockQueryError = null
  mockDocs.length = 0
  mockCacheLife.mockClear()
  mockCacheTag.mockClear()
})

it('asks only for the fields the banner readers use', async () => {
  mockDocs.push({ _id: { toString: () => 'abc' }, title: 'First' })
  await fetchFlatBannerMedia()

  const { projection } = mockFindArgs[1]
  for (const field of [...WEB_BANNER_FIELDS, ...TV_APP_FIELDS, ...DERIVATION_FIELDS]) {
    expect(projection).toHaveProperty([field], 1)
  }
  // An inclusion list: nothing is sent unless it is named
  expect(Object.values(projection).every((value) => value === 1)).toBe(true)
  for (const bookkeeping of ['syncRunId', 'lastSynced', 'updatedAt', 'createdAt', 'lockedFields', 'manualFields']) {
    expect(projection).not.toHaveProperty([bookkeeping])
  }
})

it('returns string ids and fills a missing backdrop from TMDB', async () => {
  mockDocs.push({ _id: { toString: () => 'abc' }, title: 'First', metadata: { backdrop_path: '/bd.jpg' } })
  const [item] = await fetchFlatBannerMedia()

  expect(item.id).toBe('abc')
  expect(item).not.toHaveProperty('_id')
  expect(item.backdrop).toContain('/bd.jpg')
})

describe('caching', () => {
  it('caches under the banner and movies tags, with the banner lifetime', async () => {
    mockDocs.push({ _id: { toString: () => 'abc' }, title: 'First' })
    await fetchFlatBannerMedia()

    // expireBannerCache expires 'banner'; movie-wide invalidations mark 'movies'
    expect(mockCacheTag).toHaveBeenCalledWith('banner', 'movies')
    expect(mockCacheLife).toHaveBeenCalledWith('banner')
  })

  it('returns plain JSON, which is what the route sends and a cache entry can hold', async () => {
    mockDocs.push({
      _id: { toString: () => 'abc' },
      title: 'First',
      backdropFocal: { x: 0.4, y: 0.3, updatedAt: new Date('2026-09-01T00:00:00Z') },
    })
    const [item] = await fetchFlatBannerMedia()
    expect(item.backdropFocal.updatedAt).toBe('2026-09-01T00:00:00.000Z')
  })

  it('reports a failed query as an error object instead of caching it', async () => {
    // The cached function throws, and a cache entry that throws is not stored
    mockQueryError = new Error('connection reset')
    await expect(fetchFlatBannerMedia()).resolves.toMatchObject({
      error: 'Failed to fetch banner media',
      details: 'connection reset',
      status: 500,
    })
  })

  it('still reports an empty library as a 404', async () => {
    await expect(fetchFlatBannerMedia()).resolves.toMatchObject({ status: 404 })
  })
})
