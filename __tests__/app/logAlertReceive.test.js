/**
 * @jest-environment node
 *
 * A media processor's log alert reaching the frontend
 * (src/utils/logAlerts/receiveLogAlert.js → adminNotifier.js): webhook only,
 * only known fields kept, one notification per admin per alert (a resolve
 * replaces it), linking to the Logs page filtered to the fingerprint. And the
 * alerts proxy saying when a server you don't run refuses.
 */

const mockCreateCustom = jest.fn()
jest.mock('@src/utils/notifications/NotificationManager.js', () => ({
  NotificationManager: { createCustom: (...args) => mockCreateCustom(...args) },
}))
jest.mock('@src/utils/notifications/notificationDatabase', () => ({
  getAdminUserIds: async () => ['admin-1', 'admin-2'],
}))
jest.mock('@src/utils/config', () => ({
  adminUserEmails: ['a@x'],
  getAllServers: () => [
    { id: 'default', displayName: 'Tower', syncEndpoint: 'https://public.example/nodejs', internalEndpoint: 'http://processor:3000' },
  ],
}))
jest.mock('@src/lib/logger', () => ({ createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn() }) }))

const mockIsAdmin = jest.fn()
jest.mock('@src/utils/routeAuth', () => ({ isAdmin: (req) => mockIsAdmin(req) }))
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: async () => ({ Authorization: 'Bearer t0k' }) }))
jest.mock('next/server', () => ({
  NextResponse: { json: (body, init = {}) => ({ status: init.status ?? 200, json: async () => body }) },
}))

const { handleLogAlert, readLogAlert } = require('@src/utils/logAlerts/receiveLogAlert')
const { GET: getAlerts } = require('@src/app/api/authenticated/admin/alerts/route')

const alert = {
  processorId: 'proc-1',
  key: 'recurring:2bd18557f897',
  rule: 'recurring',
  severity: 'warning',
  state: 'firing',
  title: 'session-cache: "Memory pressure detected: #MB used" 20 times in the last 60 minutes',
  category: 'session-cache',
  fp: '2bd18557f897',
  count: 20,
  windowMinutes: 60,
  notified: { should: 'be dropped' },
}
const post = (body) => ({ json: async () => body })

beforeEach(() => {
  mockCreateCustom.mockReset().mockResolvedValue([])
  mockIsAdmin.mockReset().mockResolvedValue({ id: 'admin' })
  global.fetch = jest.fn()
})

describe('POST admin/log-alert', () => {
  it('turns a fired alert into one grouped notification per admin, linking to its lines', async () => {
    const res = await handleLogAlert(post({ alert, transition: 'fired' }), { webhookId: 'key', serverId: 'default' })

    expect(res.status).toBe(200)
    const [adminIds, notification, grouped] = mockCreateCustom.mock.calls[0]
    expect(adminIds).toEqual(['admin-1', 'admin-2'])
    expect(grouped).toBe(true)
    expect(notification).toMatchObject({
      type: 'log_alert',
      title: `Tower: ${alert.title}`,
      message: 'Warning · session-cache · 20 in 60 min',
      priority: 'high',
      category: 'admin',
      groupKey: 'log_alert_proc-1_recurring:2bd18557f897',
      data: { actionUrl: '/admin/logs?server=default&q=2bd18557f897', alertKey: alert.key, severity: 'warning' },
    })
  })

  it('replaces it with a low-priority "Resolved" notice when the alert clears', async () => {
    await handleLogAlert(post({ alert: { ...alert, state: 'resolved' }, transition: 'resolved' }), { webhookId: 'key', serverId: 'default' })
    const [, notification] = mockCreateCustom.mock.calls[0]
    expect(notification.title).toBe(`Resolved on Tower: ${alert.title}`)
    expect(notification.priority).toBe('low')
    expect(notification.groupKey).toBe('log_alert_proc-1_recurring:2bd18557f897')
  })

  it('takes alerts only from a processor with a webhook ID, and only well-formed ones', async () => {
    expect((await handleLogAlert(post({ alert, transition: 'fired' }), { webhookId: null, serverId: undefined })).status).toBe(401)
    expect((await handleLogAlert(post({ alert, transition: 'exploded' }), { webhookId: 'key', serverId: 'default' })).status).toBe(400)
    expect((await handleLogAlert(post({ alert: { ...alert, severity: 'meh' }, transition: 'fired' }), { webhookId: 'key', serverId: 'default' })).status).toBe(400)
    expect(mockCreateCustom).not.toHaveBeenCalled()
  })

  it('keeps only the known fields, capped', () => {
    const { alert: kept } = readLogAlert({ alert: { ...alert, title: 'x'.repeat(2000) }, transition: 'fired' })
    expect(kept).not.toHaveProperty('notified')
    expect(kept.title).toHaveLength(500)
  })
})

describe('GET /api/authenticated/admin/alerts', () => {
  const request = { url: 'http://app.example/api/authenticated/admin/alerts?server=default', headers: new Headers() }

  it("asks the server's processor as the admin", async () => {
    global.fetch.mockResolvedValue({ status: 200, json: async () => ({ processorId: 'proc-1', active: [], recent: [] }) })
    const res = await getAlerts(request)
    expect(res.status).toBe(200)
    expect(global.fetch.mock.calls[0][0]).toBe('http://processor:3000/api/alerts?')
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer t0k')
  })

  it('marks a refusal, which is what a server you do not run answers', async () => {
    global.fetch.mockResolvedValue({ status: 401, json: async () => ({ error: 'Authentication failed' }) })
    const res = await getAlerts(request)
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ refused: true })
  })
})
