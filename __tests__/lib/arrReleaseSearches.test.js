/**
 * @jest-environment node
 *
 * Interactive searches as jobs: the same running search is shared, each
 * admin's indexer use is capped, failures read plainly, results expire before
 * the service's 30-minute cache does, and the browser's view never holds a
 * guid.
 */

const mockLog = { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
jest.mock('@src/lib/logger', () => ({ createLogger: () => mockLog }))

let store
let ArrError
let ArrRequestError

beforeEach(() => {
  jest.resetModules()
  jest.useRealTimers()
  store = require('@src/lib/arr/releaseSearches')
  ArrError = require('@src/lib/arr/http').ArrError
  ArrRequestError = require('@src/lib/arr/errors').ArrRequestError
})

/** A run() the test settles by hand. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { run: () => promise, resolve, reject }
}

const movieTarget = { kind: 'movie', movieId: 186 }
const start = (overrides = {}) =>
  store.startReleaseSearch({
    ownerId: 'admin-1',
    service: 'radarr',
    title: { mediaType: 'movie', tmdbId: 11 },
    target: movieTarget,
    run: deferred().run,
    ...overrides,
  })
const flush = () => new Promise((resolve) => setImmediate(resolve))

const stored = (title, extra = {}) => ({
  guid: `guid-${title}`,
  indexerId: 1,
  summary: { title, approved: true, rejections: [] },
  episodeIds: [],
  fullSeason: null,
  ...extra,
})

test('a search runs in the background; the view lists releases by index, never by guid', async () => {
  const run = deferred()
  const search = start({ run: run.run })
  expect(store.viewOf(search)).toMatchObject({ state: 'searching', target: { kind: 'movie' }, releases: [], expiresAt: null })

  run.resolve([stored('A'), stored('B')])
  await flush()

  const view = store.viewOf(store.getReleaseSearch(search.id))
  expect(view.state).toBe('done')
  expect(view.releases.map((release) => [release.id, release.title, release.grabbed])).toEqual([
    ['0', 'A', false],
    ['1', 'B', false],
  ])
  expect(JSON.stringify(view)).not.toContain('guid-')
  expect(Date.parse(view.expiresAt) - Date.parse(view.finishedAt)).toBe(store.RESULTS_TTL_MS)
})

test('the same search while it runs is joined, not started again', () => {
  const first = start()
  const again = start({ ownerId: 'admin-2' })
  expect(again.id).toBe(first.id)
  // A different target is a different search.
  expect(start({ target: { kind: 'movie', movieId: 187 } }).id).not.toBe(first.id)
})

test('two running searches per admin; a third is refused', () => {
  start({ target: { kind: 'movie', movieId: 1 } })
  start({ target: { kind: 'movie', movieId: 2 } })
  expect(() => start({ target: { kind: 'movie', movieId: 3 } })).toThrow(ArrRequestError)
  try {
    start({ target: { kind: 'movie', movieId: 3 } })
  } catch (error) {
    expect(error).toMatchObject({ status: 429, code: 'busy' })
  }
  // Another admin is unaffected.
  expect(() => start({ ownerId: 'admin-2', target: { kind: 'movie', movieId: 3 } })).not.toThrow()
})

test('searches per admin per hour are capped', async () => {
  for (let index = 0; index < store.MAX_STARTS_PER_HOUR; index++) {
    const run = deferred()
    start({ target: { kind: 'movie', movieId: index + 1 }, run: run.run })
    run.resolve([])
    await flush()
  }
  let refusal = null
  try {
    start({ target: { kind: 'movie', movieId: 999 } })
  } catch (error) {
    refusal = error
  }
  expect(refusal).toMatchObject({ status: 429, code: 'too_many_searches' })
})

// Built per test: the store checks `instanceof` against this test's module registry.
test.each([
  ['timeout', (Arr) => new Arr('timeout'), 'Radarr’s indexers took too long to answer. Try again.'],
  [
    'rejected',
    (Arr) => new Arr('rejected', 400, ['Unable to search: no indexers available']),
    'Radarr: Unable to search: no indexers available',
  ],
  ['unauthorized', (Arr) => new Arr('unauthorized', 401), 'Radarr couldn’t search: its API key was refused.'],
  ['invalid_response', () => new TypeError('bug'), 'Radarr couldn’t search.'],
])('a failed search says why (%s)', async (reason, makeError, message) => {
  const run = deferred()
  const search = start({ run: run.run })
  run.reject(makeError(ArrError))
  await flush()
  expect(store.viewOf(search)).toMatchObject({ state: 'failed', failure: { reason, message } })
})

test('results expire after RESULTS_TTL_MS, a little before the service drops them', async () => {
  jest.useFakeTimers({ now: new Date('2026-10-12T12:00:00Z') })
  const run = deferred()
  const search = start({ run: run.run })
  run.resolve([stored('A')])
  await Promise.resolve()
  await Promise.resolve()

  jest.setSystemTime(Date.now() + store.RESULTS_TTL_MS - 1000)
  expect(store.getReleaseSearch(search.id)).not.toBeNull()

  jest.setSystemTime(Date.now() + 2000)
  expect(store.getReleaseSearch(search.id)).toBeNull()
  jest.useRealTimers()
})
