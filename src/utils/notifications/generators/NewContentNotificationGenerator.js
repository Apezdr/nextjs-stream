/**
 * Generates notifications for newly added movies and TV episodes
 * Creates user-friendly notification objects with appropriate content and metadata
 */

import { NOTIFICATION_TYPES } from '../NotificationTypes.js';
import { NotificationHashing } from '../utils/NotificationHashing.js';

export class NewContentNotificationGenerator {
  /**
   * Generate action URL for movie content
   * @param {string} movieTitle - Movie title
   * @returns {string} Action URL
   */
  static generateMovieActionUrl(movieTitle) {
    const encodedTitle = encodeURIComponent(movieTitle);
    return `/list/movies/${encodedTitle}`;
  }

  /**
   * Generate action URL for TV show content
   * @param {string} showTitle - Show title
   * @param {number} seasonNumber - Season number (optional, for specific episode)
   * @param {number} episodeNumber - Episode number (optional, for specific episode)
   * @returns {string} Action URL
   */
  static generateTVActionUrl(showTitle, seasonNumber = null, episodeNumber = null) {
    const encodedShowTitle = encodeURIComponent(showTitle);
    
    if (seasonNumber !== null && episodeNumber !== null) {
      // Specific episode URL
      return `/list/tv/${encodedShowTitle}/${seasonNumber}/${episodeNumber}`;
    } else {
      // General show URL
      return `/list/tv/${encodedShowTitle}`;
    }
  }
  /**
   * Generate notifications for new content based on analysis results
   * @param {Object} analysis - Results from MediaAdditionAnalyzer
   * @param {Object} options - Generation options
   * @returns {Array} Array of notification objects ready for storage
   */
  static generateNotifications(analysis, options = {}) {
    const {
      batchSimilarContent = true,
      maxMoviesPerNotification = 5,
      maxEpisodesPerShow = 10,
      includeMetadata = true
    } = options;

    const notifications = [];

    try {
      // Generate movie notifications
      if (analysis.newMovies.length > 0) {
        const movieNotifications = this.generateMovieNotifications(
          analysis.newMovies,
          { batchSimilarContent, maxMoviesPerNotification, includeMetadata }
        );
        notifications.push(...movieNotifications);
      }

      // Generate TV episode notifications
      if (analysis.showsWithNewEpisodes.size > 0) {
        const episodeNotifications = this.generateEpisodeNotifications(
          analysis.showsWithNewEpisodes,
          { maxEpisodesPerShow, includeMetadata }
        );
        notifications.push(...episodeNotifications);
      }

      return notifications;
    } catch (error) {
      console.error('Error generating new content notifications:', error);
      return [];
    }
  }

  /**
   * Generate notifications for new movies
   * @param {Array} newMovies - Array of new movie objects
   * @param {Object} options - Generation options
   * @returns {Array} Movie notification objects
   */
  static generateMovieNotifications(newMovies, options = {}) {
    const { batchSimilarContent = true, maxMoviesPerNotification = 5, includeMetadata = true } = options;
    const notifications = [];

    if (!batchSimilarContent || newMovies.length === 1) {
      // Create individual notifications for each movie
      newMovies.forEach(movie => {
        notifications.push(this.createSingleMovieNotification(movie, includeMetadata));
      });
    } else {
      // Batch movies into fewer notifications
      const batches = this.batchMoviesByCategory(newMovies, maxMoviesPerNotification);
      
      batches.forEach(batch => {
        notifications.push(this.createBatchedMovieNotification(batch, includeMetadata));
      });
    }

    return notifications;
  }

  /**
   * Generate notifications for new TV episodes
   * @param {Map} showsWithNewEpisodes - Map of shows with their new episodes
   * @param {Object} options - Generation options
   * @returns {Array} Episode notification objects
   */
  static generateEpisodeNotifications(showsWithNewEpisodes, options = {}) {
    const { maxEpisodesPerShow = 10, includeMetadata = true } = options;
    const notifications = [];

    showsWithNewEpisodes.forEach((showData, showTitle) => {
      const notification = this.createShowEpisodeNotification(showData, includeMetadata, maxEpisodesPerShow);
      notifications.push(notification);
    });

    return notifications;
  }

  /**
   * Create a notification for a single new movie
   * @param {Object} movie - Movie object
   * @param {boolean} includeMetadata - Whether to include metadata
   * @returns {Object} Notification object
   */
  static createSingleMovieNotification(movie, includeMetadata = true) {
    const baseNotification = {
      type: NOTIFICATION_TYPES.NEW_CONTENT,
      subtype: 'new_movie',
      title: `New Movie: ${movie.title}`,
      message: this.formatMovieMessage(movie),
      actionUrl: this.generateMovieActionUrl(movie.title),
      data: {
        contentType: 'movie',
        contentId: movie.id,
        movies: [movie]
      },
      createdAt: new Date(),
      priority: 'normal'
    };

    if (includeMetadata) {
      baseNotification.metadata = {
        genre: movie.genre,
        rating: movie.rating,
        releaseDate: movie.releaseDate,
        posterUrl: movie.posterUrl,
        backdropUrl: movie.backdropUrl
      };
    }

    // Generate deduplication hash
    baseNotification.contentHash = NotificationHashing.generateContentHash({
      movies: [movie],
      episodes: []
    });

    return baseNotification;
  }

  /**
   * Create a notification for multiple new movies
   * @param {Array} movies - Array of movie objects
   * @param {boolean} includeMetadata - Whether to include metadata
   * @returns {Object} Notification object
   */
  static createBatchedMovieNotification(movies, includeMetadata = true) {
    const count = movies.length;
    const firstMovie = movies[0];
    
    let title, message;
    if (count === 2) {
      title = `New Movies: ${firstMovie.title} and 1 other`;
      message = `${firstMovie.title} and ${movies[1].title} have been added to your library.`;
    } else {
      title = `${count} New Movies Added`;
      message = `${firstMovie.title} and ${count - 1} other movies have been added to your library.`;
    }

    const baseNotification = {
      type: NOTIFICATION_TYPES.NEW_CONTENT,
      subtype: 'new_movies_batch',
      title,
      message,
      actionUrl: `/list/movies`, // General movies list for batch notifications
      data: {
        contentType: 'movies',
        count,
        movies
      },
      createdAt: new Date(),
      priority: count > 5 ? 'high' : 'normal'
    };

    if (includeMetadata) {
      // Include metadata for the first few movies
      baseNotification.metadata = {
        featuredMovies: movies.slice(0, 3).map(movie => ({
          title: movie.title,
          genre: movie.genre,
          rating: movie.rating,
          posterUrl: movie.posterUrl
        }))
      };
    }

    // Generate deduplication hash
    baseNotification.contentHash = NotificationHashing.generateContentHash({
      movies,
      episodes: []
    });

    return baseNotification;
  }

  /**
   * Create a notification for new episodes of a TV show
   * @param {Object} showData - Show data with episodes
   * @param {boolean} includeMetadata - Whether to include metadata
   * @param {number} maxEpisodes - Maximum episodes to include in details
   * @returns {Object} Notification object
   */
  static createShowEpisodeNotification(showData, includeMetadata = true, maxEpisodes = 10) {
    const { showTitle, episodes, totalNewEpisodes, latestSeason, latestEpisode } = showData;
    const displayEpisodes = episodes.slice(0, maxEpisodes);
    
    let title, message, actionUrl;
    if (totalNewEpisodes === 1) {
      const episode = episodes[0];
      title = `New Episode: ${showTitle}`;
      message = `S${episode.seasonNumber}E${episode.episodeNumber}${episode.title ? ` - ${episode.title}` : ''} is now available.`;
      // Link to specific episode for single episode notifications
      actionUrl = this.generateTVActionUrl(showTitle, episode.seasonNumber, episode.episodeNumber);
    } else if (totalNewEpisodes <= 3) {
      title = `${totalNewEpisodes} New Episodes: ${showTitle}`;
      message = `${totalNewEpisodes} new episodes are now available for ${showTitle}.`;
      // Link to show page for multiple episodes
      actionUrl = this.generateTVActionUrl(showTitle);
    } else {
      title = `${totalNewEpisodes} New Episodes: ${showTitle}`;
      message = `${totalNewEpisodes} new episodes are now available for ${showTitle}, including S${latestSeason}E${latestEpisode}.`;
      // Link to show page for many episodes
      actionUrl = this.generateTVActionUrl(showTitle);
    }

    const baseNotification = {
      type: NOTIFICATION_TYPES.NEW_CONTENT,
      subtype: 'new_episodes',
      title,
      message,
      actionUrl,
      data: {
        contentType: 'episodes',
        showTitle,
        totalNewEpisodes,
        latestSeason,
        latestEpisode,
        episodes: displayEpisodes
      },
      createdAt: new Date(),
      priority: totalNewEpisodes >= 5 ? 'high' : 'normal'
    };

    if (includeMetadata) {
      baseNotification.metadata = {
        showTitle,
        episodeCount: totalNewEpisodes,
        seasons: [...new Set(episodes.map(e => e.seasonNumber))].sort((a, b) => a - b),
        latestEpisode: episodes[episodes.length - 1]
      };
    }

    // Generate deduplication hash
    baseNotification.contentHash = NotificationHashing.generateContentHash({
      movies: [],
      episodes
    });

    return baseNotification;
  }

  /**
   * Format a user-friendly message for a single movie
   * @param {Object} movie - Movie object
   * @returns {string} Formatted message
   */
  static formatMovieMessage(movie) {
    let message = `${movie.title} has been added to your library.`;
    
    if (movie.releaseDate) {
      const year = new Date(movie.releaseDate).getFullYear();
      message = `${movie.title} (${year}) has been added to your library.`;
    }
    
    if (movie.genre) {
      message += ` Genre: ${movie.genre}.`;
    }
    
    return message;
  }

  /**
   * Batch movies by category for more organized notifications
   * @param {Array} movies - Array of movie objects
   * @param {number} maxPerBatch - Maximum movies per batch
   * @returns {Array} Array of movie batches
   */
  static batchMoviesByCategory(movies, maxPerBatch = 5) {
    // Sort movies by release date (newest first) and group by genre if possible
    const sortedMovies = [...movies].sort((a, b) => {
      const dateA = new Date(a.releaseDate || 0);
      const dateB = new Date(b.releaseDate || 0);
      return dateB - dateA;
    });

    const batches = [];
    for (let i = 0; i < sortedMovies.length; i += maxPerBatch) {
      batches.push(sortedMovies.slice(i, i + maxPerBatch));
    }

    return batches;
  }

  /**
   * Generate a weekly digest notification for all new content
   * @param {Object} weeklyContent - Aggregated content for the week
   * @param {Object} options - Generation options
   * @returns {Object} Weekly digest notification
   */
  static generateWeeklyDigest(weeklyContent, options = {}) {
    const { includeMetadata = true } = options;
    const { movies, episodes, weekStart } = weeklyContent;
    
    const totalMovies = movies.length;
    const totalEpisodes = episodes.length;
    const totalShows = new Set(episodes.map(e => e.showTitle)).size;
    
    let title = 'Weekly Content Summary';
    let message = 'Here\'s what was added to your library this week:';
    
    if (totalMovies > 0) {
      message += ` ${totalMovies} new movie${totalMovies > 1 ? 's' : ''}`;
    }
    
    if (totalEpisodes > 0) {
      if (totalMovies > 0) message += ' and';
      message += ` ${totalEpisodes} new episode${totalEpisodes > 1 ? 's' : ''} from ${totalShows} show${totalShows > 1 ? 's' : ''}`;
    }
    
    message += '.';

    const notification = {
      type: NOTIFICATION_TYPES.WEEKLY_DIGEST,
      subtype: 'content_summary',
      title,
      message,
      actionUrl: '/list', // Link to general content list for weekly digest
      data: {
        weekStart,
        weekEnd: new Date(weekStart.getTime() + 7 * 24 * 60 * 60 * 1000),
        totalMovies,
        totalEpisodes,
        totalShows,
        movies: movies.slice(0, 10), // Limit for performance
        episodes: episodes.slice(0, 20)
      },
      createdAt: new Date(),
      priority: 'low'
    };

    if (includeMetadata) {
      notification.metadata = {
        weekIdentifier: NotificationHashing.generateWeekIdentifier(weekStart),
        topShows: this.getTopShowsByEpisodeCount(episodes, 5)
      };
    }

    // Generate deduplication hash
    notification.contentHash = NotificationHashing.generateContentHash({
      movies,
      episodes
    });

    return notification;
  }

  /**
   * Get top shows by episode count for weekly digest
   * @param {Array} episodes - Array of episode objects
   * @param {number} limit - Maximum number of shows to return
   * @returns {Array} Top shows with episode counts
   */
  static getTopShowsByEpisodeCount(episodes, limit = 5) {
    const showCounts = new Map();
    
    episodes.forEach(episode => {
      const count = showCounts.get(episode.showTitle) || 0;
      showCounts.set(episode.showTitle, count + 1);
    });
    
    return Array.from(showCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([showTitle, count]) => ({ showTitle, count }));
  }
}
