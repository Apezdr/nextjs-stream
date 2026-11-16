/**
 * @jest-environment node
 *
 * src/lib/scheduledDeletions.ts: the check the server runs on itself, an hour
 * apart, over an in-memory database and the real deletion.
 *
 * A request a user made while signed in is carried out DELETION_GRACE_DAYS
 * after it was made. The pages used to promise exactly that while nothing ran
 * it; then they stopped promising. Now something does run it, and these tests
 * hold what it may and may not delete:
 * - only a signed-in user's request, and only once its date has come;
 * - never a request from the public form, whose address nobody verified:
 *   given a date, anyone could delete someone else's account by typing their
 *   address and waiting;
 * - never twice at once, and never one that was cancelled.
 */

const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve(mockMongo.client),
  mongoClient: mockMongo.client,
}))

const mockNotices = {
  sendDeletionReminder: jest.fn(),
  sendDeletionCompletionNotification: jest.fn(),
  sendDeletionFailureNotification: jest.fn(),
}
jest.mock('@src/utils/deletionEmailService', () => mockNotices)
jest.mock('@src/lib/authSessionStore', () => ({ forgetUserSessions: jest.fn() }))
const mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ __esModule: true, createLogger: () => mockLog }))

const { ObjectId } = require('mongodb')
const {
  CHECK_EVERY_MS,
  FIRST_CHECK_MS,
  runScheduledDeletions,
  startScheduledDeletions,
} = require('@src/lib/scheduledDeletions')
const { MAX_AUTOMATIC_ATTEMPTS } = require('@src/utils/accountDeletion')
const { DELETION_GRACE_DAYS, DELETION_REMINDER_DAYS } = require('@src/utils/deletionSchedule')

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const STARTED = Symbol.for('nextjs_stream.scheduledDeletionsStarted')

const ADA = '507f1f77bcf86cd799439011'
const GRACE = '507f1f77bcf86cd799439022'
const ALAN = '507f1f77bcf86cd799439033'
const ADMIN = '507f1f77bcf86cd7994390ad'
const ADA_REQUEST = '64b7f0c2a1b2c3d4e5f60001'
const GRACE_REQUEST = '64b7f0c2a1b2c3d4e5f60002'
const ALAN_REQUEST = '64b7f0c2a1b2c3d4e5f60003'

const col = (db, name) => mockMongo.collection(db, name)
const users = () => col('Users', 'user')
const requests = () => col('Users', 'DeletionRequests')
const history = () => col('Media', 'WatchHistory')
const request = (id) => requests().docs.find((doc) => doc._id === id)
const userIds = () => users().docs.map((doc) => doc._id).sort()
const audit = (id) =>
  col('Users', 'DeletionAuditLog')
    .docs.filter((entry) => entry.deletionRequestId === id)
    .map((entry) => [entry.action, entry.performedBy, entry.details?.automatic === true])

const ago = (ms) => new Date(Date.now() - ms)
const ahead = (ms) => new Date(Date.now() + ms)

/** A waiting request, as a signed-in user's is recorded unless overridden. */
function addRequest(id, userId, email, overrides = {}) {
  requests().insertOne({
    _id: new ObjectId(id),
    userId: new ObjectId(userId),
    email,
    requestType: 'authenticated',
    status: 'pending',
    requestedAt: ago(DELETION_GRACE_DAYS * DAY + HOUR),
    scheduledDeletionAt: ago(HOUR),
    ...overrides,
  })
}

/** Make one method of a collection fail, `times` times (for ever by default). */
function failing(db, name, method, message, times = Infinity) {
  const collection = col(db, name)
  const original = collection[method]
  let left = times
  collection[method] = (...args) => {
    if (left > 0) {
      left -= 1
      throw new Error(message)
    }
    return original.apply(collection, args)
  }
  return () => {
    collection[method] = original
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  for (const [db, names] of Object.entries({
    Users: ['user', 'session', 'account', 'deviceCode', 'PlaylistVisibility', 'DeletionRequests', 'DeletionAuditLog'],
    Media: ['WatchHistory', 'PlaybackStatus', 'PlaybackPresence', 'Notifications', 'ClientErrorReports', 'Playlists', 'Watchlist'],
  })) {
    for (const name of names) col(db, name).docs = []
  }
  for (const [hex, email] of [[ADA, 'ada@example.invalid'], [GRACE, 'grace@example.invalid'], [ALAN, 'alan@example.invalid']]) {
    users().insertOne({ _id: new ObjectId(hex), email, role: 'user' })
    history().insertOne({ userId: new ObjectId(hex), normalizedVideoId: 'nid-1' })
  }
})

describe('a signed-in user’s request whose date has come', () => {
  test('is carried out: the account and its data go, and nobody else’s', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')

    const summary = await runScheduledDeletions()

    expect(summary).toEqual({ reminded: 0, deleted: 1, failed: 0, skipped: false })
    expect(userIds()).toEqual([GRACE, ALAN].sort())
    expect(history().docs.map((doc) => doc.userId).sort()).toEqual([GRACE, ALAN].sort())
    expect(request(ADA_REQUEST)).toMatchObject({ status: 'completed', completedBy: null, completedAutomatically: true })
    // Let go of: nothing holds a finished request
    expect(request(ADA_REQUEST)).not.toHaveProperty('runLeaseUntil')
  })

  test('is recorded as done by nobody, automatically, and the admins are told so', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')

    await runScheduledDeletions()

    expect(audit(ADA_REQUEST)).toEqual([
      ['deletion_started', null, true],
      ['deletion_completed', null, true],
    ])
    expect(mockNotices.sendDeletionCompletionNotification).toHaveBeenCalledTimes(1)
    const [email, results, options] = mockNotices.sendDeletionCompletionNotification.mock.calls[0]
    expect(email).toBe('ada@example.invalid')
    expect(results).toMatchObject({ WatchHistory: 1, user: 1 })
    expect(options).toEqual({ automatic: true })
    // Ids in the log, never the address
    expect(JSON.stringify(mockLog.info.mock.calls)).toContain(ADA_REQUEST)
    expect(JSON.stringify([mockLog.info.mock.calls, mockLog.error.mock.calls])).not.toContain('ada@example.invalid')
  })

  test('a second check finds nothing left to do', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')
    await runScheduledDeletions()

    expect(await runScheduledDeletions()).toEqual({ reminded: 0, deleted: 0, failed: 0, skipped: false })
    expect(mockNotices.sendDeletionCompletionNotification).toHaveBeenCalledTimes(1)
  })
})

describe('what the check leaves alone', () => {
  test('a request whose date has not come', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid', { requestedAt: ago(10 * DAY), scheduledDeletionAt: ahead(20 * DAY) })

    expect(await runScheduledDeletions()).toMatchObject({ deleted: 0, failed: 0 })
    expect(userIds()).toHaveLength(3)
    expect(request(ADA_REQUEST).status).toBe('pending')
  })

  test('a request from the public form, however long it has waited, even were it to carry a date', async () => {
    // Nobody proved the address was theirs: an admin decides, never a timer
    addRequest(ALAN_REQUEST, ALAN, 'alan@example.invalid', {
      requestType: 'public',
      requestedAt: ago(400 * DAY),
      scheduledDeletionAt: undefined,
    })
    addRequest(GRACE_REQUEST, GRACE, 'grace@example.invalid', { requestType: 'public', requestedAt: ago(400 * DAY), scheduledDeletionAt: ago(300 * DAY) })

    expect(await runScheduledDeletions()).toEqual({ reminded: 0, deleted: 0, failed: 0, skipped: false })
    expect(userIds()).toHaveLength(3)
    expect(request(ALAN_REQUEST).status).toBe('pending')
    expect(request(GRACE_REQUEST).status).toBe('pending')
    expect(mockNotices.sendDeletionReminder).not.toHaveBeenCalled()
  })

  test.each(['cancelled', 'completed'])('a %s request, whatever its date', async (status) => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid', { status })

    expect(await runScheduledDeletions()).toMatchObject({ deleted: 0, failed: 0 })
    expect(userIds()).toHaveLength(3)
    expect(request(ADA_REQUEST).status).toBe(status)
  })

  test('a signed-in user’s request recorded without a date (made while none was promised)', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid', { requestedAt: ago(90 * DAY), scheduledDeletionAt: undefined })

    expect(await runScheduledDeletions()).toMatchObject({ deleted: 0, failed: 0 })
    expect(request(ADA_REQUEST).status).toBe('pending')
  })

  test('a deletion an admin started and that stopped: an admin runs it again, not the timer', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid', {
      status: 'processing',
      lastRunBy: ADMIN,
      lastRunAutomatic: false,
      lastError: { step: 'lists', message: 'connection reset' },
    })

    expect(await runScheduledDeletions()).toMatchObject({ deleted: 0, failed: 0 })
    expect(userIds()).toHaveLength(3)
    expect(request(ADA_REQUEST).status).toBe('processing')
  })

  test('a request another run holds right now: nothing is removed, and nothing is reported as failed', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid', { status: 'processing', lastRunAutomatic: true, runLeaseUntil: ahead(5 * 60 * 1000) })
    addRequest(GRACE_REQUEST, GRACE, 'grace@example.invalid', { runLeaseUntil: ahead(5 * 60 * 1000) })

    expect(await runScheduledDeletions()).toEqual({ reminded: 0, deleted: 0, failed: 0, skipped: false })
    expect(userIds()).toHaveLength(3)
    expect(mockNotices.sendDeletionFailureNotification).not.toHaveBeenCalled()
  })
})

describe('a request cancelled or picked up between the check reading it and running it', () => {
  test('is not carried out, and is not a failure', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')
    // The user cancels as the check reads the list
    const find = requests().find
    requests().find = (...args) => {
      const cursor = find.apply(requests(), args)
      const toArray = cursor.toArray
      cursor.toArray = async () => {
        const found = await toArray()
        requests().docs.find((doc) => doc._id === ADA_REQUEST).status = 'cancelled'
        return found
      }
      return cursor
    }

    const summary = await runScheduledDeletions()
    requests().find = find

    expect(summary).toEqual({ reminded: 0, deleted: 0, failed: 0, skipped: false })
    expect(userIds()).toHaveLength(3)
    expect(mockNotices.sendDeletionFailureNotification).not.toHaveBeenCalled()
  })
})

describe('the reminder', () => {
  test(`goes once to an account whose date is ${DELETION_REMINDER_DAYS} days away or less`, async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid', { requestedAt: ago(25 * DAY), scheduledDeletionAt: ahead(5 * DAY) })
    addRequest(GRACE_REQUEST, GRACE, 'grace@example.invalid', { requestedAt: ago(10 * DAY), scheduledDeletionAt: ahead(20 * DAY) })

    expect(await runScheduledDeletions()).toEqual({ reminded: 1, deleted: 0, failed: 0, skipped: false })
    expect(mockNotices.sendDeletionReminder).toHaveBeenCalledTimes(1)
    const [userId, reminded] = mockNotices.sendDeletionReminder.mock.calls[0]
    expect(userId).toBe(ADA)
    expect(String(reminded._id)).toBe(ADA_REQUEST)

    // An hour later: not again
    expect(await runScheduledDeletions()).toMatchObject({ reminded: 0 })
    expect(mockNotices.sendDeletionReminder).toHaveBeenCalledTimes(1)
    expect(userIds()).toHaveLength(3)
  })

  test('a reminder that cannot be sent does not stop the deletions that are due', async () => {
    mockNotices.sendDeletionReminder.mockRejectedValue(new Error('notifications are down'))
    addRequest(GRACE_REQUEST, GRACE, 'grace@example.invalid', { requestedAt: ago(25 * DAY), scheduledDeletionAt: ahead(5 * DAY) })
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')

    expect(await runScheduledDeletions()).toMatchObject({ deleted: 1, failed: 0 })
    expect(userIds()).toEqual([GRACE, ALAN].sort())
  })
})

describe('a deletion that stops part-way', () => {
  test('is reported to the admins, taken up by the next check, and finished', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')
    const restore = failing('Media', 'Notifications', 'deleteMany', 'connection reset', 1)

    const first = await runScheduledDeletions()

    expect(first).toEqual({ reminded: 0, deleted: 0, failed: 1, skipped: false })
    expect(request(ADA_REQUEST)).toMatchObject({ status: 'processing', lastRunAutomatic: true, automaticFailures: 1, lastError: { step: 'activity' } })
    // Let go of, so the next check can take it up
    expect(request(ADA_REQUEST)).not.toHaveProperty('runLeaseUntil')
    expect(mockNotices.sendDeletionFailureNotification).toHaveBeenCalledTimes(1)
    expect(mockNotices.sendDeletionFailureNotification.mock.calls[0][1].message).toBe('connection reset')
    // The account row goes last: it is still listed until the run finishes
    expect(userIds()).toHaveLength(3)

    const second = await runScheduledDeletions()
    restore()

    expect(second).toEqual({ reminded: 0, deleted: 1, failed: 0, skipped: false })
    expect(request(ADA_REQUEST).status).toBe('completed')
    expect(userIds()).toEqual([GRACE, ALAN].sort())
    expect(audit(ADA_REQUEST).map(([action]) => action)).toEqual(['deletion_started', 'deletion_failed', 'deletion_resumed', 'deletion_completed'])
    expect(audit(ADA_REQUEST).every(([, performedBy, automatic]) => performedBy === null && automatic)).toBe(true)
  })

  test(`is tried ${MAX_AUTOMATIC_ATTEMPTS} times, then left for an admin to run again`, async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')
    const restore = failing('Media', 'Notifications', 'deleteMany', 'connection reset')

    const failures = []
    for (let check = 0; check < MAX_AUTOMATIC_ATTEMPTS + 2; check += 1) {
      failures.push((await runScheduledDeletions()).failed)
    }
    restore()

    expect(failures).toEqual([...Array(MAX_AUTOMATIC_ATTEMPTS).fill(1), 0, 0])
    // One notification an attempt, not one an hour for ever
    expect(mockNotices.sendDeletionFailureNotification).toHaveBeenCalledTimes(MAX_AUTOMATIC_ATTEMPTS)
    expect(request(ADA_REQUEST)).toMatchObject({ status: 'processing', automaticFailures: MAX_AUTOMATIC_ATTEMPTS })
  })

  test('one failing does not hold up the others that are due', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid', { scheduledDeletionAt: ago(2 * HOUR) })
    addRequest(GRACE_REQUEST, GRACE, 'grace@example.invalid')
    const restore = failing('Media', 'Notifications', 'deleteMany', 'connection reset', 1)

    const summary = await runScheduledDeletions()
    restore()

    expect(summary).toEqual({ reminded: 0, deleted: 1, failed: 1, skipped: false })
    expect(request(ADA_REQUEST).status).toBe('processing')
    expect(request(GRACE_REQUEST).status).toBe('completed')
  })
})

describe('a check never throws', () => {
  test('when the requests cannot be read: it is logged, and the next check tries again', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')
    const restore = failing('Users', 'DeletionRequests', 'find', 'mongo is not answering')
    const restoreClaim = failing('Users', 'DeletionRequests', 'findOneAndUpdate', 'mongo is not answering')

    const summary = await runScheduledDeletions()
    restore()
    restoreClaim()

    expect(summary).toEqual({ reminded: 0, deleted: 0, failed: 0, skipped: false })
    expect(mockLog.error).toHaveBeenCalledTimes(2)
    expect(userIds()).toHaveLength(3)

    expect(await runScheduledDeletions()).toMatchObject({ deleted: 1 })
  })

  test('when a notification fails after a deletion: the deletion stands', async () => {
    mockNotices.sendDeletionCompletionNotification.mockRejectedValue(new Error('notifications are down'))
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')

    expect(await runScheduledDeletions()).toEqual({ reminded: 0, deleted: 1, failed: 0, skipped: false })
    expect(request(ADA_REQUEST).status).toBe('completed')
    expect(mockNotices.sendDeletionFailureNotification).not.toHaveBeenCalled()
  })
})

test('a check that is still running when the next is due is left to finish: the second does nothing', async () => {
  addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')

  const [first, second] = await Promise.all([runScheduledDeletions(), runScheduledDeletions()])

  expect(first).toMatchObject({ deleted: 1, skipped: false })
  expect(second).toEqual({ reminded: 0, deleted: 0, failed: 0, skipped: true })
  expect(audit(ADA_REQUEST).map(([action]) => action)).toEqual(['deletion_started', 'deletion_completed'])
})

describe('startScheduledDeletions', () => {
  beforeEach(() => {
    delete globalThis[STARTED]
  })
  afterAll(() => {
    delete globalThis[STARTED]
  })

  test('checks a minute after the server starts and then every hour, once per process', () => {
    const timers = { once: jest.fn(), every: jest.fn() }

    startScheduledDeletions(timers)
    // Next can call register() again
    startScheduledDeletions(timers)

    expect(timers.once).toHaveBeenCalledTimes(1)
    expect(timers.once.mock.calls[0][1]).toBe(FIRST_CHECK_MS)
    expect(timers.every).toHaveBeenCalledTimes(1)
    expect(timers.every.mock.calls[0][1]).toBe(CHECK_EVERY_MS)
    expect([FIRST_CHECK_MS, CHECK_EVERY_MS]).toEqual([60_000, 60 * 60_000])
    // Said once: a check with nothing to do is silent, so this is the sign they run
    expect(mockLog.info.mock.calls.filter(([, message]) => message === 'Scheduled account deletion checks started')).toEqual([
      [{ firstCheckMs: 60_000, everyMs: 60 * 60_000 }, 'Scheduled account deletion checks started'],
    ])
  })

  test('what the timers run is the check', async () => {
    addRequest(ADA_REQUEST, ADA, 'ada@example.invalid')
    const timers = { once: jest.fn(), every: jest.fn() }
    startScheduledDeletions(timers)

    timers.every.mock.calls[0][0]()
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(request(ADA_REQUEST).status).toBe('completed')
  })

  test('the server’s own timers never keep the process alive', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'lib', 'scheduledDeletions.ts'), 'utf8')
    expect(source).toMatch(/setTimeout\(run, ms\)\.unref\?\.\(\)/)
    expect(source).toMatch(/setInterval\(run, ms\)\.unref\?\.\(\)/)
  })

  test('instrumentation.ts starts it when the server does, on the Node runtime only', () => {
    const source = readFileSync(join(__dirname, '..', '..', 'src', 'instrumentation.ts'), 'utf8')
    expect(source).toMatch(
      /function scheduledDeletions\(\) \{\s+if \(process\.env\.NEXT_RUNTIME === 'nodejs'\) \{\s+import\('@src\/lib\/scheduledDeletions'\)\s+\.then\(\(\{ startScheduledDeletions \}\) => startScheduledDeletions\(\)\)/
    )
    expect(source).toMatch(/export function register\(\) \{\s+authStartupTasks\(\)\s+scheduledDeletions\(\)/)
  })
})
