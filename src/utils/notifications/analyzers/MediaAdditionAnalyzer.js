/**
 * Groups the titles a sync run added to the library for the new-content
 * notices: movies as they are, episodes by show. Which titles are new is
 * decided before this (src/utils/sync/run/newContent); this module only
 * arranges them.
 * Uses ID-only approach for efficient storage and fresh data retrieval
 */

import { NotificationHashing } from '../utils/NotificationHashing.js';

export class MediaAdditionAnalyzer {
  /**
   * Arrange the titles a run added for the notification generator
   * @param {Object} newContent - `{ movies, episodes }` from run/newContent:
   *   movies `{ id, title, originalTitle, createdAt }`, episodes
   *   `{ id, showTitle, originalTitle, seasonNumber, episodeNumber, title, createdAt }`
   *   (originalTitle is the show's on an episode)
   * @returns {Object} Analysis results with categorized content
   */
  static analyzeNewContent(newContent = {}) {
    const analysis = {
      newMovies: [],
      newEpisodes: [],
      showsWithNewEpisodes: new Map(),
      summary: {
        totalNewMovies: 0,
        totalNewEpisodes: 0,
        totalAffectedShows: 0
      },
      significance: 'none', // none, low, medium, high
      shouldNotify: false
    };

    const movies = Array.isArray(newContent.movies) ? newContent.movies : [];
    const episodes = Array.isArray(newContent.episodes) ? newContent.episodes : [];

    analysis.newMovies = movies.map(movie => ({
      // Store only essential identifiers and minimal fallback data
      id: movie.id,
      title: movie.title, // Keep for fallback display
      originalTitle: movie.originalTitle,
      createdAt: movie.createdAt
      // Full movie data will be fetched fresh when displaying notifications
    }));
    analysis.summary.totalNewMovies = analysis.newMovies.length;

    const episodeAnalysis = this.groupNewEpisodes(episodes);
    analysis.newEpisodes = episodeAnalysis.episodes;
    analysis.showsWithNewEpisodes = episodeAnalysis.showsMap;
    analysis.summary.totalNewEpisodes = analysis.newEpisodes.length;
    analysis.summary.totalAffectedShows = analysis.showsWithNewEpisodes.size;

    analysis.significance = this.calculateSignificance(analysis.summary);
    analysis.shouldNotify = this.shouldTriggerNotification(analysis.summary, 1);

    return analysis;
  }

  /**
   * Group new episodes by show (ID-only approach)
   * @param {Array} newEpisodes - New episodes, as analyzeNewContent takes them
   * @returns {Object} Episodes data with show grouping
   */
  static groupNewEpisodes(newEpisodes) {
    const episodes = [];
    const showsMap = new Map();

    newEpisodes.forEach(episode => {
      // Store only essential identifiers and minimal fallback data
      const episodeData = {
        id: episode.id,
        showTitle: episode.showTitle, // Display title (fallback only)
        originalTitle: episode.originalTitle, // Show's unique routing key for /list links
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        title: episode.title || null,
        createdAt: episode.createdAt
        // Full episode data will be fetched fresh when displaying notifications
      };

      episodes.push(episodeData);

      // Group by the show's unique originalTitle (two shows can share a display
      // title, e.g. "Kingdom" 2019 vs 2025 — grouping by showTitle would merge
      // them into one notification and produce an ambiguous deep-link).
      const showKey = episode.originalTitle || episode.showTitle;
      if (!showsMap.has(showKey)) {
        showsMap.set(showKey, {
          showTitle: episode.showTitle,
          originalTitle: episode.originalTitle,
          episodes: [],
          totalNewEpisodes: 0,
          latestSeason: 0,
          latestEpisode: 0
        });
      }

      const showData = showsMap.get(showKey);
      showData.episodes.push(episodeData);
      showData.totalNewEpisodes++;
    });

    // Sort episodes within each show by season/episode number, then find the
    // latest one (sorted first, so the latest does not depend on input order)
    showsMap.forEach(showData => {
      showData.episodes.sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) {
          return a.seasonNumber - b.seasonNumber;
        }
        return a.episodeNumber - b.episodeNumber;
      });
      const latest = showData.episodes[showData.episodes.length - 1];
      showData.latestSeason = latest.seasonNumber;
      showData.latestEpisode = latest.episodeNumber;
    });

    return { episodes, showsMap };
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
