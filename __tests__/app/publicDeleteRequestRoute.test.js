/**
 * @jest-environment node
 *
 * POST /api/public/delete-request: the public form's request to delete an
 * account, by email address, over an in-memory Users database.
 *
 * Both of its methods used to throw (an undeclared variable, an unimported
 * function), so the form the privacy policy points to always answered 500.
 * It also meant to answer 404 for an address with no account and 409 for one
 * already asked for, which would have told anyone who has an account here.
 *
 * Now: one answer for every well-formed request; a request is recorded only
 * when the address has an account with no open request; it waits for an
 * admin, marked as coming from the form; the account and the admins are told.
 */

const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve(mockMongo.client),
  mongoClient: mockMongo.client,
}))

const mockNotices = {
  sendDeletionRequestConfirmation: jest.fn(),
  sendAdminDeletionRequestNotification: jest.fn(),
}
jest.mock('@src/utils/deletionEmailService', () => mockNotices)
jest.mock('@src/lib/authSessionStore', () => ({ forgetUserSessions: jest.fn() }))
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))

const { ObjectId } = require('mongodb')
const route = require('@src/app/api/public/delete-request/route')
const { default: rateLimiter } = require('@src/utils/rateLimiter')

const ADA = '507f1f77bcf86cd799439011'
const RECEIVED = {
  success: true,
  message: 'If an account uses that email address, its deletion request is now with the admins. No email is sent.',
}

const users = () => mockMongo.collection('Users', 'user')
const requests = () => mockMongo.collection('Users', 'DeletionRequests')
const audit = () => mockMongo.collection('Users', 'DeletionAuditLog')

let ip = 0
/** A request from its own address each time, unless one is given: the limit is per address. */
const post = (body, { from = `198.51.100.${++ip}`, raw = false } = {}) =>
  route.POST(
    new Request('http://localhost/api/public/delete-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': from },
      body: raw ? body : JSON.stringify(body),
    })
  )

/** What a response is, as a stranger sees it: its status and its whole body. */
const seen = async (response) => ({ status: response.status, body: await response.json() })

beforeEach(() => {
  jest.clearAllMocks()
  rateLimiter.clear()
  users().docs = []
  requests().docs = []
  audit().docs = []
  users().insertOne({ _id: new ObjectId(ADA), email: 'ada@example.invalid', name: 'Ada', role: 'user' })
})

afterAll(() => rateLimiter.stopCleanup())

describe('a request for an address that has an account', () => {
  test('is recorded for an admin, as coming from the form, with no date and nothing to verify', async () => {
    const response = await post({ email: 'ada@example.invalid', reason: ' locked out ' }, { from: '203.0.113.9' })

    expect(await seen(response)).toEqual({ status: 200, body: RECEIVED })
    expect(requests().docs).toHaveLength(1)
    const [recorded] = requests().docs
    expect(recorded).toMatchObject({
      userId: ADA,
      email: 'ada@example.invalid',
      requestType: 'public',
      // Straight to the admins: there is no email to wait for
      status: 'pending',
      reason: 'locked out',
      metadata: { clientIp: '203.0.113.9' },
    })
    // Nothing runs on a schedule, so the request carries no date for one
    expect(recorded).not.toHaveProperty('scheduledDeletionAt')
    expect(audit().docs.map((entry) => [entry.action, entry.ipAddress])).toEqual([['public_request_created', '203.0.113.9']])
    expect(mockMongo.collection('Users', 'DeletionVerificationTokens').docs).toEqual([])
  })

  test('tells the account, which may not have asked, and the admins', async () => {
    await post({ email: 'ada@example.invalid' })

    expect(mockNotices.sendDeletionRequestConfirmation).toHaveBeenCalledTimes(1)
    const [userId, request] = mockNotices.sendDeletionRequestConfirmation.mock.calls[0]
    expect(userId).toBe(ADA)
    expect(request).toMatchObject({ requestType: 'public', status: 'pending' })
    expect(mockNotices.sendAdminDeletionRequestNotification).toHaveBeenCalledWith(expect.objectContaining({ requestType: 'public', email: 'ada@example.invalid' }))
  })

  test('is found whatever the case it was typed in, and recorded under the account’s own address', async () => {
    const findOne = jest.spyOn(users(), 'findOne')

    // The in-memory database compares exactly; what matters is what is asked of the real one
    await post({ email: 'ada@example.invalid' })

    expect(findOne).toHaveBeenCalledWith({ email: 'ada@example.invalid' }, expect.objectContaining({ collation: { locale: 'en', strength: 2 } }))
    expect(requests().docs[0].email).toBe('ada@example.invalid')
  })

  test('a notification that fails does not undo the request or change the answer', async () => {
    mockNotices.sendDeletionRequestConfirmation.mockRejectedValue(new Error('notifications are down'))
    mockNotices.sendAdminDeletionRequestNotification.mockRejectedValue(new Error('notifications are down'))

    const response = await post({ email: 'ada@example.invalid' })

    expect(await seen(response)).toEqual({ status: 200, body: RECEIVED })
    expect(requests().docs).toHaveLength(1)
    expect(mockLog.error).toHaveBeenCalledTimes(2)
  })

  test('nothing about the address is written to the log', async () => {
    await post({ email: 'ada@example.invalid' })

    expect(JSON.stringify([mockLog.info.mock.calls, mockLog.error.mock.calls])).not.toContain('ada@example.invalid')
  })
})

describe('what a stranger can learn from the answer', () => {
  test('nothing: an address with no account gets the same status and the same body, and nothing is recorded', async () => {
    const known = await seen(await post({ email: 'ada@example.invalid' }))
    const unknown = await seen(await post({ email: 'nobody@example.invalid' }))

    expect(unknown).toEqual(known)
    expect(unknown).toEqual({ status: 200, body: RECEIVED })
    expect(requests().docs.map((doc) => doc.email)).toEqual(['ada@example.invalid'])
    expect(mockNotices.sendAdminDeletionRequestNotification).toHaveBeenCalledTimes(1)
  })

  test('nothing: an account whose deletion is already requested gets the same answer, and no second request', async () => {
    const first = await seen(await post({ email: 'ada@example.invalid' }))
    const again = await seen(await post({ email: 'ada@example.invalid' }))

    expect(again).toEqual(first)
    expect(requests().docs).toHaveLength(1)
    expect(mockNotices.sendDeletionRequestConfirmation).toHaveBeenCalledTimes(1)
  })

  test('nothing: a request the user made while signed in also counts as already requested', async () => {
    requests().insertOne({ _id: new ObjectId(), userId: new ObjectId(ADA), email: 'ada@example.invalid', requestType: 'authenticated', status: 'pending' })

    expect(await seen(await post({ email: 'ada@example.invalid' }))).toEqual({ status: 200, body: RECEIVED })
    expect(requests().docs).toHaveLength(1)
  })

  test('a request that was cancelled or completed does not stand in the way of a new one', async () => {
    requests().insertOne({ _id: new ObjectId(), userId: new ObjectId(ADA), email: 'ada@example.invalid', requestType: 'public', status: 'cancelled' })

    await post({ email: 'ada@example.invalid' })

    expect(requests().docs.map((doc) => doc.status)).toEqual(['cancelled', 'pending'])
  })

  test('there is no way to look a request up by address', () => {
    // GET ?email= used to answer whether an address had a request, and so an account
    expect(Object.keys(route).filter((name) => name === name.toUpperCase())).toEqual(['POST'])
  })
})

describe('the limit on requests', () => {
  test('is per address the request came from, counts before the email is read, and so is the same for any email', async () => {
    const from = '203.0.113.50'
    const statuses = []
    for (const email of ['nobody@example.invalid', 'someone@example.invalid', 'ada@example.invalid', 'ada@example.invalid']) {
      statuses.push((await post({ email }, { from })).status)
    }

    // Three an hour, whoever they were for
    expect(statuses).toEqual([200, 200, 200, 429])
    expect(requests().docs).toHaveLength(1)

    const refused = await post({ email: 'nobody@example.invalid' }, { from })
    expect(refused.status).toBe(429)
    expect(refused.headers.get('Retry-After')).toMatch(/^\d+$/)
    expect((await refused.json()).error).toBe('Too many deletion requests from this address. Try again later.')

    // Another address is not held up by it
    expect((await post({ email: 'nobody@example.invalid' }, { from: '203.0.113.51' })).status).toBe(200)
  })
})

describe('a request that is not well-formed', () => {
  test.each([
    ['no body', 'not json', 'Email address is required'],
    ['no email', JSON.stringify({}), 'Email address is required'],
    ['an email that is not text', JSON.stringify({ email: { $ne: null } }), 'Email address is required'],
    ['an email that is not one', JSON.stringify({ email: 'ada.example.invalid' }), 'Invalid email format'],
    ['an email longer than any real one', JSON.stringify({ email: `${'a'.repeat(250)}@example.invalid` }), 'Invalid email format'],
    ['a reason that is not text', JSON.stringify({ email: 'ada@example.invalid', reason: ['x'] }), 'Reason must be a string'],
    ['a reason too long', JSON.stringify({ email: 'ada@example.invalid', reason: 'x'.repeat(501) }), 'Reason must be at most 500 characters'],
  ])('%s is refused with 400 and nothing is recorded', async (_name, body, error) => {
    const response = await post(body, { raw: true })

    expect(await seen(response)).toEqual({ status: 400, body: { error } })
    expect(requests().docs).toEqual([])
    expect(mockNotices.sendAdminDeletionRequestNotification).not.toHaveBeenCalled()
  })
})

test('a database that cannot be reached is a 500, said plainly, with nothing about the address', async () => {
  jest.spyOn(users(), 'findOne').mockRejectedValue(new Error('connection reset'))

  const response = await post({ email: 'ada@example.invalid' })

  expect(await seen(response)).toEqual({ status: 500, body: { error: 'The request could not be recorded. Try again later.' } })
  expect(requests().docs).toEqual([])
})
