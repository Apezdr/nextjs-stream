/**
 * In-memory data structure and utility functions for flat sync
 * 
 * This module provides efficient in-memory data structures and lookup functions
 * to reduce database calls during sync operations.
 */

import { ObjectId } from 'mongodb';
import chalk from 'chalk';
import { createFullUrl } from '../sync/utils';

/**
 * Builds an enhanced flat database structure with optimized lookup maps
 * @param {Object} client - MongoDB client
 * @param {Object} fileServer - Optional file server data to check for missing media
 * @param {Object} fieldAvailability - Field availability map
 * @returns {Promise<Object>} Enhanced data structure with lookup maps
 */
export async function buildEnhancedFlatDBStructure(client, fileServer = null, fieldAvailability) {
  try {
    console.log(chalk.cyan('Building enhanced data structure with optimized lookups...'));
    
    // Get all TV shows from FlatTVShows collection
    const flatTVShows = await client
      .db('Media')
      .collection('FlatTVShows')
      .find({})
      .toArray();
    
    // Get all seasons in a single query
    const flatSeasons = await client
      .db('Media')
      .collection('FlatSeasons')
      .find({})
      .toArray();
    
    // Get all episodes in a single query
    const flatEpisodes = await client
      .db('Media')
      .collection('FlatEpisodes')
      .find({})
      .toArray();
    
    // Create efficient lookup maps for episodes
    const episodeLookups = {
      // By primary identifier (showId, seasonId, episodeNumber)
      byIds: new Map(),
      
      // By natural key (showTitle, seasonNumber, episodeNumber)
      byNaturalKey: new Map(),
      
      // By MongoDB _id
      byId: new Map(),
      
      // By showId
      byShowId: new Map(),
      
      // By seasonId
      bySeasonId: new Map()
    };
    
    // Create lookup maps for seasons
    const seasonLookups = {
      // By primary identifier (showId, seasonNumber)
      byShowIdAndNumber: new Map(),
      
      // By natural key (showTitle, seasonNumber)
      byNaturalKey: new Map(),
      
      // By MongoDB _id
      byId: new Map(),
      
      // By showId
      byShowId: new Map()
    };
    
    // Create lookup maps for TV shows
    const tvShowLookups = {
      // By title
      byTitle: new Map(),
      
      // By original title
      byOriginalTitle: new Map(),
      
      // By MongoDB _id
      byId: new Map()
    };
    
    // Populate TV show lookups
    flatTVShows.forEach(show => {
      tvShowLookups.byId.set(show._id.toString(), show);
      tvShowLookups.byTitle.set(show.title, show);
      if (show.originalTitle) {
        tvShowLookups.byOriginalTitle.set(show.originalTitle, show);
      }
    });
    
    // Populate season lookups
    flatSeasons.forEach(season => {
      seasonLookups.byId.set(season._id.toString(), season);
      seasonLookups.byShowIdAndNumber.set(`${season.showId.toString()}-${season.seasonNumber}`, season);
      seasonLookups.byNaturalKey.set(`${season.showTitle}-${season.seasonNumber}`, season);
      
      // Group seasons by showId for easier access
      if (!seasonLookups.byShowId.has(season.showId.toString())) {
        seasonLookups.byShowId.set(season.showId.toString(), []);
      }
      seasonLookups.byShowId.get(season.showId.toString()).push(season);
    });
    
    // Populate episode lookups
    flatEpisodes.forEach(episode => {
      episodeLookups.byId.set(episode._id.toString(), episode);
      
      if (episode.showId && episode.seasonId) {
        episodeLookups.byIds.set(
          `${episode.showId.toString()}-${episode.seasonId.toString()}-${episode.episodeNumber}`, 
          episode
        );
      }
      
      if (episode.showTitle && episode.seasonNumber !== undefined && episode.episodeNumber !== undefined) {
        episodeLookups.byNaturalKey.set(
          `${episode.showTitle}-${episode.seasonNumber}-${episode.episodeNumber}`,
          episode
        );
      }
      
      // Group episodes by showId for easier access
      if (episode.showId) {
        if (!episodeLookups.byShowId.has(episode.showId.toString())) {
          episodeLookups.byShowId.set(episode.showId.toString(), []);
        }
        episodeLookups.byShowId.get(episode.showId.toString()).push(episode);
      }
      
      // Group episodes by seasonId for easier access
      if (episode.seasonId) {
        if (!episodeLookups.bySeasonId.has(episode.seasonId.toString())) {
          episodeLookups.bySeasonId.set(episode.seasonId.toString(), []);
        }
        episodeLookups.bySeasonId.get(episode.seasonId.toString()).push(episode);
      }
    });
    
    // Get all movies from FlatMovies collection
    const flatMovies = await client
      .db('Media')
      .collection('FlatMovies')
      .find({})
      .toArray();
    
    // Create lookup maps for movies
    const movieLookups = {
      byTitle: new Map(),
      byOriginalTitle: new Map(),
      byId: new Map()
    };
    
    // Populate movie lookups
    flatMovies.forEach(movie => {
      movieLookups.byId.set(movie._id.toString(), movie);
      movieLookups.byTitle.set(movie.title, movie);
      if (movie.originalTitle) {
        movieLookups.byOriginalTitle.set(movie.originalTitle, movie);
      }
    });
    
    // Build the full structure with nested relationships (similar to current behavior)
    const tvShowsWithSeasonsAndEpisodes = flatTVShows.map(show => {
      // Get all seasons for this show using our lookup map
      const showSeasons = seasonLookups.byShowId.get(show._id.toString()) || [];
      
      // Sort seasons by number
      const sortedSeasons = [...showSeasons].sort((a, b) => a.seasonNumber - b.seasonNumber);
      
      // Map each season to include its episodes
      const seasonsWithEpisodes = sortedSeasons.map(season => {
        // Get all episodes for this season using our lookup map
        const seasonEpisodes = episodeLookups.bySeasonId.get(season._id.toString()) || [];
        
        // Sort episodes by number
        const sortedEpisodes = [...seasonEpisodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
        
        return {
          ...season,
          episodes: sortedEpisodes
        };
      });
      
      return {
        ...show,
        seasons: seasonsWithEpisodes
      };
    });
    
    // Identify missing movies if fileServer is provided
    const missingMovies = [];
    if (fileServer && fileServer.movies) {
      // Implementation of missing movies detection (similar to existing code)
      const movieTitleMap = flatMovies.reduce((map, movie) => {
        if (movie.title) map[movie.title] = true;
        if (movie.originalTitle && movie.originalTitle !== movie.title) map[movie.originalTitle] = true;
        return map;
      }, {});
      
      const movieTitlesFromServer = Object.keys(fileServer.movies);
      for (const title of movieTitlesFromServer) {
        if (!movieTitleMap[title]) {
          if (fieldAvailability?.movies?.[title]) {
            const fieldPath = 'urls.mp4';
            const responsibleServers = fieldAvailability.movies[title][fieldPath] || [];
            if (responsibleServers.length > 0) {
              missingMovies.push(title);
            }
          } else {
            missingMovies.push(title);
          }
        }
      }
      
      if (missingMovies.length > 0) {
        console.log(chalk.yellow(`Identified ${missingMovies.length} movies missing from database`));
      }
    }
    
    // Return the enhanced data structure
    return {
      tv: tvShowsWithSeasonsAndEpisodes,
      movies: flatMovies,
      missingMovies: missingMovies.length > 0 ? missingMovies : undefined,
      // missingTVShows can be implemented similarly if needed
      // Add our lookup maps
      lookups: {
        tvShows: tvShowLookups,
        seasons: seasonLookups,
        episodes: episodeLookups,
        movies: movieLookups
      }
    };
  } catch (error) {
    console.error('Error building enhanced flat database structure:', error);
    return { tv: [], movies: [] };
  }
}

/**
 * Gets a TV show from in-memory structure
 * @param {Object} enhancedData - Enhanced data structure
 * @param {string} title - TV show title
 * @param {boolean} useOriginalTitle - Whether to use original title for lookup
 * @returns {Object|null} TV show document or null
 */
export function getShowFromMemory(enhancedData, title, useOriginalTitle = false) {
  if (!enhancedData || !enhancedData.lookups || !enhancedData.lookups.tvShows) {
    return null;
  }
  
  if (useOriginalTitle) {
    return enhancedData.lookups.tvShows.byOriginalTitle.get(title);
  }
  return enhancedData.lookups.tvShows.byTitle.get(title);
}

/**
 * Gets a TV season from in-memory structure
 * @param {Object} enhancedData - Enhanced data structure
 * @param {string} showTitle - TV show title
 * @param {number} seasonNumber - Season number
 * @returns {Object|null} Season document or null
 */
export function getSeasonFromMemory(enhancedData, showTitle, seasonNumber) {
  if (!enhancedData || !enhancedData.lookups || !enhancedData.lookups.seasons) {
    return null;
  }
  
  // Try by natural key first
  const season = enhancedData.lookups.seasons.byNaturalKey.get(`${showTitle}-${seasonNumber}`);
  if (season) return season;
  
  // If not found by natural key, try to resolve through show
  const show = getShowFromMemory(enhancedData, showTitle) || 
               getShowFromMemory(enhancedData, showTitle, true);
  if (!show) return null;
  
  return enhancedData.lookups.seasons.byShowIdAndNumber.get(`${show._id.toString()}-${seasonNumber}`);
}

/**
 * Gets a TV episode from in-memory structure
 * @param {Object} enhancedData - Enhanced data structure
 * @param {string} showTitle - TV show title
 * @param {number} seasonNumber - Season number
 * @param {number} episodeNumber - Episode number
 * @param {boolean} useOriginalTitle - Whether to use original title for lookup
 * @returns {Object|null} Episode document or null
 */
export function getEpisodeFromMemory(enhancedData, showTitle, seasonNumber, episodeNumber, useOriginalTitle = false) {
  if (!enhancedData || !enhancedData.lookups || !enhancedData.lookups.episodes) {
    return null;
  }
  
  // Try by natural key first
  const episode = enhancedData.lookups.episodes.byNaturalKey.get(
    `${showTitle}-${seasonNumber}-${episodeNumber}`
  );
  if (episode) return episode;
  
  // If not found by natural key, try to resolve through show and season
  const show = useOriginalTitle 
    ? enhancedData.lookups.tvShows.byOriginalTitle.get(showTitle)
    : enhancedData.lookups.tvShows.byTitle.get(showTitle);
  
  if (!show) return null;
  
  const season = enhancedData.lookups.seasons.byShowIdAndNumber.get(
    `${show._id.toString()}-${seasonNumber}`
  );
  if (!season) return null;
  
  return enhancedData.lookups.episodes.byIds.get(
    `${show._id.toString()}-${season._id.toString()}-${episodeNumber}`
  );
}

/**
 * Gets a movie from in-memory structure
 * @param {Object} enhancedData - Enhanced data structure
 * @param {string} title - Movie title
 * @param {boolean} useOriginalTitle - Whether to use original title for lookup
 * @returns {Object|null} Movie document or null
 */
export function getMovieFromMemory(enhancedData, title, useOriginalTitle = false) {
  if (!enhancedData || !enhancedData.lookups || !enhancedData.lookups.movies) {
    return null;
  }
  
  if (useOriginalTitle) {
    return enhancedData.lookups.movies.byOriginalTitle.get(title);
  }
  return enhancedData.lookups.movies.byTitle.get(title);
}

/**
 * Creates a TV show in memory and updates all relevant lookup maps
 * @param {Object} enhancedData - Enhanced data structure
 * @param {Object} showData - TV show data
 * @returns {Object} Created TV show
 */
export function createShowInMemory(enhancedData, showData) {
  if (!enhancedData || !enhancedData.lookups || !enhancedData.lookups.tvShows) {
    console.error('Enhanced data structure not properly initialized');
    return showData;
  }
  
  // Ensure we have a new _id if one wasn't provided
  if (!showData._id) {
    showData._id = new ObjectId();
  }
  
  // Add to our lookup maps
  enhancedData.lookups.tvShows.byId.set(showData._id.toString(), showData);
  
  if (showData.title) {
    enhancedData.lookups.tvShows.byTitle.set(showData.title, showData);
  }
  
  if (showData.originalTitle) {
    enhancedData.lookups.tvShows.byOriginalTitle.set(showData.originalTitle, showData);
  }
  
  // Create an initial structure for this show in the nested data
  if (enhancedData.tv) {
    // Check if show already exists in the tv array
    const existingShowIndex = enhancedData.tv.findIndex(s => 
      s.title === showData.title || 
      (s._id && showData._id && s._id.toString() === showData._id.toString())
    );
    
    if (existingShowIndex === -1) {
      // Add as a new show with empty seasons
      enhancedData.tv.push({
        ...showData,
        seasons: []
      });
    } else {
      // Update existing show with new data
      enhancedData.tv[existingShowIndex] = {
        ...enhancedData.tv[existingShowIndex],
        ...showData,
        // Keep existing seasons
        seasons: enhancedData.tv[existingShowIndex].seasons || []
      };
    }
  }
  
  return showData;
}

/**
 * Creates an episode in memory and updates all relevant lookup maps
 * @param {Object} enhancedData - Enhanced data structure
 * @param {Object} episodeData - Episode data
 * @returns {Object} Created episode
 */
export function createEpisodeInMemory(enhancedData, episodeData) {
  if (!enhancedData || !enhancedData.lookups || !enhancedData.lookups.episodes) {
    console.error('Enhanced data structure not properly initialized');
    return episodeData;
  }
  
  // Ensure we have a new _id if one wasn't provided
  if (!episodeData._id) {
    episodeData._id = new ObjectId();
  }
  
  // Add to our lookup maps
  enhancedData.lookups.episodes.byId.set(episodeData._id.toString(), episodeData);
  
  if (episodeData.showId && episodeData.seasonId && episodeData.episodeNumber !== undefined) {
    enhancedData.lookups.episodes.byIds.set(
      `${episodeData.showId.toString()}-${episodeData.seasonId.toString()}-${episodeData.episodeNumber}`,
      episodeData
    );
  }
  
  if (episodeData.showTitle && episodeData.seasonNumber !== undefined && episodeData.episodeNumber !== undefined) {
    enhancedData.lookups.episodes.byNaturalKey.set(
      `${episodeData.showTitle}-${episodeData.seasonNumber}-${episodeData.episodeNumber}`,
      episodeData
    );
  }
  
  // Add to appropriate group lists
  if (episodeData.showId) {
    if (!enhancedData.lookups.episodes.byShowId.has(episodeData.showId.toString())) {
      enhancedData.lookups.episodes.byShowId.set(episodeData.showId.toString(), []);
    }
    enhancedData.lookups.episodes.byShowId.get(episodeData.showId.toString()).push(episodeData);
  }
  
  if (episodeData.seasonId) {
    if (!enhancedData.lookups.episodes.bySeasonId.has(episodeData.seasonId.toString())) {
      enhancedData.lookups.episodes.bySeasonId.set(episodeData.seasonId.toString(), []);
    }
    enhancedData.lookups.episodes.bySeasonId.get(episodeData.seasonId.toString()).push(episodeData);
  }
  
  return episodeData;
}

/**
 * Creates a season in memory and updates all relevant lookup maps
 * @param {Object} enhancedData - Enhanced data structure
 * @param {Object} seasonData - Season data
 * @returns {Object} Created season
 */
export function createSeasonInMemory(enhancedData, seasonData) {
  if (!enhancedData || !enhancedData.lookups || !enhancedData.lookups.seasons) {
    console.error('Enhanced data structure not properly initialized');
    return seasonData;
  }
  
  // Ensure we have a new _id if one wasn't provided
  if (!seasonData._id) {
    seasonData._id = new ObjectId();
  }
  
  // Add to our lookup maps
  enhancedData.lookups.seasons.byId.set(seasonData._id.toString(), seasonData);
  
  if (seasonData.showId && seasonData.seasonNumber !== undefined) {
    enhancedData.lookups.seasons.byShowIdAndNumber.set(
      `${seasonData.showId.toString()}-${seasonData.seasonNumber}`,
      seasonData
    );
  }
  
  if (seasonData.showTitle && seasonData.seasonNumber !== undefined) {
    enhancedData.lookups.seasons.byNaturalKey.set(
      `${seasonData.showTitle}-${seasonData.seasonNumber}`,
      seasonData
    );
  }
  
  // Add to showId grouping
  if (seasonData.showId) {
    if (!enhancedData.lookups.seasons.byShowId.has(seasonData.showId.toString())) {
      enhancedData.lookups.seasons.byShowId.set(seasonData.showId.toString(), []);
    }
    enhancedData.lookups.seasons.byShowId.get(seasonData.showId.toString()).push(seasonData);
  }
  
  // Update the nested data structure by adding the season to the correct show
  if (seasonData.showId && enhancedData.tv) {
    const show = enhancedData.tv.find(s => s._id.toString() === seasonData.showId.toString());
    if (show) {
      if (!show.seasons) {
        show.seasons = [];
      }
      
      // Check if season already exists in the show
      const existingSeason = show.seasons.find(s => 
        s.seasonNumber === seasonData.seasonNumber || 
        (s._id && seasonData._id && s._id.toString() === seasonData._id.toString())
      );
      
      if (!existingSeason) {
        show.seasons.push({
          ...seasonData,
          episodes: [] // Initialize empty episodes array
        });
        // Sort seasons by number
        show.seasons.sort((a, b) => a.seasonNumber - b.seasonNumber);
      }
    }
  }
  
  return seasonData;
}

/**
 * Updates the nested data structure for episode creation
 * @param {Object} enhancedData - Enhanced data structure
 * @param {Object} episode - The created episode
 */
export function updateNestedDataWithNewEpisode(enhancedData, episode) {
  if (!enhancedData || !enhancedData.tv) return;
  
  // Find the show in the nested structure
  const show = enhancedData.tv.find(s => 
    s.title === episode.showTitle || 
    s._id.toString() === episode.showId.toString()
  );
  
  if (!show) return;
  
  // Find the season in the show
  const season = show.seasons?.find(s => 
    s.seasonNumber === episode.seasonNumber || 
    s._id.toString() === episode.seasonId.toString()
  );
  
  if (!season) return;
  
  // Add the episode to the season if it doesn't exist
  const existingEpisode = season.episodes?.find(e => 
    e.episodeNumber === episode.episodeNumber
  );
  
  if (!existingEpisode) {
    if (!season.episodes) {
      season.episodes = [];
    }
    season.episodes.push(episode);
    // Sort episodes by number
    season.episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
  }
}

/**
 * Checks if a TV show has any episodes with valid videoURLs in the file server data
 * @param {Object} fileServerShowData - File server data for a TV show
 * @returns {boolean} True if at least one episode has a valid videoURL
 */
export function hasTVShowValidVideoURLs(fileServerShowData) {
  if (!fileServerShowData || !fileServerShowData.seasons) {
    return false;
  }
  
  // Check each season
  for (const seasonKey of Object.keys(fileServerShowData.seasons)) {
    const seasonData = fileServerShowData.seasons[seasonKey];
    if (!seasonData || !seasonData.episodes) continue;
    
    // Check each episode
    for (const episodeKey of Object.keys(seasonData.episodes)) {
      const episodeData = seasonData.episodes[episodeKey];
      // If any episode has a valid videoURL, return true
      if (episodeData && episodeData.videoURL) {
        return true;
      }
    }
  }
  
  // No valid episodes found
  return false;
}

/**
 * Counts expected episodes for a server based on file server data
 * @param {Object} fileServer - File server data
 * @returns {number} Total expected episode count
 */
export function countExpectedEpisodesForServer(fileServer) {
  let totalExpectedEpisodes = 0;
  if (!fileServer || !fileServer.tv) return totalExpectedEpisodes;
  
  const serverShowTitles = Object.keys(fileServer.tv);
  
  for (const showTitle of serverShowTitles) {
    const showData = fileServer.tv[showTitle];
    if (!showData?.seasons) continue;

    for (const seasonKey of Object.keys(showData.seasons)) {
      const seasonData = showData.seasons[seasonKey];
      if (!seasonData?.episodes) continue;

      for (const episodeKey of Object.keys(seasonData.episodes)) {
        const episodeData = seasonData.episodes[episodeKey];
        // Video URLs are critical for episode processing
        // If a video URL is missing, we can't process the episode so omit it from the count
        if (episodeData?.videoURL) {
          totalExpectedEpisodes++;
        }
      }
    }
  }
  
  return totalExpectedEpisodes;
}
