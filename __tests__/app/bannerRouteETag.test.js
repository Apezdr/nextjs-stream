/**
 * @jest-environment node
 *
 * The /list banner polls every 4 s. In production each poll re-downloaded
 * ~49 KB (142 KB decoded) because the ETag the browser held, W/"<hash>-gzip",
 * never matched. Whatever form a proxy hands the ETag back in, an unchanged
 * banner must be a 304.
 */

jest.mock('@src/utils/routeAuth', () => ({
  isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })),
}))

const mockFetchFlatBannerMedia = jest.fn()
jest.mock('@src/utils/cache/bannerData', () => ({
  fetchFlatBannerMedia: (...args) => mockFetchFlatBannerMedia(...args),
}))

jest.mock('@src/utils/auth_utils', () => ({
  generateClipVideoURL: jest.fn(() => null),
}))

const { GET } = require('@src/app/api/authenticated/banner/route')

const getBanner = (headers = {}) =>
  GET(new Request('https://cinema.example/api/authenticated/banner', { headers }))

beforeEach(() => {
  mockFetchFlatBannerMedia.mockResolvedValue([{ id: 'm1', title: 'First' }])
})

it('sends a weak ETag', async () => {
  const res = await getBanner()
  expect(res.status).toBe(200)
  expect(res.headers.get('etag')).toMatch(/^W\/"[0-9a-f]{32}"$/)
})

it('answers 304 to each form a proxy hands the ETag back in', async () => {
  const etag = (await getBanner()).headers.get('etag')
  const hash = etag.slice(3, -1)

  for (const held of [etag, `W/"${hash}-gzip"`, `"${hash}-gzip"`]) {
    const res = await getBanner({ 'If-None-Match': held })
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe(etag)
  }
})

it('answers 200 with a new ETag once the banner changes', async () => {
  const etag = (await getBanner()).headers.get('etag')
  mockFetchFlatBannerMedia.mockResolvedValue([{ id: 'm2', title: 'Second' }])

  const res = await getBanner({ 'If-None-Match': etag })
  expect(res.status).toBe(200)
  expect(res.headers.get('etag')).not.toBe(etag)
})
