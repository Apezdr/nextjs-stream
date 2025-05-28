/**
 * Video availability utilities for flat database structure
 * 
 * This module provides functions to check video availability across file servers
 * and remove unavailable videos from the flat database structure.
 */

import { MediaType, findEpisodeFileName } from '../sync/utils';
import clientPromise from '@src/lib/mongodb';
import { getRedisClient } from '@src/lib/redisClient';
import chalk from 'chalk';
import { ObjectId } from 'mongodb';
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
  console.log(chalk.yellow('Checking for movies that don\'t exist in any file servers...'));
  
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
            console.log(chalk.yellow(
              `Movie "${movie.title}" exists on servers ${serversWithMovie.join(', ')} but none are ` +
              `responsible according to field availability - keeping anyway to prevent data loss`
            ));
            shouldRemove = false;
          }
        } else {
          // If no responsible servers defined remove the movie
          shouldRemove = true
        }
      }
      
      // If the movie doesn't exist in any file server (or exists but fails field checks), remove it
      if (shouldRemove) {
        console.log(`Movie "${movie.title}" not found in any file server, removing...`);
        
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
    console.error('Error cleaning up missing movies:', error);
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
  console.log(chalk.yellow('Checking for TV shows that don\'t exist in any file servers or have no valid videoURLs...'));
  
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
        console.log(chalk.yellow(
          `TV show "${show.title}" exists on servers ${serversWithShow.join(', ')} but has no valid videoURLs in any episode`
        ));
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
            console.log(chalk.yellow(
              `TV show "${show.title}" exists on servers ${serversWithShow.join(', ')} but none are ` +
              `responsible according to field availability - keeping anyway to prevent data loss`
            ));
            shouldRemove = false;
          }
        }
      }
      
      // If the show doesn't exist in any file server (or exists but fails field checks), remove it and its related data
      if (shouldRemove) {
        console.log(`TV show "${show.title}" not found in any file server, removing...`);
        
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
    console.error('Error cleaning up missing TV shows:', error);
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
  console.log(chalk.yellow('Checking for seasons that don\'t exist in any file servers...'));
  
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
            console.log(chalk.yellow(
              `Season ${season.seasonNumber} of "${season.showTitle}" exists on servers ${serversWithSeason.join(', ')} but none are ` +
              `responsible according to field availability - keeping anyway to prevent data loss`
            ));
            shouldRemove = false;
          }
        }
      }
      
      // If the season doesn't exist in any file server, remove it and its episodes
      if (shouldRemove) {
        console.log(`Season ${season.seasonNumber} of "${season.showTitle}" not found in any file server, removing...`);
        
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
    console.error('Error cleaning up missing seasons:', error);
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
  console.log(chalk.yellow('Checking for episodes that don\'t exist in any file servers...'));
  
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
            console.log(chalk.yellow(
              `Episode S${episode.seasonNumber}E${episode.episodeNumber} of "${episode.showTitle}" exists on servers ${serversWithEpisode.join(', ')} but none are ` +
              `responsible according to field availability - keeping anyway to prevent data loss`
            ));
            shouldRemove = false;
          }
        }
      }
      
      // If the episode doesn't exist in any file server, remove it
      if (shouldRemove) {
        console.log(`Episode S${episode.seasonNumber}E${episode.episodeNumber} of "${episode.showTitle}" not found in any file server, removing...`);
        
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
    console.error('Error cleaning up missing episodes:', error);
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
  const redisClient = await getRedisClient();
  if (!redisClient) {
    console.log('Redis not configured. Skipping cache clearing.');
    return { cleared: 0, errors: 0 };
  }
  
  const results = {
    cleared: 0,
    errors: 0,
    details: []
  };
  
  try {
    console.log(chalk.bold.blue(`Clearing Redis cache entries for removed content...`));
    
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
        console.error(`Error clearing cache for movie "${movieTitle}":`, error);
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
        console.error(`Error clearing cache for TV show "${showTitle}":`, error);
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
        console.error(`Error clearing cache for season "${seasonTitle}":`, error);
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
        console.error(`Error clearing cache for episode "${episodeTitle}":`, error);
        results.errors++;
      }
    }
    
    console.log(chalk.bold.blue(`Cache clearing complete. Cleared ${results.cleared} entries with ${results.errors} errors.`));
    return results;
  } catch (error) {
    console.error(`Error during cache clearing:`, error);
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
  try {
    console.log(chalk.bold.red(`Checking and removing unavailable content from flat structure...`));
    
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
      
      console.log(chalk.yellow(`Removed ${missingTVShowsResults.tvShowsRemoved} TV shows with ${totalSeasons} seasons and ${totalEpisodes} episodes`));
    }
    
    // Log individual season cleanup results
    if (missingSeasonsResults.seasonsRemoved > 0) {
      let totalEpisodesFromSeasons = 0;
      for (const item of missingSeasonsResults.details) {
        totalEpisodesFromSeasons += item.deletedEpisodes || 0;
      }
      console.log(chalk.yellow(`Removed ${missingSeasonsResults.seasonsRemoved} orphaned seasons with ${totalEpisodesFromSeasons} episodes`));
    }
    
    // Log individual episode cleanup results
    if (missingEpisodesResults.episodesRemoved > 0) {
      console.log(chalk.yellow(`Removed ${missingEpisodesResults.episodesRemoved} orphaned episodes`));
    }
    
    if (missingMoviesResults.moviesRemoved > 0) {
      console.log(chalk.yellow(`Removed ${missingMoviesResults.moviesRemoved} movies`));
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
    console.error('Error in check and remove process for flat structure:', error);
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
