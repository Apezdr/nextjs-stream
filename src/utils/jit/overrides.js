/**
 * Per-media JIT delivery overrides (`jitServeOverride: 'on' | 'off'`,
 * written from the admin media editors; absent = follow the global mode).
 *
 * DELIVERY resolution is hierarchical for TV: episode > season > show >
 * global mode. The global kill switch (mode 'off') always wins — an
 * emergency stop must not be defeatable per-title.
 *
 * VISIBILITY, by contrast, is level-local (mediaVisibility.js only reads
 * the doc's own override): a season/show-level 'off' changes how its
 * episodes are DELIVERED but does not hide them. Accepted edge: a
 * show-level 'off' over MKV-only episodes leaves them visible-but-direct
 * (they will fail on web). Overrides on non-playable content are the rare
 * case; keeping visibility doc-local keeps every count/list filter and the
 * denormalized visibleEpisodeCount recount correct without ancestor joins.
 *
 * Ancestor lookups are TTL-cached module-level (seasons/shows change
 * override state at admin-edit cadence, not request cadence) and fail open
 * to "no override" — a DB hiccup must never break delivery decisions.
 */

const TTL_MS = 20_000

/** cacheKey -> { value: 'on'|'off'|null, expiresAt } */
const ancestorCache = new Map()

async function fetchOverride(collection, id) {
  const key = `${collection}:${String(id)}`
  const cached = ancestorCache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  let value = null
  try {
    const { default: clientPromise } = await import('@src/lib/mongodb')
    const client = await clientPromise
    const doc = await client
      .db('Media')
      .collection(collection)
      .findOne({ _id: id }, { projection: { jitServeOverride: 1 } })
    value = doc?.jitServeOverride === 'on' || doc?.jitServeOverride === 'off'
      ? doc.jitServeOverride
      : null
  } catch (e) {
    value = null
  }

  ancestorCache.set(key, { value, expiresAt: Date.now() + TTL_MS })
  return value
}

/**
 * Resolve the effective per-media override for a served doc.
 *
 * @param {object} media - Flat movie or episode doc (episodes carry
 *                         showId/seasonId for ancestor resolution)
 * @returns {Promise<'on'|'off'|null>}
 */
export async function resolveJitOverride(media) {
  if (!media) return null
  if (media.jitServeOverride === 'on' || media.jitServeOverride === 'off') {
    return media.jitServeOverride
  }

  // Unit tests exercise doc-local behavior; ancestor resolution needs a DB.
  if (process.env.NODE_ENV === 'test') return null

  // Episodes inherit season, then show. Movies have neither.
  if (media.seasonId) {
    const seasonOverride = await fetchOverride('FlatSeasons', media.seasonId)
    if (seasonOverride) return seasonOverride
  }
  if (media.showId) {
    const showOverride = await fetchOverride('FlatTVShows', media.showId)
    if (showOverride) return showOverride
  }
  return null
}

/** Test hook. */
export function _resetJitOverrideCacheForTests() {
  ancestorCache.clear()
}
