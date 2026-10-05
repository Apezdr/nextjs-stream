/**
 * The viewing-experience flags a file server reports are stored as reported,
 * and a changed flag counts as a change to write.
 */

import {
  preferReportedViewingExperience,
  sameViewingExperience,
} from '@src/utils/sync/core/viewingExperience'

// What the movie sync rebuilds for an HDR file when the payload names no
// hdr_format: HDR, but neither Dolby Vision nor HDR10+.
const REBUILT_HDR = {
  enhancedColor: true,
  highDynamicRange: true,
  dolbyVision: false,
  hdr10Plus: false,
  standardHDR: true,
}

// What a file server reports for a Dolby Vision file with an HDR10 base layer
// (the `mediaQuality.viewingExperience` in its `.info` sidecar).
const REPORTED_DOLBY_VISION = {
  enhancedColor: true,
  highDynamicRange: true,
  dolbyVision: true,
  hdr10Plus: false,
  standardHDR: true,
}

describe('preferReportedViewingExperience', () => {
  it('takes every flag the server reported', () => {
    const reported = { ...REPORTED_DOLBY_VISION, hdr10Plus: true, standardHDR: false }
    expect(preferReportedViewingExperience(REBUILT_HDR, reported)).toEqual(reported)
  })

  it('stores the Dolby Vision flag the movie sync used to lose', () => {
    const merged = preferReportedViewingExperience(REBUILT_HDR, REPORTED_DOLBY_VISION)
    expect(merged.dolbyVision).toBe(true)
  })

  it('keeps the rebuilt flags when the server reported none', () => {
    expect(preferReportedViewingExperience(REBUILT_HDR, undefined)).toEqual(REBUILT_HDR)
    expect(preferReportedViewingExperience(REBUILT_HDR, null)).toEqual(REBUILT_HDR)
    expect(preferReportedViewingExperience(REBUILT_HDR, 'Dolby Vision')).toEqual(REBUILT_HDR)
  })

  it('keeps the rebuilt value for a flag the server left out or sent as a non-boolean', () => {
    const merged = preferReportedViewingExperience(REBUILT_HDR, {
      dolbyVision: true,
      hdr10Plus: 'yes',
    })
    expect(merged).toEqual({ ...REBUILT_HDR, dolbyVision: true })
  })

  it('ignores keys that are not viewing-experience flags', () => {
    const merged = preferReportedViewingExperience(REBUILT_HDR, { dolbyVision: true, extra: true })
    expect(merged).not.toHaveProperty('extra')
  })

  it('does not mutate the rebuilt flags', () => {
    const rebuilt = { ...REBUILT_HDR }
    preferReportedViewingExperience(rebuilt, { dolbyVision: true })
    expect(rebuilt).toEqual(REBUILT_HDR)
  })
})

describe('sameViewingExperience', () => {
  it('sees a corrected Dolby Vision flag as a change', () => {
    expect(sameViewingExperience(REBUILT_HDR, REPORTED_DOLBY_VISION)).toBe(false)
  })

  it('treats identical flags as unchanged, whatever the key order', () => {
    const reordered = {
      standardHDR: true,
      hdr10Plus: false,
      dolbyVision: true,
      highDynamicRange: true,
      enhancedColor: true,
    }
    expect(sameViewingExperience(reordered, REPORTED_DOLBY_VISION)).toBe(true)
  })

  it('sees flags appearing on a document that stored none as a change', () => {
    expect(sameViewingExperience(undefined, REPORTED_DOLBY_VISION)).toBe(false)
    expect(sameViewingExperience(null, REPORTED_DOLBY_VISION)).toBe(false)
  })

  it('treats a missing object and an empty one as the same', () => {
    expect(sameViewingExperience(undefined, null)).toBe(true)
    expect(sameViewingExperience(undefined, {})).toBe(true)
  })
})
