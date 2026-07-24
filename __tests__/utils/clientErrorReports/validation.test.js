import { validateClientErrorReport, VALID_SEVERITIES } from '@src/utils/clientErrorReports/validation'

function validBody(overrides = {}) {
  return {
    schemaVersion: 1,
    category: 'playback',
    severity: 'fatal',
    message: 'MediaCodecVideoRenderer error, format_supported=NO_UNSUPPORTED_TYPE',
    dedupeKey: 'playback:8f3a2c91',
    occurredAt: '2026-07-23T21:04:11.302Z',
    app: { version: '1.4.2', otaUpdateId: 'a1b2c3', platform: 'android', isTV: true },
    device: {
      model: 'BRAVIA 4K VH2',
      brand: 'Sony',
      manufacturer: 'Sony',
      osVersion: '10',
      apiLevel: 29,
    },
    details: {
      videoURL: 'https://transcoder.example.com/stream/x/master.m3u8',
      playerStatus: 'error',
      playbackSessionId: '6a1f6f0e-2b0c-4e0a-9a7e-1c2d3e4f5a6b',
      mediaId: 'backrooms-2026',
      mediaType: 'movie',
      codecSupport: [],
    },
    ...overrides,
  }
}

describe('validateClientErrorReport', () => {
  it('accepts the contract example payload', () => {
    const result = validateClientErrorReport(validBody())
    expect(result.valid).toBe(true)
    expect(result.report.category).toBe('playback')
    expect(result.report.severity).toBe('fatal')
    expect(result.report.dedupeKey).toBe('playback:8f3a2c91')
    expect(result.report.app.isTV).toBe(true)
    expect(result.report.occurredAtDate).toBeInstanceOf(Date)
    expect(result.report.messageTruncated).toBe(false)
  })

  it.each([null, undefined, 'string', 42, []])('rejects non-object body %p', (body) => {
    expect(validateClientErrorReport(body).valid).toBe(false)
  })

  it('rejects unsupported schemaVersion', () => {
    expect(validateClientErrorReport(validBody({ schemaVersion: 2 })).valid).toBe(false)
    expect(validateClientErrorReport(validBody({ schemaVersion: '1' })).valid).toBe(false)
  })

  it('rejects invalid severity but accepts every documented one', () => {
    expect(validateClientErrorReport(validBody({ severity: 'info' })).valid).toBe(false)
    for (const severity of VALID_SEVERITIES) {
      expect(validateClientErrorReport(validBody({ severity })).valid).toBe(true)
    }
  })

  it('accepts unknown (extensible) categories but rejects empty/oversized ones', () => {
    expect(validateClientErrorReport(validBody({ category: 'subtitles' })).valid).toBe(true)
    expect(validateClientErrorReport(validBody({ category: '' })).valid).toBe(false)
    expect(validateClientErrorReport(validBody({ category: 'x'.repeat(51) })).valid).toBe(false)
  })

  it('rejects missing required envelope fields', () => {
    expect(validateClientErrorReport(validBody({ message: '' })).valid).toBe(false)
    expect(validateClientErrorReport(validBody({ dedupeKey: '' })).valid).toBe(false)
    expect(validateClientErrorReport(validBody({ occurredAt: undefined })).valid).toBe(false)
    expect(validateClientErrorReport(validBody({ app: undefined })).valid).toBe(false)
    expect(validateClientErrorReport(validBody({ app: { platform: 'android' } })).valid).toBe(false)
    expect(validateClientErrorReport(validBody({ app: { version: '1.0.0' } })).valid).toBe(false)
  })

  it('tolerates missing optional device and details', () => {
    const result = validateClientErrorReport(validBody({ device: undefined, details: undefined }))
    expect(result.valid).toBe(true)
    expect(result.report.device.model).toBeNull()
    expect(result.report.details).toEqual({})
  })

  it('rejects non-object device/details', () => {
    expect(validateClientErrorReport(validBody({ device: 'BRAVIA' })).valid).toBe(false)
    expect(validateClientErrorReport(validBody({ details: [1, 2] })).valid).toBe(false)
  })

  it('truncates oversized messages and flags them', () => {
    const result = validateClientErrorReport(validBody({ message: 'x'.repeat(40000) }))
    expect(result.valid).toBe(true)
    expect(result.report.message).toHaveLength(32000)
    expect(result.report.messageTruncated).toBe(true)
  })

  it('keeps the raw occurredAt string and nulls the parsed date when unparseable', () => {
    const result = validateClientErrorReport(validBody({ occurredAt: 'not-a-date' }))
    expect(result.valid).toBe(true)
    expect(result.report.occurredAt).toBe('not-a-date')
    expect(result.report.occurredAtDate).toBeNull()
  })

  it('drops unknown top-level keys and coerces isTV', () => {
    const result = validateClientErrorReport(
      validBody({ evil: 'payload', app: { version: '1.0.0', platform: 'ios', isTV: 'yes' } })
    )
    expect(result.valid).toBe(true)
    expect(result.report.evil).toBeUndefined()
    expect(result.report.app.isTV).toBe(false)
  })

  it('passes details through verbatim', () => {
    const details = { anything: { nested: [1, 2, 3] }, custom: true }
    const result = validateClientErrorReport(validBody({ details }))
    expect(result.valid).toBe(true)
    expect(result.report.details).toEqual(details)
  })
})
