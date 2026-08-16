/** @jest-environment node */

import { GET, HEAD } from '@src/app/api/rating-badge/v1/[rating]/route'

const requestFor = (path, query = '') => new Request(`http://localhost${path}${query}`)
const contextFor = (rating) => ({ params: Promise.resolve({ rating }) })

describe('GET /api/rating-badge/v1/[rating]', () => {
  test('serves a valid public SVG with immutable and defensive headers', async () => {
    const response = await GET(
      requestFor('/api/rating-badge/v1/PG-13.svg'),
      contextFor('PG-13.svg')
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(response.headers.get('Content-Security-Policy')).toContain("default-src 'none'")
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Set-Cookie')).toBeNull()
    expect(body).toContain('PG-13')
  })

  test.each([
    ['INVALID.svg', 404],
    ['UNRATED.svg', 404],
    ['pg-13.svg', 404],
    ['../PG-13.svg', 404],
    ['..%2FPG-13.svg', 404],
    ['%252e%252e%252fPG-13.svg', 404],
    ['PG-13%00.svg', 404],
    ['%3Cscript%3Ealert(1)%3C%2Fscript%3E.svg', 404],
    [`${'A'.repeat(10000)}.svg`, 404],
  ])('returns a bounded error for hostile or unsupported path %p', async (rating, status) => {
    const response = await GET(
      requestFor(`/api/rating-badge/v1/${encodeURIComponent(rating)}`),
      contextFor(rating)
    )
    const body = await response.text()

    expect(response.status).toBe(status)
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(body).toBe('Rating badge not found')
    expect(body).not.toContain(rating)
  })

  test('rejects unexpected query parameters without varying the SVG cache key', async () => {
    const response = await GET(
      requestFor('/api/rating-badge/v1/PG-13.svg', '?theme=dark'),
      contextFor('PG-13.svg')
    )

    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.text()).toBe('Unexpected query parameters')
  })

  test('never interpolates hostile route input into SVG output', async () => {
    const hostile = '"><script>alert(1)</script>.svg'
    const response = await GET(
      requestFor(`/api/rating-badge/v1/${encodeURIComponent(hostile)}`),
      contextFor(hostile)
    )

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('<script>')
  })

  test('serves HEAD with the same representation headers and no body', async () => {
    const response = await HEAD(
      requestFor('/api/rating-badge/v1/TV-MA.svg'),
      contextFor('TV-MA.svg')
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/svg+xml; charset=utf-8')
    expect(response.headers.get('Cache-Control')).toContain('immutable')
    expect(await response.text()).toBe('')
  })
})
