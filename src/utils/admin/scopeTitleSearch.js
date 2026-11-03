import 'server-only'
import clientPromise from '@src/lib/mongodb'
import { escapeRegex } from '@src/utils/escapeRegex'
import { TITLE_COLLATION } from '@src/utils/mediaListUtils/listOrder'

/** How many titles of each type one search offers. */
const PER_TYPE = 15
const MAX_QUERY = 100

/**
 * Library titles whose display title or folder name contains the query, for
 * the role editor's hand-picked titles (admins only: the whole library). Each
 * comes with its library key (originalTitle), which is what a scope stores.
 *
 * @param {string} query
 * @returns {Promise<Array<{ mediaType: 'movie'|'tv', originalTitle: string, title: string, year: string|null, rating: string|null }>>}
 */
export async function searchScopeTitles(query) {
  const typed = typeof query === 'string' ? query.trim().slice(0, MAX_QUERY) : ''
  if (!typed) return []
  const pattern = { $regex: escapeRegex(typed), $options: 'i' }
  const db = (await clientPromise).db('Media')
  const find = (collection, dateField) =>
    db
      .collection(collection)
      .find(
        { $or: [{ title: pattern }, { originalTitle: pattern }] },
        { projection: { title: 1, originalTitle: 1, 'metadata.rating': 1, [dateField]: 1 } }
      )
      .collation(TITLE_COLLATION)
      .sort({ title: 1 })
      .limit(PER_TYPE)
      .toArray()
  const [movies, shows] = await Promise.all([
    find('FlatMovies', 'metadata.release_date'),
    find('FlatTVShows', 'metadata.first_air_date'),
  ])
  const shape = (mediaType, dateOf) => (doc) => ({
    mediaType,
    originalTitle: doc.originalTitle,
    title: doc.title || doc.originalTitle,
    year: typeof dateOf(doc) === 'string' ? dateOf(doc).slice(0, 4) || null : null,
    rating: typeof doc.metadata?.rating === 'string' ? doc.metadata.rating : null,
  })
  return [
    ...movies.map(shape('movie', (doc) => doc.metadata?.release_date)),
    ...shows.map(shape('tv', (doc) => doc.metadata?.first_air_date)),
  ].filter((title) => typeof title.originalTitle === 'string' && title.originalTitle)
}
