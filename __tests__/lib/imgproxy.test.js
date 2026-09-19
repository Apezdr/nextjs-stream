import { buildImgproxyTarget, signImgproxyPath } from '@src/lib/imgproxy'
import { IMAGE_QUALITIES } from '@src/utils/imageQualities'

const IMGPROXY_ENV_VARS = ['IMGPROXY_URL', 'IMGPROXY_KEY', 'IMGPROXY_SALT', 'IMGPROXY_REQUEST_MODE']

// key "secret" / salt "hello", hex-encoded — matches the worked example in
// https://docs.imgproxy.net/usage/signing_url
const DOC_KEY_HEX = '736563726574'
const DOC_SALT_HEX = '68656c6c6f'

function params(overrides = {}) {
  const defaults = { url: 'https://image.tmdb.org/t/p/original/poster.jpg', w: '640', q: '75' }
  const searchParams = new URLSearchParams()
  for (const [name, value] of Object.entries({ ...defaults, ...overrides })) {
    if (value !== undefined) searchParams.set(name, value)
  }
  return searchParams
}

describe('signImgproxyPath', () => {
  it('matches the documented imgproxy signing example', () => {
    const path =
      '/rs:fill:300:400:0/g:sm/aHR0cDovL2V4YW1w/bGUuY29tL2ltYWdl/cy9jdXJpb3NpdHku/anBn.png'
    expect(signImgproxyPath(path, DOC_KEY_HEX, DOC_SALT_HEX)).toBe(
      'oKfUtW34Dvo2BGQehJFR4Nr0_rIjOtdtzJ3QFsUcXH8'
    )
  })
})

describe('buildImgproxyTarget', () => {
  const savedEnv = {}

  beforeEach(() => {
    for (const name of IMGPROXY_ENV_VARS) {
      savedEnv[name] = process.env[name]
      delete process.env[name]
    }
  })

  afterEach(() => {
    for (const name of IMGPROXY_ENV_VARS) {
      if (savedEnv[name] === undefined) delete process.env[name]
      else process.env[name] = savedEnv[name]
    }
  })

  it('returns null when IMGPROXY_URL is not set', () => {
    expect(buildImgproxyTarget(params())).toBeNull()
  })

  it('builds an unsigned proxy-mode URL by default', () => {
    process.env.IMGPROXY_URL = 'http://imgproxy:8080/'

    const src = 'https://image.tmdb.org/t/p/original/poster.jpg'
    const target = buildImgproxyTarget(params({ url: src }))

    expect(target).toEqual({
      // trailing slash on IMGPROXY_URL is normalized away
      url: `http://imgproxy:8080/insecure/rs:fit:640:0/q:75/${Buffer.from(src).toString('base64url')}`,
      mode: 'proxy',
    })
  })

  it('signs the path when key and salt are configured', () => {
    process.env.IMGPROXY_URL = 'http://imgproxy:8080'
    process.env.IMGPROXY_KEY = DOC_KEY_HEX
    process.env.IMGPROXY_SALT = DOC_SALT_HEX

    const src = 'https://image.tmdb.org/t/p/original/poster.jpg'
    const path = `/rs:fit:640:0/q:75/${Buffer.from(src).toString('base64url')}`
    const target = buildImgproxyTarget(params({ url: src }))

    expect(target.url).toBe(
      `http://imgproxy:8080/${signImgproxyPath(path, DOC_KEY_HEX, DOC_SALT_HEX)}${path}`
    )
  })

  it('uses redirect mode when IMGPROXY_REQUEST_MODE=redirect', () => {
    process.env.IMGPROXY_URL = 'https://img.example.com'
    process.env.IMGPROXY_REQUEST_MODE = 'redirect'

    expect(buildImgproxyTarget(params()).mode).toBe('redirect')
  })

  it('falls back to the built-in optimizer for a half-configured signing pair', () => {
    process.env.IMGPROXY_URL = 'http://imgproxy:8080'
    process.env.IMGPROXY_KEY = DOC_KEY_HEX

    expect(buildImgproxyTarget(params())).toBeNull()
  })

  it('falls back to the built-in optimizer for non-hex key/salt', () => {
    process.env.IMGPROXY_URL = 'http://imgproxy:8080'
    process.env.IMGPROXY_KEY = 'not-hex!'
    process.env.IMGPROXY_SALT = DOC_SALT_HEX

    expect(buildImgproxyTarget(params())).toBeNull()
  })

  it('leaves relative (local /public) sources to the built-in optimizer', () => {
    process.env.IMGPROXY_URL = 'http://imgproxy:8080'

    expect(buildImgproxyTarget(params({ url: '/logo.png' }))).toBeNull()
  })

  it('leaves malformed width/quality params to the built-in optimizer', () => {
    process.env.IMGPROXY_URL = 'http://imgproxy:8080'

    expect(buildImgproxyTarget(params({ w: undefined }))).toBeNull()
    expect(buildImgproxyTarget(params({ w: '-1' }))).toBeNull()
    expect(buildImgproxyTarget(params({ q: '101' }))).toBeNull()
  })

  // This branch runs in middleware and returns before Next's optimizer route,
  // so it is the only place images.qualities can be enforced on the imgproxy
  // path. Without these, an off-list quality was refused with imgproxy off and
  // quietly honored with it on.
  describe('the images.qualities allow-list', () => {
    beforeEach(() => {
      process.env.IMGPROXY_URL = 'http://imgproxy:8080'
    })

    it('offloads every configured quality', () => {
      for (const quality of IMAGE_QUALITIES) {
        expect(buildImgproxyTarget(params({ q: String(quality) }))).not.toBeNull()
      }
    })

    it('refuses an in-range quality that is not on the list', () => {
      // 80 is a perfectly ordinary number and was accepted here before.
      expect(buildImgproxyTarget(params({ q: '80' }))).toBeNull()
      expect(buildImgproxyTarget(params({ q: '1' }))).toBeNull()
      expect(buildImgproxyTarget(params({ q: '99' }))).toBeNull()
    })

    it('cannot be talked past with a fractional or padded value', () => {
      expect(buildImgproxyTarget(params({ q: '75.5' }))).toBeNull()
      expect(buildImgproxyTarget(params({ q: '0075' }))).not.toBeNull() // digits; Next reads 75 too
      expect(buildImgproxyTarget(params({ q: '7 5' }))).toBeNull()
      expect(buildImgproxyTarget(params({ q: '' }))).toBeNull()
      expect(buildImgproxyTarget(params({ q: undefined }))).toBeNull()
    })

    // Verified against Next 16.2.6 by curl: each of these is a 400 at the
    // built-in optimizer ("q parameter must be an integer between 1 and 100"),
    // so offloading them would make the same URL succeed with IMGPROXY_URL set
    // and fail without it.
    it('refuses what the built-in optimizer would refuse, not merely what Number() dislikes', () => {
      expect(buildImgproxyTarget(params({ q: '1e2' }))).toBeNull()
      expect(buildImgproxyTarget(params({ q: '0x4B' }))).toBeNull()
      expect(buildImgproxyTarget(params({ q: ' 75 ' }))).toBeNull()
    })

    it('puts the honored quality into the imgproxy path', () => {
      const target = buildImgproxyTarget(params({ q: '90' }))
      expect(target.url).toContain('/q:90/')
    })
  })
})
