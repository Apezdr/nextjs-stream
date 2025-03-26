import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { getFullImageUrl } from '@src/utils'

/**
 * Process blurhashes in the media object.
 *
 * @param {Object} media - The media object.
 * @param {string} type - The type of media (movie or tv).
 * @returns {Promise<void>}
 */
export async function processFlatBlurhashes(media, type) {
  if (media?.posterBlurhash) {
    media.posterBlurhash = await fetchMetadataMultiServer(
      media.posterBlurhashSource,
      media.posterBlurhash,
      'blurhash',
      type,
      media.title
    );
  }

  if (media?.backdropBlurhash) {
    media.backdropBlurhash = await fetchMetadataMultiServer(
      media.backdropBlurhashSource,
      media.backdropBlurhash,
      'blurhash',
      type,
      media.title
    );
  }

  if (media?.thumbnailBlurhash) {
    media.thumbnailBlurhash = await fetchMetadataMultiServer(
      media.thumbnailBlurhashSource,
      media.thumbnailBlurhash,
      'blurhash',
      type,
      media.title
    );
  }
}

/**
 * Filter out invalid episodes (those without videoURL)
 * @param {Array} episodes - Array of episode objects
 * @returns {Array} Filtered array of valid episodes
 */
export function filterValidEpisodes(episodes) {
  if (!episodes || !Array.isArray(episodes)) return [];
  return episodes.filter(episode => episode && episode.videoURL);
}

/**
 * Generate a unique ID for a media item
 * @param {Object} item - Media item (movie or TV show)
 * @returns {string} Unique identifier
 */
export function generateUniqueId(item) {
  if (!item) return `item-${Math.random()}`;
  
  if (item.type === 'tv' && item.episode) {
    // For TV shows with episode info
    const idPart = item._id ? item._id.toString() : (item.id || `tv-${Math.random()}`);
    const videoUrlPart = item.episode.videoURL ? `-${item.episode.videoURL.substring(0, 20)}` : '';
    return `${idPart}-S${item.seasonNumber}-E${item.episode.episodeNumber}${videoUrlPart}`;
  } else if (item.type === 'movie') {
    // For movies
    const idPart = item._id ? item._id.toString() : (item.id || `movie-${Math.random()}`);
    const videoUrlPart = item.videoURL ? `-${item.videoURL.substring(0, 20)}` : '';
    return `${idPart}${videoUrlPart}`;
  } else {
    // Fallback for any other case
    return `item-${Math.random()}`;
  }
}

/**
 * Ensure media items have the necessary properties for PopupCard component
 * @param {Object} item - Media item (movie or TV show)
 * @returns {Object} Media item with necessary properties
 */
export async function ensureMediaProperties(item) {
  if (!item) return item;
  
  // Create a copy of the item to avoid modifying the original
  const enhancedItem = { ...item };
  
  // Ensure mediaId is set (required by PopupCard)
  if (!enhancedItem.mediaId) {
    if (enhancedItem.type === 'tv' && enhancedItem.showId) {
      // For TV episodes, use the showId as the mediaId
      enhancedItem.mediaId = enhancedItem.showId.toString();
    } else {
      // Use _id or id as mediaId
      enhancedItem.mediaId = enhancedItem._id 
        ? enhancedItem._id.toString() 
        : (enhancedItem.id || null);
    }
  }
  
  // For TV shows, ensure episode and seasonNumber are properly set
  if (enhancedItem.type === 'tv') {
    // If episode exists but doesn't have videoURL, try to find it
    if (enhancedItem.episode && !enhancedItem.episode.videoURL && enhancedItem.seasons) {
      const season = enhancedItem.seasons.find(s => s.seasonNumber === enhancedItem.seasonNumber);
      if (season && season.episodes) {
        const episode = season.episodes.find(e => e.episodeNumber === enhancedItem.episode.episodeNumber);
        if (episode && episode.videoURL) {
          enhancedItem.episode.videoURL = episode.videoURL;
        }
      }
    }
    
  // For TV shows with episodes, use episode thumbnail as poster and ensure thumbnails are set
  if (enhancedItem.episode) {
    // If episode has no thumbnail, try to use the episode's still_path or fallback to show poster
    if (!enhancedItem.episode.thumbnail) {
      enhancedItem.episode.thumbnail = 
        (enhancedItem.episode.metadata?.still_path ? 
         getFullImageUrl(enhancedItem.episode.metadata.still_path) : 
         enhancedItem.posterURL);
      enhancedItem.episode.thumbnailSource = enhancedItem.episode.metadata?.still_path ? null : enhancedItem.posterSource;
      enhancedItem.episode.thumbnailBlurhash = enhancedItem.episode.metadata?.still_path ? null : await fetchMetadataMultiServer(
        enhancedItem.posterBlurhashSource,
        enhancedItem.posterBlurhash,
        'blurhash',
        'tv',
        enhancedItem.title
      )
    }
    
    // For TV episodes, use the thumbnail as the posterURL
    if (enhancedItem.episode.thumbnail) {
      enhancedItem.posterURL = enhancedItem.episode.thumbnail;
    }
    
    // Include thumbnailBlurhash from episode if available
    if (enhancedItem.episode.thumbnailBlurhash) {
      enhancedItem.thumbnailBlurhash = await fetchMetadataMultiServer(
        enhancedItem.episode.thumbnailBlurhashSource,
        enhancedItem.episode.thumbnailBlurhash,
        "blurhash",
        "tv",
        enhancedItem.title
      );
      
      // Also set posterBlurhash to the same value since we're using thumbnail as poster
      enhancedItem.posterBlurhash = enhancedItem.thumbnailBlurhash;
      enhancedItem.posterBlurhashSource = enhancedItem.episode.thumbnailBlurhashSource;
    }
    
    // Expose thumbnail at the top level for easier access
    if (enhancedItem.episode.thumbnail) {
      enhancedItem.thumbnail = enhancedItem.episode.thumbnail;
    }
  }
    
    // Fix the link property for TV shows to include season and episode numbers
    if (enhancedItem.seasonNumber && enhancedItem.episode && enhancedItem.episode.episodeNumber) {
      // If link already exists but doesn't include season/episode, update it
      if (enhancedItem.link && !enhancedItem.link.includes('/')) {
        // Format: showTitle/seasonNumber/episodeNumber
        enhancedItem.link = `${enhancedItem.link}/${enhancedItem.seasonNumber}/${enhancedItem.episode.episodeNumber}`;
      } 
      // If link doesn't exist but title does, create it
      else if (!enhancedItem.link && enhancedItem.title) {
        enhancedItem.link = `${encodeURIComponent(enhancedItem.title)}/${enhancedItem.seasonNumber}/${enhancedItem.episode.episodeNumber}`;
      }
    }
  }
  
  // For movies, ensure videoURL is set
  if (enhancedItem.type === 'movie' && enhancedItem.posterBlurhash) {
    enhancedItem.posterBlurhash = await fetchMetadataMultiServer(
      enhancedItem.posterBlurhashSource,
      enhancedItem.posterBlurhash,
      'blurhash',
      'movie',
      enhancedItem.title
    );
  }
  
  return enhancedItem;
}

/**
 * Remove duplicates from an array of media items based on uniqueId and videoURL
 * @param {Array} items - Array of media items
 * @returns {Array} Array with duplicates removed
 */
export function removeDuplicates(items) {
  if (!items || !Array.isArray(items)) return [];
  
  const uniqueItems = [];
  const seenIds = new Set();
  const seenVideoURLs = new Set();
  
  items.forEach(item => {
    const uniqueId = item.uniqueId || generateUniqueId(item);
    
    // Check for duplicate by uniqueId
    if (seenIds.has(uniqueId)) {
      return;
    }
    
    // Also check for duplicate by videoURL for movies
    if (item.type === 'movie' && item.videoURL) {
      if (seenVideoURLs.has(item.videoURL)) {
        return;
      }
      seenVideoURLs.add(item.videoURL);
    }
    
    // For TV shows, check episode videoURL
    if (item.type === 'tv' && item.episode && item.episode.videoURL) {
      if (seenVideoURLs.has(item.episode.videoURL)) {
        return;
      }
      seenVideoURLs.add(item.episode.videoURL);
    }
    
    seenIds.add(uniqueId);
    uniqueItems.push({
      ...item,
      uniqueId
    });
  });
  
  return uniqueItems;
}

/**
 * Find the next episode for a user based on their watch history using flat database structure
 * @param {Object} show - TV show object with seasons and episodes
 * @param {Set} watchedVideoURLs - Set of watched video URLs
 * @returns {Object|null} Next episode object or null if not found
 */
export function findFlatNextEpisode(show, watchedVideoURLs) {
  if (!show || !show.seasons || !watchedVideoURLs) return null;
  
  // Count total episodes and watched episodes
  let totalEpisodes = 0;
  let watchedEpisodesCount = 0;
  const watchedEpisodes = new Set();
  
  // Count total episodes and watched episodes
  show.seasons.forEach(season => {
    if (!season.episodes) return;
    
    season.episodes.forEach(episode => {
      // Skip episodes with missing or invalid videoURL
      if (!episode.videoURL) return;
      
      totalEpisodes++;
      
      if (watchedVideoURLs.has(episode.videoURL)) {
        watchedEpisodesCount++;
        watchedEpisodes.add(`S${season.seasonNumber}E${episode.episodeNumber}`);
      }
    });
  });
  
  // Skip this show if the user has watched all episodes
  if (watchedEpisodesCount >= totalEpisodes) {
    return null;
  }
  
  // Also skip if totalEpisodes is 0 (invalid show data)
  if (totalEpisodes === 0) {
    return null;
  }
  
  // Find the highest episode number and season number the user has watched
  let highestSeason = 0;
  let highestEpisode = 0;
  
  show.seasons.forEach(season => {
    if (!season.episodes) return;
    
    season.episodes.forEach(episode => {
      if (episode.videoURL && watchedVideoURLs.has(episode.videoURL)) {
        // Update highest season/episode
        if (season.seasonNumber > highestSeason || 
            (season.seasonNumber === highestSeason && episode.episodeNumber > highestEpisode)) {
          highestSeason = season.seasonNumber;
          highestEpisode = episode.episodeNumber;
        }
      }
    });
  });
  
  // Find the next episode
  let nextEpisode = null;
  let nextSeason = null;
  
    // First try to find the next episode in the same season
    if (highestSeason > 0) {
      const currentSeason = show.seasons.find(s => s.seasonNumber === highestSeason);
      if (currentSeason && currentSeason.episodes) {
        nextEpisode = currentSeason.episodes.find(e => e.episodeNumber === highestEpisode + 1 && e.videoURL);
        if (nextEpisode) {
          nextSeason = currentSeason;
        }
      }
    }
  
  // If no next episode in the same season, try the first episode of the next season
  if (!nextEpisode && highestSeason > 0) {
    const nextSeasonObj = show.seasons.find(s => s.seasonNumber === highestSeason + 1);
    if (nextSeasonObj && nextSeasonObj.episodes && nextSeasonObj.episodes.length > 0) {
      // Sort episodes by episode number
      const sortedEpisodes = [...nextSeasonObj.episodes]
        .filter(e => e.videoURL) // Filter out episodes without videoURL
        .sort((a, b) => a.episodeNumber - b.episodeNumber);
      
      if (sortedEpisodes.length > 0) {
        nextEpisode = sortedEpisodes[0]; // First episode of next season
        nextSeason = nextSeasonObj;
      }
    }
  }
  
  // If we found a next episode and it hasn't been watched, return it
  if (nextEpisode && nextSeason && !watchedEpisodes.has(`S${nextSeason.seasonNumber}E${nextEpisode.episodeNumber}`)) {
    return {
      episode: nextEpisode,
      seasonNumber: nextSeason.seasonNumber,
      episodeNumber: nextEpisode.episodeNumber,
      isNextEpisode: true
    };
  }
  
  return null;
}

/**
 * Find the first episode of a TV show using flat database structure
 * @param {Object} show - TV show object with seasons
 * @returns {Object|null} First episode object or null if not found
 */
export function findFlatFirstEpisode(show) {
  if (!show || !show.seasons || !show.seasons.length) return null;
  
  // Sort seasons by season number
  const sortedSeasons = [...show.seasons].sort((a, b) => a.seasonNumber - b.seasonNumber);
  const firstSeason = sortedSeasons[0];
  
  if (!firstSeason.episodes || !firstSeason.episodes.length) return null;
  
  // Sort episodes by episode number and filter out episodes without videoURL
  const sortedEpisodes = [...firstSeason.episodes]
    .filter(e => e.videoURL) // Filter out episodes without videoURL
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
  
  if (sortedEpisodes.length === 0) return null;
  
  const firstEpisode = sortedEpisodes[0];
  
  return {
    episode: firstEpisode,
    seasonNumber: firstSeason.seasonNumber,
    episodeNumber: firstEpisode.episodeNumber,
    isNewShow: true
  };
}

/**
 * Paginate an array of items
 * @param {Array} items - Array of items to paginate
 * @param {number} page - Page number (0-based)
 * @param {number} limit - Number of items per page
 * @returns {Array} Paginated items
 */
export function paginateItems(items, page = 0, limit = 30) {
  if (!items || !Array.isArray(items)) {
    // If no items, return a dummy array for testing
    if (page === 0) {
      return Array(limit).fill(null).map((_, i) => ({
        id: `dummy-${i}`,
        title: `Dummy Item ${i+1}`,
        type: i % 2 === 0 ? 'movie' : 'tv',
        posterURL: 'https://example.com/poster.jpg',
        score: 0.9 - (i * 0.01)
      }));
    }
    return [];
  }
  
  // Ensure we have a stable sort before pagination to prevent items from moving between pages
  const stableSortedItems = [...items].sort((a, b) => {
    // First sort by score if available (descending)
    if (a.score !== undefined && b.score !== undefined) {
      const scoreDiff = b.score - a.score;
      if (Math.abs(scoreDiff) > 0.001) return scoreDiff; // Use small epsilon for floating point comparison
    }
    
    // Then by type to group movies and TV shows
    if (a.type !== b.type) {
      return a.type === 'movie' ? -1 : 1;
    }
    
    // Then by title for consistent ordering
    if (a.title && b.title) {
      return a.title.localeCompare(b.title);
    }
    
    // Finally by uniqueId as a last resort
    if (a.uniqueId && b.uniqueId) {
      return a.uniqueId.localeCompare(b.uniqueId);
    }
    
    return 0;
  });
  
  // If we don't have enough items for this page, return what we have
  // without using dummy items - this will solve the partial page issue
  if (stableSortedItems.length < (page + 1) * limit) {
    // Just return available items
    console.log(`Page ${page} has fewer than ${limit} items (${stableSortedItems.length} total)`);
  }
  
  const skip = page * limit;
  return stableSortedItems.slice(skip, Math.min(skip + limit, stableSortedItems.length));
}
