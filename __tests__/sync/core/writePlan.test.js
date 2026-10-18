/**
 * @jest-environment node
 *
 * Merging a pass's write plans into one write, and the gate decision that
 * reads it. See core/writePlan for the rule.
 */

jest.mock('@src/utils/config', () => ({ getServer: () => ({ priority: 1 }), multiServerHandler: {} }))

const { mergeWritePlans, emptyWritePlan } = require('@src/utils/sync/core/writePlan')
const { decideGate } = require('@src/utils/sync/core/syncGate')

const plan = (over = {}) => ({ ...emptyWritePlan(), ...over })

describe('mergeWritePlans: set', () => {
  it('takes a later plan\'s value for a field an earlier one set', () => {
    const merged = mergeWritePlans([plan({ set: { a: 1, b: 1 } }), plan({ set: { b: 2 } }), plan({ set: { b: 3, c: 3 } })])
    expect(merged.set).toEqual({ a: 1, b: 3, c: 3 })
  })

  it('keeps a field where it was first set, and adds new ones in order', () => {
    const merged = mergeWritePlans([plan({ set: { a: 1, b: 1 } }), plan({ set: { c: 2, a: 2 } }), plan({ set: { d: 3 } })])
    expect(Object.keys(merged.set)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('writes a value a later plan sets to null or undefined, as that plan says', () => {
    const merged = mergeWritePlans([plan({ set: { a: 1, b: 1 } }), plan({ set: { a: null, b: undefined } })])
    expect(merged.set).toEqual({ a: null, b: undefined })
    expect(Object.keys(merged.set)).toEqual(['a', 'b'])
  })

  it('does not change the plans it is given', () => {
    const first = plan({ set: { a: 1 }, unset: ['x'], deferrals: ['d1'] })
    const second = plan({ set: { a: 2 }, unset: ['a'] })
    const before = JSON.stringify([first, second])
    mergeWritePlans([first, second])
    expect(JSON.stringify([first, second])).toBe(before)
  })
})

describe('mergeWritePlans: unset', () => {
  it('lists every removal once, in the order they were asked for', () => {
    const merged = mergeWritePlans([plan({ unset: ['x', 'y'] }), plan({ unset: ['y', 'z'] }), plan({ unset: ['x'] })])
    expect(merged.unset).toEqual(['x', 'y', 'z'])
  })

  it('drops a removal when the merged set writes the same field, whichever plan came first', () => {
    const removedThenSet = mergeWritePlans([plan({ unset: ['a', 'x'] }), plan({ set: { a: 1 } })])
    const setThenRemoved = mergeWritePlans([plan({ set: { a: 1 } }), plan({ unset: ['a', 'x'] })])
    for (const merged of [removedThenSet, setThenRemoved]) {
      expect(merged.set).toEqual({ a: 1 })
      expect(merged.unset).toEqual(['x'])
    }
  })
})

describe('mergeWritePlans: needs, deferrals, incomplete and the gate', () => {
  it('collects every plan\'s needs and deferrals, in order', () => {
    const need = (path) => ({ kind: 'blurhash', serverId: 'A', path })
    const merged = mergeWritePlans([
      plan({ needs: [need('/p')], deferrals: ['metadata'] }),
      plan(),
      plan({ needs: [need('/b')], deferrals: ['posterBlurhash', 'videoURL'] }),
    ])
    expect(merged.needs).toEqual([need('/p'), need('/b')])
    expect(merged.deferrals).toEqual(['metadata', 'posterBlurhash', 'videoURL'])
  })

  it('stamps the gate when no plan held anything back, including when nothing is written', () => {
    expect(mergeWritePlans([plan(), plan()])).toMatchObject({ incomplete: false, gate: 'stamp' })
    expect(mergeWritePlans([plan({ set: { a: 1 }, unset: ['b'] })])).toMatchObject({ incomplete: false, gate: 'stamp' })
    expect(mergeWritePlans([])).toEqual({ ...emptyWritePlan(), gate: 'stamp' })
  })

  it('leaves the gate open when any one plan held something back', () => {
    for (const at of [0, 1, 2]) {
      const plans = [plan(), plan(), plan()]
      plans[at] = plan({ incomplete: true, deferrals: ['video'] })
      expect(mergeWritePlans(plans)).toMatchObject({ incomplete: true, gate: 'leaveOpen' })
    }
  })

  it('reads incomplete alone: a plan that writes nothing can still hold the gate open', () => {
    const merged = mergeWritePlans([plan({ set: { a: 1 } }), plan({ incomplete: true })])
    expect(merged.gate).toBe('leaveOpen')
    expect(decideGate({ incomplete: merged.incomplete })).toBe('leaveOpen')
    expect(decideGate({ incomplete: false })).toBe('stamp')
  })
})

describe('draftWritePlan: the plan of a builder that edits a copy of the stored document', () => {
  const { draftWritePlan } = require('@src/utils/sync/core/writePlan')

  it('sets the fields the copy changed or added, in the copy\'s order, and nothing it left alone', () => {
    const shared = { nested: true }
    const existing = { a: 1, b: shared, c: 'x' }
    const draft = { ...existing, c: 'y', d: 2, a: 1 }
    const { set } = draftWritePlan(existing, draft, [])
    expect(set).toEqual({ c: 'y', d: 2 })
    expect(Object.keys(set)).toEqual(['c', 'd'])
  })

  it('sets a field the stored document holds as an equal but distinct object', () => {
    const existing = { meta: { name: 'n' } }
    expect(draftWritePlan(existing, { meta: { name: 'n' } }, []).set).toEqual({ meta: { name: 'n' } })
  })

  it('sets every field of a new document, and takes the removals as given', () => {
    const plan = draftWritePlan(null, { title: 't', type: 'season' }, ['gone'])
    expect(plan).toEqual({ set: { title: 't', type: 'season' }, unset: ['gone'] })
  })
})

describe('applyWritePlan: the document a plan leaves', () => {
  const { applyWritePlan, draftWritePlan } = require('@src/utils/sync/core/writePlan')

  it('writes the set over the stored document in place, adds new fields last, and makes the removals', () => {
    const doc = applyWritePlan({ a: 1, b: 2, c: 3 }, { set: { d: 4, b: 9 }, unset: ['c'] })
    expect(doc).toEqual({ a: 1, b: 9, d: 4 })
    expect(Object.keys(doc)).toEqual(['a', 'b', 'd'])
  })

  it('does not make a removal of a field the plan also sets, and does not change its inputs', () => {
    const existing = { a: 1 }
    const plan = { set: { a: 2 }, unset: ['a'] }
    expect(applyWritePlan(existing, plan)).toEqual({ a: 2 })
    expect(existing).toEqual({ a: 1 })
    expect(applyWritePlan(null, { set: { a: 1 }, unset: ['b'] })).toEqual({ a: 1 })
  })

  it('gives back the copy a builder edited, given its plan', () => {
    const existing = { _id: 's1', title: 'Season 1', posterBlurhash: 'old', episodeCount: 3 }
    const draft = { ...existing, lastSynced: 'now', title: 'Named', posterURL: 'p' }
    delete draft.posterBlurhash
    expect(applyWritePlan(existing, draftWritePlan(existing, draft, ['posterBlurhash']))).toEqual(draft)
  })
})

describe('cleanupWritePlan: field-absence cleanup as a plan', () => {
  const { cleanupWritePlan } = require('@src/utils/sync/core/writePlan')

  it('removes what the cleanup removes, and holds the gate open for a removal it held back', () => {
    expect(cleanupWritePlan({ unset: ['logo', 'logoSource'], changes: [] })).toEqual({
      ...emptyWritePlan(), unset: ['logo', 'logoSource'],
    })
    expect(cleanupWritePlan({ changes: [], withheld: true })).toEqual({
      ...emptyWritePlan(), incomplete: true, deferrals: ['field-absence cleanup'],
    })
    expect(cleanupWritePlan({ changes: [] })).toEqual(emptyWritePlan())
  })
})
