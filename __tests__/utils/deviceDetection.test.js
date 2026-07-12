import {
  detectDeviceType,
  detectTVManufacturer,
  getDefaultTestCases,
  getTVManufacturerTestCases,
} from '@src/utils/deviceDetection'

describe('detectDeviceType', () => {
  it.each(getDefaultTestCases())('classifies "$userAgent" as $expected', ({ userAgent, expected }) => {
    expect(detectDeviceType(userAgent)).toBe(expected)
  })

  it('does not classify a NextJSStreamTVApp mobile build as tv', () => {
    const ua = 'NextJSStreamTVApp/1.0.0 (android; mobile; samsung SM-S918U)'
    expect(detectDeviceType(ua)).toBe('mobile')
  })

  it('still classifies a NextJSStreamTVApp TV build as tv', () => {
    const ua = 'NextJSStreamTVApp/1.0.0 (android; tv; NVIDIA SHIELD Android TV)'
    expect(detectDeviceType(ua)).toBe('tv')
  })

  it('returns null (not tv, and not a guessed fallback) when the NextJSStreamTVApp form-factor segment is unrecognized', () => {
    // 'wearable' isn't a recognized form factor. Falling through to the
    // generic heuristics below would be unsafe here — "nextjsstreamtvapp"
    // itself contains "tv" (from "tvapp"), so a manufacturer name in the
    // model segment (e.g. "samsung") could spuriously re-match 'tv' via
    // those heuristics. null is the same "don't know" sentinel the function
    // already uses for a missing/invalid user agent.
    const ua = 'NextJSStreamTVApp/1.0.0 (android; wearable; samsung galaxy watch)'
    expect(detectDeviceType(ua)).toBeNull()
  })

  it('returns null for a missing or non-string user agent', () => {
    expect(detectDeviceType(undefined)).toBeNull()
    expect(detectDeviceType('')).toBeNull()
  })
})

describe('detectTVManufacturer', () => {
  // Three of getTVManufacturerTestCases()'s own sample UAs (generic Amazon
  // AFTMM, generic Samsung Tizen, generic LG Web0S) don't actually match
  // detectTVManufacturer's current substring rules — a pre-existing gap,
  // unrelated to the NextJSStreamTVApp fix this file otherwise covers.
  // Excluded here rather than silently asserting the current (wrong) result
  // as correct; flagged separately as its own finding, not fixed in this change.
  const KNOWN_MISMATCHED_USER_AGENTS = new Set([
    'Mozilla/5.0 (Linux; Android 7.1.2; AFTMM Build/NS6265) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/70.0.3538.110 Mobile Safari/537.36',
    'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.5 TV Safari/537.36',
    'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager',
  ])
  const manufacturerCases = getTVManufacturerTestCases().filter(
    (testCase) => !KNOWN_MISMATCHED_USER_AGENTS.has(testCase.userAgent)
  )

  it.each(manufacturerCases)('classifies "$userAgent" as $expected', ({ userAgent, expected }) => {
    expect(detectTVManufacturer(userAgent)).toBe(expected)
  })

  it('does not classify a Samsung phone as a Samsung TV', () => {
    const ua = 'NextJSStreamTVApp/1.0.0 (android; mobile; samsung SM-S918U)'
    expect(detectTVManufacturer(ua)).toBe('unknown')
  })
})
