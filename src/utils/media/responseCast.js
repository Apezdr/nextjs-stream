/**
 * The cast a /api/authenticated/media response carries.
 *
 * A show's `cast` merges its main cast with every episode's guest stars: 907
 * people and 382 KB for a long-running show on the owner's server, sent again
 * with every episode. Clients show at most a rail of 24 (the web's CastRail,
 * the popup grid, the TV app's 10), so the API sends the first
 * RESPONSE_CAST_LIMIT, main cast first, and the full count beside them for a
 * "See all N". The full list stays on the server-rendered title pages, which
 * read the database directly (getFlatRequestedMedia), not this route.
 *
 * The response also drops `metadata.cast` and `metadata.guest_stars` (copies
 * of `cast` and `guestStars`) and `metadata.recurring_cast`, which no client
 * reads. __tests__/utils/media/responseCast.test.js names the reader of each
 * field kept on a cast member.
 */
export const RESPONSE_CAST_LIMIT = 24

/** What a client reads from a cast member. `roles` (40% of the bytes) and the rest go. */
export const CAST_MEMBER_FIELDS = Object.freeze(['id', 'name', 'character', 'profile_path'])

const DUPLICATE_METADATA_FIELDS = ['cast', 'guest_stars', 'recurring_cast']

// The people in a stored cast list (the processor writes arrays: tmdb.mjs
// getMediaCast and formatAggregateCast).
function people(list) {
  return Array.isArray(list) ? list.filter((member) => member && typeof member === 'object') : null
}

function firstMembers(list) {
  return list.slice(0, RESPONSE_CAST_LIMIT).map((member) => {
    const kept = {}
    for (const field of CAST_MEMBER_FIELDS) {
      if (member[field] !== undefined) kept[field] = member[field]
    }
    return kept
  })
}

/**
 * The response with `cast` and `guestStars` cut to RESPONSE_CAST_LIMIT members of
 * CAST_MEMBER_FIELDS, `castCount` and `guestStarsCount` holding how many there
 * are, and the metadata copies removed. A list missing at the top level is
 * taken from metadata (`metadata.cast`, `metadata.guest_stars`). A response with
 * neither gets no field for it. The input is not changed.
 * @param {object|null} media
 * @returns {object|null}
 */
export function limitResponseCast(media) {
  if (!media || typeof media !== 'object') return media
  const { metadata } = media
  const hasMetadata = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
  const result = { ...media }

  const cast = people(media.cast ?? (hasMetadata ? metadata.cast : undefined))
  if (cast) {
    result.cast = firstMembers(cast)
    result.castCount = cast.length
  }
  const guestStars = people(media.guestStars ?? (hasMetadata ? metadata.guest_stars : undefined))
  if (guestStars) {
    result.guestStars = firstMembers(guestStars)
    result.guestStarsCount = guestStars.length
  }

  if (hasMetadata && DUPLICATE_METADATA_FIELDS.some((field) => field in metadata)) {
    const trimmed = { ...metadata }
    for (const field of DUPLICATE_METADATA_FIELDS) delete trimmed[field]
    result.metadata = trimmed
  }
  return result
}
