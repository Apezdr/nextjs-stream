/**
 * @jest-environment node
 *
 * The notifications ETag used to be built from the newest updatedAt and the
 * unread count. Dismissing (hard-deleting) a read notification that is not the
 * newest changes neither, so once revalidation worked a 304 would have brought
 * the dismissed notification back. It never worked in production because the
 * value was unquoted and Cloudflare drops malformed ETags. It now hashes the
 * response like every other polled route.
 */

jest.mock('@src/utils/routeAuth', () => ({
  isAuthenticatedAndApproved: jest.fn(async () => ({ id: 'user-1' })),
}))

const mockGetUserNotifications = jest.fn()
const mockGetUnreadNotificationCount = jest.fn()
jest.mock('@src/utils/notifications/notificationDatabase.js', () => ({
  getUserNotifications: (...args) => mockGetUserNotifications(...args),
  getUnreadNotificationCount: (...args) => mockGetUnreadNotificationCount(...args),
}))

jest.mock('@src/utils/notifications/utils/MediaDataEnricher.js', () => ({
  MediaDataEnricher: { enrichNotificationBatch: jest.fn(async (notifications) => notifications) },
}))

jest.mock('@src/lib/cachedAuth', () => ({
  getSession: jest.fn(async () => ({ user: { id: 'user-1', approved: true } })),
}))

const { GET, HEAD } = require('@src/app/api/authenticated/notifications/route')

const URL_LIST = 'https://cinema.example/api/authenticated/notifications?limit=10'
const URL_COUNT = 'https://cinema.example/api/authenticated/notifications?count=true'

const newest = { _id: 'n1', title: 'New episode', read: false, updatedAt: '2026-09-26T10:00:00.000Z' }
const older = { _id: 'n2', title: 'Old episode', read: true, updatedAt: '2026-09-20T10:00:00.000Z' }
const listOf = (notifications) => ({
  notifications,
  pagination: { page: 1, limit: 10, totalCount: notifications.length },
  unreadCount: notifications.filter((n) => !n.read).length,
})

const getList = (headers = {}) => GET(new Request(URL_LIST, { headers }))

beforeEach(() => {
  mockGetUserNotifications.mockResolvedValue(listOf([newest, older]))
  mockGetUnreadNotificationCount.mockResolvedValue(1)
})

describe('GET', () => {
  it('sends a weak ETag and answers 304 to the proxy-rewritten forms of it', async () => {
    const first = await getList()
    expect(first.status).toBe(200)
    const etag = first.headers.get('etag')
    expect(etag).toMatch(/^W\/"[0-9a-f]{32}"$/)
    expect((await first.json()).notifications).toHaveLength(2)

    const hash = etag.slice(3, -1)
    for (const held of [etag, `W/"${hash}-gzip"`]) {
      const res = await getList({ 'If-None-Match': held })
      expect(res.status).toBe(304)
    }
  })

  it('answers 200 after a read notification that is not the newest is dismissed', async () => {
    const etag = (await getList()).headers.get('etag')

    // Same newest updatedAt, same unread count: the old ETag's inputs
    mockGetUserNotifications.mockResolvedValue(listOf([newest]))

    const res = await getList({ 'If-None-Match': etag })
    expect(res.status).toBe(200)
    expect((await res.json()).notifications.map((n) => n._id)).toEqual(['n1'])
  })
})

describe('HEAD ?count=true', () => {
  const headCount = (headers = {}) => HEAD(new Request(URL_COUNT, { method: 'HEAD', headers }))

  it('sends the count with a weak ETag, and repeats the count on a 304', async () => {
    const first = await headCount()
    expect(first.status).toBe(200)
    expect(first.headers.get('x-unread-count')).toBe('1')
    const etag = first.headers.get('etag')
    expect(etag).toMatch(/^W\/"[0-9a-f]{32}"$/)

    const res = await headCount({ 'If-None-Match': etag })
    expect(res.status).toBe(304)
    expect(res.headers.get('x-unread-count')).toBe('1')
  })

  it('changes its ETag when the count changes', async () => {
    const etag = (await headCount()).headers.get('etag')
    mockGetUnreadNotificationCount.mockResolvedValue(2)

    const res = await headCount({ 'If-None-Match': etag })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-unread-count')).toBe('2')
  })
})
