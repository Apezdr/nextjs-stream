/**
 * Sync verification utilities
 * 
 * This module provides utilities for verifying the success and completeness
 * of media sync operations by identifying potentially incomplete or missing data.
 */

import clientPromise from '@src/lib/mongodb';
import { getAllServers } from '@src/utils/config';
import chalk from 'chalk';
import { fetchAllServerData } from '@src/utils/fetchAllServerData';

/**
 * Retrieves file server data for comparison
 * @returns {Promise<Object>} The file server data and current DB state
 */
async function getFileServerData() {
  try {
    console.log(chalk.cyan('Fetching file server data for comparison...'));
    const { fileServers, errors } = await fetchAllServerData();
    
    if (errors && errors.length > 0) {
      console.warn(chalk.yellow('Warnings when fetching file server data:'), errors);
    }
    
    return { fileServers };
  } catch (error) {
    console.error(chalk.red('Error fetching file server data:'), error.message);
    throw error;
  }
}

/**
 * Gets the last sync history
 * @returns {Promise<Object>} Sync history information
 */
async function getSyncHistory() {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    // Get most recent sync operations from tracking collection
    const syncHistory = await db.collection('SyncHistory')
      .find({})
      .sort({ completedAt: -1 })
      .limit(10)
      .toArray();
      
    // Get hash data to identify what was processed or skipped
    const hashData = await db.collection('MediaHashes')
      .find({})
      .sort({ updatedAt: -1 })
      .limit(100)
      .toArray();
      
    return { syncHistory, hashData };
  } catch (error) {
    console.error(chalk.red('Error fetching sync history:'), error.message);
    return { syncHistory: [], hashData: [] };
  }
}

/**
 * Analyzes timing information from sync history
 * @param {Array} syncHistory - Sync history entries 
 * @returns {Object} Timing analysis
 */
function analyzeSyncTimings(syncHistory) {
  if (!syncHistory || syncHistory.length === 0) {
    return {};
  }
  
  // Get most recent sync
  const latestSync = syncHistory[0];
  
  // Calculate average times
  const timings = syncHistory.reduce((acc, sync) => {
    if (sync.performance) {
      const { totalTimeSeconds, tvShowTimeSeconds, seasonTimeSeconds, episodeTimeSeconds, movieTimeSeconds } = sync.performance;
      
      acc.totalTimes.push(totalTimeSeconds || 0);
      acc.tvShowTimes.push(tvShowTimeSeconds || 0);
      acc.seasonTimes.push(seasonTimeSeconds || 0);
      acc.episodeTimes.push(episodeTimeSeconds || 0);
      acc.movieTimes.push(movieTimeSeconds || 0);
    }
    return acc;
  }, {
    totalTimes: [],
    tvShowTimes: [],
    seasonTimes: [],
    episodeTimes: [],
    movieTimes: []
  });
  
  // Calculate averages
  const getAverage = arr => arr.length > 0 ? arr.reduce((sum, val) => sum + val, 0) / arr.length : 0;
  
  return {
    latestSync: {
      completedAt: latestSync.completedAt,
      server: latestSync.server,
      performance: latestSync.performance
    },
    averages: {
      totalTimeSeconds: getAverage(timings.totalTimes),
      tvShowTimeSeconds: getAverage(timings.tvShowTimes),
      seasonTimeSeconds: getAverage(timings.seasonTimes),
      episodeTimeSeconds: getAverage(timings.episodeTimes),
      movieTimeSeconds: getAverage(timings.movieTimes)
    },
    history: syncHistory.map(sync => ({
      completedAt: sync.completedAt,
      server: sync.server,
      processedCounts: {
        tvShows: sync.tvShows?.processed?.length || 0,
        seasons: sync.seasons?.processed?.length || 0,
        episodes: sync.episodes?.processed?.length || 0,
        movies: sync.movies?.processed?.length || 0
      },
      errorCounts: {
        tvShows: sync.tvShows?.errors?.length || 0,
        seasons: sync.seasons?.errors?.length || 0,
        episodes: sync.episodes?.errors?.length || 0,
        movies: sync.movies?.errors?.length || 0
      },
      timing: sync.performance
    }))
  };
}

/**
 * Identifies missing content by comparing file servers with database
 * @param {Object} fileServers - File server data
 * @param {Array} flatMovies - Database movies
 * @param {Array} flatTVShows - Database TV shows
 * @param {Array} flatSeasons - Database seasons
 * @param {Array} flatEpisodes - Database episodes
 * @returns {Object} Missing content report
 */
function identifyMissingContent(fileServers, flatMovies, flatTVShows, flatSeasons, flatEpisodes) {
  const missingContent = {
    movies: [],
    tvShows: [],
    seasons: [],
    episodes: []
  };
  
  // Create lookup maps for database content
  const movieTitleMap = {};
  flatMovies.forEach(movie => {
    const title = movie.title || movie.originalTitle;
    if (title) {
      movieTitleMap[title.toLowerCase()] = true;
      // Also add original title if different
      if (movie.originalTitle && movie.originalTitle !== movie.title) {
        movieTitleMap[movie.originalTitle.toLowerCase()] = true;
      }
    }
  });
  
  const tvShowTitleMap = {};
  flatTVShows.forEach(show => {
    const title = show.title || show.originalTitle;
    if (title) {
      tvShowTitleMap[title.toLowerCase()] = true;
      // Also add original title if different
      if (show.originalTitle && show.originalTitle !== show.title) {
        tvShowTitleMap[show.originalTitle.toLowerCase()] = true;
      }
    }
  });
  
  // Create map of seasons by show title + season number
  const seasonMap = {};
  flatSeasons.forEach(season => {
    if (season.showTitle && season.seasonNumber !== undefined) {
      const key = `${season.showTitle.toLowerCase()}_s${season.seasonNumber}`;
      seasonMap[key] = true;
    }
  });
  
  // Create map of episodes by show title + season number + episode number
  const episodeMap = {};
  flatEpisodes.forEach(episode => {
    if (episode.showTitle && episode.seasonNumber !== undefined && episode.episodeNumber !== undefined) {
      const key = `${episode.showTitle.toLowerCase()}_s${episode.seasonNumber}_e${episode.episodeNumber}`;
      episodeMap[key] = true;
    }
  });
  
  // Check each file server for content missing from the database
  Object.entries(fileServers).forEach(([serverId, fileServer]) => {
    // Check for missing movies
    if (fileServer.movies) {
      Object.keys(fileServer.movies).forEach(movieTitle => {
        if (!movieTitleMap[movieTitle.toLowerCase()]) {
          missingContent.movies.push({
            title: movieTitle,
            serverId,
            reason: 'Present in file server but missing from database'
          });
        }
      });
    }
    
    // Check for missing TV shows, seasons, and episodes
    if (fileServer.tv) {
      Object.entries(fileServer.tv).forEach(([showTitle, showData]) => {
        // Check if TV show is missing
        if (!tvShowTitleMap[showTitle.toLowerCase()]) {
          missingContent.tvShows.push({
            title: showTitle,
            serverId,
            reason: 'Present in file server but missing from database'
          });
        }
        
        // Check seasons
        if (showData.seasons) {
          Object.entries(showData.seasons).forEach(([seasonKey, seasonData]) => {
            const seasonNumber = parseInt(seasonKey.replace('Season ', ''), 10);
            if (isNaN(seasonNumber)) return;
            
            const seasonMapKey = `${showTitle.toLowerCase()}_s${seasonNumber}`;
            if (!seasonMap[seasonMapKey]) {
              missingContent.seasons.push({
                showTitle,
                seasonNumber,
                serverId,
                reason: 'Present in file server but missing from database'
              });
            }
            
            // Check episodes
            if (seasonData.episodes) {
              Object.keys(seasonData.episodes).forEach(episodeKey => {
                // Try to extract episode number from filename
                const match = episodeKey.match(/S\d+E(\d+)/i) || episodeKey.match(/E(\d+)/i);
                if (!match) return;
                
                const episodeNumber = parseInt(match[1], 10);
                if (isNaN(episodeNumber)) return;
                
                const episodeMapKey = `${showTitle.toLowerCase()}_s${seasonNumber}_e${episodeNumber}`;
                if (!episodeMap[episodeMapKey]) {
                  missingContent.episodes.push({
                    showTitle,
                    seasonNumber,
                    episodeNumber,
                    serverId,
                    reason: 'Present in file server but missing from database',
                    filename: episodeKey
                  });
                }
              });
            }
          });
        }
      });
    }
  });
  
  return missingContent;
}

/**
 * Checks for server-specific issues
 * @param {Object} fileServers - File server data
 * @param {Array} flatMovies - Database movies
 * @param {Array} flatTVShows - Database TV shows
 * @param {Array} flatSeasons - Database seasons
 * @param {Array} flatEpisodes - Database episodes
 * @returns {Object} Server issues report
 */
function checkServerIssues(fileServers, flatMovies, flatTVShows, flatSeasons, flatEpisodes) {
  const serverIssues = {};
  
  // Initialize issues for each server
  Object.keys(fileServers).forEach(serverId => {
    serverIssues[serverId] = {
      missingVideoUrls: 0,
      missingThumbnails: 0,
      missingPosters: 0,
      failedContentCount: 0,
      issuesByCategory: {
        movies: [],
        tvShows: [],
        seasons: [],
        episodes: []
      }
    };
  });
  
  // Check each movie for server-specific issues
  flatMovies.forEach(movie => {
    const sourceServer = movie.videoSource;
    if (sourceServer && serverIssues[sourceServer]) {
      if (!movie.videoURL) {
        serverIssues[sourceServer].missingVideoUrls++;
        serverIssues[sourceServer].failedContentCount++;
        serverIssues[sourceServer].issuesByCategory.movies.push({
          id: movie._id.toString(),
          title: movie.title,
          issue: 'Missing videoURL'
        });
      }
      if (!movie.thumbnail) {
        serverIssues[sourceServer].missingThumbnails++;
        serverIssues[sourceServer].issuesByCategory.movies.push({
          id: movie._id.toString(),
          title: movie.title,
          issue: 'Missing thumbnail'
        });
      }
      if (!movie.poster) {
        serverIssues[sourceServer].missingPosters++;
        serverIssues[sourceServer].issuesByCategory.movies.push({
          id: movie._id.toString(),
          title: movie.title,
          issue: 'Missing poster'
        });
      }
    }
  });
  
  // Check each episode for server-specific issues
  flatEpisodes.forEach(episode => {
    const sourceServer = episode.videoSource;
    if (sourceServer && serverIssues[sourceServer]) {
      if (!episode.videoURL) {
        serverIssues[sourceServer].missingVideoUrls++;
        serverIssues[sourceServer].failedContentCount++;
        serverIssues[sourceServer].issuesByCategory.episodes.push({
          id: episode._id.toString(),
          showTitle: episode.showTitle,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          issue: 'Missing videoURL'
        });
      }
      if (!episode.thumbnail) {
        serverIssues[sourceServer].missingThumbnails++;
        serverIssues[sourceServer].issuesByCategory.episodes.push({
          id: episode._id.toString(),
          showTitle: episode.showTitle,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          issue: 'Missing thumbnail'
        });
      }
    }
  });
  
  return serverIssues;
}

/**
 * Counts occurrences of each issue type across media categories
 * @param {Object} report - The verification report 
 * @returns {Object} Counts of each issue type by media category
 */
function countIssueTypes(report) {
  const summary = {
    // Top-level summary by issue type category
    topIssues: {
      missingFields: 0,      // Missing essential fields (videoURL, thumbnail, title, etc.)
      missingMetadata: 0,    // Missing non-essential metadata (overview, etc.)
      relationshipIssues: 0, // Missing seasons, episodes, etc.
      gapIssues: 0           // Episode gaps, etc.
    },
    // Full detailed counts
    total: {},
    byCategory: {
      movies: {},
      tvShows: {},
      seasons: {},
      episodes: {}
    },
    // Group similar issues together
    byPattern: {
      missingFields: {},     // Missing videoURL, thumbnail, etc.
      missingSeasons: {},    // Missing seasons (1/2), etc.
      missingEpisodes: {},   // Missing episodes (3/4), etc.
      episodeGaps: {}        // Episode gaps
    }
  };
  
  // Helper function to increment issue counts
  function incrementIssueCount(category, issueType) {
    // Increment in category-specific counter
    if (!summary.byCategory[category][issueType]) {
      summary.byCategory[category][issueType] = 0;
    }
    summary.byCategory[category][issueType]++;
    
    // Increment in total counter
    if (!summary.total[issueType]) {
      summary.total[issueType] = 0;
    }
    summary.total[issueType]++;
    
    // Categorize by pattern for easier analysis
    if (issueType.startsWith('Missing ')) {
      // Check if it's about relationships or fields
      if (issueType.includes('seasons') || issueType.includes('episodes')) {
        summary.topIssues.relationshipIssues++;
        
        // Count missing seasons patterns
        if (issueType.includes('seasons')) {
          if (!summary.byPattern.missingSeasons[issueType]) {
            summary.byPattern.missingSeasons[issueType] = 0;
          }
          summary.byPattern.missingSeasons[issueType]++;
        }
        
        // Count missing episodes patterns
        if (issueType.includes('episodes')) {
          if (!summary.byPattern.missingEpisodes[issueType]) {
            summary.byPattern.missingEpisodes[issueType] = 0;
          }
          summary.byPattern.missingEpisodes[issueType]++;
        }
      } else if (issueType === 'Missing overview') {
        // Missing non-essential metadata
        summary.topIssues.missingMetadata++;
      } else {
        // Missing essential fields
        summary.topIssues.missingFields++;
        
        // Group by field type
        if (!summary.byPattern.missingFields[issueType]) {
          summary.byPattern.missingFields[issueType] = 0;
        }
        summary.byPattern.missingFields[issueType]++;
      }
    } else if (issueType.includes('Episode gap')) {
      // Episode gaps
      summary.topIssues.gapIssues++;
      
      if (!summary.byPattern.episodeGaps[issueType]) {
        summary.byPattern.episodeGaps[issueType] = 0;
      }
      summary.byPattern.episodeGaps[issueType]++;
    } else if (issueType === 'No seasons found') {
      summary.topIssues.relationshipIssues++;
    }
  }
  
  // Count movie issues
  report.issues.movies.forEach(movie => {
    movie.issues.forEach(issue => {
      incrementIssueCount('movies', issue);
    });
  });
  
  // Count TV show issues
  report.issues.tvShows.forEach(show => {
    show.issues.forEach(issue => {
      incrementIssueCount('tvShows', issue);
    });
  });
  
  // Count season issues
  report.issues.seasons.forEach(season => {
    season.issues.forEach(issue => {
      incrementIssueCount('seasons', issue);
    });
  });
  
  // Count episode issues
  report.issues.episodes.forEach(episode => {
    episode.issues.forEach(issue => {
      incrementIssueCount('episodes', issue);
    });
  });
  
  // Sort the issues by frequency for easier consumption
  const sortedTotal = Object.entries(summary.total)
    .sort((a, b) => b[1] - a[1])
    .reduce((acc, [key, value]) => {
      acc[key] = value;
      return acc;
    }, {});
  
  // Sort category-specific issues by frequency
  Object.keys(summary.byCategory).forEach(category => {
    summary.byCategory[category] = Object.entries(summary.byCategory[category])
      .sort((a, b) => b[1] - a[1])
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
  });
  
  // Sort pattern-specific issues by frequency
  Object.keys(summary.byPattern).forEach(patternType => {
    summary.byPattern[patternType] = Object.entries(summary.byPattern[patternType])
      .sort((a, b) => b[1] - a[1])
      .reduce((acc, [key, value]) => {
        acc[key] = value;
        return acc;
      }, {});
  });
  
  summary.total = sortedTotal;
  
  return summary;
}

/**
 * Generates a report of media items that may not have synced properly
 * @param {boolean} compareWithFileServers - Whether to compare database with file servers
 * @returns {Promise<Object>} Verification report
 */
export async function getSyncVerificationReport(compareWithFileServers = true) {
  try {
    const client = await clientPromise;
    const db = client.db('Media');
    
    // Build the verification report
    const report = {
      issues: {
        movies: [],
        tvShows: [],
        seasons: [],
        episodes: []
      },
      stats: {
        movies: { total: 0, withIssues: 0 },
        tvShows: { total: 0, withIssues: 0 },
        seasons: { total: 0, withIssues: 0 },
        episodes: { total: 0, withIssues: 0 }
      },
      serverIssues: {},
      syncTimings: {},
      missingItems: {
        movies: [],
        tvShows: [],
        seasons: [],
        episodes: []
      },
      syncHistory: []
    };
    
    // Get all file servers and their data if requested
    const servers = getAllServers();
    let fileServers = {};
    
    if (compareWithFileServers) {
      try {
        console.log(chalk.cyan('Fetching file server data for comparison...'));
        const data = await getFileServerData();
        fileServers = data.fileServers || {};
      } catch (error) {
        console.warn(chalk.yellow('Could not fetch file server data. Skipping comparison.'));
      }
    }
    
    // Get sync history and timing data
    try {
      const historyData = await getSyncHistory();
      report.syncHistory = historyData.syncHistory || [];
      report.hashData = historyData.hashData || [];
      report.syncTimings = analyzeSyncTimings(report.syncHistory);
    } catch (error) {
      console.warn(chalk.yellow('Could not fetch sync history. Skipping timing analysis.'));
    }
    
    // Extract data from flat DB structure
    console.log(chalk.cyan('Building data for sync verification...'));
    
    // === MOVIES VERIFICATION ===
    const flatMovies = await db.collection('FlatMovies').find({}).toArray();
    report.stats.movies.total = flatMovies.length;
    
    // Check movies for issues
    for (const movie of flatMovies) {
      const issues = [];
      
      // Check for missing essential fields
      if (!movie.videoURL) issues.push('Missing videoURL');
      if (!movie.title) issues.push('Missing title');
      if (!movie.posterURL) issues.push('Missing poster');
      if (!movie.posterSource) issues.push('Missing poster source server');
      if (!movie.posterBlurhash) issues.push('Missing poster blurhash');
      if (!movie.logo && !movie.logoSource) issues.push('Missing logo and source server');
      else if (!movie.logo) issues.push('Missing logo');
      else if (!movie.logoSource) issues.push('Missing logo source server');
      if (!movie.backdrop) issues.push('Missing backdrop');
      if (!movie.backdropSource) issues.push('Missing backdrop source server');
      if (!movie.metadata && !movie.metadataSource) issues.push('Missing metadata and source server');
      else if (!movie.metadata) issues.push('Missing metadata');
      else if (!movie.metadataSource) issues.push('Missing metadata source server');
      if (!movie['duration']) issues.push('Missing duration of media');
      if (!movie.dimensions) issues.push('Missing dimensions of media');
      
      // Check for missing or corrupted metadata
      if (!movie.originalTitle) issues.push('Missing originalTitle');
      if (!movie.metadata?.overview && movie.title) issues.push('Missing overview');
      if (!movie.year && movie.releaseDate) {
        try {
          // Try to extract year from release date
          const releaseYear = new Date(movie.releaseDate).getFullYear();
          if (isNaN(releaseYear) || releaseYear < 1900 || releaseYear > new Date().getFullYear() + 5) {
            issues.push('Invalid releaseDate format');
          }
        } catch (e) {
          issues.push('Invalid releaseDate format');
        }
      }
      
      // If there are no issues, skip
      if (issues.length === 0) continue;
      
      // Add to issues report
      report.issues.movies.push({
        id: movie._id.toString(),
        title: movie.title || 'Unknown Title',
        originalTitle: movie.originalTitle,
        createdAt: movie.createdAt,
        updatedAt: movie.updatedAt,
        videoSource: movie.videoSource,
        issues
      });
      
      report.stats.movies.withIssues++;
    }
    
    // === TV SHOWS VERIFICATION ===
    const flatTVShows = await db.collection('FlatTVShows').find({}).toArray();
    report.stats.tvShows.total = flatTVShows.length;
    
    // Get all seasons and episodes for reference
    const flatSeasons = await db.collection('FlatSeasons').find({}).toArray();
    const flatEpisodes = await db.collection('FlatEpisodes').find({}).toArray();
    
    report.stats.seasons.total = flatSeasons.length;
    report.stats.episodes.total = flatEpisodes.length;
    
    // Create a map of showId -> count of seasons
    const showSeasonsCountMap = {};
    flatSeasons.forEach(season => {
      if (season.showId) {
        const showId = season.showId.toString();
        showSeasonsCountMap[showId] = (showSeasonsCountMap[showId] || 0) + 1;
      }
    });
    
    // Create a map of seasonId -> count of episodes
    const seasonEpisodesCountMap = {};
    flatEpisodes.forEach(episode => {
      if (episode.seasonId) {
        const seasonId = episode.seasonId.toString();
        seasonEpisodesCountMap[seasonId] = (seasonEpisodesCountMap[seasonId] || 0) + 1;
      }
    });
    
    // Create a map of showId -> count of episodes
    const showEpisodesCountMap = {};
    flatEpisodes.forEach(episode => {
      if (episode.showId) {
        const showId = episode.showId.toString();
        showEpisodesCountMap[showId] = (showEpisodesCountMap[showId] || 0) + 1;
      }
    });
    
    // Check TV shows for issues
    for (const show of flatTVShows) {
      const issues = [];
      
      // Check for missing essential fields
      if (!show.title) issues.push('Missing title');
      if (!show.posterURL) issues.push('Missing poster');
      if (!show.posterSource) issues.push('Missing poster source server');
      if (!show.posterBlurhash) issues.push('Missing poster blurhash');
      if (!show.logo && !show.logoSource) issues.push('Missing logo and source server');
      else if (!show.logo) issues.push('Missing logo');
      else if (!show.logoSource) issues.push('Missing logo source server');
      if (!show.metadata && !show.metadataSource) issues.push('Missing metadata and source server');
      else if (!show.metadata) issues.push('Missing metadata');
      else if (!show.metadataSource) issues.push('Missing metadata source server');
      
      // Check for missing or corrupted metadata
      if (!show.originalTitle) issues.push('Missing originalTitle');
      if (!show.overview && show.title) issues.push('Missing overview');
      
      // Check for missing or too few seasons
      const expectedSeasonCount = show.numberOfSeasons || 0;
      const actualSeasonCount = showSeasonsCountMap[show._id.toString()] || 0;
      
      if (actualSeasonCount === 0) {
        issues.push('No seasons found');
      } else if (expectedSeasonCount > 0 && actualSeasonCount < expectedSeasonCount) {
        issues.push(`Missing seasons (${actualSeasonCount}/${expectedSeasonCount})`);
      }
      
      // Check for missing episodes
      const actualEpisodeCount = showEpisodesCountMap[show._id.toString()] || 0;
      const expectedEpisodeCount = show.numberOfEpisodes || 0;
      
      if (actualEpisodeCount === 0 && expectedEpisodeCount > 0) {
        issues.push('No episodes found');
      } else if (expectedEpisodeCount > 0 && actualEpisodeCount < expectedEpisodeCount) {
        issues.push(`Missing episodes (${actualEpisodeCount}/${expectedEpisodeCount})`);
      }
      
      // If there are no issues, skip
      if (issues.length === 0) continue;
      
      // Add to issues report
      report.issues.tvShows.push({
        id: show._id.toString(),
        title: show.title || 'Unknown Title',
        originalTitle: show.originalTitle,
        createdAt: show.createdAt,
        updatedAt: show.updatedAt,
        issues,
        seasonCount: actualSeasonCount,
        episodeCount: actualEpisodeCount
      });
      
      report.stats.tvShows.withIssues++;
    }
    
    // Check seasons for issues
    for (const season of flatSeasons) {
      const issues = [];
      
      // Check for missing essential fields
      if (!season.showId) issues.push('Missing showId');
      if (season.seasonNumber === undefined) issues.push('Missing seasonNumber');
      if (!season.posterURL) issues.push('Missing poster');
      if (!season.posterSource) issues.push('Missing poster source server');
      if (!season.posterBlurhash) issues.push('Missing poster blurhash');
      if (!season.metadata) issues.push('Missing metadata');
      if (!season.metadataSource) issues.push('Missing metadata source server');
      
      // Check for missing episodes
      const expectedEpisodeCount = season.episodeCount || 0;
      const actualEpisodeCount = seasonEpisodesCountMap[season._id.toString()] || 0;
      
      if (actualEpisodeCount === 0 && expectedEpisodeCount > 0) {
        issues.push('No episodes found');
      } else if (expectedEpisodeCount > 0 && actualEpisodeCount < expectedEpisodeCount) {
        issues.push(`Missing episodes (${actualEpisodeCount}/${expectedEpisodeCount})`);
      }
      
      // If there are no issues, skip
      if (issues.length === 0) continue;
      
      // Find the show title for this season
      const showId = season.showId?.toString();
      const show = showId ? flatTVShows.find(s => s._id.toString() === showId) : null;
      const showTitle = show?.title || season.showTitle || 'Unknown Show';
      
      // Add to issues report
      report.issues.seasons.push({
        id: season._id.toString(),
        showId: season.showId?.toString(),
        showTitle: showTitle,
        seasonNumber: season.seasonNumber,
        createdAt: season.createdAt,
        updatedAt: season.updatedAt,
        issues,
        episodeCount: actualEpisodeCount
      });
      
      report.stats.seasons.withIssues++;
    }
    
    // Check episodes for issues
    for (const episode of flatEpisodes) {
      const issues = [];
      
      // Check for missing essential fields
      if (!episode.showId) issues.push('Missing showId');
      if (!episode.seasonId) issues.push('Missing seasonId');
      if (episode.episodeNumber === undefined) issues.push('Missing episodeNumber');
      if (!episode.videoURL) issues.push('Missing videoURL');
      if (!episode.thumbnail) issues.push('Missing thumbnail');
      if (!episode.thumbnailBlurhash) issues.push('Missing thumbnail blurhash');
      
      // Check for missing or corrupted metadata
      if (!episode.title) issues.push('Missing title');
      if (!episode.showTitle) issues.push('Missing showTitle');

      if (!episode.metadata && !episode.metadataSource) issues.push('Missing metadata and source server');
      else if (!episode.metadata) issues.push('Missing metadata');
      else if (!episode.metadataSource) issues.push('Missing metadata source server');
      if (!episode['duration']) issues.push('Missing duration or length of media');
      if (!episode.dimensions) issues.push('Missing dimensions of media');
      
      // If there are no issues, skip
      if (issues.length === 0) continue;
      
      // Find show and season info for this episode
      const showId = episode.showId?.toString();
      const seasonId = episode.seasonId?.toString();
      
      const show = showId ? flatTVShows.find(s => s._id.toString() === showId) : null;
      const season = seasonId ? flatSeasons.find(s => s._id.toString() === seasonId) : null;
      
      const showTitle = show?.title || episode.showTitle || 'Unknown Show';
      const seasonNumber = season?.seasonNumber || episode.seasonNumber || 'Unknown Season';
      
      // Add to issues report
      report.issues.episodes.push({
        id: episode._id.toString(),
        showId: episode.showId?.toString(),
        seasonId: episode.seasonId?.toString(),
        showTitle: showTitle,
        seasonNumber: seasonNumber,
        episodeNumber: episode.episodeNumber,
        title: episode.title,
        createdAt: episode.createdAt,
        updatedAt: episode.updatedAt,
        videoSource: episode.videoSource,
        issues
      });
      
      report.stats.episodes.withIssues++;
    }
    
    // Analyze potential synchronization inconsistencies
    const episodesByShowSeason = {};
    flatEpisodes.forEach(episode => {
      if (episode.showTitle && episode.seasonNumber !== undefined) {
        const key = `${episode.showTitle}-S${episode.seasonNumber}`;
        if (!episodesByShowSeason[key]) {
          episodesByShowSeason[key] = [];
        }
        episodesByShowSeason[key].push(episode);
      }
    });
    
    // Find seasons with gaps in episode numbering
    for (const [key, episodes] of Object.entries(episodesByShowSeason)) {
      if (episodes.length < 2) continue;
      
      // Sort episodes by episode number
      episodes.sort((a, b) => a.episodeNumber - b.episodeNumber);
      
      // Check for gaps in episode numbering
      let previousEpisodeNumber = episodes[0].episodeNumber;
      for (let i = 1; i < episodes.length; i++) {
        const currentEpisodeNumber = episodes[i].episodeNumber;
        
        if (currentEpisodeNumber - previousEpisodeNumber > 1) {
          // Found a gap
          const [showTitle, seasonLabel] = key.split('-');
          const seasonNumber = parseInt(seasonLabel.substring(1), 10);
          
          // Check if we already have an issue for this season
          const existingSeasonIssue = report.issues.seasons.find(s => 
            s.showTitle === showTitle && s.seasonNumber === seasonNumber);
          
          if (existingSeasonIssue) {
            // Add gap info to existing issue
            existingSeasonIssue.issues.push(`Episode gap: missing episodes ${previousEpisodeNumber+1}-${currentEpisodeNumber-1}`);
          } else {
            // Find the season
            const season = flatSeasons.find(s => 
              s.showTitle === showTitle && s.seasonNumber === seasonNumber);
            
            if (season) {
              // Create a new issue for this season
              report.issues.seasons.push({
                id: season._id.toString(),
                showTitle: showTitle,
                seasonNumber: seasonNumber,
                issues: [`Episode gap: missing episodes ${previousEpisodeNumber+1}-${currentEpisodeNumber-1}`],
                episodeCount: episodes.length
              });
              
              report.stats.seasons.withIssues++;
            }
          }
        }
        
        previousEpisodeNumber = currentEpisodeNumber;
      }
    }
    
    // If comparing with file servers, add server-specific analysis
    if (compareWithFileServers && Object.keys(fileServers).length > 0) {
      // Find missing content
      report.missingItems = identifyMissingContent(fileServers, flatMovies, flatTVShows, flatSeasons, flatEpisodes);
      
      // Check for server-specific issues
      report.serverIssues = checkServerIssues(fileServers, flatMovies, flatTVShows, flatSeasons, flatEpisodes);
    }
    
    // Calculate aggregate statistics
    report.totalIssues = 
      report.stats.movies.withIssues + 
      report.stats.tvShows.withIssues + 
      report.stats.seasons.withIssues + 
      report.stats.episodes.withIssues;
      
    report.totalMedia = 
      report.stats.movies.total + 
      report.stats.tvShows.total + 
      report.stats.seasons.total + 
      report.stats.episodes.total;
      
    report.issuePercentage = report.totalMedia > 0 
      ? ((report.totalIssues / report.totalMedia) * 100).toFixed(2) + '%' 
      : '0%';
    
    // Add issue type summary counts across all media types
    report.issueSummary = countIssueTypes(report);
    
    return report;
  } catch (error) {
    console.error('Error generating sync verification report:', error);
    throw error;
  }
}
