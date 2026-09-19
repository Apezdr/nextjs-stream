/**
 * TMDB image URL building. Stored paths come in two shapes: TMDB's relative
 * "/abc.jpg" and, for cast profile_path values synced earlier, an absolute
 * "https://image.tmdb.org/t/p/original/abc.jpg". Both must produce one valid
 * URL at the requested size.
 */

const { getFullImageUrl } = require('@src/utils')

describe('getFullImageUrl', () => {
  it('prefixes a relative TMDB path with the base and size', () => {
    expect(getFullImageUrl('/abc.jpg')).toBe('https://image.tmdb.org/t/p/w780/abc.jpg')
    expect(getFullImageUrl('/abc.jpg', 'w185')).toBe('https://image.tmdb.org/t/p/w185/abc.jpg')
  })

  it('re-sizes an absolute TMDB URL in place instead of prefixing it again', () => {
    expect(getFullImageUrl('https://image.tmdb.org/t/p/original/abc.jpg', 'w185')).toBe('https://image.tmdb.org/t/p/w185/abc.jpg')
    expect(getFullImageUrl('http://image.tmdb.org/t/p/w500/abc.jpg', 'original')).toBe('http://image.tmdb.org/t/p/original/abc.jpg')
  })

  it('leaves other absolute URLs alone and returns null for nothing', () => {
    expect(getFullImageUrl('https://files.example.com/movies/x/poster.jpg', 'w185')).toBe('https://files.example.com/movies/x/poster.jpg')
    expect(getFullImageUrl(null)).toBeNull()
    expect(getFullImageUrl('')).toBeNull()
  })
})
