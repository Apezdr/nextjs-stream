/**
 * @jest-environment node
 *
 * The notifications of the account deletion flow
 * (src/utils/deletionEmailService.js). They are notifications in the app:
 * the app sends no email. They used to say an account "will be permanently
 * deleted on <date>" (nothing ever ran on that date), link to two pages that
 * do not exist, and print whole "emails", addresses included, to the log.
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
  cancelledAt: new Date('2026-11-11T12:00:00Z'),
  ...overrides,
})

/** Every notification the flow can send, as [who it went to, what it says]. */
async function everyNotice() {
  await notices.sendDeletionRequestConfirmation(USER, request())
  await notices.sendDeletionRequestConfirmation(USER, request({ requestType: 'public' }))
  await notices.sendDeletionCancellationConfirmation(USER, request({ status: 'cancelled' }))
  await notices.sendAdminDeletionRequestNotification(request())
  await notices.sendAdminDeletionRequestNotification(request({ requestType: 'public' }))
  await notices.sendDeletionCompletionNotification('ada@example.invalid', { user: 1 })
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

test('no notification promises a date, a countdown or an email', async () => {
  const sent = await everyNotice()

  expect(sent).toHaveLength(7)
  for (const [, data] of sent) {
    expect(`${data.title} ${data.message}`).not.toMatch(/\bon \d|days?\b|scheduled|grace|inbox|check your email|verification/i)
    expect(data.data).not.toHaveProperty('scheduledDeletionAt')
    expect(data.data).not.toHaveProperty('verificationToken')
  }
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
  await notices.sendDeletionRequestConfirmation(USER, request({ requestType: 'public' }))

  const [[own, ownData], [byEmail, byEmailData]] = mockCreateCustom.mock.calls
  expect(own).toBe(USER)
  expect(ownData.message).toBe(
    'Your request is with the admins, who delete accounts by hand. Until one of them does, you can cancel it on the Delete account page.'
  )
  expect(ownData.data.actionUrl).toBe('/account/delete')
  expect(byEmail).toBe(USER)
  expect(byEmailData.title).toBe('Someone asked for this account to be deleted')
  expect(byEmailData.message).toMatch(/requested with its email address, on the public form\. If that wasn’t you, cancel the request/)
})

test('the admins are told a request waits for them, and that a public one is unverified', async () => {
  await notices.sendAdminDeletionRequestNotification(request())
  await notices.sendAdminDeletionRequestNotification(request({ requestType: 'public' }))

  const [[toOwn, own], [toPublic, fromForm]] = mockCreateCustom.mock.calls
  expect(toOwn).toEqual(['admin-1', 'admin-2'])
  expect(own.message).toBe('ada@example.invalid asked for their account to be deleted. It waits for an admin.')
  expect(toPublic).toEqual(['admin-1', 'admin-2'])
  expect(fromForm.message).toMatch(/requested on the public form\. Nobody has proved they own that address: check before deleting\./)
})

test('nothing is printed to the log: an "email" there named the account’s address', async () => {
  await everyNotice()

  expect(console.log).not.toHaveBeenCalled()
})

test('only notifications are exported: nothing pretends to run on a schedule', () => {
  expect(Object.keys(notices).sort()).toEqual([
    'sendAdminDeletionRequestNotification',
    'sendDeletionCancellationConfirmation',
    'sendDeletionCompletionNotification',
    'sendDeletionFailureNotification',
    'sendDeletionRequestConfirmation',
  ])
})
