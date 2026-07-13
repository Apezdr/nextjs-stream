import { cacheLife, cacheTag } from 'next/cache';
import {
  getFlatPosters,
  getFlatRecentlyAddedMedia,
  getFlatTVList
} from '@src/utils/flatDatabaseUtils';

/**
 * Serialize MongoDB objects to plain objects for client transfer
 */
function serializeForClient(data) {
  if (!data) return data;

  if (Array.isArray(data)) {
    return data.map(item => serializeForClient(item));
  }

  if (typeof data === 'object' && data !== null) {
    const serialized = {};
    for (const [key, value] of Object.entries(data)) {
      if (key === '_id' && value?.buffer) {
        // Convert MongoDB ObjectId to string
        serialized[key] = value.toString();
      } else if (typeof value === 'object' && value !== null) {
        serialized[key] = serializeForClient(value);
      } else {
        serialized[key] = value;
      }
    }
    return serialized;
  }

  return data;
}

/**
 * Cached movie window - 1 minute cache with media library tag.
 * Fetches `count` documents starting at absolute offset `offset`, letting the
 * route serve a page plus its boundary peek items from a single fetch.
 */
export async function getCachedMovieWindow(offset, count, projection) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'movies')

  const data = await getFlatPosters('movie', false, 0, count, projection, { skip: offset });
  return serializeForClient(data);
}

/**
 * Cached TV window - 1 minute cache with media library tag.
 * Uses getFlatTVList which includes seasons/episodes with HDR data.
 * NOTE: deliberately takes no projection argument — the previous version
 * accepted one it never used, which only fragmented the cache key into
 * duplicate entries holding identical data.
 */
export async function getCachedTVWindow(offset, count) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'tv')

  const data = await getFlatTVList({ limit: count, sort: true, skip: offset });
  return serializeForClient(data);
}

/**
 * Cached recently added window - 1 minute cache with media library tag
 */
export async function getCachedRecentlyAddedWindow(offset, count, shouldExposeAdditionalData) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'recently-added')

  const data = await getFlatRecentlyAddedMedia({
    offset,
    limit: count,
    shouldExposeAdditionalData
  });
  return serializeForClient(data);
}

/**
 * Cached combined movie/TV window for 'all' type.
 * Returns the two collections separately so the route can split each window
 * into page items and boundary peeks before concatenating.
 */
export async function getCachedAllMediaWindow(offset, count, movieProjection, tvProjection) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'all')

  const [movies, tv] = await Promise.all([
    getFlatPosters('movie', false, 0, count, movieProjection, { skip: offset }),
    getFlatPosters('tv', false, 0, count, tvProjection, { skip: offset }),
  ]);

  return serializeForClient({ movies, tv });
}

/**
 * Note: User-specific functions (recently watched, recommendations, playlists)
 * remain uncached because they were calling headers()/cookies() inside the
 * cache scope. The route fetches them directly with windowed offsets instead.
 */
