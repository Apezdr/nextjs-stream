/**
 * The TMDB `metadata` fields a list card carries out of /api/authenticated/horizontal-list.
 *
 * The movie and TV rows used to send each title's whole TMDB document: for 20
 * TV shows that was 1.42 MB of metadata, 1.34 MB of it `cast` and
 * `recurring_cast`, which no card shows. This is an inclusion list, applied to
 * the response after every server-side reader has run (the builders sort by
 * `last_air_date`, build poster and clip URLs, and fill watch-history
 * durations from the full document first). A field goes out only if a client
 * reads it from a row item; __tests__/utils/cardMetadataFields.test.js names
 * the reader of each one. Add a field there and here together.
 */
export const CARD_METADATA_FIELDS = Object.freeze([
  'id',
  'tmdbId',
  'tmdb_id',
  'release_date',
  'first_air_date',
  'runtime',
  'logo_path',
])

/**
 * The item with its `metadata` reduced to CARD_METADATA_FIELDS. Items without a
 * metadata object (null, missing) are returned unchanged.
 * @param {object|null} item
 * @returns {object|null}
 */
export function trimCardMetadata(item) {
  if (!item || typeof item !== 'object') return item
  const { metadata } = item
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return item

  const trimmed = {}
  for (const field of CARD_METADATA_FIELDS) {
    if (metadata[field] !== undefined) trimmed[field] = metadata[field]
  }
  return { ...item, metadata: trimmed }
}
