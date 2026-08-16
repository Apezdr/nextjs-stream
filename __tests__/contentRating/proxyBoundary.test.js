/** @jest-environment node */

function requestFor(pathname) {
  return {
    nextUrl: {
      pathname,
      searchParams: new URLSearchParams(),
    },
    headers: new Headers(),
    cookies: {
      has: () => true,
    },
  }
}

describe('rating badge proxy boundary', () => {
  const originalCookieDomain = process.env.AUTH_COOKIE_DOMAIN

  beforeEach(() => {
    jest.resetModules()
    process.env.AUTH_COOKIE_DOMAIN = '.example.test'
  })

  afterAll(() => {
    if (originalCookieDomain === undefined) {
      delete process.env.AUTH_COOKIE_DOMAIN
    } else {
      process.env.AUTH_COOKIE_DOMAIN = originalCookieDomain
    }
  })

  test('does not append Set-Cookie to public immutable rating badges', () => {
    const { proxy } = require('@src/proxy')
    const response = proxy(requestFor('/api/rating-badge/v1/PG-13.svg'))

    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  test('preserves legacy host-only cookie cleanup on other routes', () => {
    const { proxy } = require('@src/proxy')
    const response = proxy(requestFor('/list/movie/example'))

    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0')
  })
})
