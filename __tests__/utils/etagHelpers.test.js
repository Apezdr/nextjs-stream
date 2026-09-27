/**
 * @jest-environment node
 *
 * ETags have to survive whatever proxy a host puts in front of the app.
 * Production runs Cloudflare -> Caddy -> Next: Caddy appended "-gzip" to the
 * strong ETag, Cloudflare then made it weak, and Caddy only strips its suffix
 * from strong values, so browsers held W/"<hash>-gzip" and not one poll of the
 * banner or the rails got a 304 (checked in a real browser, 2026-09-26).
 * Other hosts run nginx, Apache, Jetty or a CDN, each rewriting it its own way.
 */

const {
  generateETag,
  hasMatchingETag,
  createNotModifiedResponse,
} = require('@src/utils/cache/etagHelpers')

const requestWith = (ifNoneMatch) =>
  new Request('https://cinema.example/api/authenticated/banner', {
    headers: ifNoneMatch === undefined ? {} : { 'If-None-Match': ifNoneMatch },
  })

describe('generateETag', () => {
  it('is a weak, quoted MD5 of the body', () => {
    expect(generateETag('{"a":1}')).toMatch(/^W\/"[0-9a-f]{32}"$/)
  })

  it('is stable for a body and changes with it', () => {
    expect(generateETag('{"a":1}')).toBe(generateETag('{"a":1}'))
    expect(generateETag('{"a":1}')).not.toBe(generateETag('{"a":2}'))
  })

  it('hashes an object as its JSON', () => {
    expect(generateETag({ a: 1 })).toBe(generateETag('{"a":1}'))
  })
})

describe('hasMatchingETag', () => {
  const etag = generateETag('{"items":[1,2,3]}')
  const hash = etag.slice(3, -1)
  const otherHash = generateETag('{"items":[1,2,4]}').slice(3, -1)

  it.each([
    ['unchanged, as nginx, Caddy and Cloudflare pass a weak ETag', `W/"${hash}"`],
    ['in its strong form', `"${hash}"`],
    ['weak with a gzip suffix (production today, and Apache mod_deflate)', `W/"${hash}-gzip"`],
    ['weak with a zstd suffix', `W/"${hash}-zstd"`],
    ['strong with a gzip suffix, as a gzip-only client holds it', `"${hash}-gzip"`],
    ['with an Apache mod_brotli suffix', `W/"${hash}-br"`],
    ["with Jetty's double-hyphen suffix", `W/"${hash}--gzip"`],
    ['through stacked proxies', `W/"${hash}-gzip-gzip"`],
    ['anywhere in a list', `"stale", W/"${hash}-gzip"`],
    ['as the wildcard', '*'],
  ])('matches the ETag %s', (_case, ifNoneMatch) => {
    expect(hasMatchingETag(requestWith(ifNoneMatch), etag)).toBe(true)
  })

  it.each([
    ['there is no If-None-Match', undefined],
    ['If-None-Match is empty', ''],
    ['it names a different body', `W/"${otherHash}"`],
    ['it names a different body behind a proxy suffix', `W/"${otherHash}-gzip"`],
    ['it only starts with the hash', `W/"${hash}0"`],
    ['its tail merely spells a coding name', `W/"${hash}gzip"`],
    ['it is an empty tag', '""'],
    ['every entry in the list is stale', `"a", W/"${otherHash}"`],
  ])('does not match when %s', (_case, ifNoneMatch) => {
    expect(hasMatchingETag(requestWith(ifNoneMatch), etag)).toBe(false)
  })

  it('normalizes the current ETag too, so a suffixed upstream ETag still matches', () => {
    // The TMDB route forwards an ETag it received from the backend
    expect(hasMatchingETag(requestWith('W/"abc"'), 'W/"abc-gzip"')).toBe(true)
  })

  it('never matches when there is no current ETag', () => {
    expect(hasMatchingETag(requestWith(`W/"${hash}"`), null)).toBe(false)
  })

  it('still matches an unquoted legacy ETag against itself', () => {
    expect(hasMatchingETag(requestWith('1x2y3z'), '1x2y3z')).toBe(true)
  })
})

describe('createNotModifiedResponse', () => {
  it('is a bodiless 304 with the ETag and no-cache by default', async () => {
    const res = createNotModifiedResponse('W/"abc"')
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe('W/"abc"')
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(await res.text()).toBe('')
  })

  it('repeats the headers the 200 would have carried', () => {
    const res = createNotModifiedResponse('W/"abc"', {
      'Cache-Control': 'private, must-revalidate, max-age=30',
      'X-Unread-Count': '3',
    })
    expect(res.headers.get('cache-control')).toBe('private, must-revalidate, max-age=30')
    expect(res.headers.get('x-unread-count')).toBe('3')
  })

  it('keeps its own ETag over one passed in the headers', () => {
    const res = createNotModifiedResponse('W/"abc"', { ETag: '"other"' })
    expect(res.headers.get('etag')).toBe('W/"abc"')
  })
})
