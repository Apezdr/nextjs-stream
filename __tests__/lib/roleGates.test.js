/**
 * @jest-environment node
 *
 * src/lib/roles: the rules every access check reads, and the gates that turn
 * a refusal into a route's Response, a page's redirect or an action's throw.
 * The route bodies are what the web, TV and desktop apps already read.
 */
const fs = require('fs')
const path = require('path')

const mockGetSession = jest.fn()
jest.mock('@src/lib/cachedAuth', () => ({ getSession: (...args) => mockGetSession(...args) }))
jest.mock('next/navigation', () => ({
  redirect: jest.fn((url, type) => {
    throw new Error(`REDIRECT ${url}${type ? ` (${type})` : ''}`)
  }),
}))
const mockValidateWebhookId = jest.fn()
jest.mock('@src/utils/webhookServer', () => ({ validateWebhookId: (...args) => mockValidateWebhookId(...args) }))
const mockRecordKeyCaller = jest.fn()
jest.mock('@src/lib/requestCaller', () => ({ recordKeyCaller: (...args) => mockRecordKeyCaller(...args) }))

const { isAdminUser, isAwaitingApproval } = require('@src/lib/roles/rules')
const { signedInGate, approvedGate, adminGate, isValidWebhook, adminOrWebhook } = require('@src/lib/roles/gates')

const ADMIN = { id: 'a1', role: 'admin', approved: true }
const MEMBER = { id: 'u1', role: 'user', approved: true }
const PENDING = { id: 'p1', role: 'user', approved: false }

const signedInAs = (user) => mockGetSession.mockResolvedValue(user ? { user } : null)
const bodyOf = async (response) => ({ status: response.status, body: await response.json() })

beforeEach(() => {
  mockGetSession.mockReset()
  mockValidateWebhookId.mockReset()
  mockRecordKeyCaller.mockReset()
})

describe('rules', () => {
  it('an admin is the better-auth role, exactly', () => {
    expect(isAdminUser(ADMIN)).toBe(true)
    expect(isAdminUser(MEMBER)).toBe(false)
    expect(isAdminUser({ role: 'Admin' })).toBe(false)
    expect(isAdminUser({ role: 'user', permissions: ['Admin'] })).toBe(false)
    expect(isAdminUser(null)).toBe(false)
  })

  it('only an explicit approved: false is awaiting approval', () => {
    expect(isAwaitingApproval(PENDING)).toBe(true)
    expect(isAwaitingApproval(MEMBER)).toBe(false)
    expect(isAwaitingApproval({ id: 'old' })).toBe(false)
    expect(isAwaitingApproval(undefined)).toBe(false)
  })

})

describe('route()', () => {
  it('returns the user to a caller the gate lets in', async () => {
    signedInAs(MEMBER)
    expect(await approvedGate.route()).toBe(MEMBER)
    signedInAs(ADMIN)
    expect(await adminGate.route()).toBe(ADMIN)
  })

  it('answers a signed-out caller 401 AUTH_REQUIRED', async () => {
    signedInAs(null)
    for (const gate of [signedInGate, approvedGate]) {
      expect(await bodyOf(await gate.route())).toEqual({
        status: 401,
        body: { success: false, error: 'Unauthorized', message: 'You must be signed in.', code: 'AUTH_REQUIRED' },
      })
    }
  })

  it('answers an account awaiting approval 403 APPROVAL_PENDING', async () => {
    signedInAs(PENDING)
    expect(await bodyOf(await approvedGate.route())).toEqual({
      status: 403,
      body: { success: false, error: 'Unauthorized', message: 'Account approval required.', code: 'APPROVAL_PENDING' },
    })
  })

  it('answers a non-admin and a signed-out caller alike on an admin route', async () => {
    const refusal = { status: 401, body: { success: false, error: 'Unauthorized', message: 'Admin access required.' } }
    signedInAs(MEMBER)
    expect(await bodyOf(await adminGate.route())).toEqual(refusal)
    signedInAs(null)
    expect(await bodyOf(await adminGate.route())).toEqual(refusal)
  })
})

describe('page()', () => {
  it('sends anyone but an admin home from an admin page', async () => {
    signedInAs(MEMBER)
    await expect(adminGate.page()).rejects.toThrow('REDIRECT / (replace)')
    signedInAs(null)
    await expect(adminGate.page()).rejects.toThrow('REDIRECT / (replace)')
    signedInAs(ADMIN)
    expect(await adminGate.page()).toBe(ADMIN)
  })

  it('sends a signed-out visitor to sign-in and back, and a pending account to the approval page', async () => {
    signedInAs(null)
    await expect(approvedGate.page('/list/tv/A%20Show')).rejects.toThrow(
      `REDIRECT /auth/signin?callbackUrl=${encodeURIComponent('/list/tv/A%20Show')}`
    )
    signedInAs(PENDING)
    await expect(approvedGate.page('/list')).rejects.toThrow('REDIRECT /auth/error?error=APPROVAL_PENDING')
  })
})

describe('action()', () => {
  it('throws for a caller who is not an admin, so the mutation never runs', async () => {
    signedInAs(MEMBER)
    await expect(adminGate.action()).rejects.toThrow('Admin access required.')
    signedInAs(null)
    await expect(adminGate.action()).rejects.toThrow('Admin access required.')
  })

  it('redirects a signed-out or pending caller where the page would', async () => {
    signedInAs(null)
    await expect(approvedGate.action('/list/movie')).rejects.toThrow(
      `REDIRECT /auth/signin?callbackUrl=${encodeURIComponent('/list/movie')}`
    )
    signedInAs(PENDING)
    await expect(approvedGate.action('/list/movie')).rejects.toThrow('REDIRECT /auth/error?error=APPROVAL_PENDING')
  })
})

describe('check()', () => {
  it('returns the user or null, refusing nothing itself', async () => {
    signedInAs(ADMIN)
    expect(await adminGate.check()).toBe(ADMIN)
    signedInAs(MEMBER)
    expect(await adminGate.check()).toBeNull()
  })
})

describe('webhooks', () => {
  const withId = (id) => ({ headers: new Headers(id ? { 'X-Webhook-ID': id } : {}) })

  it('a valid ID passes, names its server and records the caller', async () => {
    mockValidateWebhookId.mockResolvedValue({ isValid: true, serverId: 'server2', credential: 'WEBHOOK_ID_2' })
    const req = withId('key')
    expect(await isValidWebhook(req)).toBe(true)
    expect(req.webhookServerId).toBe('server2')
    expect(mockRecordKeyCaller).toHaveBeenCalledWith('webhook', 'key', 'WEBHOOK_ID_2', 'server2')
  })

  it('no ID, or a wrong one, is not a webhook', async () => {
    expect(await isValidWebhook(withId(null))).toBe(false)
    mockValidateWebhookId.mockResolvedValue({ isValid: false })
    expect(await isValidWebhook(withId('wrong'))).toBe(false)
    expect(mockRecordKeyCaller).not.toHaveBeenCalled()
  })

  it('admin-or-webhook: true for a valid ID, 401 for a wrong one, the admin gate without one', async () => {
    mockValidateWebhookId.mockResolvedValue({ isValid: true, serverId: 'default', credential: 'WEBHOOK_ID' })
    expect(await adminOrWebhook(withId('key'))).toBe(true)

    mockValidateWebhookId.mockResolvedValue({ isValid: false })
    expect(await bodyOf(await adminOrWebhook(withId('wrong')))).toEqual({
      status: 401,
      body: { success: false, message: 'Invalid webhook identifier.' },
    })

    signedInAs(ADMIN)
    expect(await adminOrWebhook(withId(null))).toBe(ADMIN)
    signedInAs(MEMBER)
    expect((await adminOrWebhook(withId(null))).status).toBe(401)
  })
})

describe('admin pages', () => {
  // Each page runs its own gate: the admin layout is a client component, and
  // its check only decides what to show
  it('every admin page calls adminGate.page()', () => {
    const root = path.join(__dirname, '../../src/app/(styled)/admin')
    const pages = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/^page\.(js|jsx|ts|tsx)$/.test(entry.name)) pages.push(full)
      }
    }
    walk(root)
    expect(pages.length).toBeGreaterThan(10)
    const ungated = pages.filter((page) => {
      const source = fs.readFileSync(page, 'utf8')
      // The catch-all only answers notFound()
      return !source.includes('adminGate.page()') && !/^\s*notFound\(\)\s*$/m.test(source)
    })
    expect(ungated.map((page) => path.relative(root, page))).toEqual([])
  })
})
