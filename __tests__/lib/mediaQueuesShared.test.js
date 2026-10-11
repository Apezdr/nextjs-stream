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

describe('refreshMediaQueue (a card refresh button)', () => {
  let refreshMediaQueue
  beforeEach(() => {
    ;({ refreshMediaQueue } = require('@src/lib/mediaQueues/getMediaQueues'))
  })

  test('asks only that service, even inside the shared window', async () => {
    await getMediaQueues()
    await flush()
    mockLoad.mockClear()

    const { queues } = await refreshMediaQueue('radarr')

    expect(mockLoad.mock.calls).toEqual([['radarr']])
    expect(queues).toEqual([okResult('radarr')])
  })

  test('its answer becomes the shared one, so the next poll cannot hand back an older result', async () => {
    await getMediaQueues()
    await flush()
    const fresh = { ...okResult('radarr'), health: 'active', inProgress: 1 }
    mockLoad.mockImplementation(async (service) => (service === 'radarr' ? fresh : okResult(service)))

    await refreshMediaQueue('radarr')
    await flush()
    mockLoad.mockClear()
    const { queues } = await getMediaQueues()

    expect(mockLoad).not.toHaveBeenCalled()
    expect(queues[1]).toBe(fresh)
  })

  test('does not join a poll already in flight: that request started before the click', async () => {
    let releasePoll
    mockLoad.mockImplementationOnce(() => new Promise((resolve) => (releasePoll = () => resolve({ ...okResult('sabnzbd'), health: 'warning' }))))
    const poll = getMediaQueues()

    const refreshed = refreshMediaQueue('sabnzbd')
    expect(mockLoad.mock.calls.filter(([service]) => service === 'sabnzbd')).toHaveLength(2)
    await expect(refreshed).resolves.toEqual({ queues: [okResult('sabnzbd')] })

    releasePoll()
    await poll
  })

  test('joins a refresh already in flight, so repeated clicks cost one request', async () => {
    const resolvers = {}
    mockLoad.mockImplementation((service) => new Promise((resolve) => (resolvers[service] = () => resolve(okResult(service)))))

    const first = refreshMediaQueue('tdarr')
    const second = refreshMediaQueue('tdarr')
    // A poll arriving meanwhile joins it too.
    const poll = getMediaQueues()

    expect(mockLoad.mock.calls.filter(([service]) => service === 'tdarr')).toHaveLength(1)
    Object.values(resolvers).forEach((resolve) => resolve())
    const [a, b, polled] = await Promise.all([first, second, poll])
    expect(a.queues[0]).toBe(b.queues[0])
    expect(polled.queues[3]).toBe(a.queues[0])
  })
})
