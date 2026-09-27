/**
 * conditionalFetch is the client's one implementation of ETag revalidation:
 * the shared SWR fetcher, the watch-progress sync and the watchlist button all
 * go through it. It keeps the last ETag and body per URL in a module-level map,
 * so each test loads a fresh copy.
 */

const load = () => {
  jest.resetModules()
  return require('@src/utils/conditionalFetch')
}

const reply = (status, { etag = null, body } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  statusText: String(status),
  headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag : null) },
  json: jest.fn(async () => body),
})

const ifNoneMatchSent = (callIndex) => fetch.mock.calls[callIndex][1].headers.get('If-None-Match')

beforeEach(() => {
  global.fetch = jest.fn()
})

it('sends no validator the first time, then the ETag it was given', async () => {
  const { fetchWithETag } = load()
  fetch.mockResolvedValueOnce(reply(200, { etag: 'W/"a"', body: { n: 1 } }))
  fetch.mockResolvedValueOnce(reply(304))

  await fetchWithETag('/api/x')
  const second = await fetchWithETag('/api/x')

  expect(ifNoneMatchSent(0)).toBeNull()
  expect(ifNoneMatchSent(1)).toBe('W/"a"')
  expect(second).toMatchObject({ notModified: true, data: { n: 1 } })
})

it('hands back the very same object on a 304, so SWR sees nothing change', async () => {
  const { fetchWithETag } = load()
  const body = { items: [1, 2] }
  fetch.mockResolvedValueOnce(reply(200, { etag: 'W/"a"', body }))
  fetch.mockResolvedValueOnce(reply(304))

  const first = await fetchWithETag('/api/x')
  const second = await fetchWithETag('/api/x')
  expect(second.data).toBe(first.data)
})

it('replaces the kept copy when the body changes', async () => {
  const { fetchWithETag } = load()
  fetch.mockResolvedValueOnce(reply(200, { etag: 'W/"a"', body: { n: 1 } }))
  fetch.mockResolvedValueOnce(reply(200, { etag: 'W/"b"', body: { n: 2 } }))
  fetch.mockResolvedValueOnce(reply(304))

  await fetchWithETag('/api/x')
  await fetchWithETag('/api/x')
  const third = await fetchWithETag('/api/x')

  expect(ifNoneMatchSent(1)).toBe('W/"a"')
  expect(ifNoneMatchSent(2)).toBe('W/"b"')
  expect(third.data).toEqual({ n: 2 })
})

it('forgets a URL whose response stops carrying an ETag', async () => {
  const { fetchWithETag } = load()
  fetch.mockResolvedValueOnce(reply(200, { etag: 'W/"a"', body: 1 }))
  fetch.mockResolvedValueOnce(reply(200, { body: 2 }))
  fetch.mockResolvedValueOnce(reply(200, { body: 3 }))

  await fetchWithETag('/api/x')
  await fetchWithETag('/api/x')
  await fetchWithETag('/api/x')
  expect(ifNoneMatchSent(2)).toBeNull()
})

it('uses a seed only while nothing is kept for the URL', async () => {
  const { fetchWithETag } = load()
  const seed = { etag: 'W/"server"', data: ['rendered'] }
  fetch.mockResolvedValueOnce(reply(304))
  fetch.mockResolvedValueOnce(reply(200, { etag: 'W/"new"', body: ['fresh'] }))
  fetch.mockResolvedValueOnce(reply(304))

  const first = await fetchWithETag('/api/banner', { seed })
  expect(ifNoneMatchSent(0)).toBe('W/"server"')
  expect(first).toMatchObject({ notModified: true, data: ['rendered'] })

  await fetchWithETag('/api/banner', { seed })
  // The newer copy wins over the (now stale) seed
  await fetchWithETag('/api/banner', { seed })
  expect(ifNoneMatchSent(2)).toBe('W/"new"')
})

it('does not pass the seed on to fetch', async () => {
  const { fetchWithETag } = load()
  fetch.mockResolvedValueOnce(reply(200, { body: 1 }))
  await fetchWithETag('/api/x', { seed: { etag: 'W/"s"', data: 1 }, credentials: 'include' })
  expect(fetch.mock.calls[0][1]).not.toHaveProperty('seed')
  expect(fetch.mock.calls[0][1].credentials).toBe('include')
})

it('keeps caller headers alongside If-None-Match', async () => {
  const { fetchWithETag } = load()
  fetch.mockResolvedValueOnce(reply(200, { etag: 'W/"a"', body: 1 }))
  fetch.mockResolvedValueOnce(reply(304))

  await fetchWithETag('/api/x', { headers: { Accept: 'application/json' } })
  await fetchWithETag('/api/x', { headers: { Accept: 'application/json' } })
  const headers = fetch.mock.calls[1][1].headers
  expect(headers.get('Accept')).toBe('application/json')
  expect(headers.get('If-None-Match')).toBe('W/"a"')
})

it('never revalidates or keeps anything but GETs', async () => {
  const { fetchWithETag } = load()
  fetch.mockResolvedValueOnce(reply(200, { etag: 'W/"a"', body: 1 }))
  fetch.mockResolvedValueOnce(reply(200, { etag: 'W/"a"', body: 1 }))

  await fetchWithETag('/api/x', { method: 'POST', body: '{}' })
  await fetchWithETag('/api/x')
  expect(ifNoneMatchSent(0)).toBeNull()
  expect(ifNoneMatchSent(1)).toBeNull()
})

it('reports an error response without parsing it', async () => {
  const { fetchWithETag } = load()
  const failure = reply(500)
  fetch.mockResolvedValueOnce(failure)

  const result = await fetchWithETag('/api/x')
  expect(result).toMatchObject({ notModified: false, data: undefined })
  expect(result.response.status).toBe(500)
  expect(failure.json).not.toHaveBeenCalled()
})

it('keeps at most 100 URLs, dropping the least recently used', async () => {
  const { fetchWithETag } = load()
  fetch.mockImplementation(async (url) => reply(200, { etag: `W/"${url}"`, body: url }))
  for (let i = 0; i <= 100; i++) {
    await fetchWithETag(`/api/page/${i}`)
  }

  fetch.mockClear()
  await fetchWithETag('/api/page/0') // the oldest, evicted by the 101st
  await fetchWithETag('/api/page/100')
  expect(ifNoneMatchSent(0)).toBeNull()
  expect(ifNoneMatchSent(1)).toBe('W/"/api/page/100"')
})
