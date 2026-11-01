/**
 * @jest-environment node
 *
 * src/lib/telemetrySpans.ts: the span processors src/instrumentation.ts
 * registers. One keeps credentials sent in a URL out of span attributes and
 * names; the other maps each span to its request's SERVER span, which is where
 * requestCaller.ts records the caller.
 */

const api = require('@opentelemetry/api')
const {
  activeServerSpan,
  credentialQueryProcessor,
  redactUrlCredentials,
  serverSpanProcessor,
} = require('@src/lib/telemetrySpans')

const { SpanKind, ROOT_CONTEXT, trace } = api

afterEach(() => {
  jest.restoreAllMocks()
})

describe('redactUrlCredentials', () => {
  it('blanks the value of each credential parameter and keeps the rest', () => {
    expect(redactUrlCredentials('/api/authz/verify?apikey=0123456789abcdef&_=1730400000')).toBe(
      '/api/authz/verify?apikey=REDACTED&_=1730400000'
    )
  })

  it('matches every spelling of a name', () => {
    for (const name of ['apiKey', 'api_key', 'API-KEY', 'api%5Fkey', 'webhookId', 'access_token', 'user_code', 'X-Amz-Signature']) {
      expect(redactUrlCredentials(`/x?page=2&${name}=s3cret`)).toBe(`/x?page=2&${name}=REDACTED`)
    }
  })

  it('leaves names that only contain a credential word alone', () => {
    for (const name of ['monkey', 'keyword', 'passkey', 'apikeys', 'key2', 'tokens']) {
      expect(redactUrlCredentials(`/x?${name}=v`)).toBe(`/x?${name}=v`)
    }
  })

  it('redacts a URL inside other text, such as a client span name', () => {
    expect(redactUrlCredentials('http GET https://host.test/api?token=s3cret')).toBe(
      'http GET https://host.test/api?token=REDACTED'
    )
  })

  it('redacts inside a URL-valued parameter and after a ; separator', () => {
    expect(redactUrlCredentials('/x?next=https://h/y?apikey=s3cret')).toBe('/x?next=https://h/y?apikey=REDACTED')
    expect(redactUrlCredentials('/x?a=1;apikey=s3cret')).toBe('/x?a=1;apikey=REDACTED')
  })

  it("redacts a URL's user:password and a Discord webhook's token", () => {
    expect(redactUrlCredentials('https://admin:hunter2@sab.test/api?mode=queue')).toBe(
      'https://REDACTED@sab.test/api?mode=queue'
    )
    expect(redactUrlCredentials('https://discord.com/api/webhooks/123456/AbC-dEf_123')).toBe(
      'https://discord.com/api/webhooks/123456/REDACTED'
    )
  })

  it('leaves URLs without credentials, and empty values, alone', () => {
    for (const text of ['/list/movie?sort=title&page=3', '/x?token=', '/api/v3/queue', 'GET /api/authz/verify', 'user@example.com']) {
      expect(redactUrlCredentials(text)).toBe(text)
    }
  })

  it('stops at a fragment', () => {
    expect(redactUrlCredentials('/cb?code=abc#state=keep')).toBe('/cb?code=REDACTED#state=keep')
  })

  it('stays linear on URLs built to make a regex backtrack (it runs on every request)', () => {
    const size = 16_000
    const hostile = [
      '/x' + '?'.repeat(size) + '&=',
      '/x' + '?a'.repeat(size / 2) + '&=',
      '/x?' + 'a'.repeat(size),
      '/x?' + 'a='.repeat(size / 2),
      '/x?' + ';'.repeat(size) + '=',
      'a.'.repeat(size / 2) + '://' + 'b'.repeat(size) + ':',
      'x://' + 'a:'.repeat(size / 2),
      '/api/webhooks/1/' + '-'.repeat(size),
    ]
    for (const text of hostile) {
      const started = process.hrtime.bigint()
      redactUrlCredentials(text)
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      expect(ms).toBeLessThan(20)
    }
  })
})

describe('credentialQueryProcessor', () => {
  function started(attributes, name = 'GET') {
    const span = {
      attributes: { ...attributes },
      name,
      setAttribute: jest.fn(),
      updateName: jest.fn(),
    }
    credentialQueryProcessor.onStart(span)
    return span
  }

  it("rewrites Next's request URL on its server span", () => {
    const span = started({ 'http.method': 'GET', 'http.target': '/api/authz/verify?apikey=0123456789abcdef' })

    expect(span.setAttribute).toHaveBeenCalledWith('http.target', '/api/authz/verify?apikey=REDACTED')
  })

  it("rewrites a fetch span's URL and its name", () => {
    const span = started(
      { 'http.url': 'https://host.test/api?token=s3cret', 'url.query': 'token=s3cret&page=1' },
      'fetch GET https://host.test/api?token=s3cret'
    )

    expect(span.setAttribute).toHaveBeenCalledWith('http.url', 'https://host.test/api?token=REDACTED')
    expect(span.setAttribute).toHaveBeenCalledWith('url.query', 'token=REDACTED&page=1')
    expect(span.updateName).toHaveBeenCalledWith('fetch GET https://host.test/api?token=REDACTED')
  })

  it("rewrites resource.name and Next's copy of the span name", () => {
    const span = started({
      'resource.name': 'https://admin:hunter2@sab.test/api',
      'next.span_name': 'fetch GET https://host.test/api?apikey=s3cret',
    })

    expect(span.setAttribute).toHaveBeenCalledWith('resource.name', 'https://REDACTED@sab.test/api')
    expect(span.setAttribute).toHaveBeenCalledWith('next.span_name', 'fetch GET https://host.test/api?apikey=REDACTED')
  })

  it('touches nothing on a span without credentials', () => {
    const span = started({ 'http.target': '/list/movie?page=2', 'db.system.name': 'mongodb' }, 'GET /list/movie')

    expect(span.setAttribute).not.toHaveBeenCalled()
    expect(span.updateName).not.toHaveBeenCalled()
  })
})

describe('serverSpanProcessor and activeServerSpan', () => {
  const fakeSpan = (kind) => ({ kind, attributes: {}, name: 'span' })

  function start(span, parent) {
    serverSpanProcessor.onStart(span, parent ? trace.setSpan(ROOT_CONTEXT, parent) : ROOT_CONTEXT)
    return span
  }

  function activeIs(span) {
    jest.spyOn(trace, 'getActiveSpan').mockReturnValue(span)
  }

  it("resolves a route handler's child span, and its children, to the request's SERVER span", () => {
    const server = start(fakeSpan(SpanKind.SERVER))
    const handler = start(fakeSpan(SpanKind.INTERNAL), server)
    const query = start(fakeSpan(SpanKind.CLIENT), handler)

    activeIs(handler)
    expect(activeServerSpan()).toBe(server)
    activeIs(query)
    expect(activeServerSpan()).toBe(server)
  })

  it('gives the render pass its own SERVER span, though the proxy pass is its parent', () => {
    const proxyPass = start(fakeSpan(SpanKind.SERVER))
    const renderPass = start(fakeSpan(SpanKind.SERVER), proxyPass)
    const render = start(fakeSpan(SpanKind.INTERNAL), renderPass)

    activeIs(render)
    expect(activeServerSpan()).toBe(renderPass)
  })

  it('falls back to the active span outside a known request (a remote parent, no SERVER span)', () => {
    const remote = trace.wrapSpanContext({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), traceFlags: 1, isRemote: true })
    const orphan = start(fakeSpan(SpanKind.INTERNAL), remote)

    activeIs(orphan)
    expect(activeServerSpan()).toBe(orphan)
  })

  it('is undefined with no active span (OpenTelemetry off)', () => {
    activeIs(undefined)
    expect(activeServerSpan()).toBeUndefined()
  })

  it('shares one map across module copies, as Next loads the hook and the routes separately', () => {
    const server = start(fakeSpan(SpanKind.SERVER))
    const child = start(fakeSpan(SpanKind.INTERNAL), server)
    let isolated
    jest.isolateModules(() => {
      jest.spyOn(require('@opentelemetry/api').trace, 'getActiveSpan').mockReturnValue(child)
      isolated = require('@src/lib/telemetrySpans')
    })

    expect(isolated.activeServerSpan()).toBe(server)
  })
})
