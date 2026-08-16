/** @jest-environment node */

jest.mock('@src/utils/routeAuth', () => ({
  isAuthenticatedAndApproved: jest.fn(),
}))
jest.mock('@src/utils/backendAuth', () => ({
  getBackendAuthHeaders: jest.fn(),
}))
jest.mock('@src/utils/tmdb/backendClient', () => ({
  fetchTmdbFromBackend: jest.fn(),
  unwrapCachedEnvelope: jest.fn((value) => value),
}))

import { GET } from '@src/app/api/authenticated/tmdb/[...endpoint]/route'
import { isAuthenticatedAndApproved } from '@src/utils/routeAuth'
import { getBackendAuthHeaders } from '@src/utils/backendAuth'
import { fetchTmdbFromBackend } from '@src/utils/tmdb/backendClient'

const context = { params: Promise.resolve({ endpoint: ['comprehensive', 'movie'] }) }

describe('authenticated TMDB proxy content-rating compatibility', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    getBackendAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test-placeholder' })
  })

  test('denies unauthenticated requests before the backend boundary', async () => {
    const denied = Response.json({ error: 'Unauthorized' }, { status: 401 })
    isAuthenticatedAndApproved.mockResolvedValue(denied)

    const response = await GET(
      new Request('http://localhost/api/authenticated/tmdb/comprehensive/movie'),
      context
    )

    expect(response.status).toBe(401)
    expect(fetchTmdbFromBackend).not.toHaveBeenCalled()
  })

  test('allows authenticated requests and preserves additive normalized data and backend ETag', async () => {
    isAuthenticatedAndApproved.mockResolvedValue({ id: 'user-1' })
    fetchTmdbFromBackend.mockResolvedValue({
      data: {
        rating: 'PG-13',
        contentRating: {
          contentRating: 'PG-13',
          country: 'US',
          system: 'MPA',
          mediaType: 'movie',
          descriptors: [],
          reason: null,
          source: 'TMDB',
        },
      },
      headers: { etag: '"rating-v1"' },
    })

    const response = await GET(
      new Request('http://localhost/api/authenticated/tmdb/comprehensive/movie'),
      context
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(response.headers.get('ETag')).toBe('"rating-v1"')
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(body.rating).toBe('PG-13')
    expect(body.contentRating.contentRating).toBe('PG-13')
  })

  test('returns 304 for a matching client ETag without changing the backend revalidation chain', async () => {
    isAuthenticatedAndApproved.mockResolvedValue({ id: 'user-1' })
    fetchTmdbFromBackend.mockResolvedValue({
      data: { rating: 'PG-13' },
      headers: { etag: '"rating-v1"' },
    })

    const response = await GET(
      new Request('http://localhost/api/authenticated/tmdb/comprehensive/movie', {
        headers: { 'If-None-Match': '"rating-v1"' },
      }),
      context
    )

    expect(response.status).toBe(304)
    expect(response.headers.get('ETag')).toBe('"rating-v1"')
    expect(await response.text()).toBe('')
  })
})
