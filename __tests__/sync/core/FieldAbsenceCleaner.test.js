import { detectAbsentFields, planFieldCleanup } from '@src/utils/sync/core/FieldAbsenceCleaner'

// Minimal FieldAvailability builder: mediaType → availabilityKey → fieldPath → serverIds[]
function fa(tvBucket = {}) {
  return { movies: {}, tv: { Show: tvBucket } }
}

const THUMB_PATH = 'seasons.Season 2.episodes.S02E05.thumbnail'

const baseInput = (overrides = {}) => ({
  mediaType: 'tv',
  availabilityKey: 'Show',
  entity: { thumbnail: 'http://x/05.jpg', thumbnailSource: 'default' },
  fieldAvailability: fa({}), // nobody reports the thumbnail
  fields: [
    { entityField: 'thumbnail', fieldPath: THUMB_PATH, companions: ['thumbnailSource'] },
  ],
  allEnabledServersProbed: true,
  ...overrides,
})

describe('detectAbsentFields', () => {
  it('clears a field absent on all servers when value present and pass is authoritative', () => {
    const res = detectAbsentFields(baseInput())
    expect(res.aborted).toBe(false)
    expect(res.fieldsToUnset).toEqual(expect.arrayContaining(['thumbnail', 'thumbnailSource']))
    expect(res.changes[0]).toMatch(/Cleared thumbnail/)
  })

  it('no-ops when the pass is not authoritative (transient outage protection)', () => {
    const res = detectAbsentFields(baseInput({ allEnabledServersProbed: false }))
    expect(res.fieldsToUnset).toEqual([])
    expect(res.changes).toEqual([])
  })

  it('no-ops when some server still reports the field', () => {
    const res = detectAbsentFields(
      baseInput({ fieldAvailability: fa({ [THUMB_PATH]: ['default'] }) })
    )
    expect(res.fieldsToUnset).toEqual([])
  })

  it('no-ops when the field is already absent in the entity', () => {
    const res = detectAbsentFields(baseInput({ entity: { videoURL: 'x' } }))
    expect(res.fieldsToUnset).toEqual([])
    expect(res.changes).toEqual([])
  })

  it('treats an empty-object value as nothing to clear', () => {
    const res = detectAbsentFields(
      baseInput({
        entity: { captionURLs: {} },
        fields: [{ entityField: 'captionURLs', fieldPath: 'seasons.Season 2.episodes.S02E05.captions' }],
      })
    )
    expect(res.fieldsToUnset).toEqual([])
  })

  it('never clears an admin-locked field', () => {
    const res = detectAbsentFields(
      baseInput({
        entity: { thumbnail: 'http://x/05.jpg', thumbnailSource: 'default', lockedFields: { thumbnail: true } },
      })
    )
    expect(res.fieldsToUnset).toEqual([])
  })

  it('does not clear a locked companion but still clears the unlocked primary', () => {
    const res = detectAbsentFields(
      baseInput({
        entity: {
          thumbnail: 'http://x/05.jpg',
          thumbnailSource: 'default',
          lockedFields: { thumbnailSource: true },
        },
      })
    )
    expect(res.fieldsToUnset).toContain('thumbnail')
    expect(res.fieldsToUnset).not.toContain('thumbnailSource')
  })

  it('throws if asked to clear a protected/required field', () => {
    expect(() =>
      detectAbsentFields(
        baseInput({
          entity: { title: 'The Odd Couple' },
          fields: [{ entityField: 'title', fieldPath: 'seasons.Season 2.episodes.S02E05.title' }],
        })
      )
    ).toThrow(/protected field "title"/)
  })

  it('aborts the entity when more primary fields than the cap look absent', () => {
    const fields = ['a', 'b', 'c', 'd', 'e', 'f'].map((f) => ({
      entityField: f,
      fieldPath: `seasons.Season 2.episodes.S02E05.${f}`,
    }))
    const entity = {}
    for (const f of fields) entity[f.entityField] = 'value'
    const res = detectAbsentFields(baseInput({ entity, fields, maxFieldsPerEntity: 5 }))
    expect(res.aborted).toBe(true)
    expect(res.fieldsToUnset).toEqual([])
    expect(res.changes[0]).toMatch(/ABORTED/)
  })

  it('does not abort exactly at the cap', () => {
    const fields = ['a', 'b', 'c', 'd', 'e'].map((f) => ({
      entityField: f,
      fieldPath: `seasons.Season 2.episodes.S02E05.${f}`,
    }))
    const entity = {}
    for (const f of fields) entity[f.entityField] = 'value'
    const res = detectAbsentFields(baseInput({ entity, fields, maxFieldsPerEntity: 5 }))
    expect(res.aborted).toBe(false)
    expect(res.fieldsToUnset.sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('dedupes companions shared across fields', () => {
    const res = detectAbsentFields(
      baseInput({
        entity: { thumbnail: 'x', chapterURL: 'y', sharedSource: 'default' },
        fields: [
          { entityField: 'thumbnail', fieldPath: 'p1', companions: ['sharedSource'] },
          { entityField: 'chapterURL', fieldPath: 'p2', companions: ['sharedSource'] },
        ],
      })
    )
    const occurrences = res.fieldsToUnset.filter((f) => f === 'sharedSource').length
    expect(occurrences).toBe(1)
  })
})

describe('planFieldCleanup', () => {
  const planArgs = (overrides = {}) => ({
    cleanup: { enabled: true, mode: 'enforce', maxFieldsPerEntity: 5, allEnabledServersProbed: true },
    mediaType: 'tv',
    availabilityKey: 'Show',
    entity: { thumbnail: 'http://x/05.jpg', thumbnailSource: 'default' },
    fieldAvailability: fa({}), // nobody reports it → absent
    fields: [{ entityField: 'thumbnail', fieldPath: THUMB_PATH, companions: ['thumbnailSource'] }],
    log: jest.fn(),
    logContext: { show: 'Show', season: 2, episode: 5 },
    ...overrides,
  })

  it('returns empty plan and does not log when cleanup is disabled', () => {
    const log = jest.fn()
    const plan = planFieldCleanup(planArgs({ cleanup: undefined, log }))
    expect(plan).toEqual({ changes: [] })
    expect(log).not.toHaveBeenCalled()
  })

  it('enforce: returns unset + changes and logs once', () => {
    const log = jest.fn()
    const plan = planFieldCleanup(planArgs({ log }))
    expect(plan.unset).toEqual(expect.arrayContaining(['thumbnail', 'thumbnailSource']))
    expect(plan.changes.length).toBeGreaterThan(0)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toBe('field-absence cleanup (enforce)')
  })

  it('dry-run: logs and returns changes but NO unset', () => {
    const log = jest.fn()
    const plan = planFieldCleanup(
      planArgs({ cleanup: { enabled: true, mode: 'dry-run', maxFieldsPerEntity: 5, allEnabledServersProbed: true }, log })
    )
    expect(plan.unset).toBeUndefined()
    expect(plan.changes.length).toBeGreaterThan(0)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][1]).toBe('field-absence cleanup (dry-run)')
  })

  it('no candidates → empty plan, no log', () => {
    const log = jest.fn()
    const plan = planFieldCleanup(
      planArgs({ fieldAvailability: fa({ [THUMB_PATH]: ['default'] }), log }) // present → not absent
    )
    expect(plan).toEqual({ changes: [] })
    expect(log).not.toHaveBeenCalled()
  })
})
