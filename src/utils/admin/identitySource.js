/**
 * `tmdb_id_source` — who pinned a media folder's TMDB id.
 *
 * The media processor records provenance beside `tmdb_id` in each folder's
 * tmdb.config (media-processor `utils/tmdbConfig.mjs`). Its precedence rule
 * turns on this one field: a human pin is the only thing that beats an
 * identity provider (Radarr, Sonarr, …), and a provider is the only thing that
 * beats the processor's own name search. So what the editor shows here, and
 * what it sends back, decides whether a title can ever be auto-corrected.
 *
 * Values: 'manual' (a person set it), 'auto' (the processor's name search
 * chose it; any provider may replace it), or a provider's name. A pin with no
 * source predates provenance and the processor reads it as 'manual'.
 */

export const IDENTITY_SOURCE_MANUAL = 'manual'
export const IDENTITY_SOURCE_AUTO = 'auto'

/** Same token rule as the processor: short, lowercase, never renamed. */
const SOURCE_TOKEN = /^[a-z][a-z0-9_-]{0,31}$/

/**
 * Normalize a submitted source for the wire: a valid token, or null when it
 * should be dropped from the config (blank, malformed, or the wrong type).
 */
export function sanitizeIdentitySource(value) {
  if (typeof value !== 'string') return null
  const token = value.trim().toLowerCase()
  return SOURCE_TOKEN.test(token) ? token : null
}

/**
 * The provider-facing name for a source token: 'radarr' → 'Radarr'.
 */
export function providerLabel(source) {
  if (!source) return ''
  return source.charAt(0).toUpperCase() + source.slice(1)
}

/**
 * What to tell an operator about a pin's provenance.
 *
 * @param {string|null|undefined} source   the stored tmdb_id_source
 * @param {{ hasId?: boolean }} [options]  whether a tmdb_id is set at all
 * @returns {{ kind: 'none'|'manual'|'auto'|'provider'|'unrecorded', label: string, detail: string, provider: string|null }}
 */
export function describeIdentitySource(source, { hasId = true } = {}) {
  if (!hasId) {
    return { kind: 'none', label: 'Not pinned', detail: 'The processor will match this title by name on its next pass.', provider: null }
  }
  const token = sanitizeIdentitySource(source)
  if (!token) {
    return {
      kind: 'unrecorded',
      label: 'Pinned before tracking began',
      detail: 'Treated as pinned by hand: Radarr or Sonarr can flag a disagreement but will never change it.',
      provider: null,
    }
  }
  if (token === IDENTITY_SOURCE_MANUAL) {
    return { kind: 'manual', label: 'Pinned by hand', detail: 'Only a person can change this match.', provider: null }
  }
  if (token === IDENTITY_SOURCE_AUTO) {
    return {
      kind: 'auto',
      label: 'Matched by name',
      detail: 'The media server picked this from a title search. Radarr or Sonarr may correct it if they know better.',
      provider: null,
    }
  }
  return {
    kind: 'provider',
    label: `Pinned by ${providerLabel(token)}`,
    detail: `${providerLabel(token)} supplied this match. Editing the id here turns it into a hand pin.`,
    provider: token,
  }
}
