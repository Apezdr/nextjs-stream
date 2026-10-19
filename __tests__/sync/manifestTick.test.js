/**
 * @jest-environment node
 *
 * The pass's inputs from manifests and entries (run/manifestTick
 * buildTickInputs): which titles are asked for, from which servers, what a
 * library that moved between manifest and entries does (review R-E), and when
 * a server is out of the tick.
 */

let mockServers = []
jest.mock('@src/utils/config', () => ({
  getAllServers: () => mockServers,
  getServer: (id) => mockServers.find((server) => server.id === id),
}))
const { createFakeProcessor, titleHash } = require('../helpers/fakeProcessor')
const mockProcessor = createFakeProcessor()
jest.mock('@src/utils/sync/run/manifestSource', () => ({
  ...jest.requireActual('@src/utils/sync/run/manifestSource'),
  fetchManifest: (...args) => mockProcessor.fetchManifest(...args),
  fetchEntries: (...args) => mockProcessor.fetchEntries(...args),
}))

const { probeServers, buildTickInputs, tickPerfLine } = require('@src/utils/sync/run/manifestTick')
const { beginRun, recordApplied, resetTickState, getTickState } = require('@src/utils/sync/run/tickState')
const { tryAcquireSyncLock, releaseSyncLock } = require('@src/utils/sync/run/runState')

const server = (id, priority) => ({ id, priority, baseURL: `https://${id}.example`, prefixPath: '', syncEndpoint: `https://${id}-node.example` })
const film = (n) => ({ urls: { mp4: `/movies/film-${n}.mkv` } })
const show = (episodes) => ({
  seasons: { 'Season 1': { episodes: Object.fromEntries(episodes.map((n) => [`S01E0${n}`, { videoURL: `/e${n}.mkv` }])) } },
})
const WATCHDOG = 10 * 60 * 1000

/** A database that has every listed title with every server's gate, and the episodes and seasons listed. */
function databaseFor(libraries) {
  const gates = Object.fromEntries(Object.keys(libraries).map((id) => [id, 'g2:x']))
  const titles = (kind) => [...new Set(Object.values(libraries).flatMap((library) => Object.keys(library[kind] || {})))]
  const docs = {
    FlatMovies: titles('movies').map((originalTitle) => ({ originalTitle, syncGates: gates })),
    FlatTVShows: titles('tv').map((originalTitle) => ({ _id: `id:${originalTitle}`, originalTitle, syncGates: gates, visibleEpisodeCount: 9 })),
  }
  const big = (name) => titles('tv').map((title) => ({ _id: `id:${title}`, n: name === 'FlatEpisodes' ? 99 : 9 }))
  return {
    collection: (name) => ({
      find: () => ({ toArray: async () => docs[name] }),
      aggregate: () => ({ toArray: async () => big(name) }),
    }),
  }
}

/** Serve the libraries, probe them, and leave a tick state of a clean pass over them (run `run-0`). */
async function settled(libraries) {
  mockServers = Object.keys(libraries).map((id, i) => server(id, i + 1))
  mockProcessor.reset()
  for (const [id, library] of Object.entries(libraries)) mockProcessor.serve(id, library)
  resetTickState()
  const probes = await probeServers(mockServers, null)
  tryAcquireSyncLock('run-0')
  const state = beginRun({
    syncRunId: 'run-0',
    mode: 'all',
    bootId: 'boot',
    gateVersion: 2,
    serversFingerprint: 'x',
    manifests: new Map([...probes].map(([id, probe]) => [id, probe.manifests])),
    selected: { tv: [], movies: [] },
  })
  for (const kind of ['tv', 'movies']) {
    const byTitle = new Map()
    for (const [id, library] of Object.entries(libraries)) {
      for (const [title, entry] of Object.entries(library[kind] || {})) {
        if (!byTitle.has(title)) byTitle.set(title, new Map())
        byTitle.get(title).set(id, titleHash(entry))
      }
    }
    for (const [title, servers] of byTitle) recordApplied(state, kind, title, servers, 'run-0')
  }
  releaseSyncLock('run-0')
  mockProcessor.calls.manifests.length = 0
  return state
}

/** The tick a probe makes now (conditional on the state), and its inputs, as a select tick builds them. */
async function selectTick(libraries, mode = 'select') {
  const probes = await probeServers(mockServers, mode === 'select' ? getTickState().manifests : null)
  const errors = [...probes].filter(([, p]) => !p.ok).map(([serverId, p]) => ({ serverId, error: p.error }))
  const tick = { mode, servers: probes, errors: errors.length > 0 ? errors : undefined }
  return buildTickInputs({ tick, mode, state: getTickState(), db: databaseFor(libraries), watchdogMs: WATCHDOG })
}

const keys = (selected) => ({ tv: [...selected.tv.keys()].sort(), movies: [...selected.movies.keys()].sort() })
const asked = () => mockProcessor.calls.entries.map(({ server: id, kind, request }) => [id, kind, request])

beforeEach(() => {
  for (const method of ['error', 'warn', 'info']) jest.spyOn(console, method).mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

const twoServers = () => ({
  A: { movies: { 'Film 1': film(1), 'Film 2': film(2), version: film(9) }, tv: { Show: show([1, 2]) } },
  B: { movies: { 'Film 1': film(1) }, tv: { Show: show([1, 2]) } },
})

describe('an all tick', () => {
  it('asks every server for everything with {all: true} and keeps every title the manifests list, the version folder left out', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.calls.entries.length = 0

    const inputs = await selectTick(libraries, 'all')

    expect(asked()).toEqual([
      ['A', 'tv', { all: true }],
      ['A', 'movies', { all: true }],
      ['B', 'tv', { all: true }],
      ['B', 'movies', { all: true }],
    ])
    expect(Object.keys(inputs.fileServers.A.movies)).toEqual(['Film 1', 'Film 2'])
    expect(inputs.fileServers.A.movies['Film 2']).toEqual(film(2))
    expect(inputs.fileServers.B.tv).toEqual({ Show: show([1, 2]) })
    expect(inputs.fileServers.A.config).toEqual({ baseURL: 'https://A.example', prefixPath: '', syncEndpoint: 'https://A-node.example', priority: 1 })
    expect([...inputs.listings.get('A').movies]).toEqual(['Film 1', 'Film 2'])
    expect(inputs.hashes.movies.get('Film 1')).toEqual(new Map([['A', titleHash(film(1))], ['B', titleHash(film(1))]]))
    expect(inputs.allEnabledServersProbed).toBe(true)
    expect(inputs.fieldAvailability.movies['Film 1']['urls.mp4']).toEqual(['A', 'B'])
  })
})

describe('a select tick', () => {
  it('asks only for the title that changed, from every server that lists it, and builds availability from both', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.server('B').library.movies['Film 1'] = { urls: { mp4: '/movies/film-1-remux.mkv' } }

    const inputs = await selectTick(libraries)

    expect(keys(inputs.selected)).toEqual({ tv: [], movies: ['Film 1'] })
    expect(asked()).toEqual([
      ['A', 'movies', { titles: ['Film 1'] }],
      ['B', 'movies', { all: true }],
    ])
    expect(inputs.fileServers.A).toMatchObject({ movies: { 'Film 1': film(1) }, tv: {} })
    expect(inputs.fileServers.B.movies).toEqual({ 'Film 1': { urls: { mp4: '/movies/film-1-remux.mkv' } } })
    expect(inputs.fieldAvailability.movies['Film 1']['urls.mp4']).toEqual(['A', 'B'])
    // Pre-tag and cleanup still see each server's whole library
    expect([...inputs.listings.get('A').movies]).toEqual(['Film 1', 'Film 2'])
    expect(tickPerfLine({ kind: 'select', selected: inputs.selected, manifests: inputs.manifests, perf: inputs.perf })).toMatch(
      /^\[SYNC PERF\] tick=select selected tv=0\/1 movies=1\/2 \| A tv: manifest 304, 0 entries, 0\.0 KB received, 0\.0 KB parsed; movies: manifest 304, 1 entries, [\d.]+ KB received, [\d.]+ KB parsed \| B tv: manifest 304, 0 entries.*; movies: manifest 200, 1 entries/
    )
  })

  it('leaves a server that did not answer out, and asks the others for the titles it shared (they changed hands, R2)', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.server('B').down = true

    const inputs = await selectTick(libraries)

    expect(inputs.allEnabledServersProbed).toBe(false)
    expect(keys(inputs.selected)).toEqual({ tv: ['Show'], movies: ['Film 1'] })
    expect(Object.keys(inputs.fileServers)).toEqual(['A'])
    expect(inputs.listings.has('B')).toBe(false)
  })

  it('leaves a server whose entries fail out, and asks the others in another round for what it shared', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.server('B').library.movies['Film 1'] = film(11)
    mockProcessor.server('B').entriesFail = true

    const inputs = await selectTick(libraries)

    expect(inputs.errors).toEqual([expect.objectContaining({ serverId: 'B' })])
    expect(inputs.allEnabledServersProbed).toBe(false)
    expect(keys(inputs.selected)).toEqual({ tv: ['Show'], movies: ['Film 1'] })
    expect(asked()).toEqual([
      ['A', 'movies', { titles: ['Film 1'] }],
      ['B', 'movies', { all: true }],
      ['A', 'tv', { all: true }],
    ])
    expect(Object.keys(inputs.fileServers)).toEqual(['A'])
    expect(inputs.fileServers.A.tv).toEqual({ Show: show([1, 2]) })
  })
})

describe('a library that moved between the manifest and the entries (R-E)', () => {
  it('re-reads the manifest once; when its ETag is the entries’ the lines apply and it becomes the listing', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.server('A').library.movies['Film 2'] = film(22)
    // Before the entries answer, a scan adds a film on A
    mockProcessor.server('A').beforeEntries = (library, kind) => {
      if (kind === 'movies') library.movies['Film 3'] = film(3)
    }

    const inputs = await selectTick(libraries)

    expect(inputs.allEnabledServersProbed).toBe(true)
    expect(inputs.fileServers.A.movies).toEqual({ 'Film 2': film(22) })
    expect(inputs.hashes.movies.get('Film 2')).toEqual(new Map([['A', titleHash(film(22))]]))
    // The re-read is the listing (pre-tag sees Film 3) and the manifest the run remembers
    expect([...inputs.listings.get('A').movies]).toEqual(['Film 1', 'Film 2', 'Film 3'])
    expect(inputs.manifests.get('A').movies.etag).toBe(mockProcessor.manifestOf('A', 'movies').etag)
    // Film 3 was not selected this tick: R2 takes it next tick
    expect(inputs.selected.movies.has('Film 3')).toBe(false)
    expect(mockProcessor.calls.manifests.filter((call) => call.server === 'A' && call.kind === 'movies')).toHaveLength(2)
  })

  it('leaves the server out when the re-read is yet another generation: no deletes, nothing recorded', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.server('A').library.movies['Film 2'] = film(22)
    // A scan adds a film before the entries answer, and another before the re-read
    let movedAgain = false
    mockProcessor.server('A').beforeEntries = (library, kind) => {
      if (kind !== 'movies') return
      library.movies['Film 3'] = film(3)
      movedAgain = true
    }
    const read = mockProcessor.fetchManifest
    mockProcessor.fetchManifest = async (target, kind, options) => {
      if (target.id === 'A' && kind === 'movies' && movedAgain) {
        movedAgain = false
        mockProcessor.server('A').library.movies['Film 4'] = film(4)
      }
      return read(target, kind, options)
    }
    try {
      const inputs = await selectTick(libraries)

      expect(inputs.errors).toEqual([expect.objectContaining({ serverId: 'A', error: expect.stringContaining('re-read did not match') })])
      expect(inputs.allEnabledServersProbed).toBe(false)
      expect(inputs.listings.has('A')).toBe(false)
      expect(inputs.fileServers.A).toBeUndefined()
    } finally {
      mockProcessor.fetchManifest = read
    }
  })

  it('leaves the server out when the re-read is not format 2', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.server('A').library.movies['Film 2'] = film(22)
    mockProcessor.server('A').beforeEntries = (library) => {
      library.movies['Film 3'] = film(3)
      mockProcessor.server('A').format = 3
    }

    const inputs = await selectTick(libraries)

    expect(inputs.errors).toEqual([expect.objectContaining({ serverId: 'A', error: expect.stringContaining('format 3') })])
    expect(inputs.allEnabledServersProbed).toBe(false)
  })

  it('takes a missing title out of the tick (not a deletion) once the re-read no longer lists it', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.server('A').library.movies['Film 1'] = film(11)
    mockProcessor.server('A').beforeEntries = (library, kind) => {
      if (kind === 'movies') delete library.movies['Film 1']
    }

    const inputs = await selectTick(libraries)

    expect(inputs.allEnabledServersProbed).toBe(true)
    expect([...inputs.dropped.movies]).toEqual(['Film 1'])
    expect(inputs.selected.movies.has('Film 1')).toBe(false)
    // Nobody passes over it this tick, B included
    expect(inputs.fileServers.B.movies).toEqual({})
    expect([...inputs.listings.get('A').movies]).toEqual(['Film 2'])
  })

  it('leaves the server out when a title comes missing that its manifest lists', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.server('A').library.movies['Film 1'] = film(11)
    const entries = mockProcessor.fetchEntries
    mockProcessor.fetchEntries = async (target, kind, request) => {
      const answer = await entries(target, kind, request)
      if (target.id === 'A' && answer.ok && answer.lines.has('Film 1')) answer.lines.set('Film 1', { missing: true })
      return answer
    }
    try {
      const inputs = await selectTick(libraries)
      expect(inputs.errors).toEqual([expect.objectContaining({ serverId: 'A', error: expect.stringContaining('came missing') })])
    } finally {
      mockProcessor.fetchEntries = entries
    }
  })

  it('leaves the server out when a line’s hash is not its manifest’s', async () => {
    const libraries = twoServers()
    await settled(libraries)
    mockProcessor.server('A').library.movies['Film 1'] = film(11)
    const entries = mockProcessor.fetchEntries
    mockProcessor.fetchEntries = async (target, kind, request) => {
      const answer = await entries(target, kind, request)
      if (target.id === 'A' && answer.ok && answer.lines.has('Film 1')) answer.lines.get('Film 1').hash = '0000000000000000'
      return answer
    }
    try {
      const inputs = await selectTick(libraries)
      expect(inputs.errors).toEqual([expect.objectContaining({ serverId: 'A', error: expect.stringContaining('its manifest has') })])
    } finally {
      mockProcessor.fetchEntries = entries
    }
  })
})
