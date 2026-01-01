/**
 * Analyzes sync results to identify newly added media content
 * This module focuses on detecting and categorizing new movies and TV episodes
 * Uses ID-only approach for efficient storage and fresh data retrieval
 */

import { NotificationHashing } from '../utils/NotificationHashing.js';

export class MediaAdditionAnalyzer {
  /**
   * Analyze sync results to identify new content worthy of notifications
   * @param {Object} syncResults - Results from flatSync operations
   * @param {Object} options - Analysis options
   * @returns {Object} Analysis results with categorized content
   */
  static analyzeSyncResults(syncResults, options = {}) {
    const {
      minSignificanceThreshold = 1, // Minimum number of new items to trigger notification
      includeMovies = true,
      includeEpisodes = true,
      timeWindow = 24 * 60 * 60 * 1000 // 24 hours in milliseconds
    } = options;

    const analysis = {
      newMovies: [],
      newEpisodes: [],
      newSeasons: [],
      showsWithNewEpisodes: new Map(),
      summary: {
        totalNewMovies: 0,
        totalNewEpisodes: 0,
        totalNewSeasons: 0,
        totalAffectedShows: 0
      },
      significance: 'none', // none, low, medium, high
      shouldNotify: false
    };

    const now = new Date();
    const cutoffTime = new Date(now.getTime() - timeWindow);

    try {
      // Analyze movie additions
      if (includeMovies && syncResults.movies?.processed) {
        analysis.newMovies = this.extractNewMovies(syncResults.movies.processed, cutoffTime);
        analysis.summary.totalNewMovies = analysis.newMovies.length;
      }

      // Analyze episode additions
      if (includeEpisodes && syncResults.episodes?.processed) {
        const episodeAnalysis = this.extractNewEpisodes(syncResults.episodes.processed, cutoffTime);
        analysis.newEpisodes = episodeAnalysis.episodes;
        analysis.showsWithNewEpisodes = episodeAnalysis.showsMap;
        analysis.summary.totalNewEpisodes = analysis.newEpisodes.length;
        analysis.summary.totalAffectedShows = analysis.showsWithNewEpisodes.size;
      }

      // Analyze season additions (for organizational purposes)
      if (syncResults.seasons?.processed) {
        analysis.newSeasons = this.extractNewSeasons(syncResults.seasons.processed, cutoffTime);
        analysis.summary.totalNewSeasons = analysis.newSeasons.length;
      }

      // Determine significance and notification worthiness
      analysis.significance = this.calculateSignificance(analysis.summary);
      analysis.shouldNotify = this.shouldTriggerNotification(analysis.summary, minSignificanceThreshold);

      return analysis;
    } catch (error) {
      console.error('Error analyzing sync results for notifications:', error);
      return {
        ...analysis,
        error: error.message,
        shouldNotify: false
      };
    }
  }

  /**
   * Extract newly added movies from sync results (ID-only approach)
   * @param {Array} processedMovies - Processed movies from sync
   * @param {Date} cutoffTime - Time threshold for "new" content
   * @returns {Array} New movies data
   */
  static extractNewMovies(processedMovies, cutoffTime) {
    return processedMovies
      .filter(movie => {
        // Check if this is actually a new movie (not just updated)
        if (movie.created && movie.createdAt) {
          const createdTime = new Date(movie.createdAt);
          return createdTime >= cutoffTime;
        }
        // Fallback: check if it was marked as newly created
        return movie.isNew || movie.created;
      })
      .map(movie => ({
        // Store only essential identifiers and minimal fallback data
        id: movie._id,
        title: movie.title, // Keep for fallback display
        originalTitle: movie.originalTitle,
        createdAt: movie.createdAt || new Date()
        // Full movie data will be fetched fresh when displaying notifications
      }));
  }

  /**
   * Extract newly added episodes from sync results (ID-only approach)
   * @param {Array} processedEpisodes - Processed episodes from sync
   * @param {Date} cutoffTime - Time threshold for "new" content
   * @returns {Object} Episodes data with show grouping
   */
  static extractNewEpisodes(processedEpisodes, cutoffTime) {
    const episodes = [];
    const showsMap = new Map();

    processedEpisodes
      .filter(episode => {
        // Check if this is actually a new episode
        if (episode.created && episode.createdAt) {
          const createdTime = new Date(episode.createdAt);
          return createdTime >= cutoffTime;
        }
        return episode.isNew || episode.created;
      })
      .forEach(episode => {
        // Store only essential identifiers and minimal fallback data
        const episodeData = {
          // DEBUG: Log episode structure to see available fields
          ...(console.log('DEBUG: MediaAdditionAnalyzer - episode structure:', { 
            keys: Object.keys(episode), 
            _id: episode._id, 
            id: episode.id, 
            dbId: episode.dbId,
            showTitle: episode.showTitle,
            seasonNumber: episode.seasonNumber,
            episodeNumber: episode.episodeNumber
          }) || {}),
          id: episode._id,
          showTitle: episode.showTitle, // Keep for grouping and fallback
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          createdAt: episode.createdAt || new Date()
          // Full episode data will be fetched fresh when displaying notifications
        };

        episodes.push(episodeData);

        // Group by show
        const showKey = episode.showTitle;
        if (!showsMap.has(showKey)) {
          showsMap.set(showKey, {
            showTitle: episode.showTitle,
            episodes: [],
            totalNewEpisodes: 0,
            latestSeason: 0,
            latestEpisode: 0
          });
        }

        const showData = showsMap.get(showKey);
        showData.episodes.push(episodeData);
        showData.totalNewEpisodes++;
        showData.latestSeason = Math.max(showData.latestSeason, episode.seasonNumber);
        
        // Track latest episode within the latest season
        if (episode.seasonNumber === showData.latestSeason) {
          showData.latestEpisode = Math.max(showData.latestEpisode, episode.episodeNumber);
        }
      });

    // Sort episodes within each show by season/episode number
    showsMap.forEach(showData => {
      showData.episodes.sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) {
          return a.seasonNumber - b.seasonNumber;
        }
        return a.episodeNumber - b.episodeNumber;
      });
    });

    return { episodes, showsMap };
  }

  /**
   * Extract newly added seasons from sync results (ID-only approach)
   * @param {Array} processedSeasons - Processed seasons from sync
   * @param {Date} cutoffTime - Time threshold for "new" content
   * @returns {Array} New seasons data
   */
  static extractNewSeasons(processedSeasons, cutoffTime) {
    return processedSeasons
      .filter(season => {
        if (season.created && season.createdAt) {
          const createdTime = new Date(season.createdAt);
          return createdTime >= cutoffTime;
        }
        return season.isNew || season.created;
      })
      .map(season => ({
        // Store only essential identifiers and minimal fallback data
        id: season._id,
        showTitle: season.showTitle, // Keep for fallback display
        seasonNumber: season.seasonNumber,
        createdAt: season.createdAt || new Date()
        // Full season data will be fetched fresh when displaying notifications
      }));
  }

  /**
   * Calculate the significance level of new content
   * @param {Object} summary - Content summary statistics
   * @returns {string} Significance level: none, low, medium, high
   */
  static calculateSignificance(summary) {
    const totalItems = summary.totalNewMovies + summary.totalNewEpisodes;
    
    if (totalItems === 0) {
      return 'none';
    } else if (totalItems <= 2) {
      return 'low';
    } else if (totalItems <= 10) {
      return 'medium';
    } else {
      return 'high';
    }
  }

  /**
   * Determine if new content warrants a notification
   * @param {Object} summary - Content summary statistics
   * @param {number} threshold - Minimum threshold for notification
   * @returns {boolean} Whether to trigger notification
   */
  static shouldTriggerNotification(summary, threshold) {
    const totalItems = summary.totalNewMovies + summary.totalNewEpisodes;
    return totalItems >= threshold;
  }

  /**
   * Group episodes by show for better notification formatting
   * @param {Array} episodes - Array of episode objects
   * @returns {Map} Map of show title to episode data
   */
  static groupEpisodesByShow(episodes) {
    const grouped = new Map();
    
    episodes.forEach(episode => {
      const showTitle = episode.showTitle;
      if (!grouped.has(showTitle)) {
        grouped.set(showTitle, {
          showTitle,
          episodes: [],
          seasons: new Set()
        });
      }
      
      const showData = grouped.get(showTitle);
      showData.episodes.push(episode);
      showData.seasons.add(episode.seasonNumber);
    });

    // Convert seasons Set to sorted array and add episode counts
    grouped.forEach(showData => {
      showData.seasons = Array.from(showData.seasons).sort((a, b) => a - b);
      showData.totalEpisodes = showData.episodes.length;
      
      // Sort episodes by season/episode number
      showData.episodes.sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) {
          return a.seasonNumber - b.seasonNumber;
        }
        return a.episodeNumber - b.episodeNumber;
      });
    });

    return grouped;
  }

  /**
   * Generate a content fingerprint for deduplication (ID-only approach)
   * @param {Object} analysis - Analysis results
   * @returns {string} Content fingerprint hash
   */
  static generateContentFingerprint(analysis) {
    const content = {
      movies: analysis.newMovies.map(m => ({
        id: m.id,
        title: m.title,
        createdAt: m.createdAt
      })),
      episodes: analysis.newEpisodes.map(e => ({
        id: e.id,
        showTitle: e.showTitle,
        seasonNumber: e.seasonNumber,
        episodeNumber: e.episodeNumber,
        createdAt: e.createdAt
      }))
    };

    return NotificationHashing.generateContentHash(content);
  }
}
