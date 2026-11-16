/**
 * @jest-environment node
 *
 * The notifications of the account deletion flow
 * (src/utils/deletionEmailService.js). They are notifications in the app:
 * the app sends no email. They used to link to two pages that do not exist
 * and print whole "emails", addresses included, to the log.
 *
 * A signed-in user's request is carried out by the server 30 days after it
 * was made (src/lib/scheduledDeletions.ts), and the notifications say so. They
 * name no calendar date: a notification is read days later and in another
 * time zone than the server's, and the Delete account page shows the date.
 */

const { existsSync } = require('node:fs')
const { join } = require('node:path')

const mockCreateCustom = jest.fn(async () => ({}))
jest.mock('@src/utils/notifications/NotificationManager', () => ({
  NotificationManager: { createCustom: (...args) => mockCreateCustom(...args) },
}))
jest.mock('@src/utils/config', () => ({ adminUserEmails: ['root@example.invalid'] }))
jest.mock('@src/utils/notifications/notificationDatabase', () => ({
  getAdminUserIds: jest.fn(async () => ['admin-1', 'admin-2']),
}))

const notices = require('@src/utils/deletionEmailService')

const ROOT = join(__dirname, '..', '..')
const USER = '507f1f77bcf86cd799439011'
const request = (overrides = {}) => ({
  _id: { toString: () => '64b7f0c2a1b2c3d4e5f60001' },
  userId: USER,
  email: 'ada@example.invalid',
  requestType: 'authenticated',
  status: 'pending',
  requestedAt: new Date('2026-11-10T12:00:00Z'),
  // A signed-in user's request has the date the server acts on
  scheduledDeletionAt: new Date('2026-12-10T12:00:00Z'),
  cancelledAt: new Date('2026-11-11T12:00:00Z'),
  ...overrides,
})

/** One made on the public form: no date, it waits for an admin. */
const publicRequest = () => request({ requestType: 'public', scheduledDeletionAt: undefined })

/** Every notification the flow can send, as [who it went to, what it says]. */
async function everyNotice() {
  await notices.sendDeletionRequestConfirmation(USER, request())
  await notices.sendDeletionRequestConfirmation(USER, publicRequest())
  await notices.sendDeletionReminder(USER, request())
  await notices.sendDeletionCancellationConfirmation(USER, request({ status: 'cancelled' }))
  await notices.sendAdminDeletionRequestNotification(request())
  await notices.sendAdminDeletionRequestNotification(publicRequest())
  await notices.sendDeletionCompletionNotification('ada@example.invalid', { user: 1 })
  await notices.sendDeletionCompletionNotification('ada@example.invalid', { user: 1 }, { automatic: true })
  await notices.sendDeletionFailureNotification(request(), new Error('connection reset'))
  return mockCreateCustom.mock.calls.map(([to, data]) => [to, data])
}

/** The page file a path in the (styled) app is served by, if there is one. */
const pageOf = (url) =>
  ['page.js', 'page.jsx', 'page.tsx'].map((file) => join(ROOT, 'src', 'app', '(styled)', ...url.split('/').filter(Boolean), file)).find(existsSync)

beforeEach(() => {
  jest.clearAllMocks()
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

test('no notification names a calendar date or an email', async () => {
  const sent = await everyNotice()

  expect(sent).toHaveLength(9)
  for (const [, data] of sent) {
    // How the date is set, never the date: the page shows that
    expect(`${data.title} ${data.message}`).not.toMatch(
      /\b(20\d\d|January|February|March|April|May|June|July|August|September|October|November|December)\b|\d\/\d|inbox|check your email|verification/i
    )
    expect(data.data).not.toHaveProperty('verificationToken')
  }
})

test('only a request the server will carry out is said to be deleted after 30 days', async () => {
  await notices.sendDeletionRequestConfirmation(USER, request())
  await notices.sendDeletionRequestConfirmation(USER, publicRequest())
  // A signed-in user's request recorded while no date was promised
  await notices.sendDeletionRequestConfirmation(USER, request({ scheduledDeletionAt: undefined }))

  const [scheduled, fromForm, undated] = mockCreateCustom.mock.calls.map(([, data]) => data.message)
  expect(scheduled).toBe(
    'Your account will be deleted 30 days after your request, or sooner if an admin carries it out. The Delete account page shows the date, and is where to cancel.'
  )
  expect(fromForm).not.toMatch(/30 days|automatic/)
  expect(undated).toBe(
    'Your request is with the admins, who delete accounts by hand. Until one of them does, you can cancel it on the Delete account page.'
  )
})

test('the reminder takes the place of the first notice and says where to cancel', async () => {
  await notices.sendDeletionRequestConfirmation(USER, request())
  await notices.sendDeletionReminder(USER, request())

  const [[, first, firstGrouped], [to, reminder, grouped]] = mockCreateCustom.mock.calls
  expect(to).toBe(USER)
  expect(reminder.title).toBe('Your account will be deleted soon')
  expect(reminder.message).toBe(
    'Your account will be deleted within 7 days. The Delete account page shows the date, and is where to cancel if you have changed your mind.'
  )
  expect(reminder.data.actionUrl).toBe('/account/delete')
  // Same group, replaced: one notice about the deletion, not two
  expect([reminder.groupKey, grouped]).toEqual([first.groupKey, true])
  expect(firstGrouped).toBe(true)
})

test('the admins are told when the server carried a deletion out by itself', async () => {
  await notices.sendDeletionCompletionNotification('ada@example.invalid', { user: 1 }, { automatic: true })
  await notices.sendDeletionCompletionNotification('ada@example.invalid', { user: 1 })

  const [[, automatic], [, byAdmin]] = mockCreateCustom.mock.calls
  expect(automatic.message).toBe('The account of ada@example.invalid was deleted automatically, 30 days after its owner asked.')
  expect(byAdmin.message).toBe('The account of ada@example.invalid was deleted, as requested.')
})

test('every notification links to a page that exists', async () => {
  const sent = await everyNotice()

  const links = [...new Set(sent.map(([, data]) => data.data.actionUrl))].sort()
  expect(links).toEqual(['/account/delete', '/admin/deletion-requests'])
  for (const link of links) {
    expect([link, Boolean(pageOf(link))]).toEqual([link, true])
  }
})

test('the account is told where to cancel; a request from the public form says it may not be theirs', async () => {
  await notices.sendDeletionRequestConfirmation(USER, request())
  await notices.sendDeletionRequestConfirmation(USER, publicRequest())

  const [[own, ownData], [byEmail, byEmailData]] = mockCreateCustom.mock.calls
  expect(own).toBe(USER)
  expect(ownData.message).toMatch(/The Delete account page shows the date, and is where to cancel\.$/)
  expect(ownData.data.actionUrl).toBe('/account/delete')
  expect(byEmail).toBe(USER)
  expect(byEmailData.title).toBe('Someone asked for this account to be deleted')
  expect(byEmailData.message).toMatch(/requested with its email address, on the public form\. If that wasn’t you, cancel the request/)
})

test('the admins are told a request waits for them, and that a public one is unverified', async () => {
  await notices.sendAdminDeletionRequestNotification(request())
  await notices.sendAdminDeletionRequestNotification(publicRequest())

  const [[toOwn, own], [toPublic, fromForm]] = mockCreateCustom.mock.calls
  expect(toOwn).toEqual(['admin-1', 'admin-2'])
  expect(own.message).toBe(
    'ada@example.invalid asked for their account to be deleted. It is deleted automatically 30 days after the request unless they cancel; an admin can delete it sooner.'
  )
  expect(toPublic).toEqual(['admin-1', 'admin-2'])
  expect(fromForm.message).toMatch(/requested on the public form\. Nobody has proved they own that address: it waits for an admin, so check before deleting\./)
  expect(fromForm.message).not.toMatch(/automatically/)
})

test('nothing is printed to the log: an "email" there named the account’s address', async () => {
  await everyNotice()

  expect(console.log).not.toHaveBeenCalled()
})

test('only notifications are exported: the schedule itself lives in src/lib/scheduledDeletions.ts', () => {
  expect(Object.keys(notices).sort()).toEqual([
    'sendAdminDeletionRequestNotification',
    'sendDeletionCancellationConfirmation',
    'sendDeletionCompletionNotification',
    'sendDeletionFailureNotification',
    'sendDeletionReminder',
    'sendDeletionRequestConfirmation',
  ])
})
