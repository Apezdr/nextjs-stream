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
const mockDocs = []
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: () => ({
        find: (...args) => {
          mockFindArgs = args
          return { sort: () => ({ limit: () => ({ toArray: async () => mockDocs }) }) }
        },
      }),
    }),
  }),
}))
jest.mock('@src/utils/auth_utils', () => ({}))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))
jest.mock('@src/utils/watchHistory/database', () => ({}))
jest.mock('@src/utils/watchHistory/mediaIdResolver', () => ({}))

const { fetchFlatBannerMedia } = require('@src/utils/flatDatabaseUtils')

// What the readers use (see BANNER_FIELDS in flatDatabaseUtils.js)
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
  mockDocs.length = 0
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
