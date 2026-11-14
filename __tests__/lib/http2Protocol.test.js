/**
 * @jest-environment node
 *
 * The demo once said "Can't reach Default" for as long as its container ran,
 * while the file server answered every request made to it by hand. The status
 * check goes out over HTTP/2, and before its first request the client asks
 * the host which protocol it speaks. That probe timed out during a busy
 * start-up, and http2-wrapper remembered the non-answer as "not HTTP/2" for
 * the life of the process: every later request was written as HTTP/1.1 on a
 * connection that had negotiated HTTP/2, and failed.
 *
 * http2Protocol.ts gives the library a memory that keeps only a protocol a
 * completed handshake negotiated. These tests run the library's own lookup
 * (http2-wrapper and resolve-alpn, unmocked) over a host that is played by
 * hand, so they also say whether an upgrade still behaves as this relies on.
 */
const { EventEmitter } = require('node:events')
const http2wrapper = require('http2-wrapper')
const { NegotiatedProtocols, createProtocolResolver, http2Request } = require('@src/lib/http2Protocol')

// A host whose handshakes go as the test says: each connection either
// completes and negotiates a protocol, or goes quiet until the client's
// timeout fires. `asked` lists how each connection went, in order.
function fakeHost(...handshakes) {
  const asked = []
  const connect = (_options, onSecureConnect) => {
    const outcome = handshakes.shift()
    asked.push(outcome)
    const socket = new EventEmitter()
    socket.alpnProtocol = false // nothing is negotiated until a handshake completes
    socket.destroy = jest.fn()
    setImmediate(() => {
      if (outcome === 'timeout') return socket.emit('timeout')
      socket.alpnProtocol = outcome
      onSecureConnect()
    })
    return socket
  }
  return { connect, asked }
}

// What http2-wrapper hands the lookup for a request to https://files.example
const probe = () => ({ host: 'files.example', port: 443, ALPNProtocols: ['h2', 'http/1.1'], resolveSocket: true })

describe('the protocol a host speaks', () => {
  it('is asked once and remembered when the handshake completes', async () => {
    const host = fakeHost('h2')
    const resolve = createProtocolResolver(host.connect)

    expect(await resolve(probe())).toMatchObject({ alpnProtocol: 'h2' })
    expect(await resolve(probe())).toEqual({ alpnProtocol: 'h2' })
    expect(await resolve(probe())).toEqual({ alpnProtocol: 'h2' })
    expect(host.asked).toEqual(['h2'])
  })

  it('is not remembered from a probe that timed out: the next request asks again', async () => {
    const host = fakeHost('timeout', 'h2')
    const resolve = createProtocolResolver(host.connect)

    // The slow start-up: no handshake, so no protocol to read
    const slow = await resolve(probe())
    expect(slow.timeout).toBe(true)
    expect(slow.alpnProtocol).toBe(false)

    // The host is asked again, answers, and from then on is remembered
    expect(await resolve(probe())).toMatchObject({ alpnProtocol: 'h2' })
    expect(await resolve(probe())).toEqual({ alpnProtocol: 'h2' })
    expect(host.asked).toEqual(['timeout', 'h2'])
  })

  it('survives a run of slow handshakes', async () => {
    const host = fakeHost('timeout', 'timeout', 'timeout', 'http/1.1')
    const resolve = createProtocolResolver(host.connect)

    for (let i = 0; i < 3; i++) expect((await resolve(probe())).timeout).toBe(true)
    expect(await resolve(probe())).toMatchObject({ alpnProtocol: 'http/1.1' })
    expect(await resolve(probe())).toEqual({ alpnProtocol: 'http/1.1' })
    expect(host.asked).toEqual(['timeout', 'timeout', 'timeout', 'http/1.1'])
  })

  it('is remembered per host', async () => {
    const host = fakeHost('timeout', 'h2', 'h2')
    const resolve = createProtocolResolver(host.connect)

    await resolve(probe())
    expect(await resolve({ ...probe(), host: 'other.example' })).toMatchObject({ alpnProtocol: 'h2' })
    expect(await resolve(probe())).toMatchObject({ alpnProtocol: 'h2' })
    expect(host.asked).toEqual(['timeout', 'h2', 'h2'])
  })
})

describe('why the library’s own memory is not used', () => {
  it('remembers a timed-out probe as "not HTTP/2", and never asks the host again', async () => {
    const host = fakeHost('timeout', 'h2')
    // The library's lookup over a plain cache, as its default one behaves
    const stock = http2wrapper.auto.createResolveProtocol(new Map(), new Map(), host.connect)

    expect((await stock(probe())).timeout).toBe(true)
    // If this starts failing after an upgrade, http2-wrapper has stopped
    // storing a failed probe, and http2Protocol.ts may no longer be needed
    expect(await stock(probe())).toEqual({ alpnProtocol: false })
    expect(await stock(probe())).toEqual({ alpnProtocol: false })
    expect(host.asked).toEqual(['timeout'])
  })
})

describe('NegotiatedProtocols', () => {
  it('keeps a negotiated protocol and nothing else', () => {
    const remembered = new NegotiatedProtocols()
    remembered.set('files.example:443:h2,http/1.1', false)
    remembered.set('files.example:443:h2,http/1.1', undefined)
    remembered.set('files.example:443:h2,http/1.1', '')
    expect(remembered.size).toBe(0)

    remembered.set('files.example:443:h2,http/1.1', 'h2')
    expect(remembered.get('files.example:443:h2,http/1.1')).toBe('h2')
    // A later failed probe doesn't erase what a handshake said
    remembered.set('files.example:443:h2,http/1.1', false)
    expect(remembered.get('files.example:443:h2,http/1.1')).toBe('h2')
  })

  it('holds a bounded number of hosts, letting the oldest go', () => {
    const remembered = new NegotiatedProtocols()
    for (let i = 0; i < 101; i++) remembered.set(`host-${i}:443:h2,http/1.1`, 'h2')

    expect(remembered.size).toBe(100)
    expect(remembered.has('host-0:443:h2,http/1.1')).toBe(false)
    expect(remembered.has('host-100:443:h2,http/1.1')).toBe(true)
  })
})

describe('http2Request, got’s request function for an HTTP/2 call', () => {
  afterEach(() => jest.restoreAllMocks())

  it('is http2-wrapper’s own, told to use this lookup', async () => {
    const stockLookup = http2wrapper.auto.resolveProtocol
    const auto = jest.spyOn(http2wrapper, 'auto').mockResolvedValue('the request')
    const callback = () => {}

    await expect(http2Request('https://files.example/api/system-status', { headers: { 'x-webhook-id': 'w' } }, callback)).resolves.toBe('the request')

    const [url, options, passedCallback] = auto.mock.calls[0]
    expect(url).toBe('https://files.example/api/system-status')
    expect(options.headers).toEqual({ 'x-webhook-id': 'w' })
    expect(typeof options.resolveProtocol).toBe('function')
    expect(options.resolveProtocol).not.toBe(stockLookup)
    expect(passedCallback).toBe(callback)
  })

  it('relies on http2-wrapper asking the lookup it is given, before it connects', async () => {
    const lookup = jest.fn(async () => {
      throw new Error('asked')
    })

    await expect(http2wrapper.auto('https://files.example/api/system-status', { resolveProtocol: lookup })).rejects.toThrow('asked')
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ host: 'files.example', port: 443, ALPNProtocols: ['h2', 'http/1.1'] }))
  })
})
