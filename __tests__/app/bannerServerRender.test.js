/**
 * @jest-environment node
 *
 * The /list banner's server render queries once (it used to query twice) and
 * hands the client exactly the ETag the banner route computes for the same
 * data; if they drifted apart, the client's first revalidation would miss.
 */

jest.mock('@src/utils/routeAuth', () => ({
  isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })),
}))

const mockFetchFlatBannerMedia = jest.fn()
jest.mock('@src/utils/flatDatabaseUtils', () => ({
  fetchFlatBannerMedia: (...args) => mockFetchFlatBannerMedia(...args),
}))

jest.mock('@src/utils/auth_utils', () => ({
  generateClipVideoURL: jest.fn(() => null),
}))

// The client half is not under test here
jest.mock('@src/components/Landing/BannerWithVideoContainer', () => ({
  __esModule: true,
  default: function BannerWithVideoContainer() {
    return null
  },
}))

const BannerWithVideoWrapper = require('@src/components/Landing/BannerWithVideoWrapper').default
const { GET } = require('@src/app/api/authenticated/banner/route')

const banner = [
  { id: 'm1', title: 'First', backdrop: '/b1.jpg', metadata: { trailer_url: 'https://youtu.be/1' } },
  { id: 'm2', title: 'Second', backdrop: '/b2.jpg', metadata: { release_date: '2026-09-01' } },
]

beforeEach(() => {
  mockFetchFlatBannerMedia.mockReset()
})

it('queries once and hands over the ETag the banner route sends for the same data', async () => {
  mockFetchFlatBannerMedia.mockResolvedValue(banner)

  const element = await BannerWithVideoWrapper()
  expect(mockFetchFlatBannerMedia).toHaveBeenCalledTimes(1)
  expect(element.props.initialData).toEqual(banner)

  const res = await GET(new Request('https://cinema.example/api/authenticated/banner'))
  expect(element.props.initialETag).toBe(res.headers.get('etag'))
  expect(element.props.initialETag).toMatch(/^W\/"[0-9a-f]{32}"$/)
})

it('hands over no data and no ETag when the query fails', async () => {
  mockFetchFlatBannerMedia.mockResolvedValue({ error: 'Failed to fetch banner media', status: 500 })

  const element = await BannerWithVideoWrapper()
  expect(element.props).toMatchObject({ initialData: [], initialETag: null })
})
