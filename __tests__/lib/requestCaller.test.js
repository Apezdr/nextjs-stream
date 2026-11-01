/**
 * @jest-environment node
 *
 * src/lib/requestCaller.ts: who made a request, on the request's span. A user
 * is recorded by id, a configured key by its setting name and fingerprint,
 * and a key's value never reaches a span.
 */

const crypto = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

jest.mock('next/headers', () => ({ headers: jest.fn(async () => new Headers({ cookie: 'session=1' })) }))
jest.mock('next/cache', () => ({ cacheLife: jest.fn() }))
const mockGetSession = jest.fn()
jest.mock('@src/lib/auth', () => ({ auth: { api: { getSession: (...args) => mockGetSession(...args) } } }))
// Loaded by routeAuth and mediaActivity, never queried by the paths under test
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: new Promise(() => {}) }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))

const api = require('@opentelemetry/api')
const {
  credentialFingerprint,
  recordAuthHandlerCaller,
  recordKeyCaller,
  recordUserCaller,
} = require('@src/lib/requestCaller')
const { serverSpanProcessor } = require('@src/lib/telemetrySpans')

const WEBHOOK_KEY = 'whk_live_5f3c2a9e8d7b6c5a4f3e2d1c'
const ACTIVITY_KEY = 'mak_9e8d7c6b5a4f3e2d1c0b9a8f'

let span
beforeEach(() => {
  span = { setAttributes: jest.fn() }
  jest.spyOn(api.trace, 'getActiveSpan').mockReturnValue(span)
  mockGetSession.mockReset()
})

afterEach(() => {
  jest.restoreAllMocks()
  delete process.env.WEBHOOK_ID
  delete process.env.WEBHOOK_ID_2
  delete process.env.WEBHOOK_ID_3
  delete process.env.NODE_SERVER_URL_2
  delete process.env.MEDIA_ACTIVITY_API_KEY
})

/** Every attribute value set on the span, as one string. */
function recorded() {
  return JSON.stringify(span.setAttributes.mock.calls)
}

describe('credentialFingerprint', () => {
  it('is the first 8 hex digits of the SHA-256, as the media processor prints it', () => {
    const digest = crypto.createHash('sha256').update(WEBHOOK_KEY).digest('hex')
    expect(credentialFingerprint(WEBHOOK_KEY)).toBe(`sha256:${digest.slice(0, 8)}`)
  })

  it('tells keys apart and never contains the key', () => {
    expect(credentialFingerprint(WEBHOOK_KEY)).not.toBe(credentialFingerprint(`${WEBHOOK_KEY}x`))
    expect(credentialFingerprint(WEBHOOK_KEY)).not.toContain(WEBHOOK_KEY.slice(0, 8))
  })
})

describe('recording the caller', () => {
  it('records a user by id', () => {
    recordUserCaller('6578feca7317f7b672cebb5e')

    expect(span.setAttributes).toHaveBeenCalledWith({
      'nextjs_stream.caller.type': 'user',
      'user.id': '6578feca7317f7b672cebb5e',
    })
  })

  it('records nothing for a request without a user', () => {
    recordUserCaller(undefined)

    expect(span.setAttributes).not.toHaveBeenCalled()
  })

  it('records a key by its setting and fingerprint, never its value', () => {
    recordKeyCaller('webhook', WEBHOOK_KEY, 'WEBHOOK_ID_2', 'server2')

    expect(span.setAttributes).toHaveBeenCalledWith({
      'nextjs_stream.caller.type': 'webhook',
      'nextjs_stream.caller.credential': 'WEBHOOK_ID_2',
      'nextjs_stream.caller.fingerprint': credentialFingerprint(WEBHOOK_KEY),
      'nextjs_stream.caller.server': 'server2',
    })
    expect(recorded()).not.toContain(WEBHOOK_KEY)
  })

  it('does nothing when no span is active', () => {
    api.trace.getActiveSpan.mockReturnValue(undefined)

    expect(() => recordUserCaller('u1')).not.toThrow()
    expect(() => recordKeyCaller('api-key', WEBHOOK_KEY, 'MEDIA_ACTIVITY_API_KEY')).not.toThrow()
  })

  it("goes on the request's SERVER span, not the child span the handler runs in", () => {
    const server = { kind: api.SpanKind.SERVER, setAttributes: jest.fn() }
    const handler = { kind: api.SpanKind.INTERNAL, setAttributes: jest.fn() }
    serverSpanProcessor.onStart(server, api.ROOT_CONTEXT)
    serverSpanProcessor.onStart(handler, api.trace.setSpan(api.ROOT_CONTEXT, server))
    api.trace.getActiveSpan.mockReturnValue(handler)

    recordUserCaller('u1')

    expect(server.setAttributes).toHaveBeenCalledWith({ 'nextjs_stream.caller.type': 'user', 'user.id': 'u1' })
    expect(handler.setAttributes).not.toHaveBeenCalled()
  })
})

describe("better-auth's own handler", () => {
  const future = new Date(Date.now() + 60_000)
  const past = new Date(Date.now() - 60_000)
  const session = (id, expiresAt) => ({ session: { expiresAt }, user: { id } })
  const recordedUser = () => span.setAttributes.mock.calls.map(([attributes]) => attributes['user.id'])

  it('names the session the request carried', () => {
    recordAuthHandlerCaller({ session: session('u1', future) })
    expect(recordedUser()).toEqual(['u1'])
  })

  it('names the user a sign-in just made a session for', () => {
    recordAuthHandlerCaller({ newSession: session('u2', future) })
    expect(recordedUser()).toEqual(['u2'])
  })

  it('names the admin, not the user an admin impersonates', () => {
    recordAuthHandlerCaller({ session: session('admin', future), newSession: session('target', future) })
    expect(recordedUser()).toEqual(['admin'])
  })

  it('does not name the user of an expired session', () => {
    recordAuthHandlerCaller({ session: session('u1', past) })
    expect(span.setAttributes).not.toHaveBeenCalled()
  })

  it('records nothing for a signed-out request', () => {
    recordAuthHandlerCaller({ session: null })
    expect(span.setAttributes).not.toHaveBeenCalled()
  })
})

describe('where callers are recorded', () => {
  it('getSession records the signed-in user by id, not by email', async () => {
    mockGetSession.mockResolvedValue({ user: { id: 'u1', email: 'viewer@example.com' } })
    const { getSession } = require('@src/lib/cachedAuth')

    const session = await getSession()

    expect(session.user.id).toBe('u1')
    expect(span.setAttributes).toHaveBeenCalledWith({ 'nextjs_stream.caller.type': 'user', 'user.id': 'u1' })
    expect(recorded()).not.toContain('viewer@example.com')
  })

  it('a webhook check records the setting that matched, never the ID', async () => {
    process.env.WEBHOOK_ID_2 = WEBHOOK_KEY
    process.env.NODE_SERVER_URL_2 = 'http://server2.test'
    const { isValidWebhook } = require('@src/utils/routeAuth')
    const req = { headers: new Headers({ 'X-Webhook-ID': WEBHOOK_KEY }) }

    expect(await isValidWebhook(req)).toBe(true)
    expect(span.setAttributes).toHaveBeenCalledWith({
      'nextjs_stream.caller.type': 'webhook',
      'nextjs_stream.caller.credential': 'WEBHOOK_ID_2',
      'nextjs_stream.caller.fingerprint': credentialFingerprint(WEBHOOK_KEY),
      'nextjs_stream.caller.server': 'server2',
    })
    expect(recorded()).not.toContain(WEBHOOK_KEY)
  })

  it('a refused webhook ID records nothing', async () => {
    process.env.WEBHOOK_ID = WEBHOOK_KEY
    const { isValidWebhook } = require('@src/utils/routeAuth')

    expect(await isValidWebhook({ headers: new Headers({ 'X-Webhook-ID': 'not-a-key' }) })).toBe(false)
    expect(span.setAttributes).not.toHaveBeenCalled()
  })

  it('the admin-or-webhook check records the webhook too', async () => {
    process.env.WEBHOOK_ID = WEBHOOK_KEY
    const { isAdminOrWebhook } = require('@src/utils/routeAuth')

    expect(await isAdminOrWebhook({ headers: new Headers({ 'X-Webhook-ID': WEBHOOK_KEY }) })).toBe(true)
    expect(span.setAttributes).toHaveBeenCalledWith({
      'nextjs_stream.caller.type': 'webhook',
      'nextjs_stream.caller.credential': 'WEBHOOK_ID',
      'nextjs_stream.caller.fingerprint': credentialFingerprint(WEBHOOK_KEY),
      'nextjs_stream.caller.server': 'default',
    })
  })

  it('a wildcard webhook ID (no file server of its own) records no server', async () => {
    process.env.WEBHOOK_ID_3 = WEBHOOK_KEY
    const { isValidWebhook } = require('@src/utils/routeAuth')

    expect(await isValidWebhook({ headers: new Headers({ 'X-Webhook-ID': WEBHOOK_KEY }) })).toBe(true)
    expect(span.setAttributes).toHaveBeenCalledWith({
      'nextjs_stream.caller.type': 'webhook',
      'nextjs_stream.caller.credential': 'WEBHOOK_ID_3',
      'nextjs_stream.caller.fingerprint': credentialFingerprint(WEBHOOK_KEY),
    })
  })

  it('the media-activity API records its own key as an api-key caller', async () => {
    process.env.MEDIA_ACTIVITY_API_KEY = ACTIVITY_KEY
    const { validateMediaActivityRequest } = require('@src/utils/mediaActivity')
    const request = new Request('http://app.test/api/media-activity', { headers: { 'X-API-Key': ACTIVITY_KEY } })

    expect(await validateMediaActivityRequest(request)).toEqual({ isValid: true, source: 'media-activity-api-key' })
    expect(span.setAttributes).toHaveBeenCalledWith({
      'nextjs_stream.caller.type': 'api-key',
      'nextjs_stream.caller.credential': 'MEDIA_ACTIVITY_API_KEY',
      'nextjs_stream.caller.fingerprint': credentialFingerprint(ACTIVITY_KEY),
    })
    expect(recorded()).not.toContain(ACTIVITY_KEY)
  })

  it('the media-activity API records a webhook ID sent in the query as a webhook caller', async () => {
    process.env.WEBHOOK_ID = WEBHOOK_KEY
    const { validateMediaActivityRequest } = require('@src/utils/mediaActivity')
    const request = new Request(`http://app.test/api/media-activity?token=${WEBHOOK_KEY}`)

    expect(await validateMediaActivityRequest(request)).toEqual({ isValid: true, source: 'webhook', serverId: 'default' })
    expect(span.setAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ 'nextjs_stream.caller.credential': 'WEBHOOK_ID' })
    )
    expect(recorded()).not.toContain(WEBHOOK_KEY)
  })
})

describe('webhook IDs stay server-side', () => {
  const read = (path) => readFileSync(join(__dirname, '..', '..', path), 'utf8')

  it('webhookServer.js is server-only and not a Server Actions module', () => {
    const source = read('src/utils/webhookServer.js')
    // "use server" made every export (getAllWebhookConfigs included) an action endpoint
    expect(source).not.toMatch(/^\s*['"]use server['"]/m)
    expect(source).toMatch(/^import 'server-only'$/m)
  })

  it('sync_db.js, whose getServerSettings() returns every webhook ID, is server-only too', () => {
    const source = read('src/utils/sync_db.js')
    expect(source).not.toMatch(/^\s*['"]use server['"]/m)
    expect(source).toMatch(/^import 'server-only'$/m)
  })

  it('config.js, which client components import, does not import webhookServer.js', () => {
    expect(read('src/utils/config.js')).not.toMatch(/from ['"](\.\/|@src\/utils\/)webhookServer['"]/)
  })
})
