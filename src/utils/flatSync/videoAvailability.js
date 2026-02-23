/**
 * Video availability utilities for flat database structure
 * 
 * This module provides functions to check video availability across file servers
 * and remove unavailable videos from the flat database structure.
 */

import { createLogger, logError } from '@src/lib/logger';
import clientPromise from '@src/lib/mongodb';
import { getRedisClient } from '@src/lib/redisClient';
import { hasTVShowValidVideoURLs } from './memoryUtils';

/**
 * Directly checks all movies in the flat database and removes any that don't exist in file servers
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Current flat database structure (used to avoid additional DB queries)
 * @param {Object} fileServers - All file servers data 
 * @param {Object} fieldAvailability - Field availability map 
 * @returns {Promise<Object>} Results showing how many movies were removed
 */
async function cleanupMissingMovies(client, flatDB, fileServers, fieldAvailability) {
  const log = createLogger('FlatSync.VideoAvailability.Movies');
  log.info('Checking for movies that do not exist in any file servers...');
  
  try {
    // Use the movies from flatDB instead of making a new database query
    const allMovies = flatDB.movies || [];
    const removedMovies = [];
    
    // Check each movie against all file servers
    for (const movie of allMovies) {
      let foundInAnyServer = false;
      
      // Get servers that have this movie
      const serversWithMovie = [];
      
      // Check if the movie exists in any file server (by title or originalTitle)
      for (const [serverId, fileServer] of Object.entries(fileServers)) {
        // Check against both title and originalTitle (if it exists)
        if (fileServer.movies && (
            fileServer.movies[movie.title] || 
            (movie.originalTitle && fileServer.movies[movie.originalTitle])
          )) {
          foundInAnyServer = true;
          serversWithMovie.push(serverId);
        }
      }
      
      let shouldRemove = !foundInAnyServer;
      
      // If the movie exists in some servers but we have field availability, check priorities
      if (fieldAvailability?.movies?.[movie.title]) {
        // Get the servers responsible for the movie's video URL
        const fieldPath = 'urls.mp4';
        const responsibleServers = fieldAvailability.movies[movie.title][fieldPath] || [];
        
        // If there are responsible servers defined, check if any servers with the movie are in that list
        if (responsibleServers.length > 0) {
          const isAvailableOnResponsibleServer = serversWithMovie.some(
            serverId => responsibleServers.includes(serverId)
          );
          
          // Special case - if movie exists on some servers but none are responsible,
          // we should still not remove it to avoid data loss
          if (!isAvailableOnResponsibleServer) {
            log.info({
              movieTitle: movie.title,
              serversWithMovie,
              context: 'movie_not_on_responsible_server'
            }, 'Movie exists on servers but none responsible per field availability; keeping');
            shouldRemove = false;
          }
        } else {
          // If no responsible servers defined remove the movie
          shouldRemove = true
        }
      }
      
      // If the movie doesn't exist in any file server (or exists but fails field checks), remove it
      if (shouldRemove) {
        log.info({ movieTitle: movie.title }, 'Removing movie missing from all file servers');
        
        // Delete the movie
        await client.db('Media').collection('FlatMovies').deleteOne({ _id: movie._id });
        
        removedMovies.push({
          title: movie.title
        });
      }
    }
    
    return {
      moviesRemoved: removedMovies.length,
      details: removedMovies
    };
  } catch (error) {
    logError(log, error, { context: 'cleanup_missing_movies' });
    return {
      moviesRemoved: 0,
      error: error.message
    };
  }
}

/**
 * Directly checks all shows in the flat database and removes any that don't exist in file servers
 * or have no valid videoURLs in any episode
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Current flat database structure (used to avoid additional DB queries)
 * @param {Object} fileServers - All file servers data 
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Results showing how many shows were removed
 */
async function cleanupMissingTVShows(client, flatDB, fileServers, fieldAvailability) {
  const log = createLogger('FlatSync.VideoAvailability.TVShows');
  log.info('Checking for TV shows missing from file servers or lacking valid video URLs...');
  
  try {
    // Use the TV shows from flatDB instead of making a new database query
    const allShows = flatDB.tv || [];
    const removedShows = [];
    
    // Check each show against all file servers
    for (const show of allShows) {
      let foundInAnyServer = false;
      const serversWithShow = [];
      
      // Track servers that have this show and also if any server has valid videoURLs
      let hasValidVideoURLsInAnyServer = false;
      
      // Check if the show exists in any file server (by title or originalTitle)
      for (const [serverId, fileServer] of Object.entries(fileServers)) {
        // Check existence of the show in this server's data
        if (fileServer.tv) {
          // Try with both title and originalTitle
          const fileServerShowData = fileServer.tv[show.title] || 
              (show.originalTitle && fileServer.tv[show.originalTitle]);
              
          if (fileServerShowData) {
            foundInAnyServer = true;
            serversWithShow.push(serverId);
            
            // Check if the show has any valid videoURLs in this server
            if (hasTVShowValidVideoURLs(fileServerShowData)) {
              hasValidVideoURLsInAnyServer = true;
            }
          }
        }
      }
      
      // A show should be removed if either:
      // 1. It doesn't exist in any file server
      // 2. It exists in one or more servers but doesn't have valid videoURLs in any of them
      let shouldRemove = !foundInAnyServer || (foundInAnyServer && !hasValidVideoURLsInAnyServer);
      
      // If we're considering removal because of no valid videoURLs, log it
      if (foundInAnyServer && !hasValidVideoURLsInAnyServer) {
        log.info({
          showTitle: show.title,
          serversWithShow,
          context: 'tv_show_no_valid_videos'
        }, 'TV show has no valid video URLs in any episode');
      }
      
      // If the show exists in some servers but we have field availability, check priorities
      if (foundInAnyServer && fieldAvailability?.tv?.[show.title]) {
        // TV shows are more complex - we need to check for different fields
        // First, get all field paths for this show
        const showFieldPaths = Object.keys(fieldAvailability.tv[show.title]);
        
        // Look for any show-level fields (metadata, poster, backdrop, etc.)
        const showLevelFields = showFieldPaths.filter(path => 
          !path.includes('seasons.') && !path.includes('episodes.')
        );
        
        // If there are show-level fields, check if any servers with the show are responsible
        if (showLevelFields.length > 0) {
          let isResponsibleForAnyField = false;
          
          for (const fieldPath of showLevelFields) {
            const responsibleServers = fieldAvailability.tv[show.title][fieldPath] || [];
            
            // If no responsible servers defined, any server can provide it
            if (responsibleServers.length === 0) {
              isResponsibleForAnyField = true;
              break;
            }
            
            // If any server with the show is responsible for any field, don't remove
            const isResponsible = serversWithShow.some(
              serverId => responsibleServers.includes(serverId)
            );
            
            if (isResponsible) {
              isResponsibleForAnyField = true;
              break;
            }
          }
          
          // Even if not responsible, keep show to avoid data loss
          if (!isResponsibleForAnyField && serversWithShow.length > 0) {
            log.info({
              showTitle: show.title,
              serversWithShow,
              context: 'tv_show_not_on_responsible_servers'
            }, 'TV show exists on servers but none responsible; keeping to avoid data loss');
            shouldRemove = false;
          }
        }
      }
      
      // If the show doesn't exist in any file server (or exists but fails field checks), remove it and its related data
      if (shouldRemove) {
        log.info({ showTitle: show.title }, 'Removing TV show missing from all file servers');
        
        // Store the ID for deleting related content
        const showId = show._id;
        
        // Delete the show
        const showResult = await client.db('Media').collection('FlatTVShows').deleteOne({ _id: showId });
        
        // Delete all seasons for this show
        const seasonsResult = await client.db('Media').collection('FlatSeasons').deleteMany({ showId });
        
        // Delete all episodes for this show
        const episodesResult = await client.db('Media').collection('FlatEpisodes').deleteMany({ showId });
        
        removedShows.push({
          title: show.title,
          deletedSeasons: seasonsResult.deletedCount,
          deletedEpisodes: episodesResult.deletedCount
        });
      }
    }
    
    return {
      tvShowsRemoved: removedShows.length,
      details: removedShows
    };
  } catch (error) {
    logError(log, error, { context: 'cleanup_missing_tv_shows' });
    return {
      tvShowsRemoved: 0,
      error: error.message
    };
  }
}

/**
 * Directly checks all seasons in the flat database and removes any that don't exist in file servers
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Current flat database structure (used to avoid additional DB queries)
 * @param {Object} fileServers - All file servers data 
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Results showing how many seasons were removed
 */
async function cleanupMissingSeasons(client, flatDB, fileServers, fieldAvailability) {
  const log = createLogger('FlatSync.VideoAvailability.Seasons');
  log.info('Checking for seasons missing from file servers...');
  
  try {
    // Get all seasons from flatDB 
    const allSeasons = [];
    
    // Extract seasons from the nested TV show structure, preserving show title information
    if (flatDB.tv) {
      for (const show of flatDB.tv) {
        if (show.seasons) {
          for (const season of show.seasons) {
            allSeasons.push({
              ...season,
              showOriginalTitle: show.originalTitle  // File server title
            });
          }
        }
      }
    }
    
    const removedSeasons = [];
    
    // Check each season against all file servers
    for (const season of allSeasons) {
      let foundInAnyServer = false;
      const serversWithSeason = [];
      
      // Check if the season exists in any file server
      for (const [serverId, fileServer] of Object.entries(fileServers)) {
        if (fileServer.tv) {
          // Try with both title and originalTitle for the show
          const fileServerShowData = fileServer.tv[season.showOriginalTitle];
          
          if (fileServerShowData && fileServerShowData.seasons) {
            // Check if this specific season exists
            const seasonKey = `Season ${season.seasonNumber}`;
            if (fileServerShowData.seasons[seasonKey]) {
              foundInAnyServer = true;
              serversWithSeason.push(serverId);
            }
          }
        }
      }
      
      let shouldRemove = !foundInAnyServer;
      
      // If the season exists in some servers but we have field availability, check priorities
      if (foundInAnyServer && fieldAvailability?.tv?.[season.showTitle]) {
        // Check season-level fields in field availability
        const seasonFieldPath = `seasons.Season ${season.seasonNumber}`;
        const showFieldPaths = Object.keys(fieldAvailability.tv[season.showTitle]);
        
        // Look for season-specific fields
        const seasonFields = showFieldPaths.filter(path => path.startsWith(seasonFieldPath));
        
        if (seasonFields.length > 0) {
          let isResponsibleForAnyField = false;
          
          for (const fieldPath of seasonFields) {
            const responsibleServers = fieldAvailability.tv[season.showTitle][fieldPath] || [];
            
            // If no responsible servers defined, any server can provide it
            if (responsibleServers.length === 0) {
              isResponsibleForAnyField = true;
              break;
            }
            
            // If any server with the season is responsible for any field, don't remove
            const isResponsible = serversWithSeason.some(
              serverId => responsibleServers.includes(serverId)
            );
            
            if (isResponsible) {
              isResponsibleForAnyField = true;
              break;
            }
          }
          
          // Even if not responsible, keep season to avoid data loss
          if (!isResponsibleForAnyField && serversWithSeason.length > 0) {
            log.info({
              showTitle: season.showTitle,
              seasonNumber: season.seasonNumber,
              serversWithSeason,
              context: 'season_not_on_responsible_servers'
            }, 'Season exists on servers but none responsible; keeping to avoid data loss');
            shouldRemove = false;
          }
        }
      }
      
      // If the season doesn't exist in any file server, remove it and its episodes
      if (shouldRemove) {
        log.info({
          showTitle: season.showTitle,
          seasonNumber: season.seasonNumber
        }, 'Removing season missing from all file servers');
        
        // Store the ID for deleting related content
        const seasonId = season._id;
        
        // Delete the season
        const seasonResult = await client.db('Media').collection('FlatSeasons').deleteOne({ _id: seasonId });
        
        // Delete all episodes for this season
        const episodesResult = await client.db('Media').collection('FlatEpisodes').deleteMany({ seasonId });
        
        removedSeasons.push({
          showTitle: season.showTitle,
          seasonNumber: season.seasonNumber,
          deletedEpisodes: episodesResult.deletedCount
        });
      }
    }
    
    return {
      seasonsRemoved: removedSeasons.length,
      details: removedSeasons
    };
  } catch (error) {
    logError(log, error, { context: 'cleanup_missing_seasons' });
    return {
      seasonsRemoved: 0,
      error: error.message
    };
  }
}

/**
 * Directly checks all episodes in the flat database and removes any that don't exist in file servers
 * @param {Object} client - MongoDB client
 * @param {Object} flatDB - Current flat database structure (used to avoid additional DB queries)
 * @param {Object} fileServers - All file servers data 
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Results showing how many episodes were removed
 */
async function cleanupMissingEpisodes(client, flatDB, fileServers, fieldAvailability) {
  const log = createLogger('FlatSync.VideoAvailability.Episodes');
  log.info('Checking for episodes missing from file servers...');
  
  try {
    // Get all episodes from flatDB 
    const allEpisodes = [];
    
    // Extract episodes from the nested TV show structure, preserving show title information
    if (flatDB.tv) {
      for (const show of flatDB.tv) {
        if (show.seasons) {
          for (const season of show.seasons) {
            if (season.episodes) {
              for (const episode of season.episodes) {
                allEpisodes.push({
                  ...episode,
                  showOriginalTitle: show.originalTitle  // File server title
                });
              }
            }
          }
        }
      }
    }
    
    const removedEpisodes = [];
    
    // Check each episode against all file servers
    for (const episode of allEpisodes) {
      let foundInAnyServer = false;
      const serversWithEpisode = [];
      
      // Check if the episode exists in any file server
      for (const [serverId, fileServer] of Object.entries(fileServers)) {
        if (fileServer.tv) {
          // Try with both title and originalTitle for the show
          const fileServerShowData = fileServer.tv[episode.showOriginalTitle];
          
          if (fileServerShowData && fileServerShowData.seasons) {
            // Check if this specific season exists
            const seasonKey = `Season ${episode.seasonNumber}`;
            const seasonData = fileServerShowData.seasons[seasonKey];
            
            if (seasonData && seasonData.episodes) {
              // Check if this specific episode exists
              // Episode keys are typically in format like "S01E05"
              const paddedSeason = String(episode.seasonNumber).padStart(2, '0');
              const paddedEpisode = String(episode.episodeNumber).padStart(2, '0');
              const episodeKey = `S${paddedSeason}E${paddedEpisode}`;
              
              if (seasonData.episodes[episodeKey]) {
                foundInAnyServer = true;
                serversWithEpisode.push(serverId);
              }
            }
          }
        }
      }
      
      let shouldRemove = !foundInAnyServer;
      
      // If the episode exists in some servers but we have field availability, check priorities
      if (foundInAnyServer && fieldAvailability?.tv?.[episode.showTitle]) {
        // Check episode-level fields in field availability
        const episodeFieldPath = `seasons.Season ${episode.seasonNumber}.episodes.S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;
        const showFieldPaths = Object.keys(fieldAvailability.tv[episode.showTitle]);
        
        // Look for episode-specific fields
        const episodeFields = showFieldPaths.filter(path => path.startsWith(episodeFieldPath));
        
        if (episodeFields.length > 0) {
          let isResponsibleForAnyField = false;
          
          for (const fieldPath of episodeFields) {
            const responsibleServers = fieldAvailability.tv[episode.showTitle][fieldPath] || [];
            
            // If no responsible servers defined, any server can provide it
            if (responsibleServers.length === 0) {
              isResponsibleForAnyField = true;
              break;
            }
            
            // If any server with the episode is responsible for any field, don't remove
            const isResponsible = serversWithEpisode.some(
              serverId => responsibleServers.includes(serverId)
            );
            
            if (isResponsible) {
              isResponsibleForAnyField = true;
              break;
            }
          }
          
          // Even if not responsible, keep episode to avoid data loss
          if (!isResponsibleForAnyField && serversWithEpisode.length > 0) {
            log.info({
              showTitle: episode.showTitle,
              seasonNumber: episode.seasonNumber,
              episodeNumber: episode.episodeNumber,
              serversWithEpisode,
              context: 'episode_not_on_responsible_servers'
            }, 'Episode exists on servers but none responsible; keeping to avoid data loss');
            shouldRemove = false;
          }
        }
      }
      
      // If the episode doesn't exist in any file server, remove it
      if (shouldRemove) {
        log.info({
          showTitle: episode.showTitle,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber
        }, 'Removing episode missing from all file servers');
        
        // Delete the episode
        await client.db('Media').collection('FlatEpisodes').deleteOne({ _id: episode._id });
        
        removedEpisodes.push({
          showTitle: episode.showTitle,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          title: episode.title
        });
      }
    }
    
    return {
      episodesRemoved: removedEpisodes.length,
      details: removedEpisodes
    };
  } catch (error) {
    logError(log, error, { context: 'cleanup_missing_episodes' });
    return {
      episodesRemoved: 0,
      error: error.message
    };
  }
}

/**
 * Clears Redis cache entries related to removed content.
 * @param {Object} removedContent - Content that was removed
 * @returns {Promise<Object>} Cache clearing results
 */
async function clearCacheEntries(removedContent) {
  const log = createLogger('FlatSync.VideoAvailability.Cache');
  const redisClient = await getRedisClient();
  if (!redisClient) {
    log.info('Redis not configured. Skipping cache clearing.');
    return { cleared: 0, errors: 0 };
  }
  
  const results = {
    cleared: 0,
    errors: 0,
    details: []
  };
  
  try {
    log.info('Clearing Redis cache entries for removed content...');
    
    // Clear cache for movies
    for (const movieTitle of removedContent.movies) {
      try {
        // Common cache key patterns for movies
        const movieCacheKeys = [
          `movie:${movieTitle}*`,
          `metadata:movie:${movieTitle}*`,
          `blurhash:movie:${movieTitle}*`,
          `poster:movie:${movieTitle}*`,
          `backdrop:movie:${movieTitle}*`
        ];
        
        for (const pattern of movieCacheKeys) {
          const keys = await redisClient.keys(pattern);
          if (keys.length > 0) {
            await redisClient.del(keys);
            results.cleared += keys.length;
            results.details.push(`Cleared ${keys.length} cache entries for movie "${movieTitle}" with pattern ${pattern}`);
          }
        }
      } catch (error) {
        logError(log, error, {
          movieTitle,
          context: 'clear_cache_movie'
        });
        results.errors++;
      }
    }
    
    // Clear cache for TV shows
    for (const showTitle of removedContent.tvShows) {
      try {
        // Common cache key patterns for TV shows
        const showCacheKeys = [
          `tv:${showTitle}*`,
          `metadata:tv:${showTitle}*`,
          `blurhash:tv:${showTitle}*`,
          `poster:tv:${showTitle}*`,
          `backdrop:tv:${showTitle}*`,
          `season:${showTitle}*`,
          `episode:${showTitle}*`
        ];
        
        for (const pattern of showCacheKeys) {
          const keys = await redisClient.keys(pattern);
          if (keys.length > 0) {
            await redisClient.del(keys);
            results.cleared += keys.length;
            results.details.push(`Cleared ${keys.length} cache entries for TV show "${showTitle}" with pattern ${pattern}`);
          }
        }
      } catch (error) {
        logError(log, error, {
          showTitle,
          context: 'clear_cache_tv_show'
        });
        results.errors++;
      }
    }
    
    // Clear cache for individual seasons
    for (const seasonTitle of removedContent.tvSeasons || []) {
      try {
        // Extract show title and season number from "ShowTitle Season X" format
        const seasonMatch = seasonTitle.match(/^(.+) Season (\d+)$/);
        if (seasonMatch) {
          const [, showTitle, seasonNumber] = seasonMatch;
          
          // Common cache key patterns for seasons
          const seasonCacheKeys = [
            `season:${showTitle}:${seasonNumber}*`,
            `metadata:season:${showTitle}:${seasonNumber}*`,
            `blurhash:season:${showTitle}:${seasonNumber}*`,
            `poster:season:${showTitle}:${seasonNumber}*`
          ];
          
          for (const pattern of seasonCacheKeys) {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
              await redisClient.del(keys);
              results.cleared += keys.length;
              results.details.push(`Cleared ${keys.length} cache entries for season "${seasonTitle}" with pattern ${pattern}`);
            }
          }
        }
      } catch (error) {
        logError(log, error, {
          seasonTitle,
          context: 'clear_cache_season'
        });
        results.errors++;
      }
    }
    
    // Clear cache for individual episodes
    for (const episodeTitle of removedContent.tvEpisodes || []) {
      try {
        // Extract show title, season, and episode from "ShowTitle SXXeYY" format
        const episodeMatch = episodeTitle.match(/^(.+) S(\d+)E(\d+)$/);
        if (episodeMatch) {
          const [, showTitle, seasonNumber, episodeNumber] = episodeMatch;
          
          // Common cache key patterns for episodes
          const episodeCacheKeys = [
            `episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
            `metadata:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
            `blurhash:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`,
            `thumbnail:episode:${showTitle}:${seasonNumber}:${episodeNumber}*`
          ];
          
          for (const pattern of episodeCacheKeys) {
            const keys = await redisClient.keys(pattern);
            if (keys.length > 0) {
              await redisClient.del(keys);
              results.cleared += keys.length;
              results.details.push(`Cleared ${keys.length} cache entries for episode "${episodeTitle}" with pattern ${pattern}`);
            }
          }
        }
      } catch (error) {
        logError(log, error, {
          episodeTitle,
          context: 'clear_cache_episode'
        });
        results.errors++;
      }
    }
    
    log.info({ cleared: results.cleared, errors: results.errors }, 'Cache clearing complete');
    return results;
  } catch (error) {
    logError(log, error, { context: 'cache_clearing' });
    return { cleared: 0, errors: 1, details: [error.message] };
  }
}

/**
 * Performs a full availability check and removes unavailable content from the flat database.
 * Uses only the cleanup functions which already handle direct removal from the flat database.
 * @param {Object} flatDB - Current database state from buildFlatDBStructure
 * @param {Object} fileServers - All file servers data
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Results of the operation
 */
export async function checkAndRemoveUnavailableVideosFlat(flatDB, fileServers, fieldAvailability) {
  const client = await clientPromise;
  const log = createLogger('FlatSync.VideoAvailability');
  try {
    log.info('Checking and removing unavailable content from flat structure...');
    
    // Pass the flatDB to the cleanup functions to avoid additional database queries
    // The functions will use this data instead of making their own database calls
    
    // Clean up in hierarchical order: Shows -> Seasons -> Episodes -> Movies
    const missingTVShowsResults = await cleanupMissingTVShows(client, flatDB, fileServers, fieldAvailability);
    const missingSeasonsResults = await cleanupMissingSeasons(client, flatDB, fileServers, fieldAvailability);
    const missingEpisodesResults = await cleanupMissingEpisodes(client, flatDB, fileServers, fieldAvailability);
    const missingMoviesResults = await cleanupMissingMovies(client, flatDB, fileServers, fieldAvailability);
    
    // Format the results in a consistent structure
    const results = {
      removed: { 
        movies: missingMoviesResults.details.map(item => item.title), 
        tvShows: missingTVShowsResults.details.map(item => item.title), 
        tvSeasons: missingSeasonsResults.details.map(item => `${item.showTitle} Season ${item.seasonNumber}`), 
        tvEpisodes: missingEpisodesResults.details.map(item => `${item.showTitle} S${item.seasonNumber}E${item.episodeNumber}`) 
      },
      errors: { 
        movies: [], 
        tvShows: [], 
        tvSeasons: [], 
        tvEpisodes: [] 
      },
      cache: null
    };
    
    // Add season and episode counts from TV show results
    if (missingTVShowsResults.details.length > 0) {
      let totalSeasons = 0;
      let totalEpisodes = 0;
      
      for (const item of missingTVShowsResults.details) {
        totalSeasons += item.deletedSeasons || 0;
        totalEpisodes += item.deletedEpisodes || 0;
      }
      
      log.info({
        tvShowsRemoved: missingTVShowsResults.tvShowsRemoved,
        totalSeasons,
        totalEpisodes
      }, 'Removed TV shows with associated seasons/episodes');
    }
    
    // Log individual season cleanup results
    if (missingSeasonsResults.seasonsRemoved > 0) {
      let totalEpisodesFromSeasons = 0;
      for (const item of missingSeasonsResults.details) {
        totalEpisodesFromSeasons += item.deletedEpisodes || 0;
      }
      log.info({
        seasonsRemoved: missingSeasonsResults.seasonsRemoved,
        totalEpisodesFromSeasons
      }, 'Removed orphaned seasons');
    }
    
    // Log individual episode cleanup results
    if (missingEpisodesResults.episodesRemoved > 0) {
      log.info({ episodesRemoved: missingEpisodesResults.episodesRemoved }, 'Removed orphaned episodes');
    }
    
    if (missingMoviesResults.moviesRemoved > 0) {
      log.info({ moviesRemoved: missingMoviesResults.moviesRemoved }, 'Removed movies missing from file servers');
    }
    
    // Clear cache for removed content (including seasons and episodes)
    if (results.removed.movies.length > 0 || 
        results.removed.tvShows.length > 0 || 
        results.removed.tvSeasons.length > 0 || 
        results.removed.tvEpisodes.length > 0) {
      results.cache = await clearCacheEntries(results.removed);
    }
    
    return results;
  } catch (error) {
    logError(log, error, { context: 'check_and_remove' });
    return {
      removed: { movies: [], tvShows: [], tvSeasons: [], tvEpisodes: [] },
      errors: { general: { message: error.message, stack: error.stack } }
    };
  }
}

// Exports the main function and helper functions
export {
  cleanupMissingMovies,
  cleanupMissingTVShows,
  cleanupMissingSeasons,
  cleanupMissingEpisodes,
};
