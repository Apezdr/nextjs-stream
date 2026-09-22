/**
 * tmdb_id_source is what decides whether a title can ever be auto-corrected
 * by Radarr/Sonarr (src/utils/admin/identitySource.js). The editor's caption
 * and the value it sends back both come from these helpers.
 */

import {
  describeIdentitySource,
  sanitizeIdentitySource,
  providerLabel,
  IDENTITY_SOURCE_AUTO,
  IDENTITY_SOURCE_MANUAL,
} from '@src/utils/admin/identitySource'

describe('sanitizeIdentitySource', () => {
  it('accepts the processor token shape and lowercases it', () => {
    expect(sanitizeIdentitySource('radarr')).toBe('radarr')
    expect(sanitizeIdentitySource(' Sonarr ')).toBe('sonarr')
    expect(sanitizeIdentitySource('kodi-nfo_v2')).toBe('kodi-nfo_v2')
  })

  it('drops anything the processor would reject', () => {
    expect(sanitizeIdentitySource('')).toBeNull()
    expect(sanitizeIdentitySource('   ')).toBeNull()
    expect(sanitizeIdentitySource('1radarr')).toBeNull()
    expect(sanitizeIdentitySource('has space')).toBeNull()
    expect(sanitizeIdentitySource('x'.repeat(33))).toBeNull()
    expect(sanitizeIdentitySource(42)).toBeNull()
    expect(sanitizeIdentitySource(null)).toBeNull()
  })
})

describe('describeIdentitySource', () => {
  it('names a provider pin after the provider', () => {
    const info = describeIdentitySource('radarr')
    expect(info.kind).toBe('provider')
    expect(info.label).toBe('Pinned by Radarr')
    expect(info.provider).toBe('radarr')
  })

  it('distinguishes a hand pin from an automatic match', () => {
    expect(describeIdentitySource(IDENTITY_SOURCE_MANUAL)).toMatchObject({ kind: 'manual', label: 'Pinned by hand' })
    expect(describeIdentitySource(IDENTITY_SOURCE_AUTO)).toMatchObject({ kind: 'auto', label: 'Matched by name' })
  })

  it('explains a legacy pin with no source as one the processor treats as hand-pinned', () => {
    const info = describeIdentitySource(undefined)
    expect(info.kind).toBe('unrecorded')
    expect(info.detail).toMatch(/pinned by hand/i)
  })

  it('says so when there is no pin at all', () => {
    expect(describeIdentitySource('radarr', { hasId: false })).toMatchObject({ kind: 'none', label: 'Not pinned' })
  })
})

describe('providerLabel', () => {
  it('capitalizes a token and tolerates nothing', () => {
    expect(providerLabel('sonarr')).toBe('Sonarr')
    expect(providerLabel('')).toBe('')
    expect(providerLabel(undefined)).toBe('')
  })
})
