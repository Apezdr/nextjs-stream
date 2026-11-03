import { cacheLife, cacheTag } from 'next/cache';
import {
  getFlatPosters,
  getFlatRecentlyAddedMedia,
  getFlatTVList
} from '@src/utils/flatDatabaseUtils';
import { listOrder } from '@src/utils/mediaListUtils/listOrder';
import { libraryAccessById } from '@src/lib/roles/libraryAccess';

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
 * route serve a page plus its boundary peek items from a single fetch, in
 * the list's order (`sort`: id | title | date, see mediaListUtils/listOrder.js).
 * Every window takes the viewer's scope id first (LibraryAccess.id), the
 * cache key, so viewers with the same scope share entries; the access is
 * resolved again inside (libraryAccessById).
 */
export async function getCachedMovieWindow(scopeId, offset, count, projection, sort, sortOrder) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'movies')
  const access = await libraryAccessById(scopeId)

  const data = await getFlatPosters('movie', false, 0, count, projection, {
    access,
    skip: offset,
    order: listOrder('movie', sort, sortOrder),
  });
  return serializeForClient(data);
}

/**
 * Cached TV window - 1 minute cache with media library tag.
 * Uses getFlatTVList which includes seasons/episodes with HDR data.
 * NOTE: deliberately takes no projection argument — the previous version
 * accepted one it never used, which only fragmented the cache key into
 * duplicate entries holding identical data. In the list's order, like movies.
 */
export async function getCachedTVWindow(scopeId, offset, count, sort, sortOrder) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'tv')
  const access = await libraryAccessById(scopeId)

  const data = await getFlatTVList({ access, limit: count, skip: offset, order: listOrder('tv', sort, sortOrder) });
  return serializeForClient(data);
}

/**
 * Cached recently added window - 1 minute cache with media library tag
 */
export async function getCachedRecentlyAddedWindow(scopeId, offset, count, shouldExposeAdditionalData) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'recently-added')
  const access = await libraryAccessById(scopeId)

  const data = await getFlatRecentlyAddedMedia({
    access,
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
export async function getCachedAllMediaWindow(scopeId, offset, count, movieProjection, tvProjection) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'all')
  const access = await libraryAccessById(scopeId)

  const [movies, tv] = await Promise.all([
    getFlatPosters('movie', false, 0, count, movieProjection, { access, skip: offset }),
    getFlatPosters('tv', false, 0, count, tvProjection, { access, skip: offset }),
  ]);

  return serializeForClient({ movies, tv });
}

/**
 * Note: User-specific functions (recently watched, recommendations, playlists)
 * remain uncached because they were calling headers()/cookies() inside the
 * cache scope. The route fetches them directly with windowed offsets instead.
 */
