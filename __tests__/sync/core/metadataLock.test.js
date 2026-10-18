/**
 * @jest-environment node
 *
 * The metadata lock: which copy of a document's metadata a pass ends with, and
 * so which copy its derived fields (title, dates, counts) are read from. See
 * the module header; each case here is one step of it.
 */

const { effectiveMetadata } = require('@src/utils/sync/core/metadataLock')

const STORED = { metadata: { title: 'Stored', episode_count: 6 }, metadataSource: 'B' }
const FETCHED = { metadata: { title: 'Fetched', episode_count: 8 }, metadataSource: 'A' }

describe('effectiveMetadata', () => {
  it('writes the copy the pass brings, and derives from it', () => {
    expect(effectiveMetadata({ stored: STORED, incoming: FETCHED, locked: false })).toEqual({
      action: 'write',
      metadata: FETCHED.metadata,
      metadataSource: 'A',
    })
  })

  it('keeps the stored copy while an admin has locked it, whatever the pass brings', () => {
    expect(effectiveMetadata({ stored: STORED, incoming: FETCHED, locked: true })).toEqual({
      action: 'keep',
      metadata: STORED.metadata,
      metadataSource: 'B',
      locked: true,
    })
  })

  it('keeps a locked copy even when the source says there is none any more', () => {
    expect(effectiveMetadata({ stored: STORED, incoming: null, gone: true, locked: true })).toMatchObject({
      action: 'keep',
      metadata: STORED.metadata,
    })
  })

  it('keeps the stored copy when the pass brings none', () => {
    for (const incoming of [null, undefined, {}, { metadata: null, metadataSource: 'A' }]) {
      expect(effectiveMetadata({ stored: STORED, incoming, locked: false })).toEqual({
        action: 'keep',
        metadata: STORED.metadata,
        metadataSource: 'B',
        locked: false,
      })
    }
  })

  it('removes the stored copy when the source says there is none any more', () => {
    expect(effectiveMetadata({ stored: STORED, incoming: null, gone: true, locked: false })).toEqual({
      action: 'remove',
      metadata: undefined,
      metadataSource: undefined,
    })
  })

  it('has nothing to remove from a document that holds no metadata', () => {
    expect(effectiveMetadata({ stored: { metadataSource: 'B' }, incoming: null, gone: true, locked: false })).toMatchObject({
      action: 'keep',
      metadata: undefined,
    })
    expect(effectiveMetadata({ stored: null, incoming: null, gone: true, locked: false })).toMatchObject({ action: 'keep' })
  })

  it('writes over a source that is gone when the pass brings a copy after all', () => {
    expect(effectiveMetadata({ stored: STORED, incoming: FETCHED, gone: true, locked: false }).action).toBe('write')
  })

  it('keeps the stored source for an incoming copy that names none', () => {
    expect(
      effectiveMetadata({ stored: STORED, incoming: { metadata: FETCHED.metadata }, locked: false })
    ).toMatchObject({ action: 'write', metadataSource: 'B' })
  })

  it('writes the first copy of a new document', () => {
    expect(effectiveMetadata({ stored: null, incoming: FETCHED, locked: false })).toEqual({
      action: 'write',
      metadata: FETCHED.metadata,
      metadataSource: 'A',
    })
  })

  it('takes an empty object as a copy: judging what was fetched is the caller\'s', () => {
    expect(effectiveMetadata({ stored: STORED, incoming: { metadata: {}, metadataSource: 'A' }, locked: false })).toMatchObject({
      action: 'write',
      metadata: {},
    })
  })
})
