import clientPromise from '@src/lib/mongodb'
import { isFullLibrary } from '@src/lib/roles/libraryScope'
import { scopeEpisodeFilter, scopeMovieFilter } from '@src/utils/mediaVisibility'

const strings = (values) => [...new Set(values.filter((value) => typeof value === 'string' && value))]

/** Rows checked per lookup: each lookup's $in lists stay bounded however long a history is. */
const ROWS_PER_LOOKUP = 200

/**
 * WatchHistory rows, cut to a library scope (src/lib/roles/libraryScope.ts):
 * a row whose title is outside it is left out, and its video URL with it.
 * Fails closed: a row that matches no title in the scope (a removed title, the
 * trailer of one outside it) goes too. Pass only the rows being returned: the
 * lookups are by those rows' own identities.
 *
 * The whole library returns the rows as they are, with no query. A scoped
 * user pays one bounded lookup per collection per ROWS_PER_LOOKUP rows: $in
 * of the rows' normalizedVideoId, URL and mediaId, within the scope.
 *
 * @param {Array<Object>} rows - WatchHistory rows (videoId, normalizedVideoId, mediaId)
 * @param {import('@src/lib/roles/libraryScope').LibraryAccess} access - the user's library access
 * @returns {Promise<Array<Object>>}
 */
export async function watchRowsInScope(rows, access) {
  if (isFullLibrary(access) || !Array.isArray(rows) || rows.length === 0) return rows
  const db = (await clientPromise).db('Media')
  const kept = []
  for (let start = 0; start < rows.length; start += ROWS_PER_LOOKUP) {
    const chunk = rows.slice(start, start + ROWS_PER_LOOKUP)
    const allowed = await allowedKeys(db, chunk, access)
    for (const row of chunk) {
      if (allowed.has(row.normalizedVideoId) || allowed.has(row.videoId) || allowed.has(row.mediaId)) kept.push(row)
    }
  }
  return kept
}

async function allowedKeys(db, rows, access) {
  const nids = strings(rows.map((row) => row.normalizedVideoId))
  const urls = strings(rows.map((row) => row.videoId))
  const mediaIds = strings(rows.map((row) => row.mediaId))
  const identity = [
    { normalizedVideoId: { $in: nids } },
    { videoURL: { $in: urls } },
    { mediaId: { $in: mediaIds } },
  ]
  const projection = { projection: { normalizedVideoId: 1, videoURL: 1, mediaId: 1, 'metadata.trailer_url': 1 } }
  const [movies, episodes] = await Promise.all([
    db
      .collection('FlatMovies')
      .find(
        { $and: [{ $or: [...identity, { 'metadata.trailer_url': { $in: urls } }] }, scopeMovieFilter(access)] },
        projection
      )
      .toArray(),
    db
      .collection('FlatEpisodes')
      .find({ $and: [{ $or: identity }, scopeEpisodeFilter(access)] }, projection)
      .toArray(),
  ])
  const allowed = new Set()
  for (const doc of [...movies, ...episodes]) {
    for (const key of [doc.normalizedVideoId, doc.videoURL, doc.mediaId, doc.metadata?.trailer_url]) {
      if (typeof key === 'string' && key) allowed.add(key)
    }
  }
  return allowed
}
