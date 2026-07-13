import {
  getFeatureFlagStatus,
  shouldUseNewArchitecture,
  withFeatureFlagOverride,
} from '@src/utils/sync/featureFlags'

const originalValue = process.env.USE_NEW_SYNC_ARCHITECTURE

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'warn').mockImplementation(() => {})
  delete process.env.USE_NEW_SYNC_ARCHITECTURE
})

afterEach(() => {
  jest.restoreAllMocks()
  if (originalValue === undefined) delete process.env.USE_NEW_SYNC_ARCHITECTURE
  else process.env.USE_NEW_SYNC_ARCHITECTURE = originalValue
})

describe('sync architecture feature flag', () => {
  it.each(['true', '1', ' TRUE '])('enables the new architecture for %p', (value) => {
    process.env.USE_NEW_SYNC_ARCHITECTURE = value
    expect(shouldUseNewArchitecture()).toBe(true)
  })

  it.each(['false', '0', ' FALSE '])('enables rollback to the old architecture for %p', (value) => {
    process.env.USE_NEW_SYNC_ARCHITECTURE = value
    expect(shouldUseNewArchitecture()).toBe(false)
  })

  it('defaults to new when unset and fails closed for an invalid explicit value', () => {
    expect(shouldUseNewArchitecture()).toBe(true)
    process.env.USE_NEW_SYNC_ARCHITECTURE = 'unexpected'
    expect(shouldUseNewArchitecture()).toBe(false)
    expect(console.warn).toHaveBeenCalled()
  })

  it('reports an explicit disabled value as environment-controlled', () => {
    process.env.USE_NEW_SYNC_ARCHITECTURE = 'false'
    expect(getFeatureFlagStatus()).toMatchObject({
      environmentVariable: 'false',
      effectiveValue: false,
      source: 'environment',
    })
  })

  it('temporarily forces the old architecture and restores the original value', async () => {
    process.env.USE_NEW_SYNC_ARCHITECTURE = 'true'

    const result = await withFeatureFlagOverride(false, async () => ({
      enabled: shouldUseNewArchitecture(),
      raw: process.env.USE_NEW_SYNC_ARCHITECTURE,
    }))

    expect(result).toEqual({ enabled: false, raw: 'false' })
    expect(process.env.USE_NEW_SYNC_ARCHITECTURE).toBe('true')
  })
})
