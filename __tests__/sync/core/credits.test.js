/**
 * @jest-environment node
 *
 * The credits rule (core/credits, CREDITS_SIDECAR.md section 5): who
 * owns a title's credits, when the owner's file is fetched and stored, why a
 * failure keeps the last valid credits and holds the gate open, and when the
 * credits are confirmed gone.
 */

const { createHash } = require('crypto')

const mockServers = { A: { id: 'A', priority: 1 }, B: { id: 'B', priority: 2 }, C: { id: 'C', priority: 3 } }
jest.mock('@src/utils/config', () => ({ getServer: (id) => mockServers[id] }))

const { planCredits, creditsReporters, creditsRequest } = require('@src/utils/sync/core/credits')
const { Resources } = require('@src/utils/sync/core/resources')
const { collectFieldAvailability } = require('@src/utils/sync/run/availability')
const fixtures = require('../../helpers/creditsFixtures')

const TITLE = 'Film (2020)'
const FILE = `/movies/${encodeURIComponent(TITLE)}/credits.json`
const NOW = new Date('2026-10-29T00:00:00.000Z')
const LATER = new Date('2026-10-30T00:00:00.000Z')

const sha = (text) => createHash('sha256').update(text, 'utf8').digest('hex')
const TEXT = JSON.stringify(fixtures.mixedGrants())
const HASH = sha(TEXT)
const present = (hash = HASH) => ({ url: `${FILE}?hash=${hash}`, hash })

/** The availability map for a title, from each server's payload. */
const availabilityOf = (payloads) => {
  const fieldAvailability = { movies: { [TITLE]: Object.create(null) }, tv: {} }
  for (const [serverId, payload] of Object.entries(payloads)) {
    collectFieldAvailability(payload, '', serverId, fieldAvailability.movies[TITLE])
  }
  return fieldAvailability
}
const withVideo = (credits) => ({ urls: { mp4: '/movies/Film/Film.mp4' }, ...(credits === undefined ? {} : { credits }) })

/**
 * One server's plan for the title, with the file fetched as `fetched` says
 * (a function of the request, or undefined: nothing fetched).
 */
function plan(serverId, payloads, stored, { fetched, probed = true, now = NOW } = {}) {
  const input = {
    stored,
    reported: payloads[serverId].credits,
    reporters: creditsReporters(availabilityOf(payloads), 'movies', TITLE),
    scope: 'title',
    run: { serverConfig: { ...mockServers[serverId], baseUrl: `https://${serverId}.example`, enabled: true }, allEnabledServersProbed: probed },
    now,
  }
  const request = creditsRequest(input)
  const resources = new Resources(request && fetched ? [{ ...request, ...fetched(request) }] : [])
  return { outcome: planCredits(input, (asked) => resources.read(asked)), request, needs: resources.needs }
}
const ok = (text = TEXT) => () => ({ ok: true, data: text })
const storedFrom = (serverId, hash = HASH) => ({ credits: fixtures.mixedGrants(), creditsSource: serverId, creditsHash: hash })

describe('the owner\'s file', () => {
  it('is named as a need first, then stored with its source and hash', () => {
    const payloads = { A: withVideo(present()) }
    const first = plan('A', payloads, null)
    expect(first.needs).toEqual([{ kind: 'credits', serverId: 'A', path: `${FILE}?hash=${HASH}` }])

    const { outcome } = plan('A', payloads, null, { fetched: ok() })
    expect(outcome).toMatchObject({ action: 'stored', holdBack: null, unset: [] })
    expect(outcome.set).toEqual({ credits: fixtures.mixedGrants(), creditsSource: 'A', creditsHash: HASH })
  })

  it('is not fetched again while its hash is the stored one', () => {
    const { outcome, request } = plan('A', { A: withVideo(present()) }, storedFrom('A'))
    expect(request).toBeNull()
    expect(outcome).toMatchObject({ action: 'unchanged', set: {}, unset: [], holdBack: null })
  })

  it('is fetched again when the stored copy came from another server', () => {
    const { request } = plan('A', { A: withVideo(present()) }, storedFrom('B'))
    expect(request).not.toBeNull()
  })

  it('replaces the stored credits when its hash moves, and clears a recorded failure', () => {
    const text = JSON.stringify(fixtures.exactBackdropSource())
    const stored = { ...storedFrom('A'), creditsStatus: { state: 'error', reason: 'fetch-failed', serverId: 'A', since: NOW } }
    const { outcome } = plan('A', { A: withVideo(present(sha(text))) }, stored, { fetched: ok(text) })
    expect(outcome.set).toEqual({ credits: fixtures.exactBackdropSource(), creditsSource: 'A', creditsHash: sha(text) })
    expect(outcome.unset).toEqual(['creditsStatus'])
  })

  it('is validated as an episode\'s file when the scope says so', () => {
    const text = JSON.stringify({ ...fixtures.episodeOwn(1, 'Ep'), suppress: ['x'] })
    const input = (scope) => ({
      stored: null,
      reported: present(sha(text)),
      reporters: { urls: ['A'], errors: [], absent: [], holders: ['A'] },
      scope,
      run: { serverConfig: mockServers.A, allEnabledServersProbed: true },
      now: NOW,
    })
    const read = () => ({ kind: 'credits', serverId: 'A', path: 'x', ok: true, data: text })
    expect(planCredits(input('episode'), read).action).toBe('stored')
    expect(planCredits(input('title'), read)).toMatchObject({ action: 'rejected', set: { creditsStatus: { reason: 'schema' } } })
  })
})

describe('a failure', () => {
  const failed = (fetched, payload = present(), stored = storedFrom('A', 'old')) =>
    plan('A', { A: withVideo(payload) }, stored, { fetched }).outcome

  it.each([
    ['a fetch that failed', () => ({ ok: false, error: 'timeout' }), 'fetch-failed'],
    ['text that is not JSON', ok('{'), 'hash-mismatch'],
    ['a file that changed since it was hashed', ok(JSON.stringify(fixtures.artworkByArtist())), 'hash-mismatch'],
  ])('keeps the stored credits after %s, records why and holds the gate open', (_name, fetched, reason) => {
    const outcome = failed(fetched)
    expect(outcome.action).toBe('failed')
    expect(outcome.holdBack).toBe('credits')
    expect(outcome.unset).toEqual([])
    expect(outcome.set).not.toHaveProperty('credits')
    expect(outcome.set).not.toHaveProperty('creditsHash')
    expect(outcome.set.creditsStatus).toMatchObject({ state: 'error', reason, serverId: 'A', hash: HASH, since: NOW })
  })

  it.each([
    ['invalid JSON', '{', 'invalid-json'],
    ['an unsupported version', JSON.stringify({ ...fixtures.mixedGrants(), schemaVersion: 2 }), 'unsupported-version'],
    ['a schema error', JSON.stringify({ ...fixtures.mixedGrants(), extra: true }), 'schema'],
    ['a file over 256 KiB', JSON.stringify({ ...fixtures.mixedGrants(), pad: 'x'.repeat(262_144) }), 'too-large'],
  ])('records %s as rejected, keeps the stored credits, and lets the gate close until the file changes', (_name, text, reason) => {
    const outcome = failed(ok(text), present(sha(text)))
    expect(outcome).toMatchObject({ action: 'rejected', holdBack: null, unset: [], errors: [], set: { creditsStatus: { reason, hash: sha(text) } } })
    expect(outcome.set).not.toHaveProperty('credits')
  })

  it.each([
    ['too-large', false],
    ['empty', false],
    ['unreadable', true],
    ['something-new', true],
  ])('holds the gate open for a processor error %p only when it may clear by itself (%p)', (error, held) => {
    const outcome = failed(undefined, { error })
    expect(outcome.action).toBe(held ? 'failed' : 'rejected')
    expect(outcome.holdBack).toBe(held ? 'credits' : null)
  })

  it('rejects a url without a hash, without holding the gate', () => {
    expect(failed(undefined, { url: FILE })).toMatchObject({ action: 'rejected', holdBack: null })
  })

  it('does not rewrite the document while the same rejection repeats', () => {
    const text = JSON.stringify({ ...fixtures.mixedGrants(), extra: true })
    const first = failed(ok(text), present(sha(text)))
    const stored = { ...storedFrom('A', 'old'), creditsStatus: first.set.creditsStatus }
    const again = plan('A', { A: withVideo(present(sha(text))) }, stored, { fetched: ok(text), now: LATER }).outcome
    expect(again).toMatchObject({ action: 'rejected', holdBack: null, set: {}, unset: [], changes: [] })
  })

  it('keeps the stored credits when the processor could not read the file', () => {
    const outcome = failed(undefined, { error: 'unreadable' })
    expect(outcome).toMatchObject({ action: 'failed', holdBack: 'credits', unset: [] })
    expect(outcome.set).toEqual({ creditsStatus: { state: 'error', reason: 'server:unreadable', serverId: 'A', since: NOW } })
  })

  it('calls a url without a hash a malformed locator', () => {
    const outcome = failed(undefined, { url: FILE })
    expect(outcome.set.creditsStatus).toMatchObject({ reason: 'malformed-locator' })
  })

  it('does not rewrite the document while the same failure repeats', () => {
    const first = failed(() => ({ ok: false, error: 'timeout' }))
    const stored = { ...storedFrom('A', 'old'), creditsStatus: first.set.creditsStatus }
    const again = plan('A', { A: withVideo(present()) }, stored, { fetched: () => ({ ok: false, error: 'timeout' }), now: LATER }).outcome
    expect(again).toMatchObject({ action: 'failed', holdBack: 'credits', set: {}, unset: [] })
  })

  it('records a new reason with a new since', () => {
    const stored = { ...storedFrom('A', 'old'), creditsStatus: { state: 'error', reason: 'fetch-failed', serverId: 'A', hash: HASH, detail: 'timeout', since: NOW } }
    const next = plan('A', { A: withVideo(present()) }, stored, { fetched: ok('{'), now: LATER }).outcome
    expect(next.set.creditsStatus).toMatchObject({ reason: 'hash-mismatch', since: LATER })
  })
})

describe('ownership across servers', () => {
  it('belongs to the highest-priority server with a file', () => {
    const payloads = { A: withVideo(present()), B: withVideo(present()) }
    expect(plan('B', payloads, null, { fetched: ok() }).outcome).toMatchObject({ action: 'unchanged', set: {} })
    expect(plan('A', payloads, null, { fetched: ok() }).outcome.action).toBe('stored')
  })

  it('passes to a lower-priority server when the higher one confirms it has none', () => {
    const payloads = { A: withVideo({ absent: true }), B: withVideo(present()) }
    expect(plan('A', payloads, storedFrom('A')).outcome).toMatchObject({ action: 'unchanged', set: {}, unset: [] })
    expect(plan('B', payloads, storedFrom('A'), { fetched: ok() }).outcome.set.creditsSource).toBe('B')
  })

  it('stays with the owner while it reports an error: a failure hands nothing down', () => {
    const payloads = { A: withVideo({ error: 'unreadable' }), B: withVideo(present()) }
    expect(plan('B', payloads, storedFrom('A')).outcome).toMatchObject({ action: 'unchanged', set: {} })
    expect(plan('A', payloads, storedFrom('A')).outcome).toMatchObject({ action: 'failed', holdBack: 'credits' })
  })

  it('is never claimed by a processor that publishes no credits value', () => {
    const payloads = { A: withVideo(), B: withVideo(present()) }
    expect(plan('A', payloads, null).outcome.action).toBe('unchanged')
    expect(plan('B', payloads, null, { fetched: ok() }).outcome.action).toBe('stored')
  })
})

describe('removal', () => {
  it('removes every credits field once every server that has the title confirms none', () => {
    const stored = { ...storedFrom('A'), creditsStatus: { state: 'error', reason: 'x', serverId: 'A', since: NOW } }
    const { outcome } = plan('A', { A: withVideo({ absent: true }), B: withVideo({ absent: true }) }, stored)
    expect(outcome).toMatchObject({ action: 'removed', holdBack: null, set: {} })
    expect(outcome.unset).toEqual(['credits', 'creditsSource', 'creditsHash', 'creditsStatus'])
  })

  it('holds the removal back on a run a server did not answer', () => {
    const { outcome } = plan('A', { A: withVideo({ absent: true }) }, storedFrom('A'), { probed: false })
    expect(outcome).toMatchObject({ action: 'unchanged', holdBack: 'credits removal', unset: [] })
  })

  it('never removes on the say-so of a server whose processor predates credits', () => {
    const payloads = { A: withVideo({ absent: true }), B: withVideo() }
    expect(plan('A', payloads, storedFrom('B')).outcome).toMatchObject({ action: 'unchanged', unset: [], holdBack: null })
    expect(plan('B', payloads, storedFrom('B')).outcome).toMatchObject({ action: 'unchanged', unset: [] })
  })

  it('clears a recorded failure once no server claims the credits, and keeps the credits when the absence is not confirmed', () => {
    const stored = { ...storedFrom('A'), creditsStatus: { state: 'error', reason: 'server:unreadable', serverId: 'A', since: NOW } }
    const payloads = { A: withVideo({ absent: true }), B: withVideo() }
    expect(plan('A', payloads, stored).outcome).toMatchObject({ action: 'unchanged', unset: ['creditsStatus'], holdBack: null })
    // With a server missing, it may be the owner whose failure the status records.
    expect(plan('A', payloads, stored, { probed: false }).outcome).toMatchObject({ unset: [] })
  })

  it('does nothing when nothing is stored', () => {
    expect(plan('A', { A: withVideo({ absent: true }) }, null).outcome).toMatchObject({ action: 'unchanged', unset: [] })
  })
})

describe('an admin lock', () => {
  it('keeps the stored credits whatever the servers say', () => {
    const stored = { ...storedFrom('A', 'old'), lockedFields: { credits: true } }
    expect(plan('A', { A: withVideo(present()) }, stored, { fetched: ok() }).outcome).toMatchObject({ action: 'unchanged', set: {} })
    expect(plan('A', { A: withVideo({ absent: true }) }, stored).outcome).toMatchObject({ action: 'unchanged', unset: [] })
  })
})

describe('an episode\'s reporters', () => {
  it('are ranked across every season key, and nobody reports for an episode with no path', () => {
    const fieldAvailability = { movies: {}, tv: { Show: Object.create(null) } }
    collectFieldAvailability({ seasons: { 'Season 1': { episodes: { S01E01: { videoURL: 'v', credits: { absent: true } } } } } }, '', 'A', fieldAvailability.tv.Show)
    collectFieldAvailability({ seasons: { 'Season 01': { episodes: { S01E01: { videoURL: 'v', credits: present() } } } } }, '', 'B', fieldAvailability.tv.Show)
    collectFieldAvailability({ seasons: { 'Season 1': { episodes: { S01E01: { videoURL: 'v' } } } } }, '', 'C', fieldAvailability.tv.Show)
    const prefixes = ['seasons.Season 1.episodes.S01E01', 'seasons.Season 01.episodes.S01E01']
    expect(creditsReporters(fieldAvailability, 'tv', 'Show', prefixes)).toEqual({
      urls: ['B'],
      errors: [],
      absent: ['A'],
      holders: ['A', 'C', 'B'],
    })
    expect(creditsReporters(fieldAvailability, 'tv', 'Show', [])).toEqual({ urls: [], errors: [], absent: [], holders: [] })
  })
})
