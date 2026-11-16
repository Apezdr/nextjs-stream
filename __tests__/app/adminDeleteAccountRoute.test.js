/**
 * @jest-environment node
 *
 * POST /api/authenticated/admin/delete-account: an admin deletes an account
 * that did not ask to be deleted. The route and the deletion behind it are
 * real, over an in-memory database; only the gate, the session lookup, Redis
 * and the logger are stood in for.
 *
 * What it must refuse, each without removing anything: a caller who is not an
 * admin, a "View as" session, a missing or malformed id, an account that
 * doesn't exist, the admin's own account, another admin's, and a confirmation
 * that is not the account's email.
 */

const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve(mockMongo.client),
  mongoClient: mockMongo.client,
}))

const mockAdminGate = jest.fn()
jest.mock('@src/lib/roles/gates', () => ({ adminGate: { route: (...args) => mockAdminGate(...args) } }))
const mockGetSession = jest.fn()
jest.mock('@src/lib/cachedAuth', () => ({ getSession: (...args) => mockGetSession(...args) }))
jest.mock('@src/lib/authSessionStore', () => ({ forgetUserSessions: jest.fn() }))
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))

// The user-requested flow's notifications: an admin's deletion sends none
const mockEmails = {
  sendDeletionRequestConfirmation: jest.fn(),
  sendAdminDeletionRequestNotification: jest.fn(),
  sendDeletionCancellationConfirmation: jest.fn(),
  sendDeletionCompletionNotification: jest.fn(),
  sendDeletionFailureNotification: jest.fn(),
}
jest.mock('@src/utils/deletionEmailService', () => mockEmails)

const { ObjectId } = require('mongodb')
const { POST } = require('@src/app/api/authenticated/admin/delete-account/route')

const ADMIN = '507f1f77bcf86cd7994390ad'
const OTHER_ADMIN = '507f1f77bcf86cd7994390ae'
const ADA = '507f1f77bcf86cd799439011'
const GRACE = '507f1f77bcf86cd799439022'
const ADA_EMAIL = 'ada@example.invalid'

const col = (db, name) => mockMongo.collection(db, name)
const user = (hex) => col('Users', 'user').docs.find((doc) => doc._id === hex)
const requests = () => col('Users', 'DeletionRequests').docs
const audit = () => col('Users', 'DeletionAuditLog').docs
const historyOf = (hex) => col('Media', 'WatchHistory').docs.filter((doc) => doc.userId === hex)

function seed() {
  for (const [db, name] of [
    ['Users', 'user'], ['Users', 'session'], ['Users', 'account'], ['Users', 'DeletionRequests'], ['Users', 'DeletionAuditLog'],
    ['Media', 'WatchHistory'], ['Media', 'Notifications'],
  ]) {
    col(db, name).docs = []
  }
  for (const [hex, email, role] of [
    [ADMIN, 'admin@example.invalid', 'admin'],
    [OTHER_ADMIN, 'other-admin@example.invalid', 'admin'],
    [ADA, ADA_EMAIL, 'user'],
    [GRACE, 'grace@example.invalid', 'user'],
  ]) {
    col('Users', 'user').insertOne({ _id: new ObjectId(hex), email, name: email, role, approved: true })
    col('Users', 'session').insertOne({ userId: new ObjectId(hex), token: `tok-${hex}` })
    col('Users', 'account').insertOne({ userId: new ObjectId(hex), providerId: 'google', accountId: `g-${hex}` })
    col('Media', 'WatchHistory').insertOne({ userId: new ObjectId(hex), normalizedVideoId: 'nid-1' })
  }
}

/** Everything a deletion could have touched, to compare before and after a refusal. */
const snapshot = () =>
  JSON.stringify([
    col('Users', 'user').docs, col('Users', 'session').docs, col('Users', 'account').docs, col('Media', 'WatchHistory').docs,
    requests(), audit(),
  ])

const post = (body, headers = { 'Content-Type': 'application/json' }) =>
  POST(
    new Request('http://localhost/api/authenticated/admin/delete-account', {
      method: 'POST',
      headers,
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  )

beforeEach(() => {
  jest.clearAllMocks()
  seed()
  mockAdminGate.mockResolvedValue({ id: ADMIN, role: 'admin', email: 'admin@example.invalid' })
  mockGetSession.mockResolvedValue({ user: { id: ADMIN, role: 'admin' }, session: { token: 'tok' } })
})

describe('refused, with nothing removed', () => {
  async function expectRefusal(response, status, error) {
    expect(response.status).toBe(status)
    const body = await response.json()
    expect(body).toMatchObject({ success: false, error })
    expect(typeof body.message).toBe('string')
  }

  test('someone who is not an admin gets the gate’s answer', async () => {
    const before = snapshot()
    const denied = new Response(JSON.stringify({ success: false, error: 'Unauthorized' }), { status: 401 })
    mockAdminGate.mockResolvedValue(denied)

    const response = await post({ userId: ADA, email: ADA_EMAIL })

    expect(response).toBe(denied)
    expect(mockGetSession).not.toHaveBeenCalled()
    expect(snapshot()).toBe(before)
  })

  test('a "View as" session, even one that passes the admin gate', async () => {
    const before = snapshot()
    // The viewed user was made an admin while the view was open: the session is theirs, opened by ADMIN
    mockAdminGate.mockResolvedValue({ id: ADA, role: 'admin' })
    mockGetSession.mockResolvedValue({ user: { id: ADA, role: 'admin' }, session: { impersonatedBy: ADMIN } })

    await expectRefusal(await post({ userId: GRACE, email: 'grace@example.invalid' }), 403, 'VIEWING_AS')
    // ...and the account being viewed as cannot be deleted from inside the view either
    await expectRefusal(await post({ userId: ADA, email: ADA_EMAIL }), 403, 'VIEWING_AS')

    expect(snapshot()).toBe(before)
  })

  test.each([
    ['no id', { email: ADA_EMAIL }],
    ['an empty id', { userId: '  ', email: ADA_EMAIL }],
    ['an id that is not text', { userId: { $ne: null }, email: ADA_EMAIL }],
    ['a malformed id', { userId: 'ada', email: ADA_EMAIL }],
  ])('%s', async (_label, body) => {
    const before = snapshot()

    await expectRefusal(await post(body), 400, 'INVALID_USER_ID')

    expect(snapshot()).toBe(before)
  })

  test('a body that is not JSON', async () => {
    const before = snapshot()

    await expectRefusal(await post(`userId=${ADA}&email=${ADA_EMAIL}`, { 'Content-Type': 'application/x-www-form-urlencoded' }), 415, 'JSON_REQUIRED')
    await expectRefusal(await post('{not json'), 400, 'INVALID_USER_ID')

    expect(snapshot()).toBe(before)
  })

  test('an id no account has', async () => {
    const before = snapshot()

    await expectRefusal(await post({ userId: '507f1f77bcf86cd7994399ff', email: ADA_EMAIL }), 404, 'USER_NOT_FOUND')

    expect(snapshot()).toBe(before)
  })

  test('the admin’s own account', async () => {
    const before = snapshot()

    await expectRefusal(await post({ userId: ADMIN, email: 'admin@example.invalid' }), 403, 'OWN_ACCOUNT')

    expect(snapshot()).toBe(before)
  })

  test('another admin’s account', async () => {
    const before = snapshot()

    await expectRefusal(await post({ userId: OTHER_ADMIN, email: 'other-admin@example.invalid' }), 403, 'TARGET_IS_ADMIN')

    expect(snapshot()).toBe(before)
  })

  test('no confirmation, or one that is not the account’s email', async () => {
    const before = snapshot()

    await expectRefusal(await post({ userId: ADA }), 400, 'EMAIL_REQUIRED')
    await expectRefusal(await post({ userId: ADA, email: '' }), 400, 'EMAIL_REQUIRED')
    await expectRefusal(await post({ userId: ADA, email: 'grace@example.invalid' }), 400, 'EMAIL_MISMATCH')
    await expectRefusal(await post({ userId: ADA, email: 'ada@example' }), 400, 'EMAIL_MISMATCH')

    expect(snapshot()).toBe(before)
  })

  test('a reason that is not short text', async () => {
    const before = snapshot()

    await expectRefusal(await post({ userId: ADA, email: ADA_EMAIL, reason: 'x'.repeat(501) }), 400, 'INVALID_REASON')
    await expectRefusal(await post({ userId: ADA, email: ADA_EMAIL, reason: { why: 'because' } }), 400, 'INVALID_REASON')

    expect(snapshot()).toBe(before)
  })
})

describe('an admin deletes an account', () => {
  test('the account and its rows go, nobody else’s do, and nobody is notified', async () => {
    const response = await post({ userId: ADA, email: ' Ada@Example.invalid ', reason: ' left the household ' })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({ success: true, data: { deletionResults: { user: 1, account: 1, session: 1, WatchHistory: 1 } } })

    expect(user(ADA)).toBeUndefined()
    expect(historyOf(ADA)).toEqual([])
    expect(col('Users', 'account').docs.some((doc) => doc.userId === ADA)).toBe(false)
    for (const hex of [ADMIN, OTHER_ADMIN, GRACE]) {
      expect(user(hex)).toBeDefined()
      expect(historyOf(hex)).toHaveLength(1)
      expect(col('Users', 'session').docs.filter((doc) => doc.userId === hex)).toHaveLength(1)
    }
    for (const send of Object.values(mockEmails)) expect(send).not.toHaveBeenCalled()
  })

  test('it is recorded as the admin’s own request, and the audit log names the admin', async () => {
    const response = await post({ userId: ADA, email: ADA_EMAIL, reason: ' left the household ' })
    const { data } = await response.json()

    expect(requests()).toHaveLength(1)
    expect(requests()[0]).toMatchObject({
      _id: data.requestId,
      userId: ADA,
      email: ADA_EMAIL,
      requestType: 'admin',
      requestedBy: ADMIN,
      reason: 'left the household',
      status: 'completed',
      completedBy: ADMIN,
    })
    expect(audit().map((entry) => [entry.action, entry.performedBy, entry.deletionRequestId])).toEqual([
      ['admin_request_created', ADMIN, data.requestId],
      ['deletion_started', ADMIN, data.requestId],
      ['deletion_completed', ADMIN, data.requestId],
    ])
    // The log line carries ids, never the email
    expect(JSON.stringify(mockLog.info.mock.calls)).not.toContain('example.invalid')
  })

  test('who did it is the signed-in admin, whatever the request says', async () => {
    await post({ userId: ADA, email: ADA_EMAIL, adminId: OTHER_ADMIN, performedBy: OTHER_ADMIN })

    expect(requests()[0]).toMatchObject({ requestedBy: ADMIN, completedBy: ADMIN })
    expect(audit().every((entry) => entry.performedBy === ADMIN)).toBe(true)
  })

  test('a deletion that stops part-way says so and leaves its request to be run again', async () => {
    const notifications = col('Media', 'Notifications')
    const deleteMany = notifications.deleteMany
    notifications.deleteMany = () => {
      notifications.deleteMany = deleteMany
      throw new Error('connection reset')
    }

    const response = await post({ userId: ADA, email: ADA_EMAIL })

    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toMatchObject({ success: false, error: 'DELETION_INCOMPLETE', requestId: requests()[0]._id })
    expect(requests()[0]).toMatchObject({ requestType: 'admin', status: 'processing', lastError: { step: 'activity' } })
    // Signed out and banned, its user row still there for the second run
    expect(user(ADA)).toMatchObject({ banned: true })
    expect(col('Users', 'session').docs.some((doc) => doc.userId === ADA)).toBe(false)
    for (const send of Object.values(mockEmails)) expect(send).not.toHaveBeenCalled()
  })
})
