/**
 * @jest-environment node
 *
 * The sync's side of the processor's per-title routes: manifests (format 2
 * only) and NDJSON entries, read strictly. A response that breaks the protocol
 * in any way contributes nothing.
 */

const http = require('http')
const zlib = require('zlib')

let mockBase = 'http://files.test'
jest.mock('@src/utils/config', () => ({
  getSyncUrls: () => ({ tv: `${mockBase}/media/tv`, movies: `${mockBase}/media/movies` }),
  fileServerVersionTV: 1.0001,
  fileServerVersionMOVIES: 1.0001,
}))
jest.mock('@src/utils/webhookServer', () => ({ getWebhookIdForServer: jest.fn(async () => 'hook-id') }))

const { fetchManifest, fetchEntries, parseManifest, fetchPhaseBudgetMs } = require('@src/utils/sync/run/manifestSource')

const SERVER = { id: 'A' }
const H1 = '0123456789abcdef'
const H2 = 'fedcba9876543210'
const NO_WAIT = { retryDelaysMs: [0, 0] }
const realFetch = global.fetch
const encoder = new TextEncoder()
// Written as escapes so the source stays ASCII
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)
const E_ACUTE = String.fromCharCode(0xe9)
const CLAPPER = String.fromCodePoint(0x1f3ac)

/** A body that sends `chunks` (strings or bytes) one read at a time; `error` errors it after them; `stall` never ends it. */
function stream(chunks, { error = null, stall = false } = {}) {
  let i = 0
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        const chunk = chunks[i++]
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      } else if (error) {
        controller.error(error)
      } else if (!stall) {
        controller.close()
      }
    },
  })
}

const respond = (status, body, headers = {}) => new Response(body, { status, headers })
const ndjson = (...lines) => lines.map((line) => `${typeof line === 'string' ? line : JSON.stringify(line)}\n`)
const ENTRY_HEADERS = { 'X-Manifest-ETag': 'W/"tv-manifest-1"', 'X-Library-ETag': 'W/"tv-1"' }

let fetchMock
beforeEach(() => {
  fetchMock = jest.fn()
  global.fetch = fetchMock
  for (const method of ['warn', 'error']) jest.spyOn(console, method).mockImplementation(() => {})
})
afterEach(() => {
  global.fetch = realFetch
  jest.restoreAllMocks()
})

const tvManifest = (titles, extra = {}) => JSON.stringify({ format: 2, kind: 'tv', version: 1.0001, titles, ...extra })

describe('fetchManifest', () => {
  it('reads a format-2 manifest into Maps, keeping every folder name but the list version key', async () => {
    const body =
      '{"format":2,"kind":"tv","version":1.0001,"titles":{' +
      `"Show":{"hash":"${H1}","seasons":{"Season 1":["S01E01","S01E02"],"Specials":[]}},` +
      `"__proto__":{"hash":"${H2}","seasons":{}},"constructor":{"hash":"${H1}","seasons":{}},` +
      `"2012":{"hash":"${H1}","seasons":{}},"version":{"hash":"${H1}","seasons":{}}}}`
    fetchMock.mockResolvedValue(respond(200, body, { ETag: 'W/"tv-manifest-1"' }))

    const result = await fetchManifest(SERVER, 'tv')

    expect(result).toMatchObject({ ok: true, status: 200, received: body.length, parsed: body.length })
    const { manifest } = result
    expect(manifest).toMatchObject({ etag: 'W/"tv-manifest-1"', format: 2, version: 1.0001 })
    expect([...manifest.titles.keys()].sort()).toEqual(['2012', 'Show', '__proto__', 'constructor'])
    expect(manifest.titles.get('Show').hash).toBe(H1)
    expect(Object.fromEntries(manifest.titles.get('Show').seasons)).toEqual({ 'Season 1': ['S01E01', 'S01E02'], Specials: [] })
    expect(manifest.titles.get('__proto__').hash).toBe(H2)
    expect(fetchMock).toHaveBeenCalledWith('http://files.test/media/tv/manifest', expect.objectContaining({
      headers: { 'x-webhook-id': 'hook-id' },
    }))
  })

  it('asks conditionally with the held ETag and Cache-Control: max-age=0, and takes a 304 as an answer', async () => {
    fetchMock.mockResolvedValue(respond(304, null))
    const result = await fetchManifest(SERVER, 'movies', { etag: 'W/"movies-manifest-9"' })
    expect(result).toEqual({ ok: true, status: 304, etag: 'W/"movies-manifest-9"', received: 0, parsed: 0 })
    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      'x-webhook-id': 'hook-id',
      'If-None-Match': 'W/"movies-manifest-9"',
      'Cache-Control': 'max-age=0',
    })
  })

  it.each([
    ['a 404 (no manifest route)', () => respond(404, 'Not found'), /404/],
    ['manifest format 1', () => respond(200, tvManifest({}, { format: 1 }), { ETag: 'W/"x"' }), /format 1/],
    ['no format', () => respond(200, '{"kind":"tv","version":1,"titles":{}}', { ETag: 'W/"x"' }), /format null/],
  ])('is a contract failure, not retried, on %s', async (_name, response, message) => {
    fetchMock.mockImplementation(async () => response())
    const result = await fetchManifest(SERVER, 'tv', NO_WAIT)
    expect(result).toMatchObject({ ok: false, contract: true })
    expect(result.error).toMatch(message)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 500 (a show the processor could not describe) and then reports the server did not answer', async () => {
    fetchMock.mockImplementation(async () => respond(500, 'Internal server error'))
    const result = await fetchManifest(SERVER, 'tv', NO_WAIT)
    expect(result).toMatchObject({ ok: false, contract: false })
    expect(result.error).toMatch(/HTTP 500/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it.each([
    ['not JSON', '{"format":2,'],
    ['another kind', JSON.stringify({ format: 2, kind: 'movies', version: 1, titles: {} })],
    ['no titles', JSON.stringify({ format: 2, kind: 'tv', version: 1 })],
    ['a short hash', tvManifest({ Show: { hash: 'abc', seasons: {} } })],
    ['a TV title without seasons', tvManifest({ Show: { hash: H1 } })],
    ['episode keys that are not strings', tvManifest({ Show: { hash: H1, seasons: { 'Season 1': [1] } } })],
  ])('fails on a manifest with %s', async (_name, body) => {
    fetchMock.mockImplementation(async () => respond(200, body, { ETag: 'W/"x"' }))
    const result = await fetchManifest(SERVER, 'tv', NO_WAIT)
    expect(result).toMatchObject({ ok: false, contract: false })
  })

  it('fails on a manifest without an ETag, and on a 304 to a request that was not conditional', async () => {
    fetchMock.mockImplementation(async () => respond(200, tvManifest({})))
    expect(await fetchManifest(SERVER, 'tv', NO_WAIT)).toMatchObject({ ok: false })
    fetchMock.mockImplementation(async () => respond(304, null))
    expect(await fetchManifest(SERVER, 'tv', NO_WAIT)).toMatchObject({ ok: false })
  })

  it('gives up on a body that stalls, at the idle deadline', async () => {
    fetchMock.mockImplementation(async () => respond(200, stream(['{"format":2,'], { stall: true }), { ETag: 'W/"x"' }))
    const result = await fetchManifest(SERVER, 'tv', { ...NO_WAIT, timeouts: { headersMs: 1000, idleMs: 30, totalMs: 1000 } })
    expect(result).toMatchObject({ ok: false, contract: false })
    expect(result.error).toMatch(/no bytes for 30 ms/)
  })

  it('logs a list version other than the expected one, as the payload fetch does, and still reads the manifest', async () => {
    fetchMock.mockResolvedValue(respond(200, JSON.stringify({ format: 2, kind: 'movies', version: 2, titles: { Film: { hash: H1 } } }), { ETag: 'W/"m"' }))
    const result = await fetchManifest(SERVER, 'movies')
    expect(result.manifest.titles.get('Film')).toEqual({ hash: H1 })
    expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/version mismatch: 2 not equal to expected 1.0001/))
  })
})

describe('parseManifest', () => {
  it('reads movie titles without seasons', () => {
    const bytes = encoder.encode(JSON.stringify({ format: 2, kind: 'movies', version: 1.0001, titles: { Film: { hash: H1 } } }))
    expect(parseManifest(bytes, 'movies', 'W/"m"').titles).toEqual(new Map([['Film', { hash: H1 }]]))
  })
})

describe('fetchPhaseBudgetMs', () => {
  it('is 240 s under the default 10-minute watchdog, and never more than half of a shorter one', () => {
    expect(fetchPhaseBudgetMs(600_000)).toBe(240_000)
    expect(fetchPhaseBudgetMs(60_000)).toBe(30_000)
    expect(fetchPhaseBudgetMs(10 * 60 * 60 * 1000)).toBe(240_000)
  })
})

describe('fetchEntries', () => {
  const deadline = () => new AbortController().signal
  const entries = (chunks, headers = ENTRY_HEADERS) => respond(200, stream(chunks), headers)
  const film = { urls: { mp4: '/f.mkv' } }

  it('posts the titles asked for, once each, and reads one line per title closed by the end line', async () => {
    const body = ndjson({ title: 'Film', hash: H1, entry: film }, { title: 'Gone', missing: true }, { end: true, count: 2 })
    fetchMock.mockResolvedValue(entries(body))

    const result = await fetchEntries(SERVER, 'movies', { titles: ['Film', 'Gone', 'Film'] }, { deadline: deadline() })

    expect(result).toMatchObject({ ok: true, manifestETag: 'W/"tv-manifest-1"', libraryETag: 'W/"tv-1"' })
    expect(result.lines).toEqual(new Map([['Film', { hash: H1, entry: film }], ['Gone', { missing: true }]]))
    const bytes = body.join('').length
    expect(result.received).toBe(bytes)
    // (the newlines are received, not parsed)
    expect(result.parsed).toBe(bytes - body.length)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://files.test/media/movies/entries')
    expect(init).toMatchObject({ method: 'POST', body: '{"titles":["Film","Gone"]}' })
    expect(init.headers).toMatchObject({ 'x-webhook-id': 'hook-id', 'Content-Type': 'application/json' })
  })

  it('asks for all with {all: true} and takes whatever titles come, once each', async () => {
    fetchMock.mockResolvedValue(entries(ndjson({ title: 'A', hash: H1, entry: {} }, { title: 'B', hash: H2, entry: {} }, { end: true, count: 2 })))
    const result = await fetchEntries(SERVER, 'tv', { all: true }, { deadline: deadline() })
    expect([...result.lines.keys()]).toEqual(['A', 'B'])
    expect(fetchMock.mock.calls[0][1].body).toBe('{"all":true}')
  })

  it('splits on 0x0A only: raw U+2028 and U+2029 inside a string stay in the entry', async () => {
    const line = `{"title":"Film","hash":"${H1}","entry":{"overview":"one${LS}two${PS}three"}}\n`
    expect(line).toContain(LS)
    fetchMock.mockResolvedValue(entries([line, '{"end":true,"count":1}\n']))
    const result = await fetchEntries(SERVER, 'movies', { titles: ['Film'] }, { deadline: deadline() })
    expect(result.lines.get('Film').entry.overview).toBe(`one${LS}two${PS}three`)
  })

  it('reassembles a line and multi-byte characters split across chunks', async () => {
    const name = `Am${E_ACUTE}lie ${CLAPPER}`
    const bytes = encoder.encode(`{"title":"${name}","hash":"${H1}","entry":{"t":"${E_ACUTE}${CLAPPER}"}}\n{"end":true,"count":1}\n`)
    const cuts = [3, 16, 17, 18, 19, 20, 40, 41, 42, 43, 44, bytes.length - 5]
    const chunks = [0, ...cuts].map((start, i) => bytes.subarray(start, cuts[i] ?? bytes.length))
    fetchMock.mockResolvedValue(entries(chunks))
    const result = await fetchEntries(SERVER, 'movies', { titles: [name] }, { deadline: deadline() })
    expect(result.lines.get(name).entry).toEqual({ t: `${E_ACUTE}${CLAPPER}` })
  })

  const filmLine = { title: 'Film', hash: H1, entry: {} }
  it.each([
    ['no end line (cut off)', ndjson(filmLine)],
    ['a body that ends inside a line', [...ndjson(filmLine), '{"end":true,"count":1}']],
    ['an end line with the wrong count', ndjson(filmLine, { end: true, count: 2 })],
    ['a line after the end line', ndjson(filmLine, { end: true, count: 1 }, { title: 'X', missing: true })],
    ['a title twice', ndjson(filmLine, filmLine, { end: true, count: 2 })],
    ['a title not asked for', ndjson(filmLine, { title: 'Other', hash: H1, entry: {} }, { end: true, count: 2 })],
    ['no line for a title asked for', ndjson({ end: true, count: 0 })],
    ['a line that is not JSON', ['{"title":"Film",\n', '{"end":true,"count":1}\n']],
    ['an empty line', ['\n', ...ndjson(filmLine, { end: true, count: 1 })]],
    ['a short hash', ndjson({ title: 'Film', hash: 'abc', entry: {} }, { end: true, count: 1 })],
    ['an entry that is not an object', ndjson({ title: 'Film', hash: H1, entry: [] }, { end: true, count: 1 })],
    ['an unknown line shape', ndjson({ ...filmLine, extra: 1 }, { end: true, count: 1 })],
    ['invalid UTF-8', [new Uint8Array([0x7b, 0xff, 0x7d, 0x0a]), '{"end":true,"count":0}\n']],
  ])('fails, keeping no line, on %s', async (_name, body) => {
    fetchMock.mockImplementation(async () => entries(body))
    const result = await fetchEntries(SERVER, 'movies', { titles: ['Film'] }, { deadline: deadline(), ...NO_WAIT })
    expect(result.ok).toBe(false)
    expect(result).not.toHaveProperty('lines')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('fails on a body-stream error, and keeps the lines of a later complete attempt only', async () => {
    fetchMock
      .mockResolvedValueOnce(respond(200, stream(ndjson({ title: 'Film', hash: H1, entry: { v: 1 } }), { error: new Error('socket hang up') }), ENTRY_HEADERS))
      .mockResolvedValueOnce(entries(ndjson({ title: 'Film', hash: H2, entry: { v: 2 } }, { end: true, count: 1 })))
    const result = await fetchEntries(SERVER, 'movies', { titles: ['Film'] }, { deadline: deadline(), ...NO_WAIT })
    expect(result.lines.get('Film')).toEqual({ hash: H2, entry: { v: 2 } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails on a response without X-Manifest-ETag', async () => {
    fetchMock.mockImplementation(async () => entries(ndjson({ end: true, count: 0 }), {}))
    const result = await fetchEntries(SERVER, 'movies', { titles: [] }, { deadline: deadline(), ...NO_WAIT })
    expect(result).toMatchObject({ ok: false })
    expect(result.error).toMatch(/X-Manifest-ETag/)
  })

  it('does not retry a 400, and retries a 503', async () => {
    fetchMock.mockImplementation(async () => respond(400, '{}'))
    expect(await fetchEntries(SERVER, 'tv', { all: true }, { deadline: deadline(), ...NO_WAIT })).toMatchObject({ ok: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => respond(503, 'busy'))
    expect(await fetchEntries(SERVER, 'tv', { all: true }, { deadline: deadline(), ...NO_WAIT })).toMatchObject({ ok: false })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives up on a body that stalls, at the idle deadline', async () => {
    fetchMock.mockImplementation(async () => respond(200, stream(['{"title":'], { stall: true }), ENTRY_HEADERS))
    const result = await fetchEntries(SERVER, 'tv', { all: true }, {
      deadline: deadline(), ...NO_WAIT, timeouts: { headersMs: 1000, idleMs: 30, totalMs: 1000 },
    })
    expect(result.error).toMatch(/no bytes for 30 ms/)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('stops at the fetch-phase deadline, mid-body and without another attempt', async () => {
    const phase = new AbortController()
    fetchMock.mockImplementation(async () => {
      setTimeout(() => phase.abort(), 20)
      return respond(200, stream(['{"title":'], { stall: true }), ENTRY_HEADERS)
    })
    const result = await fetchEntries(SERVER, 'tv', { all: true }, { deadline: phase.signal, ...NO_WAIT })
    expect(result.error).toMatch(/fetch phase deadline/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reads a gzip, chunked NDJSON body from a real server', async () => {
    global.fetch = realFetch
    const lines = ndjson({ title: 'Show', hash: H1, entry: { seasons: { 'Season 1': {} }, overview: `x${LS}y` } }, { end: true, count: 1 })
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Content-Encoding': 'gzip', ...ENTRY_HEADERS })
      const gzip = zlib.createGzip()
      gzip.pipe(res)
      for (const line of lines) gzip.write(line)
      gzip.end()
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    mockBase = `http://127.0.0.1:${server.address().port}`
    try {
      const result = await fetchEntries(SERVER, 'tv', { titles: ['Show'] }, { deadline: deadline() })
      expect(result).toMatchObject({ ok: true, manifestETag: 'W/"tv-manifest-1"' })
      expect(result.lines.get('Show').entry.overview).toBe(`x${LS}y`)
    } finally {
      mockBase = 'http://files.test'
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
