import { normalizeAuthCallbackURL, resolveSignInCallback } from '@src/utils/authCallbackUrl'

describe('resolveSignInCallback', () => {
  const isAllowedExternal = (url) => url.origin === 'https://organizr.example.com'
  const resolve = (raw) => resolveSignInCallback(raw, { isAllowedExternal })
  const fallback = { callbackUrl: '/list', isExternal: false, destinationHost: null }

  it('passes same-site paths through as internal', () => {
    expect(resolve('/account/delete')).toEqual({
      callbackUrl: '/account/delete',
      isExternal: false,
      destinationHost: null,
    })
  })

  it('labels an allow-listed absolute URL as external with its host', () => {
    expect(resolve('https://organizr.example.com/?tab=1')).toEqual({
      callbackUrl: 'https://organizr.example.com/?tab=1',
      isExternal: true,
      destinationHost: 'organizr.example.com',
    })
  })

  it('falls back to /list for anything that would leave the site un-vetted', () => {
    expect(resolve('https://evil.example.com/')).toEqual(fallback)
    expect(resolve('//evil.example.com/')).toEqual(fallback)
    expect(resolve('/\\evil.example.com/')).toEqual(fallback)
    expect(resolve('javascript:alert(1)')).toEqual(fallback)
    expect(resolve('')).toEqual(fallback)
    expect(resolve(undefined)).toEqual(fallback)
  })

  it('never treats an absolute URL as allowed without a matcher', () => {
    expect(resolveSignInCallback('https://organizr.example.com/')).toEqual(fallback)
  })
})

describe('normalizeAuthCallbackURL', () => {
  it('converts encoded relative media routes to absolute URLs', () => {
    const callback = '/list/tv/Over%20the%20Garden%20Wall/1/1/play'

    expect(normalizeAuthCallbackURL(callback, '/list')).toBe(
      'http://localhost/list/tv/Over%20the%20Garden%20Wall/1/1/play'
    )
  })

  it('keeps absolute callback URLs intact', () => {
    const callback = 'https://stream.example.com/list/movie/The%20Matrix'

    expect(normalizeAuthCallbackURL(callback, '/list')).toBe(callback)
  })

  it('falls back when callback URL is invalid', () => {
    expect(normalizeAuthCallbackURL('http://%', '/list')).toBe('http://localhost/list')
  })

  it('uses fallback path when callback URL is empty', () => {
    expect(normalizeAuthCallbackURL('', '/device')).toBe('http://localhost/device')
  })
})