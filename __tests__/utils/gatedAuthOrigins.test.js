import { isGatedAuthUrl } from '@src/utils/gatedAuthOrigins'

const entries = [new URL('https://organizr.example.com'), new URL('https://apps.example.com/radarr/')]

describe('isGatedAuthUrl', () => {
  it('accepts any path under a bare-origin entry', () => {
    expect(isGatedAuthUrl('https://organizr.example.com/', entries)).toBe(true)
    expect(isGatedAuthUrl('https://organizr.example.com/deep/path?x=1', entries)).toBe(true)
  })

  it('accepts only the subpath for an origin+path entry', () => {
    expect(isGatedAuthUrl('https://apps.example.com/radarr', entries)).toBe(true)
    expect(isGatedAuthUrl('https://apps.example.com/radarr/movies', entries)).toBe(true)
    expect(isGatedAuthUrl('https://apps.example.com/radarrx', entries)).toBe(false)
    expect(isGatedAuthUrl('https://apps.example.com/sonarr', entries)).toBe(false)
  })

  it('rejects look-alike hosts, other schemes, and garbage', () => {
    expect(isGatedAuthUrl('https://organizr.example.com.evil.com/', entries)).toBe(false)
    expect(isGatedAuthUrl('http://organizr.example.com/', entries)).toBe(false)
    expect(isGatedAuthUrl('javascript:alert(1)', entries)).toBe(false)
    expect(isGatedAuthUrl('not a url', entries)).toBe(false)
    expect(isGatedAuthUrl('/relative', entries)).toBe(false)
  })
})
