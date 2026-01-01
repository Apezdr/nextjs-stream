/**
 * Utility functions for generating stable hashes for notification deduplication
 */

import crypto from 'crypto';

export class NotificationHashing {
  /**
   * Generate a stable hash for content to prevent duplicate notifications
   * @param {Object} content - Content object containing movies/episodes
   * @returns {string} Hash string
   */
  static generateContentHash(content) {
    const contentString = JSON.stringify({
      movies: content.movies?.map(m => ({ id: m._id, title: m.title, createdAt: m.createdAt })) || [],
      episodes: content.episodes?.map(e => ({ 
        id: e._id, 
        showTitle: e.showTitle, 
        seasonNumber: e.seasonNumber, 
        episodeNumber: e.episodeNumber,
        createdAt: e.createdAt 
      })) || []
    });
    
    return crypto.createHash('sha256').update(contentString).digest('hex').substring(0, 16);
  }

  /**
   * Generate a hash representing user's watch state
   * @param {Object} userState - User's playback status and preferences
   * @returns {string} Hash string
   */
  static generateUserStateHash(userState) {
    // Only include relevant fields that affect suggestions
    const relevantState = {
      watchedShows: userState.watchedShows?.map(show => ({
        title: show.title,
        lastWatchedEpisode: show.lastWatchedEpisode,
        totalWatched: show.totalWatched
      })) || [],
      lastActivity: userState.lastActivity
    };
    
    const stateString = JSON.stringify(relevantState);
    return crypto.createHash('sha256').update(stateString).digest('hex').substring(0, 16);
  }

  /**
   * Generate a hash for watch suggestions to prevent duplicates
   * @param {Object} show - Show object with watch history
   * @param {Array} episodes - New episodes available
   * @param {string} userStateHash - Current user state hash
   * @returns {string} Hash string
   */
  static generateSuggestionHash(show, episodes, userStateHash) {
    const suggestionData = {
      showTitle: show.title,
      lastWatchedEpisode: show.lastWatchedEpisode,
      newEpisodes: episodes.map(e => ({ 
        seasonNumber: e.seasonNumber, 
        episodeNumber: e.episodeNumber,
        id: e._id 
      })),
      userStateHash
    };
    
    const suggestionString = JSON.stringify(suggestionData);
    return crypto.createHash('sha256').update(suggestionString).digest('hex').substring(0, 16);
  }

  /**
   * Generate a weekly digest identifier
   * @param {Date} weekStart - Start of the week
   * @returns {string} Week identifier (e.g., "2025-W03")
   */
  static generateWeekIdentifier(weekStart = new Date()) {
    const year = weekStart.getFullYear();
    const week = this.getWeekNumber(weekStart);
    return `${year}-W${week.toString().padStart(2, '0')}`;
  }

  /**
   * Get week number for a given date
   * @param {Date} date - Date to get week number for
   * @returns {number} Week number
   */
  static getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * Get start of week for a given date (Sunday)
   * @param {Date} date - Date to get week start for
   * @returns {Date} Start of week
   */
  static getWeekStart(date = new Date()) {
    const weekStart = new Date(date);
    weekStart.setDate(date.getDate() - date.getDay());
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }
}
