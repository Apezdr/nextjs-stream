/**
 * @jest-environment node
 *
 * Every payload /api/authenticated/media sends carries at most 24 cast members
 * and the count: the TV-device shape, the popup's card shape, the flat GET and
 * the POST the web layouts use. A long show's cast (main cast plus every
 * episode's guest stars) was 907 people and 382 KB.
 */

jest.mock('@src/utils/routeAuth', () => ({
  __esModule: true,
  default: jest.fn(async () => ({ id: 'user-1' })),
  isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })),
}))
jest.mock('@src/utils/jit/preference', () => ({ applyJitPreference: jest.fn(async () => {}) }))
jest.mock('@src/utils/watchHistoryUtils', () => ({ addWatchHistoryToItems: jest.fn(async (items) => items) }))

const people = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: from + i,
    name: `Person ${from + i}`,
    character: `Role ${from + i}`,
    profile_path: `/p${from + i}.jpg`,
    roles: [{ credit_id: `c${i}`, episode_count: 2 }],
    total_episode_count: 2,
  }))

const show = () => ({
  _id: 'show-1',
  id: 'show-1',
  title: 'A Show',
  originalTitle: 'A Show',
  type: 'tv',
  posterURL: 'https://files.example/poster.jpg',
  cast: people(907),
  seasons: [{ seasonNumber: 1 }],
  metadata: { overview: 'Plot', cast: people(907), recurring_cast: people(138), genres: [] },
})
const episode = () => ({
  ...show(),
  seasonNumber: 1,
  episodeNumber: 2,
  videoURL: 'https://files.example/e2.mp4',
  cast: people(897),
  guestStars: people(30, 2000),
})

const mockGetFlatRequestedMedia = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  getFlatRequestedMedia: (...args) => mockGetFlatRequestedMedia(...args),
  getFlatTVSeasonWithEpisodes: jest.fn(async () => null),
  getVisibleEpisodeCountBySeason: jest.fn(async () => new Map([[1, 10]])),
}))

const { GET, POST } = require('@src/app/api/authenticated/media/route')

const get = (query) => GET(new Request(`https://cinema.example/api/authenticated/media?${query}`))

beforeEach(() => {
  jest.clearAllMocks()
  mockGetFlatRequestedMedia.mockImplementation(async (request) => (request.episode ? episode() : show()))
})

const expectLean = (body, count) => {
  expect(body.castCount).toBe(count)
  expect(body.cast).toHaveLength(24)
  expect(Object.keys(body.cast[0]).sort()).toEqual(['character', 'id', 'name', 'profile_path'])
  expect(body.metadata?.cast).toBeUndefined()
  expect(body.metadata?.recurring_cast).toBeUndefined()
}

it('caps the TV-device show response', async () => {
  const response = await get('mediaType=tv&mediaId=show-1&isTVdevice=true')

  expect(response.status).toBe(200)
  expectLean(await response.json(), 907)
})

it('caps the TV-device episode response, guest stars too', async () => {
  const body = await (await get('mediaType=tv&mediaId=show-1&season=1&episode=2&isTVdevice=true')).json()

  expectLean(body, 897)
  expect(body.guestStarsCount).toBe(30)
  expect(body.guestStars).toHaveLength(24)
})

it("caps the popup's card response", async () => {
  expectLean(await (await get('mediaType=tv&mediaId=show-1&card=true')).json(), 907)
})

it('caps the flat GET response', async () => {
  const body = await (await get('mediaType=tv&mediaId=show-1')).json()

  expectLean(body, 907)
  expect(body.metadata.overview).toBe('Plot')
})

it("caps the POST the web layouts use", async () => {
  const request = new Request('https://cinema.example/api/authenticated/media', {
    method: 'POST',
    body: JSON.stringify({ mediaType: 'tv', mediaOriginalTitle: 'A Show' }),
  })

  expectLean(await (await POST(request)).json(), 907)
})
