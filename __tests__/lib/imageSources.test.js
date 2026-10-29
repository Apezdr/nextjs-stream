/**
 * @jest-environment node
 *
 * Which sources /_next/image may fetch (src/lib/imageSources.ts). The rule is
 * checked in src/proxy.ts at request time, before imgproxy and before Next's
 * built-in optimizer, so it holds for every deployment.
 */

let mockServers = []
jest.mock('@src/utils/config', () => ({ getAllServers: () => mockServers }))

const { isAllowedImageSource, reportRefusedImageSource } = require('@src/lib/imageSources')

const DEFAULT_SERVERS = [
  { id: 'default', baseURL: 'https://files.example.com', syncEndpoint: 'https://files.example.com/node' },
  { id: 'server2', baseURL: 'http://media.lan.example:8080/', syncEndpoint: 'http://192.168.1.20:3000' },
]

describe('isAllowedImageSource', () => {
  const savedPatterns = process.env.REMOTE_PATTERNS

  beforeEach(() => {
    mockServers = DEFAULT_SERVERS
    delete process.env.REMOTE_PATTERNS
    jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    if (savedPatterns === undefined) delete process.env.REMOTE_PATTERNS
    else process.env.REMOTE_PATTERNS = savedPatterns
    jest.restoreAllMocks()
  })

  it.each([
    '/sorry-image-not-available.jpg',
    '/_next/static/media/4kBanner.abc123.png',
    '/devices/browsers/chrome.png?v=2',
  ])('allows the app-relative source %s', (src) => {
    expect(isAllowedImageSource(src)).toBe(true)
  })

  it.each(['//evil.example/x.jpg', '/\\evil.example/x.jpg'])('refuses the protocol-relative source %s', (src) => {
    expect(isAllowedImageSource(src)).toBe(false)
  })

  it.each([
    ['a configured file server', 'https://files.example.com/movies/Some%20Title/poster.jpg?hash=abc'],
    ['an http file server, in the scheme it was configured with', 'http://media.lan.example:8080/tv/Show/season1.jpg'],
    ['a processor chapter frame', 'https://files.example.com/node/frame/movie/Some%20Title/00:10:00.jpg'],
    ['a LAN processor chapter frame', 'http://192.168.1.20:3000/frame/tv/Show/1/1/00:05:00.jpg'],
    ['TMDB artwork', 'https://image.tmdb.org/t/p/w780/abc.jpg'],
    ['a Google avatar', 'https://lh3.googleusercontent.com/a/ACg8ocK=s96-c'],
    ['a Discord avatar', 'https://cdn.discordapp.com/avatars/123/abc.png'],
    ['a default Discord avatar', 'https://cdn.discordapp.com/embed/avatars/2.png'],
    ['a YouTube trailer thumbnail', 'https://img.youtube.com/vi/dQw4w9WgXcQ/hqdefault.jpg'],
    ['TheTVDB art', 'https://artworks.thetvdb.com/banners/posters/1.jpg'],
  ])('allows %s', (_, src) => {
    expect(isAllowedImageSource(src)).toBe(true)
  })

  it.each([
    ['an unknown host', 'https://evil.example/x.jpg'],
    ['a file server host in the wrong scheme', 'http://files.example.com/movies/x.jpg'],
    ['a file server host on another port', 'https://files.example.com:8443/movies/x.jpg'],
    // (server2's processor has its own origin; the default one shares the file
    // server's, and the file server's whole origin is allowed)
    ['a processor path outside /frame/', 'http://192.168.1.20:3000/api/sync'],
    ['a processor frame on the wrong base path', 'https://evil.example/node/frame/x.jpg'],
    ['TMDB outside /t/p/', 'https://image.tmdb.org/other/x.jpg'],
    ['TMDB over http', 'http://image.tmdb.org/t/p/w780/abc.jpg'],
    ['a dot segment stepping out of /t/p/', 'https://image.tmdb.org/t/p/../../x.jpg'],
    ['an encoded dot segment stepping out of /frame/', 'http://192.168.1.20:3000/frame/%2e%2e/api/x'],
    ['another googleusercontent subdomain', 'https://doc-0s-4c-docs.googleusercontent.com/x'],
    ['a public Google Photos image on the avatar host', 'https://lh3.googleusercontent.com/pw/abc=s0'],
    ['a public Google Drive file on the avatar host', 'https://lh3.googleusercontent.com/d/FILEID'],
    ['TheTVDB outside /banners/', 'https://artworks.thetvdb.com/other/x.jpg'],
    ['a lookalike suffix', 'https://lh3.googleusercontent.com.evil.example/x.jpg'],
    ['a Discord path outside avatars', 'https://cdn.discordapp.com/attachments/1/2/x.png'],
    ['credentials in the URL', 'https://user:pass@files.example.com/movies/x.jpg'],
    ['a data: URL', 'data:image/png;base64,iVBORw0KGgo='],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a file: URL', 'file:///etc/passwd'],
    ['something that is not a URL', 'not a url'],
  ])('refuses %s', (_, src) => {
    expect(isAllowedImageSource(src)).toBe(false)
  })

  it('compares hostnames case-insensitively and ignores an explicit default port', () => {
    expect(isAllowedImageSource('https://IMAGE.TMDB.ORG:443/t/p/w92/abc.jpg')).toBe(true)
  })

  it('allows every server in the config, not only the default one', () => {
    expect(isAllowedImageSource('https://third.example/movies/x.jpg')).toBe(false)
    mockServers = [...DEFAULT_SERVERS, { id: 'server3', baseURL: 'https://third.example', syncEndpoint: 'https://third.example/node' }]
    expect(isAllowedImageSource('https://third.example/movies/x.jpg')).toBe(true)
  })

  it('allows the older /a-/ Google avatar form', () => {
    expect(isAllowedImageSource('https://lh5.googleusercontent.com/a-/AOh14Gh=s96-c')).toBe(true)
  })

  it('skips a server with no baseURL and warns about one that is not a URL', () => {
    mockServers = [
      { id: 'server2', baseURL: undefined, syncEndpoint: 'https://two.example/node' },
      { id: 'server3', baseURL: 'files.example.com', syncEndpoint: undefined },
    ]
    expect(isAllowedImageSource('https://two.example/movies/x.jpg')).toBe(false)
    expect(isAllowedImageSource('https://two.example/node/frame/x.jpg')).toBe(true)
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('File server baseURL for server3 "files.example.com" is not a URL'))
  })

  describe('REMOTE_PATTERNS', () => {
    it('adds an exact origin', () => {
      process.env.REMOTE_PATTERNS = 'https://images.example.com'
      expect(isAllowedImageSource('https://images.example.com/a/b.jpg')).toBe(true)
      expect(isAllowedImageSource('https://cdn.images.example.com/a/b.jpg')).toBe(false)
      expect(isAllowedImageSource('http://images.example.com/a/b.jpg')).toBe(false)
    })

    it('treats an entry without a scheme as https', () => {
      process.env.REMOTE_PATTERNS = 'assets.fanart.tv'
      expect(isAllowedImageSource('https://assets.fanart.tv/fanart/tv/1.jpg')).toBe(true)
      expect(isAllowedImageSource('http://assets.fanart.tv/fanart/tv/1.jpg')).toBe(false)
    })

    it('matches subdomains with *. but not the bare domain or lookalikes', () => {
      process.env.REMOTE_PATTERNS = 'https://*.example-cdn.com'
      expect(isAllowedImageSource('https://a.example-cdn.com/x.jpg')).toBe(true)
      expect(isAllowedImageSource('https://a.b.example-cdn.com/x.jpg')).toBe(true)
      expect(isAllowedImageSource('https://example-cdn.com/x.jpg')).toBe(false)
      expect(isAllowedImageSource('https://evilexample-cdn.com/x.jpg')).toBe(false)
    })

    it('limits an entry to its path and port', () => {
      process.env.REMOTE_PATTERNS = 'http://art.example:8080/posters/, https://other.example:443'
      expect(isAllowedImageSource('http://art.example:8080/posters/1.jpg')).toBe(true)
      expect(isAllowedImageSource('http://art.example:8080/private/1.jpg')).toBe(false)
      expect(isAllowedImageSource('http://art.example/posters/1.jpg')).toBe(false)
      expect(isAllowedImageSource('https://other.example/x.jpg')).toBe(true)
    })

    it('treats an entry path as a whole folder, so /art does not match /artifacts', () => {
      process.env.REMOTE_PATTERNS = 'https://cdn.example.com/art'
      expect(isAllowedImageSource('https://cdn.example.com/art/poster.jpg')).toBe(true)
      expect(isAllowedImageSource('https://cdn.example.com/artifacts/x.png')).toBe(false)
      expect(isAllowedImageSource('https://cdn.example.com/art-uploads/x.png')).toBe(false)
    })

    it('accepts what a FILE_SERVER_URL can hold: underscores, IPv6 and Next-style **. wildcards', () => {
      process.env.IMGPROXY_URL = 'http://imgproxy:8080'
      process.env.REMOTE_PATTERNS = 'http://media_assets:8080, http://[fd00::5]:8080, https://**.example-cdn.com'
      try {
        expect(isAllowedImageSource('http://media_assets:8080/x.jpg')).toBe(true)
        expect(isAllowedImageSource('http://[fd00::5]:8080/x.jpg')).toBe(true)
        expect(isAllowedImageSource('https://a.example-cdn.com/x.jpg')).toBe(true)
        expect(console.warn).not.toHaveBeenCalled()
      } finally {
        delete process.env.IMGPROXY_URL
      }
    })

    it('warns that an http or custom-port entry only works with imgproxy', () => {
      process.env.REMOTE_PATTERNS = 'http://warn-me.example'
      expect(isAllowedImageSource('http://warn-me.example/x.jpg')).toBe(true)
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('only takes effect with imgproxy'))
    })

    it('rejects entries carrying credentials or a query string', () => {
      process.env.REMOTE_PATTERNS = 'https://user:pw@creds.example, https://query.example/?a=1'
      expect(isAllowedImageSource('https://creds.example/x.jpg')).toBe(false)
      expect(isAllowedImageSource('https://query.example/x.jpg')).toBe(false)
    })

    it('ignores and warns about an entry that is not an origin', () => {
      process.env.REMOTE_PATTERNS = 'ftp://files.example, https://good.example'
      expect(isAllowedImageSource('https://good.example/x.jpg')).toBe(true)
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('REMOTE_PATTERNS entry "ftp://files.example"'))
    })
  })
})

describe('reportRefusedImageSource', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  it('logs the host once, never the full URL', () => {
    reportRefusedImageSource('https://report-once.example/secret-token/x.jpg')
    reportRefusedImageSource('https://report-once.example/other/y.jpg')
    expect(console.warn).toHaveBeenCalledTimes(1)
    const [message] = console.warn.mock.calls[0]
    expect(message).toContain('report-once.example')
    expect(message).not.toContain('secret-token')
  })
})
