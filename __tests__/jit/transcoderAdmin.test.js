/**
 * The app's transcoder admin client: which transcoder each file server owns, which key goes
 * where, and how every refusal is reported.
 */

const KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5'
const KEY2 = 'zyxwvutsrqponmlkjihgfedcba9876'

let mockGroups = []
let mockServers = []
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => ({
        aggregate: () => ({ toArray: async () => mockGroups.filter((g) => g.collection === name).map(({ _id }) => ({ _id })) }),
      }),
    }),
  }),
}))
jest.mock('@src/utils/config', () => ({ getAllServers: () => mockServers }))

import {
  getTranscoderTargets,
  fetchTargetSessions,
  getTranscoderLoadForOrigin,
  _resetTranscoderAdminForTests,
} from '@src/utils/jit/transcoderAdmin'

const okBody = (queued = 0) => ({ schema: 1, version: '0.1.0', features: [], load: { queued }, capacity: {}, sessions: [], gpu: [] })
const respond = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })

const ENV_KEYS = ['WEBHOOK_ID', 'WEBHOOK_ID_2', 'JIT_TRANSCODER_WEBHOOK_ID', 'JIT_TRANSCODER_WEBHOOK_ID_2', 'JIT_TRANSCODER_INTERNAL_URL', 'JIT_TRANSCODER_INTERNAL_URL_2']
const savedEnv = {}
const origFetch = global.fetch

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k]
    delete process.env[k]
  }
  _resetTranscoderAdminForTests()
  mockServers = [{ id: 'default', displayName: 'Home' }, { id: 'server2' }]
  mockGroups = [
    { collection: 'FlatMovies', _id: { server: 'default', base: 'https://transcoder.home.example' } },
    { collection: 'FlatEpisodes', _id: { server: 'default', base: 'https://transcoder.home.example' } },
    { collection: 'FlatEpisodes', _id: { server: 'server2', base: 'https://gpu.friend.example/jit' } },
  ]
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  global.fetch = origFetch
})

describe('getTranscoderTargets', () => {
  test("each server's transcoder comes from its own titles; a key falls back to the server's webhook key", async () => {
    process.env.WEBHOOK_ID = KEY
    const [home, friend] = await getTranscoderTargets()
    expect(home).toMatchObject({
      serverId: 'default',
      displayName: 'Home',
      publicBases: ['https://transcoder.home.example'],
      endpoints: ['https://transcoder.home.example'],
      keyVariable: 'WEBHOOK_ID',
      problem: null,
    })
    // No key of its own, and never default's: nothing to call.
    expect(friend.endpoints).toEqual([])
    expect(friend.problem).toMatch(/JIT_TRANSCODER_WEBHOOK_ID_2.*WEBHOOK_ID_2/)
  })

  test('an internal URL replaces the public base for calls but keeps the mapping', async () => {
    process.env.WEBHOOK_ID = KEY
    process.env.JIT_TRANSCODER_INTERNAL_URL = 'http://jit-transcoder:3232/'
    const [home] = await getTranscoderTargets()
    expect(home.endpoints).toEqual(['http://jit-transcoder:3232'])
    expect(home.publicBases).toEqual(['https://transcoder.home.example'])
  })

  test('a server with no transcoder URL anywhere says so', async () => {
    process.env.WEBHOOK_ID = KEY
    mockGroups = []
    const [home] = await getTranscoderTargets()
    expect(home.endpoints).toEqual([])
    expect(home.problem).toMatch(/no title on this server carries a transcoder URL.*JIT_TRANSCODER_INTERNAL_URL/)
  })

  test('targets never carry a key', async () => {
    process.env.WEBHOOK_ID = KEY
    process.env.JIT_TRANSCODER_WEBHOOK_ID_2 = KEY2
    const json = JSON.stringify(await getTranscoderTargets())
    expect(json).not.toContain(KEY)
    expect(json).not.toContain(KEY2)
  })
})

describe('fetchTargetSessions', () => {
  test('sends the bearer key to the target endpoint only', async () => {
    process.env.WEBHOOK_ID = KEY
    process.env.JIT_TRANSCODER_WEBHOOK_ID_2 = KEY2
    global.fetch = jest.fn(async () => respond(200, okBody()))
    const [home, friend] = await getTranscoderTargets()
    const res = await fetchTargetSessions(friend, 'https://gpu.friend.example/jit')
    expect(res.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = global.fetch.mock.calls[0]
    expect(url).toBe('https://gpu.friend.example/jit/admin/sessions')
    expect(init.headers).toEqual({ Authorization: `Bearer ${KEY2}` })
    // One server's key never goes to another server's transcoder.
    expect(() => fetchTargetSessions(friend, home.endpoints[0])).toThrow(/not an endpoint/)
  })

  test('maps every refusal to a reason and a detail that names what to fix', async () => {
    process.env.WEBHOOK_ID = KEY
    const cases = [
      [respond(401, { reason: 'unauthorized' }), 'unauthorized', /WEBHOOK_ID/],
      [respond(503, { reason: 'no-admin-key', error: 'WEBHOOK_ID_1 is not usable as an admin key' }), 'no-admin-key', /WEBHOOK_ID_1/],
      [respond(404, null), 'no-admin-api', /predates the admin API/],
      [respond(502, null), 'http-502', /502/],
      [respond(200, { schema: 2 }), 'unexpected-schema', /schema 2/],
    ]
    for (const [answer, reason, detail] of cases) {
      _resetTranscoderAdminForTests()
      global.fetch = jest.fn(async () => answer)
      const [home] = await getTranscoderTargets()
      const res = await fetchTargetSessions(home, home.endpoints[0])
      expect(res).toMatchObject({ ok: false, reason })
      expect(res.detail).toMatch(detail)
      expect(res.detail).not.toContain(KEY)
    }
  })

  test('a timeout and an unreachable host are reported, not thrown', async () => {
    process.env.WEBHOOK_ID = KEY
    const [home] = await getTranscoderTargets()
    global.fetch = jest.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' })
    })
    expect(await fetchTargetSessions(home, home.endpoints[0])).toMatchObject({ ok: false, reason: 'timeout' })
    _resetTranscoderAdminForTests()
    global.fetch = jest.fn(async () => {
      throw new Error('ECONNREFUSED')
    })
    const [again] = await getTranscoderTargets()
    expect(await fetchTargetSessions(again, again.endpoints[0])).toMatchObject({ ok: false, reason: 'unreachable' })
  })

  test('concurrent and back-to-back callers share one request', async () => {
    process.env.WEBHOOK_ID = KEY
    global.fetch = jest.fn(async () => respond(200, okBody()))
    const [home] = await getTranscoderTargets()
    await Promise.all([fetchTargetSessions(home, home.endpoints[0]), fetchTargetSessions(home, home.endpoints[0])])
    await fetchTargetSessions(home, home.endpoints[0])
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('getTranscoderLoadForOrigin', () => {
  test("reads the queue of the server whose titles use that origin", async () => {
    process.env.WEBHOOK_ID = KEY
    global.fetch = jest.fn(async () => respond(200, okBody(3)))
    expect(await getTranscoderLoadForOrigin('https://transcoder.home.example')).toEqual({ ok: true, queued: 3 })
  })

  test('unknown is never zero', async () => {
    process.env.WEBHOOK_ID = KEY
    global.fetch = jest.fn(async () => respond(200, { ...okBody(), load: {} }))
    expect(await getTranscoderLoadForOrigin('https://transcoder.home.example')).toMatchObject({ ok: false })
    expect((await getTranscoderLoadForOrigin('https://elsewhere.example')).detail).toMatch(/no file server's titles use/)
    delete process.env.WEBHOOK_ID
    _resetTranscoderAdminForTests()
    expect((await getTranscoderLoadForOrigin('https://transcoder.home.example')).detail).toMatch(/JIT_TRANSCODER_WEBHOOK_ID/)
  })
})
