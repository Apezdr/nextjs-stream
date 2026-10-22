import { sessionVideoId, fileNameFromPathKey, shapeTranscoderDashboard } from '@src/utils/admin/transcoderSessionsJoin'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'

const pathKey = (p) => Buffer.from(p, 'utf8').toString('base64url')

describe('sessionVideoId', () => {
  test("is the watch-history id of the title's own file URL", () => {
    const rel = 'movies/Some Film (2020)/Some Film (2020).mkv'
    expect(sessionVideoId(pathKey(rel))).toBe(
      generateNormalizedVideoId(`https://files.example/${encodeURI(rel)}`)
    )
  })

  test('null without a key', () => {
    expect(sessionVideoId('')).toBeNull()
    expect(sessionVideoId(undefined)).toBeNull()
  })
})

test('fileNameFromPathKey names the addressed file', () => {
  expect(fileNameFromPathKey(pathKey('tv/Show/Season 1/E01.mkv'))).toBe('E01.mkv')
})

describe('shapeTranscoderDashboard', () => {
  const now = new Date('2026-10-22T12:00:00Z')
  const target = { serverId: 'default', displayName: 'Home', keyVariable: 'WEBHOOK_ID', internalBase: null, endpoint: 'https://t.example' }

  test('a failed transcoder carries its reason and detail and no data', () => {
    const out = shapeTranscoderDashboard(
      [{ ...target, result: { ok: false, reason: 'unauthorized', detail: 'refused the key in WEBHOOK_ID' } }],
      new Map(),
      new Map(),
      now
    )
    expect(out.transcoders[0]).toEqual({
      serverId: 'default',
      serverLabel: 'Home',
      endpoint: 'https://t.example',
      internal: false,
      keyVariable: 'WEBHOOK_ID',
      ok: false,
      reason: 'unauthorized',
      detail: 'refused the key in WEBHOOK_ID',
    })
    expect(out.generatedAt).toBe('2026-10-22T12:00:00.000Z')
  })

  test('sessions are joined to titles and viewers and grouped by title', () => {
    const film = pathKey('movies/A/A.mkv')
    const stray = pathKey('movies/B/B.mkv')
    const filmId = sessionVideoId(film)
    const sessions = [
      { id: 3, kind: 'audio', path_key: film },
      { id: 1, kind: 'video', path_key: film },
      { id: 2, kind: 'video', path_key: stray },
    ]
    const out = shapeTranscoderDashboard(
      [{ ...target, result: { ok: true, ms: 4, data: { schema: 1, version: '0.1.0', load: { queued: 0 }, capacity: {}, gpu: [], sessions } } }],
      new Map([[filmId, { kind: 'movie', title: 'A Film', duration: 5_400_000 }]]),
      new Map([[filmId, [{ name: 'Sam', state: 'playing', positionSec: 61 }]]]),
      now
    )
    const t = out.transcoders[0]
    expect(t.ok).toBe(true)
    const byId = Object.fromEntries(t.sessions.map((s) => [s.id, s]))
    expect(byId[1].title).toEqual({ kind: 'movie', name: 'A Film', durationSec: 5400 })
    expect(byId[1].viewers).toEqual([{ name: 'Sam', state: 'playing', positionSec: 61 }])
    expect(byId[3].title).toEqual({ kind: 'movie', name: 'A Film', durationSec: 5400 })
    expect(byId[2].title).toBeNull()
    expect(byId[2].file).toBe('B.mkv')
    expect(byId[2].viewers).toEqual([])
    // A title's video session sits right before its audio session.
    const order = t.sessions.map((s) => s.id)
    expect(order.indexOf(3)).toBe(order.indexOf(1) + 1)
  })

  test("recent problems are joined to their titles and aged against the answer's time", () => {
    const film = pathKey('movies/A/A.mkv')
    const filmId = sessionVideoId(film)
    const recent_problems = [
      { at_unix_ms: now.getTime() - 90_000, event: 'stalled', kind: 'video', stream: 'v/s3', path_key: film, detail: 'encode stalled: no new segment in 27s' },
      { at_unix_ms: now.getTime() - 5_000, event: 'failed', kind: 'audio', stream: 'a/aac/en', path_key: pathKey('movies/Gone/Gone.mkv'), detail: 'x' },
    ]
    const out = shapeTranscoderDashboard(
      [{ ...target, result: { ok: true, ms: 1, data: { schema: 1, sessions: [], recent_problems } } }],
      new Map([[filmId, { kind: 'movie', title: 'A Film' }]]),
      new Map(),
      now
    )
    const [a, b] = out.transcoders[0].problems
    expect(a).toMatchObject({ event: 'stalled', age_ms: 90_000, title: { kind: 'movie', name: 'A Film' } })
    expect(b).toMatchObject({ event: 'failed', title: null, file: 'Gone.mkv' })
  })

  test('an older transcoder without the problem log yields an empty list', () => {
    const out = shapeTranscoderDashboard(
      [{ ...target, result: { ok: true, ms: 1, data: { schema: 1, sessions: [] } } }],
      new Map(),
      new Map(),
      now
    )
    expect(out.transcoders[0].problems).toEqual([])
  })
})
