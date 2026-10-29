/**
 * @jest-environment node
 *
 * src/proxy.ts refuses unknown /_next/image sources before either optimizer
 * sees them. Deployments differ: some hand images to imgproxy (IMGPROXY_URL),
 * most use Next's built-in optimizer, and the check has to hold for both.
 */

jest.mock('@src/utils/config', () => ({
  getAllServers: () => [
    { id: 'default', baseURL: 'https://files.example.com', syncEndpoint: 'https://files.example.com/node' },
  ],
}))

const { NextRequest } = require('next/server')
const { adapter } = require('next/dist/server/web/adapter')
const { parseUrl } = require('next/dist/shared/lib/router/utils/parse-url')
const { ImageOptimizerCache } = require('next/dist/server/image-optimizer')
const { proxy, config } = require('@src/proxy')

const EVIL = 'https://evil.example/x.png'
const TMDB = 'https://image.tmdb.org/t/p/w780/abc.jpg'

function imageRequest(src) {
  const query = new URLSearchParams({ url: src, w: '640', q: '75' })
  return new NextRequest(`https://app.example/_next/image?${query}`)
}

// What Next's built-in optimizer would fetch for a raw request path, end to
// end: the request goes through Next's own middleware adapter (which renames
// nxtP/nxtI query keys before the proxy sees them), and the optimizer then
// validates the query the router hands it: the rewrite target when the proxy
// rewrote, otherwise the raw request's own query.
async function builtInOptimizerFetches(rawPath) {
  const { response } = await adapter({
    handler: proxy,
    page: 'middleware',
    request: { url: `https://app.example${rawPath}`, headers: {}, method: 'GET', nextConfig: {}, page: {} },
  })
  if (response.status !== 200) return { status: response.status }
  const rewrite = response.headers.get('x-middleware-rewrite')
  const query = parseUrl(rewrite ? new URL(rewrite, 'https://app.example').href : rawPath).query
  const verdict = ImageOptimizerCache.validateParams({ headers: { accept: 'image/webp' } }, query, {
    images: {
      remotePatterns: [{ protocol: 'https', hostname: '**', port: '', pathname: '/**' }],
      localPatterns: [{ pathname: '**', search: '' }],
      deviceSizes: [640],
      imageSizes: [],
      qualities: [75],
      formats: ['image/webp'],
    },
  }, false)
  return { status: 200, href: verdict.href, error: verdict.errorMessage }
}

describe('proxy /_next/image source check', () => {
  const savedImgproxy = process.env.IMGPROXY_URL

  beforeEach(() => {
    delete process.env.IMGPROXY_URL
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    if (savedImgproxy === undefined) delete process.env.IMGPROXY_URL
    else process.env.IMGPROXY_URL = savedImgproxy
    jest.restoreAllMocks()
  })

  it('matches /_next/image requests', () => {
    expect(config.matcher).toContain('/_next/image')
  })

  it('refuses an unknown host with the built-in optimizer', async () => {
    const response = proxy(imageRequest(EVIL))
    expect(response.status).toBe(400)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.text()).toBe('"url" parameter is not allowed')
  })

  it('refuses an unknown host before it reaches imgproxy', () => {
    process.env.IMGPROXY_URL = 'http://imgproxy:8080'
    const response = proxy(imageRequest(EVIL))
    expect(response.status).toBe(400)
    expect(response.headers.get('x-middleware-rewrite')).toBeNull()
  })

  it('hands the built-in optimizer only the checked url, w and q', () => {
    const request = new NextRequest(`https://app.example/_next/image?${new URLSearchParams({ url: TMDB, w: '640', q: '75', extra: '1' })}`)
    const rewrite = new URL(proxy(request).headers.get('x-middleware-rewrite'))
    expect(rewrite.pathname).toBe('/_next/image')
    expect([...rewrite.searchParams]).toEqual([['url', TMDB], ['w', '640'], ['q', '75']])
  })

  it('passes a known source to imgproxy when it is configured', () => {
    process.env.IMGPROXY_URL = 'http://imgproxy:8080'
    const response = proxy(imageRequest('https://files.example.com/movies/x/poster.jpg'))
    expect(response.headers.get('x-middleware-rewrite')).toMatch(/^http:\/\/imgproxy:8080\/insecure\/rs:fit:640:0\/q:75\//)
  })

  it('passes app-relative sources and leaves a missing url= for Next to reject', () => {
    const local = new URL(proxy(imageRequest('/sorry-image-not-available.jpg')).headers.get('x-middleware-rewrite'))
    expect(local.searchParams.get('url')).toBe('/sorry-image-not-available.jpg')
    const noUrl = new URL(proxy(new NextRequest('https://app.example/_next/image?w=640&q=75')).headers.get('x-middleware-rewrite'))
    expect(noUrl.searchParams.has('url')).toBe(false)
  })

  describe("through Next's middleware adapter and optimizer validation", () => {
    const evil = encodeURIComponent(EVIL)

    it.each([
      ['a plain unknown source', `/_next/image?url=${evil}&w=640&q=75`],
      ['an nxtPurl key masking the real url=', `/_next/image?url=${evil}&nxtPurl=%2Fsorry-image-not-available.jpg&w=640&q=75`],
      ['an empty nxtPurl key', `/_next/image?url=${evil}&nxtPurl=&w=640&q=75`],
      ['an nxtIurl key masking the real url=', `/_next/image?nxtIurl=%2Fsorry-image-not-available.jpg&url=${evil}&w=640&q=75`],
      ['an nxtPurl key carrying an allowed source', `/_next/image?nxtPurl=${encodeURIComponent(TMDB)}&url=${evil}&w=640&q=75`],
    ])('never fetches the unknown host: %s', async (_, rawPath) => {
      const result = await builtInOptimizerFetches(rawPath)
      expect(result.href ?? '').not.toContain('evil.example')
    })

    it('still serves an allowed source', async () => {
      const result = await builtInOptimizerFetches(`/_next/image?url=${encodeURIComponent(TMDB)}&w=640&q=75`)
      expect(result).toEqual({ status: 200, href: TMDB, error: undefined })
    })
  })
})
