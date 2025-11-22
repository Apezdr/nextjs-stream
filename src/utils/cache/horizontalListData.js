import { cacheLife, cacheTag } from 'next/cache';
import { 
  getFlatPosters, 
  getFlatRecentlyAddedMedia, 
  getFlatRecentlyWatchedForUser 
} from '@src/utils/flatDatabaseUtils';
import { getFlatRecommendations } from '@src/utils/flatRecommendations';

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
 * Cached movie list - 1 minute cache with media library tag
 */
export async function getCachedMovieList(page, limit, projection) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'movies')
  
  const data = await getFlatPosters('movie', false, page, limit, projection);
  return serializeForClient(data);
}

/**
 * Cached TV show list - 1 minute cache with media library tag  
 */
export async function getCachedTVList(page, limit, projection) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'tv')
  
  const data = await getFlatPosters('tv', false, page, limit, projection);
  return serializeForClient(data);
}

/**
 * Cached recently added media - 1 minute cache with media library tag
 */
export async function getCachedRecentlyAdded(page, limit, shouldExposeAdditionalData) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'recently-added')
  
  const data = await getFlatRecentlyAddedMedia({ 
    page, 
    limit, 
    shouldExposeAdditionalData 
  });
  return serializeForClient(data);
}

/**
 * Cached combined movie/TV list for 'all' type
 */
export async function getCachedAllMedia(page, limit, movieProjection, tvProjection) {
  'use cache'
  cacheLife('mediaLists')
  cacheTag('media-library', 'all')
  
  const [moviePosters, tvPosters] = await Promise.all([
    getFlatPosters('movie', false, page, limit, movieProjection),
    getFlatPosters('tv', false, page, limit, tvProjection),
  ]);
  
  const data = [...moviePosters, ...tvPosters];
  return serializeForClient(data);
}

/**
 * Note: User-specific functions are commented out due to dynamic API restrictions
 * These functions were calling headers()/cookies() inside the cache scope
 * For now, we'll cache only the non-user-specific data for performance gains
 */

// /**
//  * Cached recommendations - shorter cache since they're user-specific
//  */
// export async function getCachedRecommendations(userId, page, limit, shouldExposeAdditionalData) {
//   'use cache'
//   cacheLife('userContent')
//   cacheTag('recommendations', `user-${userId}`)
//   
//   const recommendations = await getFlatRecommendations(
//     userId,
//     page,
//     limit,
//     false, // countOnly
//     shouldExposeAdditionalData
//   );
//   
//   return serializeForClient(recommendations.items || []);
// }

// /**
//  * Cached recently watched for user - shorter cache for user-specific data
//  */
// export async function getCachedRecentlyWatched(userId, page, limit, shouldExposeAdditionalData, contextHints) {
//   'use cache'
//   cacheLife('userContent')
//   cacheTag('recently-watched', `user-${userId}`)
//   
//   const data = await getFlatRecentlyWatchedForUser({
//     userId,
//     page,
//     limit,
//     shouldExposeAdditionalData,
//     contextHints
//   });
//   return serializeForClient(data);
// }

// /**
//  * Cached playlist data - user-specific with playlist tags
//  */
// export async function getCachedPlaylistData(playlistId, userId, page, limit, hideUnavailable) {
//   'use cache'
//   cacheLife('userContent')
//   cacheTag('playlist', `playlist-${playlistId}`, `user-${userId}`)
//   
//   const { getUserWatchlist, getMinimalCardDataForPlaylist, getPlaylistById } = await import('@src/utils/watchlist');
//   
//   // Get playlist info for sorting preferences
//   let playlistInfo = null;
//   try {
//     playlistInfo = await getPlaylistById(playlistId);
//   } catch (e) {
//     console.error('Error fetching playlist info:', e);
//   }
//   
//   // Get watchlist items
//   const watchlistItems = await getUserWatchlist({
//     page,
//     limit,
//     playlistId,
//     internalOnly: hideUnavailable,
//     userId
//   });
//   
//   // Get card media documents
//   const data = await getMinimalCardDataForPlaylist(
//     watchlistItems,
//     playlistInfo,
//     !hideUnavailable
//   );
//   return serializeForClient(data);
// }
