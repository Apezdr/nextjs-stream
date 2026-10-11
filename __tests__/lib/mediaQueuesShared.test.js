/**
 * @jest-environment node
 *
 * Every open admin tab polls the media queues. getMediaQueues shares one
 * answer per service for SHARED_RESULT_MS and joins requests still in flight,
 * so N tabs cost each service one poll.
 */

const mockLoad = jest.fn()
jest.mock('@src/lib/mediaQueues/upstream', () => ({ loadMediaQueue: (...args) => mockLoad(...args) }))

const okResult = (service) => ({ service, state: 'ok', health: 'idle', inProgress: 0, itemsTotal: 0, items: [], counts: [], notices: [] })

let getMediaQueues
let SHARED_RESULT_MS
let now

beforeEach(() => {
  jest.resetModules()
  mockLoad.mockReset()
  mockLoad.mockImplementation(async (service) => okResult(service))
  now = 1_000_000
  jest.spyOn(Date, 'now').mockImplementation(() => now)
  ;({ getMediaQueues, SHARED_RESULT_MS } = require('@src/lib/mediaQueues/getMediaQueues'))
})

afterEach(() => {
  jest.restoreAllMocks()
})

const flush = () => new Promise((resolve) => setImmediate(resolve))

test('every service, in display order', async () => {
  const { queues } = await getMediaQueues()
  expect(queues.map((queue) => queue.service)).toEqual(['sabnzbd', 'radarr', 'sonarr', 'tdarr'])
  expect(mockLoad).toHaveBeenCalledTimes(4)
})

test('concurrent callers share one upstream request per service', async () => {
  await Promise.all([getMediaQueues(), getMediaQueues(), getMediaQueues()])
  expect(mockLoad).toHaveBeenCalledTimes(4)
})

test('an answer is reused inside the window and refreshed after it', async () => {
  await getMediaQueues()
  await flush()

  now += SHARED_RESULT_MS - 1
  await getMediaQueues()
  expect(mockLoad).toHaveBeenCalledTimes(4)

  now += 1
  await getMediaQueues()
  expect(mockLoad).toHaveBeenCalledTimes(8)
})

test('a request still in flight past the window is joined, not repeated', async () => {
  let release
  mockLoad.mockImplementation(
    (service) =>
      new Promise((resolve) => {
        if (service === 'tdarr') release = () => resolve(okResult(service))
        else resolve(okResult(service))
      })
  )

  const first = getMediaQueues()
  await flush()
  now += SHARED_RESULT_MS * 3
  const second = getMediaQueues()
  // The three fast services settled and their window passed, so they reload;
  // the slow one is still in flight and is joined.
  expect(mockLoad).toHaveBeenCalledTimes(7)
  expect(mockLoad.mock.calls.filter(([service]) => service === 'tdarr')).toHaveLength(1)

  release()
  const [a, b] = await Promise.all([first, second])
  expect(a.queues[3]).toBe(b.queues[3])
})
