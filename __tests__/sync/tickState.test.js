/**
 * @jest-environment node
 *
 * The manifest tick's memory (run/tickState): trusted only while it tracks the
 * last run on record, and `applied` cleared before any pass writes.
 */

const {
  getTickState,
  resetTickState,
  whyStateUnusable,
  beginRun,
  recordApplied,
  forgetUnlisted,
} = require('@src/utils/sync/run/tickState')
const { stateRules } = require('@src/utils/sync/run/selectTitles')
const { tryAcquireSyncLock, releaseSyncLock, getSyncLockHolder } = require('@src/utils/sync/run/runState')

const H0 = '0000000000000000'
const H1 = '1111111111111111'
const CURRENT = { bootId: 'boot-1', gateVersion: 2, serversFingerprint: 'A:1' }
const km = (titles, version = 1.0001) => ({
  etag: `W/"${JSON.stringify(titles)}"`,
  format: 2,
  version,
  titles: new Map(Object.entries(titles).map(([name, hash]) => [name, { hash }])),
})
const manifestsOf = (movies) => new Map([['A', { movies: km(movies), tv: km({}) }]])
const none = { tv: [], movies: [] }

/** Run `id` takes the orchestration lock (whoever held it lets go): only the lock holder changes the state. */
function holdLock(id) {
  const holder = getSyncLockHolder()
  if (holder) releaseSyncLock(holder.syncRunId)
  if (!tryAcquireSyncLock(id)) throw new Error('lock')
}

/** beginRun for run `id`, which takes the lock first. */
const begin = (id, args) => {
  holdLock(id)
  return beginRun({ ...CURRENT, syncRunId: id, ...args })
}

beforeEach(() => resetTickState())
afterEach(() => {
  const holder = getSyncLockHolder()
  if (holder) releaseSyncLock(holder.syncRunId)
})

describe('whyStateUnusable', () => {
  const run = (syncRunId) => begin(syncRunId, { mode: 'all', manifests: manifestsOf({}), selected: none })

  it('is usable while the record names the run the state last saw, running marker or complete', () => {
    const state = run('run-1')
    expect(whyStateUnusable(state, { ...CURRENT, record: { state: 'running', syncRunId: 'run-1' } })).toBeNull()
    expect(whyStateUnusable(state, { ...CURRENT, record: { state: 'complete', syncRunId: 'run-1' } })).toBeNull()
  })

  it.each([
    ['no state', () => null, {}, /no tick state/],
    ['another process', () => run('run-1'), { bootId: 'boot-2' }, /another process/],
    ['a new gate version', () => run('run-1'), { gateVersion: 3 }, /gate version/],
    ['changed servers', () => run('run-1'), { serversFingerprint: 'A:1,B:2' }, /servers/],
  ])('is not usable with %s', (_name, state, change, reason) => {
    expect(whyStateUnusable(state(), { ...CURRENT, ...change, record: { syncRunId: 'run-1' } })).toMatch(reason)
  })

  it('is not usable once the record is forgotten, or names a run it did not see (another process wrote a marker)', () => {
    const state = run('run-1')
    expect(whyStateUnusable(state, { ...CURRENT, record: null })).toMatch(/no pass on record/)
    expect(whyStateUnusable(state, { ...CURRENT, record: { state: 'running', syncRunId: 'run-from-elsewhere' } })).toMatch(/not the one this state saw/)
  })
})

describe('beginRun', () => {
  it('starts an `all` run from a fresh state, kept for the process', () => {
    const first = begin('run-1', { mode: 'all', manifests: manifestsOf({ Film: H0 }), selected: { tv: [], movies: ['Film'] } })
    recordApplied(first, 'movies', 'Film', new Map([['A', H0]]), first.lastRunId)
    const second = begin('run-2', { mode: 'all', manifests: manifestsOf({ Film: H0 }), selected: { tv: [], movies: ['Film'] } })
    expect(second).not.toBe(first)
    expect(getTickState()).toBe(second)
    expect(second.applied.movies.size).toBe(0)
    expect(second.lastRunId).toBe('run-2')
  })

  it('on a select run clears `applied` for the selected titles only, takes the run’s manifests and its id', () => {
    const state = begin('run-1', { mode: 'all', manifests: manifestsOf({ Film: H0, Other: H0 }), selected: none })
    recordApplied(state, 'movies', 'Film', new Map([['A', H0]]), state.lastRunId)
    recordApplied(state, 'movies', 'Other', new Map([['A', H0]]), state.lastRunId)
    const next = manifestsOf({ Film: H1, Other: H0 })

    expect(begin('run-2', { mode: 'select', manifests: next, selected: { tv: [], movies: ['Film'] } })).toBe(state)

    expect([...state.applied.movies.keys()]).toEqual(['Other'])
    expect(state.manifests.get('A').movies).toBe(next.get('A').movies)
    expect(state.lastRunId).toBe('run-2')
  })

  it('closes the ABA hole: written at the new hash, then a throw, then the server back at the old hash: selected again', () => {
    const state = begin('run-1', { mode: 'all', manifests: manifestsOf({ Film: H0 }), selected: none })
    recordApplied(state, 'movies', 'Film', new Map([['A', H0]]), state.lastRunId)
    // run-2: Film at H1 is selected and cleared before the pass writes it; the run throws before recordApplied
    begin('run-2', { mode: 'select', manifests: manifestsOf({ Film: H1 }), selected: { tv: [], movies: ['Film'] } })
    // run-3: the server publishes H0 again
    const selected = stateRules({ manifests: manifestsOf({ Film: H0 }), applied: state.applied })
    expect(selected.movies.get('Film')).toEqual(['R1', 'R2'])
  })
})

describe('recordApplied and forgetUnlisted', () => {
  it('set a title’s servers and hashes, and forget titles no answering server lists', () => {
    const state = begin('run-1', { mode: 'all', manifests: manifestsOf({}), selected: none })
    const servers = new Map([['A', H0], ['B', H1]])
    recordApplied(state, 'tv', '__proto__', servers, state.lastRunId)
    recordApplied(state, 'tv', 'Gone', servers, state.lastRunId)
    servers.delete('A')
    expect(state.applied.tv.get('__proto__')).toEqual(new Map([['A', H0], ['B', H1]]))
    forgetUnlisted(state, 'tv', new Set(['__proto__']), state.lastRunId)
    expect([...state.applied.tv.keys()]).toEqual(['__proto__'])
  })
})

describe('a run that lost the lock (the watchdog released it) changes nothing', () => {
  it('cannot begin', () => {
    const state = begin('run-1', { mode: 'all', manifests: manifestsOf({ Film: H0 }), selected: none })
    recordApplied(state, 'movies', 'Film', new Map([['A', H0]]), 'run-1')
    releaseSyncLock('run-1')

    expect(beginRun({ ...CURRENT, syncRunId: 'run-1', mode: 'select', manifests: manifestsOf({ Film: H1 }), selected: { tv: [], movies: ['Film'] } })).toBeNull()
    expect(state.applied.movies.get('Film')).toEqual(new Map([['A', H0]]))
  })

  it('cannot record, nor forget, once another run holds the lock or the state moved on', () => {
    const stale = begin('run-k', { mode: 'all', manifests: manifestsOf({ Film: H0 }), selected: { tv: [], movies: ['Film'] } })
    // The watchdog releases run k; run k+1 takes the lock and begins
    const next = begin('run-k+1', { mode: 'select', manifests: manifestsOf({ Film: H1 }), selected: { tv: [], movies: ['Film'] } })
    expect(next).toBe(stale)

    expect(recordApplied(stale, 'movies', 'Film', new Map([['A', H0]]), 'run-k')).toBe(false)
    forgetUnlisted(stale, 'movies', new Set(), 'run-k')
    expect(recordApplied(next, 'movies', 'Film', new Map([['A', H1]]), 'run-k+1')).toBe(true)
    expect(next.applied.movies.get('Film')).toEqual(new Map([['A', H1]]))

    // run k ends: syncAllServers drops the state, so the next tick is `all`
    resetTickState()
    expect(recordApplied(next, 'movies', 'Film', new Map([['A', H1]]), 'run-k+1')).toBe(false)
    expect(whyStateUnusable(getTickState(), { ...CURRENT, record: { syncRunId: 'run-k+1' } })).toMatch(/no tick state/)
  })
})
