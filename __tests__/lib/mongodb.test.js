/**
 * @jest-environment node
 *
 * lib/mongodb must recover once mongod answers, without a process restart.
 * 2026-10-14: a stack restart raced mongod's 64 s startup. The module kept
 * the boot-time connect() rejection and replayed it to every route handler
 * for 16 minutes, and better-auth's raw client sat on a closed topology.
 */

const mockConnect = jest.fn()
jest.mock('mongodb', () => ({
  MongoClient: class MongoClient {
    constructor(uri, options) {
      this.uri = uri
      this.options = options
    }
    connect() {
      return mockConnect(this)
    }
  },
}))

/** A fresh evaluation of the module, as a second bundle copy would be. */
function loadModule() {
  let mod
  jest.isolateModules(() => {
    mod = require('@src/lib/mongodb')
  })
  return mod
}

const refused = () =>
  Object.assign(new Error('connect ECONNREFUSED 172.19.0.7:27017'), {
    name: 'MongoServerSelectionError',
  })

async function settle(thenable) {
  try {
    return { value: await thenable }
  } catch (error) {
    return { error }
  }
}

beforeEach(() => {
  jest.useFakeTimers()
  delete globalThis._mongoClient
  delete globalThis._mongoSyncClient
  mockConnect.mockReset()
  mockConnect.mockImplementation((client) => Promise.resolve(client))
})

afterEach(() => {
  jest.useRealTimers()
})

test('an await after a refused connect gets a fresh attempt, not the stored rejection', async () => {
  mockConnect
    .mockImplementationOnce(() => Promise.reject(refused())) // boot
    .mockImplementationOnce(() => Promise.reject(refused())) // mongod still starting

  const { default: clientPromise, mongoClient } = loadModule()

  const first = await settle(clientPromise)
  expect(first.error.message).toMatch('ECONNREFUSED')

  const second = await settle(clientPromise)
  expect(second.error).toBeUndefined()
  expect(second.value).toBe(mongoClient)
  expect(mockConnect).toHaveBeenCalledTimes(3)
})

test('a refused boot connect is retried until it succeeds, with no acquisition', async () => {
  mockConnect
    .mockImplementationOnce(() => Promise.reject(refused())) // boot
    .mockImplementationOnce(() => Promise.reject(refused())) // first retry

  loadModule()
  await jest.advanceTimersByTimeAsync(0)
  expect(mockConnect).toHaveBeenCalledTimes(1)

  await jest.advanceTimersByTimeAsync(5_000)
  expect(mockConnect).toHaveBeenCalledTimes(2)

  await jest.advanceTimersByTimeAsync(5_000)
  expect(mockConnect).toHaveBeenCalledTimes(3)

  // Connected: the retries stop.
  await jest.advanceTimersByTimeAsync(60_000)
  expect(mockConnect).toHaveBeenCalledTimes(3)
})

test('both bundle copies share one request client and one sync client', async () => {
  const pages = loadModule()
  const routeHandlers = loadModule()

  expect(routeHandlers.mongoClient).toBe(pages.mongoClient)
  expect(await routeHandlers.default).toBe(pages.mongoClient)

  // The sync pool stays lazy until the sync path asks for it.
  expect(globalThis._mongoSyncClient).toBeUndefined()
  const syncClient = await pages.getSyncClientPromise()
  expect(await routeHandlers.getSyncClientPromise()).toBe(syncClient)
  expect(syncClient).not.toBe(pages.mongoClient)
  expect(syncClient.options.appName).toBe('nextjs-stream-sync')
})
