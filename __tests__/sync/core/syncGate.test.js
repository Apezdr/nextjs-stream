/**
 * @jest-environment node
 *
 * The skip gate's bookkeeping: what counts as a change to a document, and what
 * the per-server gate map becomes after a pass. See core/syncGate for the rule.
 */

jest.mock('@src/utils/config', () => ({ getServer: () => ({ priority: 1 }), multiServerHandler: {} }))
jest.mock('@src/utils/sync/captions', () => ({ sortSubtitleEntries: jest.fn() }))

const {
  SYNC_GATE_VERSION,
  buildSyncGate,
  readSyncGate,
  changesDocument,
  nextSyncGates,
  clearSyncGates,
} = require('@src/utils/sync/core/syncGate')
const { payloadFingerprint } = require('@src/utils/sync/utils')

describe('buildSyncGate / readSyncGate', () => {
  it('moves when the payload or the who-has-what picture moves', () => {
    const gate = buildSyncGate('payload', 'availability')
    expect(buildSyncGate('payload2', 'availability')).not.toBe(gate)
    expect(buildSyncGate('payload', 'availability2')).not.toBe(gate)
    expect(buildSyncGate('payload', 'availability')).toBe(gate)
  })

  it('carries the rules version, so a change of rules reopens every gate', () => {
    expect(buildSyncGate('payload', 'availability')).toBe(`g${SYNC_GATE_VERSION}:payload#availability`)
  })

  it('reads one server\'s gate, and nothing from a document without any', () => {
    expect(readSyncGate({ syncGates: { A: 'g1', B: 'g2' } }, 'B')).toBe('g2')
    expect(readSyncGate({ syncGates: { A: 'g1' } }, 'B')).toBeUndefined()
    // A document from before gates existed has only the old single hash.
    expect(readSyncGate({ syncHash: 'legacy' }, 'A')).toBeUndefined()
    expect(readSyncGate(null, 'A')).toBeUndefined()
    expect(readSyncGate({ syncGates: { A: '' } }, 'A')).toBeUndefined()
  })
})

describe('payloadFingerprint', () => {
  it('is the same for the same payload and different for a changed one', () => {
    const payload = { urls: { mp4: '/a.mkv' }, hdr: null }
    expect(payloadFingerprint(payload)).toBe(payloadFingerprint(JSON.parse(JSON.stringify(payload))))
    expect(payloadFingerprint({ ...payload, hdr: 'HDR10' })).not.toBe(payloadFingerprint(payload))
    expect(payloadFingerprint(payload)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('accepts a missing payload', () => {
    expect(payloadFingerprint(undefined)).toBe(payloadFingerprint(null))
  })
})

describe('changesDocument', () => {
  const existing = { title: 'Film', videoURL: 'a', duration: 10, syncHash: 'h', lastSynced: 1 }

  it('is true for a new document', () => {
    expect(changesDocument(null, { title: 'Film' })).toBe(true)
  })

  it('is false when only the sync\'s own bookkeeping differs', () => {
    expect(
      changesDocument(existing, {
        ...existing,
        syncHash: 'h2',
        syncGates: { A: 'g' },
        contentHash: 'c',
        lastSynced: 2,
        updatedAt: 3,
        syncRunId: 'run',
      })
    ).toBe(false)
  })

  it('is true when a field of the title differs', () => {
    expect(changesDocument(existing, { ...existing, duration: 11 })).toBe(true)
    expect(changesDocument(existing, { duration: 11 })).toBe(true)
    expect(changesDocument(existing, { duration: 10 })).toBe(false)
  })

  it('compares nested values by content', () => {
    const doc = { captionURLs: { English: { url: 'u' } } }
    expect(changesDocument(doc, { captionURLs: { English: { url: 'u' } } })).toBe(false)
    expect(changesDocument(doc, { captionURLs: { English: { url: 'v' } } })).toBe(true)
  })

  it('counts a removal only when the document has the field', () => {
    expect(changesDocument(existing, existing, ['duration'])).toBe(true)
    expect(changesDocument(existing, existing, ['hdr'])).toBe(false)
  })

  it('does not count a field an admin locked, set or removed', () => {
    const locked = { ...existing, lockedFields: { duration: true } }
    expect(changesDocument(locked, { ...locked, duration: 99 })).toBe(false)
    expect(changesDocument(locked, locked, ['duration'])).toBe(false)
  })
})

describe('nextSyncGates', () => {
  it('adds this server\'s gate beside the others when nothing changed', () => {
    expect(nextSyncGates({ A: 'a1' }, 'B', 'b1', false)).toEqual({ A: 'a1', B: 'b1' })
    expect(nextSyncGates(undefined, 'B', 'b1', false)).toEqual({ B: 'b1' })
  })

  it('keeps only this server\'s gate when the pass changed the document', () => {
    expect(nextSyncGates({ A: 'a1', B: 'b0' }, 'B', 'b1', true)).toEqual({ B: 'b1' })
  })

  it('drops every gate when the pass changed the document and may not be stamped', () => {
    expect(nextSyncGates({ A: 'a1', B: 'b0' }, 'B', null, true)).toEqual({})
  })

  it('drops only this server\'s gate when its pass did not complete and changed nothing', () => {
    expect(nextSyncGates({ A: 'a1', B: 'b0' }, 'B', null, false)).toEqual({ A: 'a1' })
    expect(nextSyncGates({ A: 'a1' }, 'B', null, false)).toEqual({ A: 'a1' })
  })

  it('does not mutate the stored map', () => {
    const stored = { A: 'a1' }
    nextSyncGates(stored, 'B', 'b1', true)
    expect(stored).toEqual({ A: 'a1' })
  })
})

describe('clearSyncGates', () => {
  const database = (modifiedCount, failing) => {
    const calls = []
    return {
      calls,
      collection: (name) => ({
        updateMany: async (filter, update) => {
          calls.push([name, filter, update])
          if (name === failing) throw new Error('not primary')
          return { modifiedCount }
        },
      }),
    }
  }

  it('removes the gates from every collection that carries them, and nothing else', async () => {
    const db = database(3)
    expect(await clearSyncGates(db)).toBe(12)

    expect(db.calls.map(([name]) => name).sort()).toEqual(['FlatEpisodes', 'FlatMovies', 'FlatSeasons', 'FlatTVShows'])
    for (const [, filter, update] of db.calls) {
      expect(filter).toEqual({ syncGates: { $exists: true } })
      expect(update).toEqual({ $unset: { syncGates: '' } })
    }
  })

  it('throws when a collection could not be updated, so the caller does not write under stale gates', async () => {
    await expect(clearSyncGates(database(0, 'FlatEpisodes'))).rejects.toThrow('not primary')
  })
})
