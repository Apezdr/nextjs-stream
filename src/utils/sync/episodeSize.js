/**
 * Resolve an episode size reported by the file server into bytes together with
 * the exact field-availability suffix that supplied the value.
 *
 * Direct `size` values are already bytes. `additionalMetadata.size` may be a
 * byte count or an object containing one of `gb`, `mb`, or `kb`.
 *
 * @param {Object} episodeData
 * @returns {{ bytes: number, fieldSuffix: string } | null}
 */
export function resolveEpisodeSize(episodeData) {
  if (Number.isFinite(episodeData?.size)) {
    return { bytes: episodeData.size, fieldSuffix: 'size' }
  }

  const size = episodeData?.additionalMetadata?.size
  if (Number.isFinite(size)) {
    return { bytes: size, fieldSuffix: 'additionalMetadata.size' }
  }

  if (!size || typeof size !== 'object') return null

  const units = [
    ['gb', 1024 ** 3],
    ['mb', 1024 ** 2],
    ['kb', 1024],
  ]

  for (const [unit, multiplier] of units) {
    if (Number.isFinite(size[unit])) {
      return {
        bytes: Math.round(size[unit] * multiplier),
        fieldSuffix: `additionalMetadata.size.${unit}`,
      }
    }
  }

  return null
}

/**
 * All file-server representations that map to the single persisted `size`
 * field. Priority must be calculated across this union, not per unit.
 */
export const EPISODE_SIZE_FIELD_SUFFIXES = [
  'size',
  'additionalMetadata.size',
  'additionalMetadata.size.gb',
  'additionalMetadata.size.mb',
  'additionalMetadata.size.kb',
]

export function parseEpisodeNumberFromKey(key, data) {
  if (typeof data?.episodeNumber === 'number' && data.episodeNumber > 0) {
    return data.episodeNumber
  }
  const seasonEpisodeMatch = String(key).match(/S\d+E(\d+)/i)
  const match = seasonEpisodeMatch
    || String(key).match(/(?:episode_?|ep_?|e)(\d+)/i)
    || String(key).match(/^(\d+)/)
  const parsed = match ? Number.parseInt(match[1], 10) : Number.NaN
  return parsed > 0 ? parsed : null
}
