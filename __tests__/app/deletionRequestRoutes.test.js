/**
 * @jest-environment node
 *
 * The deletion-request routes act on the request they were asked about:
 * POST /api/authenticated/admin/deletion-requests (an admin's cancel and
 * execute) and DELETE /api/authenticated/account/delete-request (a user
 * cancelling their own), over an in-memory Users database.
 *
 * Both used to look the request up through a filter the lookup ignored, and
 * got the newest request of anyone's.
 */

const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve(mockMongo.client),
  mongoClient: mockMongo.client,
}))

const mockAdminGate = jest.fn()
const mockSignedInGate = jest.fn()
jest.mock('@src/lib/roles/gates', () => ({
  adminGate: { route: (...args) => mockAdminGate(...args) },
  signedInGate: { route: (...args) => mockSignedInGate(...args) },
}))

const mockEmails = {
  sendDeletionRequestConfirmation: jest.fn(),
  sendAdminDeletionRequestNotification: jest.fn(),
  sendDeletionCancellationConfirmation: jest.fn(),
  sendDeletionCompletionNotification: jest.fn(),
  sendDeletionFailureNotification: jest.fn(),
}
jest.mock('@src/utils/deletionEmailService', () => mockEmails)
jest.mock('@src/lib/authSessionStore', () => ({ forgetUserSessions: jest.fn() }))
jest.mock('@src/lib/logger', () => ({
  __esModule: true,
  createLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}))

const { ObjectId } = require('mongodb')
const adminRoute = require('@src/app/api/authenticated/admin/deletion-requests/route')
const accountRoute = require('@src/app/api/authenticated/account/delete-request/route')

const ADMIN = '507f1f77bcf86cd7994390ad'
const ADA = '507f1f77bcf86cd799439011'
const GRACE = '507f1f77bcf86cd799439022'
const ADA_REQUEST = '64b7f0c2a1b2c3d4e5f60001'
const GRACE_REQUEST = '64b7f0c2a1b2c3d4e5f60002'

const requests = () => mockMongo.collection('Users', 'DeletionRequests')
const history = () => mockMongo.collection('Media', 'WatchHistory')
const users = () => mockMongo.collection('Users', 'user')
const statusOf = (id) => requests().docs.find((doc) => doc._id === id)?.status

/** Ada asked first; Grace's request is the newest, the one the old lookup always returned. */
function seed({ ada = 'pending', grace = 'pending' } = {}) {
  requests().docs = []
  mockMongo.collection('Users', 'DeletionAuditLog').docs = []
  users().docs = []
  history().docs = []
  for (const [hex, email] of [[ADA, 'ada@example.invalid'], [GRACE, 'grace@example.invalid']]) {
    users().insertOne({ _id: new ObjectId(hex), email, role: 'user' })
  }
  history().insertOne({ userId: new ObjectId(ADA), normalizedVideoId: 'nid-1' })
  history().insertOne({ userId: new ObjectId(ADA), normalizedVideoId: 'nid-2' })
  history().insertOne({ userId: new ObjectId(GRACE), normalizedVideoId: 'nid-1' })
  requests().insertOne({
    _id: new ObjectId(ADA_REQUEST),
    userId: new ObjectId(ADA),
    email: 'ada@example.invalid',
    requestType: 'authenticated',
    status: ada,
    requestedAt: new Date('2026-10-01T00:00:00Z'),
  })
  requests().insertOne({
    _id: new ObjectId(GRACE_REQUEST),
    userId: new ObjectId(GRACE),
    email: 'grace@example.invalid',
    requestType: 'authenticated',
    status: grace,
    requestedAt: new Date('2026-11-01T00:00:00Z'),
  })
}

const adminPost = (body) =>
  adminRoute.POST(
    new Request('http://localhost/api/authenticated/admin/deletion-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  )

const userDelete = (requestId) =>
  accountRoute.DELETE(
    new Request(`http://localhost/api/authenticated/account/delete-request?requestId=${requestId}`, { method: 'DELETE' })
  )

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'error').mockImplementation(() => {})
  mockAdminGate.mockResolvedValue({ id: ADMIN, role: 'admin' })
  seed()
})

afterEach(() => jest.restoreAllMocks())

describe('an admin’s cancel', () => {
  test('cancels the request asked for and tells its own user', async () => {
    const response = await adminPost({ action: 'cancel', requestId: ADA_REQUEST })

    expect(response.status).toBe(200)
    expect(statusOf(ADA_REQUEST)).toBe('cancelled')
    expect(statusOf(GRACE_REQUEST)).toBe('pending')
    expect(mockEmails.sendDeletionCancellationConfirmation).toHaveBeenCalledTimes(1)
    const [userId, cancelled] = mockEmails.sendDeletionCancellationConfirmation.mock.calls[0]
    expect(userId).toBe(ADA)
    expect(cancelled).toMatchObject({ email: 'ada@example.invalid', status: 'cancelled' })
  })

  test('an id no request has is a 404, whatever else is pending', async () => {
    for (const requestId of ['64b7f0c2a1b2c3d4e5f6ffff', 'not-an-id']) {
      const response = await adminPost({ action: 'cancel', requestId })
      expect(response.status).toBe(404)
    }
    expect(statusOf(ADA_REQUEST)).toBe('pending')
    expect(statusOf(GRACE_REQUEST)).toBe('pending')
    expect(mockEmails.sendDeletionCancellationConfirmation).not.toHaveBeenCalled()
  })
})

describe('an admin’s execute', () => {
  test('reads the status of the request asked for, not of the newest one', async () => {
    seed({ ada: 'cancelled', grace: 'pending' })

    const response = await adminPost({ action: 'execute', requestId: ADA_REQUEST })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Only pending deletion requests can be executed' })
    expect(statusOf(ADA_REQUEST)).toBe('cancelled')
    expect(statusOf(GRACE_REQUEST)).toBe('pending')
    // Nothing was attempted, so nobody is told a deletion failed
    expect(mockEmails.sendDeletionFailureNotification).not.toHaveBeenCalled()
    expect(mockEmails.sendDeletionCompletionNotification).not.toHaveBeenCalled()
  })

  test('an id no request has is a 404', async () => {
    for (const requestId of ['64b7f0c2a1b2c3d4e5f6ffff', 'not-an-id']) {
      const response = await adminPost({ action: 'execute', requestId })
      expect(response.status).toBe(404)
    }
    expect(mockEmails.sendDeletionFailureNotification).not.toHaveBeenCalled()
  })

  test('deletes that request’s account and answers with what was removed', async () => {
    const response = await adminPost({ action: 'execute', requestId: ADA_REQUEST })

    expect(response.status).toBe(200)
    const { data } = await response.json()
    expect(data).toMatchObject({ requestId: ADA_REQUEST, completedBy: ADMIN, deletionResults: { WatchHistory: 2, user: 1 } })
    expect(history().docs.map((doc) => doc.userId)).toEqual([GRACE])
    expect(statusOf(ADA_REQUEST)).toBe('completed')
    expect(statusOf(GRACE_REQUEST)).toBe('pending')
    expect(mockEmails.sendDeletionCompletionNotification).toHaveBeenCalledWith('ada@example.invalid', data.deletionResults)
    expect(mockEmails.sendDeletionFailureNotification).not.toHaveBeenCalled()
  })

  test('a notification that fails after the deletion does not turn it into an error', async () => {
    mockEmails.sendDeletionCompletionNotification.mockRejectedValue(new Error('notifications are down'))

    const response = await adminPost({ action: 'execute', requestId: ADA_REQUEST })

    expect(response.status).toBe(200)
    expect(statusOf(ADA_REQUEST)).toBe('completed')
    expect(mockEmails.sendDeletionFailureNotification).not.toHaveBeenCalled()
  })

  test('a run that stops part-way says so, and running the request again finishes it', async () => {
    const notifications = mockMongo.collection('Media', 'Notifications')
    const deleteMany = notifications.deleteMany
    notifications.deleteMany = () => {
      notifications.deleteMany = deleteMany
      throw new Error('connection reset')
    }

    const stopped = await adminPost({ action: 'execute', requestId: ADA_REQUEST })

    expect(stopped.status).toBe(500)
    await expect(stopped.json()).resolves.toEqual({
      error: 'The deletion started but did not finish. Run the request again to complete it.',
      code: 'DELETION_INCOMPLETE',
    })
    expect(statusOf(ADA_REQUEST)).toBe('processing')
    expect(mockEmails.sendDeletionFailureNotification).toHaveBeenCalledTimes(1)
    expect(mockEmails.sendDeletionFailureNotification.mock.calls[0][0].email).toBe('ada@example.invalid')
    expect(mockEmails.sendDeletionCompletionNotification).not.toHaveBeenCalled()

    const again = await adminPost({ action: 'execute', requestId: ADA_REQUEST })

    expect(again.status).toBe(200)
    expect(statusOf(ADA_REQUEST)).toBe('completed')
    expect((await again.json()).data.deletionResults).toMatchObject({ WatchHistory: 2, user: 1 })
  })

  test('a deletion an admin started themselves notifies nobody, done or not', async () => {
    requests().docs.find((doc) => doc._id === ADA_REQUEST).requestType = 'admin'

    const response = await adminPost({ action: 'execute', requestId: ADA_REQUEST })

    expect(response.status).toBe(200)
    expect(mockEmails.sendDeletionCompletionNotification).not.toHaveBeenCalled()
    expect(mockEmails.sendDeletionFailureNotification).not.toHaveBeenCalled()
  })

  test('someone who is not an admin gets the gate’s answer and nothing is read', async () => {
    const denied = new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
    mockAdminGate.mockResolvedValue(denied)

    const response = await adminPost({ action: 'cancel', requestId: ADA_REQUEST })

    expect(response).toBe(denied)
    expect(statusOf(ADA_REQUEST)).toBe('pending')
  })
})

describe('a user cancelling a request', () => {
  test('cannot cancel someone else’s: it answers as if there were none', async () => {
    mockSignedInGate.mockResolvedValue({ id: ADA, email: 'ada@example.invalid' })

    const response = await userDelete(GRACE_REQUEST)

    expect(response.status).toBe(404)
    expect(statusOf(GRACE_REQUEST)).toBe('pending')
    expect(mockEmails.sendDeletionCancellationConfirmation).not.toHaveBeenCalled()
  })

  test('cancels their own, though a newer request of someone else’s exists', async () => {
    mockSignedInGate.mockResolvedValue({ id: ADA, email: 'ada@example.invalid' })

    const response = await userDelete(ADA_REQUEST)

    expect(response.status).toBe(200)
    expect(statusOf(ADA_REQUEST)).toBe('cancelled')
    expect(statusOf(GRACE_REQUEST)).toBe('pending')
  })

  test('their own request that is no longer open is refused, whatever the newest one is', async () => {
    seed({ ada: 'completed', grace: 'pending' })
    mockSignedInGate.mockResolvedValue({ id: ADA, email: 'ada@example.invalid' })

    const response = await userDelete(ADA_REQUEST)

    expect(response.status).toBe(400)
    expect(statusOf(ADA_REQUEST)).toBe('completed')
  })
})

describe('a signed-in user asking for their account to be deleted', () => {
  const DAY = 24 * 60 * 60 * 1000
  const url = 'http://localhost/api/authenticated/account/delete-request'

  test('the request is recorded with the date the server deletes the account: 30 days on', async () => {
    requests().docs = []
    mockSignedInGate.mockResolvedValue({ id: ADA, email: 'ada@example.invalid' })

    const response = await accountRoute.POST(
      new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'moving away' }) })
    )

    expect(response.status).toBe(200)
    const [recorded] = requests().docs
    expect(recorded).toMatchObject({ requestType: 'authenticated', status: 'pending', reason: 'moving away' })
    expect(new Date(recorded.scheduledDeletionAt) - new Date(recorded.requestedAt)).toBe(30 * DAY)
    const { data } = await response.json()
    expect(new Date(data.scheduledDeletionAt).getTime()).toBe(new Date(recorded.scheduledDeletionAt).getTime())
    // The account and the admins are told about a request that has its date
    expect(mockEmails.sendDeletionRequestConfirmation.mock.calls[0][1].scheduledDeletionAt).toBeTruthy()
    expect(mockEmails.sendAdminDeletionRequestNotification).toHaveBeenCalledTimes(1)
  })

  test('a second request while one is open is refused', async () => {
    mockSignedInGate.mockResolvedValue({ id: ADA, email: 'ada@example.invalid' })

    const response = await accountRoute.POST(
      new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
    )

    expect(response.status).toBe(409)
    expect(requests().docs.filter((doc) => doc.userId === ADA)).toHaveLength(1)
  })

  test('their page is sent the date; a request with none (the public form’s) is sent null, not a made-up one', async () => {
    mockSignedInGate.mockResolvedValue({ id: ADA, email: 'ada@example.invalid' })
    const ada = requests().docs.find((doc) => doc._id === ADA_REQUEST)

    ada.scheduledDeletionAt = '2026-10-31T00:00:00.000Z'
    const dated = (await (await accountRoute.GET(new Request(url))).json()).data
    expect(dated).toMatchObject({ hasActiveRequest: true, request: { id: ADA_REQUEST, canCancel: true } })
    expect(new Date(dated.request.scheduledDeletionAt).toISOString()).toBe('2026-10-31T00:00:00.000Z')

    delete ada.scheduledDeletionAt
    ada.requestType = 'public'
    const undated = (await (await accountRoute.GET(new Request(url))).json()).data
    expect(undated.request).toMatchObject({ requestType: 'public', scheduledDeletionAt: null })
  })
})

describe('the admin’s list', () => {
  test('says which waiting requests the server carries out by itself, and which wait for an admin', async () => {
    const byId = (id) => requests().docs.find((doc) => doc._id === id)
    byId(ADA_REQUEST).scheduledDeletionAt = '2099-01-01T00:00:00.000Z'
    byId(GRACE_REQUEST).requestType = 'public'

    const response = await adminRoute.GET(new Request('http://localhost/api/authenticated/admin/deletion-requests?limit=100'))

    expect(response.status).toBe(200)
    const listed = Object.fromEntries((await response.json()).data.requests.map((request) => [request.email, request]))
    expect(listed['ada@example.invalid']).toMatchObject({ deletesAutomatically: true, canExecute: true, canCancel: true })
    expect(listed['grace@example.invalid']).toMatchObject({ requestType: 'public', deletesAutomatically: false, canExecute: true })
  })

  test('a request that is no longer waiting is not said to delete automatically, whatever date it carries', async () => {
    seed({ ada: 'cancelled' })
    requests().docs.find((doc) => doc._id === ADA_REQUEST).scheduledDeletionAt = '2020-01-01T00:00:00.000Z'

    const response = await adminRoute.GET(new Request('http://localhost/api/authenticated/admin/deletion-requests?limit=100'))

    const ada = (await response.json()).data.requests.find((request) => request.email === 'ada@example.invalid')
    expect(ada).toMatchObject({ status: 'cancelled', deletesAutomatically: false, canExecute: false })
  })
})

describe('an admin’s execute while another run holds the request', () => {
  test('answers 409, removes nothing, and reports no failure', async () => {
    // The hourly check picked it up a moment ago, or the admin clicked twice
    const ada = requests().docs.find((doc) => doc._id === ADA_REQUEST)
    ada.status = 'processing'
    ada.runLeaseUntil = new Date(Date.now() + 5 * 60 * 1000).toISOString()

    const response = await adminPost({ action: 'execute', requestId: ADA_REQUEST })

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      error: 'This deletion is running right now. Refresh in a moment.',
      code: 'DELETION_RUNNING',
    })
    expect(history().docs.filter((doc) => doc.userId === ADA)).toHaveLength(2)
    expect(statusOf(ADA_REQUEST)).toBe('processing')
    expect(mockEmails.sendDeletionFailureNotification).not.toHaveBeenCalled()
    expect(mockEmails.sendDeletionCompletionNotification).not.toHaveBeenCalled()
  })
})
