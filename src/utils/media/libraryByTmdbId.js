import clientPromise from '@src/lib/mongodb'
import { getFullImageUrl } from '@src/utils'
import { mediaLinkParam } from '@src/utils/media/urlParser'
import { visibleMovieFilter, visibleShowFilter } from '@src/utils/mediaVisibility'

/** The most titles one lookup may ask about: a few pages of TMDB search results. */
export const LIBRARY_LOOKUP_MAX = 100

const COLLECTIONS = { movie: 'FlatMovies', tv: 'FlatTVShows' }
const VISIBLE = { movie: visibleMovieFilter, tv: visibleShowFilter }

/**
 * Which of these TMDB titles the library holds: a title is in the library when
 * a web-visible movie or show carries its TMDB id in `metadata.id`. That is
 * the rule the watchlist uses to resolve a saved item to library media
 * (watchlist/mediaResolver.js), so a title found here is the one an add
 * resolves to. TMDB ids repeat across movies and TV, so each item names its type.
 *
 * @param {Array<{ tmdbId: number, mediaType: 'movie'|'tv' }>} items
 * @returns {Promise<Array<{ tmdbId: number, mediaType: string, id: string, title: string, posterURL: string|null, link: string|null }>>}
 */
export async function findLibraryTitlesByTmdbId(items) {
  const idsByType = { movie: new Set(), tv: new Set() }
  for (const { tmdbId, mediaType } of items) idsByType[mediaType].add(tmdbId)

  const db = (await clientPromise).db('Media')
  const found = await Promise.all(
    Object.entries(idsByType)
      .filter(([, ids]) => ids.size > 0)
      .map(async ([mediaType, ids]) => {
        const docs = await db
          .collection(COLLECTIONS[mediaType])
          .find(
            { $and: [{ 'metadata.id': { $in: [...ids] } }, VISIBLE[mediaType]()] },
            { projection: { _id: 1, title: 1, originalTitle: 1, posterURL: 1, 'metadata.id': 1, 'metadata.poster_path': 1 } }
          )
          .toArray()
        return docs.map((doc) => ({
          tmdbId: doc.metadata.id,
          mediaType,
          id: doc._id.toString(),
          title: doc.title,
          posterURL: doc.posterURL || getFullImageUrl(doc.metadata?.poster_path) || null,
          link: mediaLinkParam(doc),
        }))
      })
  )
  return found.flat()
}
