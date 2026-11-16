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
const statusOf = (id) => requests().docs.find((doc) => doc._id === id)?.status

/** Ada asked first; Grace's request is the newest, the one the old lookup always returned. */
function seed({ ada = 'pending', grace = 'pending' } = {}) {
  requests().docs = []
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
    const [userId, email] = mockEmails.sendDeletionCancellationConfirmation.mock.calls[0]
    expect(userId).toBe(ADA)
    expect(email).toBe('ada@example.invalid')
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
