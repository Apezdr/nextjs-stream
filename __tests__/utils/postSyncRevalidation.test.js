/**
 * @jest-environment node
 *
 * The sync and its background cleanup run outside any request, where
 * revalidateTag is a silent no-op, so they POST what changed to
 * /admin/revalidate-media over loopback. That request must reach the server
 * itself (never the external host), authenticate with a webhook id, and never
 * throw: a missed revalidation must not fail a sync or a cleanup.
 */

const { countChangedMedia, requestMediaRevalidation } = require('@src/utils/cache/postSyncRevalidation')

const changed = { movies: ['Heat'], shows: ['Severance'], seasons: [], episodes: [] }
const savedEnv = { PORT: process.env.PORT, WEBHOOK_ID: process.env.WEBHOOK_ID }

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, status: 200 }))
  process.env.PORT = '3000'
  process.env.WEBHOOK_ID = 'env-hook'
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.env.PORT = savedEnv.PORT
  process.env.WEBHOOK_ID = savedEnv.WEBHOOK_ID
  if (savedEnv.PORT === undefined) delete process.env.PORT
  if (savedEnv.WEBHOOK_ID === undefined) delete process.env.WEBHOOK_ID
  jest.restoreAllMocks()
})

it('counts every changed entity', () => {
  expect(countChangedMedia(changed)).toBe(2)
  expect(countChangedMedia(undefined)).toBe(0)
})

it('POSTs the changes to the revalidation route over loopback', async () => {
  await expect(requestMediaRevalidation(changed, { webhookId: 'incoming-hook' })).resolves.toBe(true)

  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('http://127.0.0.1:3000/api/authenticated/admin/revalidate-media')
  expect(init.method).toBe('POST')
  expect(init.headers['X-Webhook-ID']).toBe('incoming-hook')
  expect(JSON.parse(init.body)).toEqual(changed)
})

it('uses WEBHOOK_ID when there is no incoming webhook id (the background cleanup)', async () => {
  await requestMediaRevalidation(changed)
  expect(fetch.mock.calls[0][1].headers['X-Webhook-ID']).toBe('env-hook')
})

it('uses the port it is given, or PORT', async () => {
  await requestMediaRevalidation(changed, { port: '3232' })
  delete process.env.PORT
  await requestMediaRevalidation(changed)
  expect(fetch.mock.calls[0][0]).toContain('127.0.0.1:3232/')
  expect(fetch.mock.calls[1][0]).toContain('127.0.0.1:3000/')
})

it('sends nothing when nothing changed, or without a webhook id', async () => {
  await expect(requestMediaRevalidation({ movies: [], shows: [] })).resolves.toBe(false)
  delete process.env.WEBHOOK_ID
  await expect(requestMediaRevalidation(changed)).resolves.toBe(false)
  expect(fetch).not.toHaveBeenCalled()
})

it('never throws when the route fails or cannot be reached', async () => {
  fetch.mockResolvedValueOnce({ ok: false, status: 401 })
  fetch.mockRejectedValueOnce(new Error('fetch failed'))

  await expect(requestMediaRevalidation(changed)).resolves.toBe(false)
  await expect(requestMediaRevalidation(changed)).resolves.toBe(false)
})
