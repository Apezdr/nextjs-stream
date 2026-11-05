/**
 * @jest-environment node
 *
 * src/lib/redisClient.js: Redis is optional and nothing may wait on it. A
 * connect that fails, or a call slower than its budget, answers the fallback
 * and keeps Redis off for a cool-down instead of being retried on every call.
 * (Before, a refused connection was retried forever and every httpGet hung.)
 */

let mockClients
let mockBehaviour
jest.mock('redis', () => ({
  createClient: jest.fn((options) => {
    const handlers = {}
    const client = {
      options,
      isReady: false,
      on: (event, handler) => {
        handlers[event] = handler
        return client
      },
      emit: (event, value) => handlers[event]?.(value),
      connect: jest.fn(async () => {
        if (mockBehaviour.connect === 'refuse') throw new Error('connect ECONNREFUSED')
        client.isReady = true
      }),
      get: jest.fn(async (key) => mockBehaviour.get(key)),
      destroy: jest.fn(() => {
        client.isReady = false
      }),
    }
    mockClients.push(client)
    return client
  }),
}))
jest.mock('@src/lib/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }))

const ENV = { ...process.env }

function load() {
  let mod
  jest.isolateModules(() => {
    mod = require('@src/lib/redisClient')
  })
  return mod
}

beforeEach(() => {
  mockClients = []
  mockBehaviour = { connect: 'ok', get: async () => 'value' }
  process.env = { ...ENV, REDIS_HOST: 'redis.test', REDIS_PORT: '6379' }
})
afterEach(() => {
  process.env = ENV
  jest.useRealTimers()
})

it('without REDIS_HOST/REDIS_PORT answers the fallback and never builds a client', async () => {
  delete process.env.REDIS_HOST
  const { withRedis, isRedisConfigured } = load()
  expect(isRedisConfigured()).toBe(false)
  await expect(withRedis((redis) => redis.get('k'), { fallback: 'none' })).resolves.toBe('none')
  expect(mockClients).toHaveLength(0)
})

it('connects once, without the client retrying on its own or queueing commands while down', async () => {
  const { withRedis } = load()
  await expect(withRedis((redis) => redis.get('k'))).resolves.toBe('value')
  await expect(withRedis((redis) => redis.get('k'))).resolves.toBe('value')
  expect(mockClients).toHaveLength(1)
  expect(mockClients[0].options.socket).toMatchObject({ reconnectStrategy: false })
  expect(mockClients[0].options.socket.connectTimeout).toBeGreaterThan(0)
  expect(mockClients[0].options.disableOfflineQueue).toBe(true)
})

it('a refused connection answers the fallback, and the cool-down keeps the next calls from trying again', async () => {
  mockBehaviour.connect = 'refuse'
  const { withRedis } = load()
  await expect(withRedis((redis) => redis.get('k'), { fallback: 'cached-nothing' })).resolves.toBe('cached-nothing')
  await expect(withRedis((redis) => redis.get('k'), { fallback: 'cached-nothing' })).resolves.toBe('cached-nothing')
  expect(mockClients).toHaveLength(1)
  expect(mockClients[0].destroy).toHaveBeenCalled()
})

it('after the cool-down, a fresh client is tried', async () => {
  jest.useFakeTimers({ now: 1_000_000 })
  mockBehaviour.connect = 'refuse'
  const { withRedis } = load()
  await withRedis((redis) => redis.get('k'))
  mockBehaviour.connect = 'ok'
  jest.setSystemTime(1_000_000 + 31_000)
  await expect(withRedis((redis) => redis.get('k'))).resolves.toBe('value')
  expect(mockClients).toHaveLength(2)
})

it('a call slower than its budget answers the fallback; its late failure is no unhandled rejection', async () => {
  const unhandled = jest.fn()
  process.on('unhandledRejection', unhandled)
  let fail
  mockBehaviour.get = () =>
    new Promise((_, reject) => {
      fail = () => reject(new Error('late'))
    })
  const { withRedis } = load()
  await expect(withRedis((redis) => redis.get('k'), { budgetMs: 20, fallback: 'gave up' })).resolves.toBe('gave up')
  fail()
  await new Promise((resolve) => setTimeout(resolve, 10))
  process.off('unhandledRejection', unhandled)
  expect(unhandled).not.toHaveBeenCalled()
  // ... and the next call doesn't wait out the budget again
  mockBehaviour.get = async () => 'value'
  await expect(withRedis((redis) => redis.get('k'), { fallback: 'off' })).resolves.toBe('off')
})

it('a failing command answers the fallback', async () => {
  mockBehaviour.get = async () => {
    throw new Error('WRONGTYPE')
  }
  const { withRedis } = load()
  await expect(withRedis((redis) => redis.get('k'), { fallback: null })).resolves.toBeNull()
})

it('a dropped connection takes the client out and starts the cool-down', async () => {
  const { withRedis } = load()
  await withRedis((redis) => redis.get('k'))
  mockClients[0].emit('error', new Error('Socket closed unexpectedly'))
  await expect(withRedis((redis) => redis.get('k'), { fallback: 'off' })).resolves.toBe('off')
  expect(mockClients[0].destroy).toHaveBeenCalled()
})

it('setCache refuses an entry without a TTL: every entry expires', async () => {
  let setCache
  jest.isolateModules(() => {
    ;({ setCache } = require('@src/lib/cache'))
  })
  await expect(setCache('k', { a: 1 }, null, null, 0)).rejects.toThrow('positive ttl')
})
