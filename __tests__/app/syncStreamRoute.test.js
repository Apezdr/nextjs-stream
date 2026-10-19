/**
 * @jest-environment node
 *
 * GET /api/authenticated/admin/sync-stream?operationId=<id>: the stream of one
 * sync operation. Its replay starts at that operation's first event (never at
 * an earlier tick's warm-up), and only that operation's completion ends it: a
 * webhook tick's completion passes through.
 */

jest.mock('@src/utils/routeAuth', () => ({ isAdmin: jest.fn(async () => ({ id: 'admin-1' })) }))

const { GET } = require('@src/app/api/authenticated/admin/sync-stream/route')
const { syncEventBus } = require('@src/utils/sync/core/events')
const { MediaType } = require('@src/utils/sync/core/types')

const warmup = (operationId) => syncEventBus.emitStarted('__sync_warmup__', MediaType.Movie, 'server-all', undefined, { operationId })
const complete = (operationId, outcome = 'completed') =>
  syncEventBus.emitComplete('__sync_complete__', MediaType.Movie, 'server-all', undefined, { operationId, outcome, summary: {} })
const serverStart = (serverId) => syncEventBus.emitStarted('__server_start__', MediaType.Movie, serverId, undefined, { total: 1 })

/** Open the stream; `frames()` reads what has arrived, `closed` says whether it ended. */
async function open(operationId) {
  const abort = new AbortController()
  const url = `http://127.0.0.1:3000/api/authenticated/admin/sync-stream${operationId ? `?operationId=${operationId}` : ''}`
  const response = await GET(new Request(url, { signal: abort.signal }))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const state = { text: '', closed: false }
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        state.closed = true
        return
      }
      state.text += decoder.decode(value)
    }
  })()
  const frames = () =>
    state.text
      .split('\n\n')
      .map((frame) => frame.split('\n').find((line) => line.startsWith('data: ')))
      .filter(Boolean)
      .map((line) => JSON.parse(line.slice(6)))
      .map((event) => [event.entityId, event.data?.operationId ?? event.serverId, event.replayed === true])
  return { frames, state, stop: () => abort.abort(), pump }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

beforeEach(() => {
  syncEventBus.clearHistory()
  jest.useRealTimers()
})

it('replays from the followed operation’s first event, not from a later warm-up', async () => {
  warmup('op-a')
  serverStart('default')
  complete('op-a')
  warmup('op-tick')

  const stream = await open('op-a')
  await tick()

  expect(stream.frames()).toEqual([
    ['__sync_warmup__', 'op-a', true],
    ['__server_start__', 'default', true],
    ['__sync_complete__', 'op-a', true],
    ['__sync_warmup__', 'op-tick', true],
  ])
  stream.stop()
})

it('replays nothing of an earlier tick while the followed operation has not started, and ends only with its completion', async () => {
  warmup('op-old')
  complete('op-old')

  const stream = await open('op-b')
  await tick()
  expect(stream.frames()).toEqual([])

  // A webhook tick finishes first: its completion passes through, the stream stays open
  complete('op-tick')
  await new Promise((resolve) => setTimeout(resolve, 600))
  expect(stream.state.closed).toBe(false)

  warmup('op-b')
  complete('op-b', 'busy')
  await new Promise((resolve) => setTimeout(resolve, 600))

  expect(stream.frames()).toEqual([
    ['__sync_complete__', 'op-tick', false],
    ['__sync_warmup__', 'op-b', false],
    ['__sync_complete__', 'op-b', false],
  ])
  expect(stream.state.closed).toBe(true)
  stream.stop()
})

it('without an operation id, replays from the latest warm-up and ends with the first completion, as before', async () => {
  warmup('op-old')
  complete('op-old')
  warmup('op-now')

  const stream = await open(null)
  await tick()
  expect(stream.frames()).toEqual([['__sync_warmup__', 'op-now', true]])

  complete('op-other')
  await new Promise((resolve) => setTimeout(resolve, 600))
  expect(stream.state.closed).toBe(true)
  stream.stop()
})
