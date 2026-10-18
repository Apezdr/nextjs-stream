/**
 * File servers as the sync sees them through run/manifestSource: each one's
 * library served as a format-2 manifest and as entries, the processor's
 * contract (its lib/mediaManifest.mjs) at the level of fetchManifest and
 * fetchEntries. The manifest body is built as the processor builds it and read
 * by the real parseManifest; an entry's hash is the first 16 hex digits of the
 * SHA-1 of its JSON, and entries cross the "wire" as JSON.
 *
 * Mock run/manifestSource's two fetches with it:
 *
 *   jest.mock('@src/utils/sync/run/manifestSource', () => ({
 *     ...jest.requireActual('@src/utils/sync/run/manifestSource'),
 *     fetchManifest: (...args) => mockProcessor.fetchManifest(...args),
 *     fetchEntries: (...args) => mockProcessor.fetchEntries(...args),
 *   }))
 *
 * Knobs per server (`processor.server(id)`): `down` (nothing answers), `notFound`
 * (the manifest route 404s), `format` (the manifest format served), `entriesFail`
 * (the entries route fails), `beforeEntries` (called once, with the library and
 * the kind, before the next entries answer: the library moves between the
 * manifest and the entries).
 */

const { createHash } = require('crypto')

const KINDS = ['tv', 'movies']

const sha1 = (text) => createHash('sha1').update(text).digest('hex')
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The processor's tvManifestKeys: each season key with its episode keys. */
function tvManifestKeys(entry) {
  const keys = {}
  const seasons = entry?.seasons
  if (!isPlainObject(seasons)) return keys
  for (const [seasonKey, season] of Object.entries(seasons)) {
    if (season === undefined) continue
    const episodes = isPlainObject(season) ? season.episodes : undefined
    Object.defineProperty(keys, seasonKey, {
      value: isPlainObject(episodes) ? Object.keys(episodes).filter((key) => episodes[key] !== undefined) : [],
      enumerable: true,
      writable: true,
      configurable: true,
    })
  }
  return keys
}

/** The hash the processor publishes for an entry. */
const titleHash = (entry) => sha1(JSON.stringify(entry)).slice(0, 16)

function createFakeProcessor({ version = 1.0001 } = {}) {
  const servers = new Map()
  const calls = { manifests: [], entries: [] }

  function server(id) {
    if (!servers.has(id)) servers.set(id, { library: { tv: {}, movies: {} } })
    return servers.get(id)
  }

  /** The manifest body and ETag, built from the library as it is now. */
  function manifestOf(id, kind) {
    const s = server(id)
    const parts = []
    for (const [name, entry] of Object.entries(s.library[kind])) {
      let record = `{"hash":"${titleHash(entry)}"`
      if (kind === 'tv') record += `,"seasons":${JSON.stringify(tvManifestKeys(entry))}`
      parts.push(`${JSON.stringify(name)}:${record}}`)
    }
    const format = s.format ?? 2
    const body = `{"format":${format},"kind":"${kind}","version":${version},"titles":{${parts.join(',')}}}`
    return { body, etag: `W/"${kind}-manifest-${sha1(body)}"`, format }
  }

  async function fetchManifest(target, kind, { etag = null } = {}) {
    const s = server(target.id)
    calls.manifests.push({ server: target.id, kind, etag })
    if (s.down) return { ok: false, contract: false, error: `${kind} manifest: connect ECONNREFUSED` }
    if (s.notFound) return { ok: false, contract: true, error: `${kind} manifest: answered 404 (no manifest route)` }
    const { body, etag: current, format } = manifestOf(target.id, kind)
    if (format !== 2) return { ok: false, contract: true, error: `${kind} manifest: answered manifest format ${format}` }
    if (etag && etag === current) return { ok: true, status: 304, etag, received: 0, parsed: 0 }
    const { parseManifest } = jest.requireActual('@src/utils/sync/run/manifestSource')
    const bytes = new TextEncoder().encode(body)
    return { ok: true, status: 200, manifest: parseManifest(bytes, kind, current), received: bytes.length, parsed: bytes.length }
  }

  async function fetchEntries(target, kind, request) {
    const s = server(target.id)
    calls.entries.push({ server: target.id, kind, request })
    if (s.beforeEntries) {
      const move = s.beforeEntries
      s.beforeEntries = null
      move(s.library, kind)
    }
    if (s.down || s.entriesFail) return { ok: false, error: `${kind} entries: socket hang up` }
    const library = s.library[kind]
    const names = request.all === true ? Object.keys(library) : request.titles
    const lines = new Map()
    let received = 0
    let parsed = 0
    for (const name of names) {
      const has = Object.hasOwn(library, name)
      const text = has
        ? `{"title":${JSON.stringify(name)},"hash":"${titleHash(library[name])}","entry":${JSON.stringify(library[name])}}`
        : `{"title":${JSON.stringify(name)},"missing":true}`
      received += Buffer.byteLength(text) + 1
      parsed += Buffer.byteLength(text)
      const line = JSON.parse(text)
      lines.set(name, has ? { hash: line.hash, entry: line.entry } : { missing: true })
    }
    const end = `{"end":true,"count":${names.length}}`
    received += Buffer.byteLength(end) + 1
    parsed += Buffer.byteLength(end)
    return {
      ok: true,
      lines,
      manifestETag: manifestOf(target.id, kind).etag,
      libraryETag: `W/"${kind}-library"`,
      received,
      parsed,
    }
  }

  return {
    server,
    calls,
    /** Serve `library` (`{ tv, movies }`, payload-shaped) from server `id`. */
    serve(id, library) {
      const s = server(id)
      s.library = { tv: { ...(library.tv || {}) }, movies: { ...(library.movies || {}) } }
      return s
    },
    reset() {
      servers.clear()
      calls.manifests.length = 0
      calls.entries.length = 0
    },
    manifestOf,
    fetchManifest,
    fetchEntries,
  }
}

module.exports = { createFakeProcessor, titleHash, tvManifestKeys, KINDS }
