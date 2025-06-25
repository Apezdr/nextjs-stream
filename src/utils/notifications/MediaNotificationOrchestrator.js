/**
 * Main orchestrator for media addition notifications
 * Integrates with flatSync process to analyze and generate notifications for newly added content
 */

import { MediaAdditionAnalyzer } from './analyzers/MediaAdditionAnalyzer.js';
import { NewContentNotificationGenerator } from './generators/NewContentNotificationGenerator.js';
import { NotificationManager } from './NotificationManager.js';
import { NOTIFICATION_TYPES } from './NotificationTypes.js';
import clientPromise from '@src/lib/mongodb';
import { ObjectId } from 'mongodb';

export class MediaNotificationOrchestrator {
  /**
   * Process sync results and generate appropriate notifications
   * This is the main entry point called from flatSync operations
   * @param {Object} syncResults - Results from flatSync operations
   * @param {Object} options - Processing options
   * @returns {Promise<Object>} Processing results
   */
  static async processSyncResults(syncResults, options = {}) {
    const {
      enableNotifications = true,
      analysisOptions = {},
      generationOptions = {},
      deliveryOptions = {}
    } = options;

    const results = {
      analysis: null,
      notifications: [],
      delivered: [],
      errors: [],
      summary: {
        totalGenerated: 0,
        totalDelivered: 0,
        totalErrors: 0
      }
    };

    try {
      if (!enableNotifications) {
        console.log('Notifications disabled, skipping notification processing');
        return results;
      }

      // Step 1: Analyze sync results for notification-worthy content
      console.log('Analyzing sync results for new content notifications...');
      results.analysis = MediaAdditionAnalyzer.analyzeSyncResults(syncResults, analysisOptions);

      if (!results.analysis.shouldNotify) {
        console.log('No significant new content detected, skipping notification generation');
        return results;
      }

      console.log(`Detected ${results.analysis.summary.totalNewMovies} new movies and ${results.analysis.summary.totalNewEpisodes} new episodes`);

      // Step 2: Generate notifications based on analysis
      console.log('Generating notifications for new content...');
      results.notifications = NewContentNotificationGenerator.generateNotifications(
        results.analysis,
        generationOptions
      );

      results.summary.totalGenerated = results.notifications.length;

      if (results.notifications.length === 0) {
        console.log('No notifications generated');
        return results;
      }

      // Step 3: Check for duplicates and deliver notifications
      console.log(`Generated ${results.notifications.length} notifications, delivering to users...`);
      const deliveryResults = await this.deliverNotifications(results.notifications, deliveryOptions);
      
      results.delivered = deliveryResults.delivered;
      results.errors = deliveryResults.errors;
      results.summary.totalDelivered = deliveryResults.delivered.length;
      results.summary.totalErrors = deliveryResults.errors.length;

      console.log(`Successfully delivered ${results.summary.totalDelivered} notifications with ${results.summary.totalErrors} errors`);

      return results;
    } catch (error) {
      console.error('Error processing sync results for notifications:', error);
      results.errors.push({
        type: 'processing_error',
        message: error.message,
        stack: error.stack
      });
      return results;
    }
  }

  /**
   * Deliver notifications to users with deduplication
   * @param {Array} notifications - Generated notifications
   * @param {Object} options - Delivery options
   * @returns {Promise<Object>} Delivery results
   */
  static async deliverNotifications(notifications, options = {}) {
    const {
      targetAllUsers = true,
      specificUsers = [],
      checkDuplicates = true,
      duplicateWindow = 24 * 60 * 60 * 1000 // 24 hours
    } = options;

    const results = {
      delivered: [],
      skipped: [],
      errors: []
    };

    try {
      // Get target users
      const targetUsers = await this.getTargetUsers(targetAllUsers, specificUsers);
      
      if (targetUsers.length === 0) {
        console.log('No target users found for notifications');
        return results;
      }

      console.log(`Delivering notifications to ${targetUsers.length} users`);

      // Process each notification
      for (const notification of notifications) {
        try {
          // Check for duplicates if enabled
          if (checkDuplicates) {
            const duplicateResults = await this.checkForDuplicates(
              notification,
              targetUsers,
              duplicateWindow
            );
            
            // Only deliver to users who haven't received this notification recently
            const usersToNotify = duplicateResults.newUsers;
            
            if (usersToNotify.length === 0) {
              results.skipped.push({
                notification: notification.title,
                reason: 'duplicate_content',
                skippedUsers: targetUsers.length
              });
              continue;
            }

            // Update target users to only include non-duplicate recipients
            const finalTargetUsers = targetUsers.filter(user => 
              usersToNotify.includes(user._id.toString())
            );

            if (finalTargetUsers.length > 0) {
              await this.deliverToUsers(notification, finalTargetUsers);
              results.delivered.push({
                notification: notification.title,
                recipients: finalTargetUsers.length,
                skippedDuplicates: targetUsers.length - finalTargetUsers.length
              });
            }
          } else {
            // Deliver to all target users without duplicate checking
            await this.deliverToUsers(notification, targetUsers);
            results.delivered.push({
              notification: notification.title,
              recipients: targetUsers.length
            });
          }
        } catch (error) {
          console.error(`Error delivering notification "${notification.title}":`, error);
          results.errors.push({
            notification: notification.title,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Error in notification delivery process:', error);
      results.errors.push({
        type: 'delivery_error',
        error: error.message
      });
      return results;
    }
  }

  /**
   * Get target users for notifications
   * @param {boolean} targetAllUsers - Whether to target all users
   * @param {Array} specificUsers - Specific user IDs to target
   * @returns {Promise<Array>} Array of user objects
   */
  static async getTargetUsers(targetAllUsers = true, specificUsers = []) {
    try {
      const client = await clientPromise;
      const db = client.db('Users'); // Use Users database
      
      let query = {};
      
      if (!targetAllUsers && specificUsers.length > 0) {
        query = { _id: { $in: specificUsers.map(id => new ObjectId(id)) } };
      }

      // Get all users or specific users from AuthenticatedUsers collection
      const users = await db.collection('AuthenticatedUsers').find(query).toArray();
      
      console.log(`Found ${users.length} target users for notifications`);
      return users;
    } catch (error) {
      console.error('Error getting target users:', error);
      return [];
    }
  }

  /**
   * Check for duplicate notifications
   * @param {Object} notification - Notification to check
   * @param {Array} users - Users to check for
   * @param {number} timeWindow - Time window in milliseconds
   * @returns {Promise<Object>} Duplicate check results
   */
  static async checkForDuplicates(notification, users, timeWindow) {
    try {
      const results = {
        newUsers: [],
        duplicateUsers: []
      };

      if (!notification.contentHash) {
        // If no content hash, consider all users as new
        results.newUsers = users.map(user => user._id.toString());
        return results;
      }

      const cutoffTime = new Date(Date.now() - timeWindow);
      
      // Check which users have received similar content recently
      const recentNotifications = await NotificationManager.getNotificationsByContentHash(
        notification.contentHash,
        cutoffTime
      );

      const usersWithRecentNotifications = new Set(
        recentNotifications.map(notif => notif.userId.toString())
      );

      // Categorize users
      users.forEach(user => {
        const userId = user._id.toString();
        if (usersWithRecentNotifications.has(userId)) {
          results.duplicateUsers.push(userId);
        } else {
          results.newUsers.push(userId);
        }
      });

      return results;
    } catch (error) {
      console.error('Error checking for duplicates:', error);
      // On error, assume all users are new to avoid blocking notifications
      return {
        newUsers: users.map(user => user._id.toString()),
        duplicateUsers: []
      };
    }
  }

  /**
   * Deliver notification to specific users
   * @param {Object} notification - Notification object
   * @param {Array} users - Users to deliver to
   * @returns {Promise<void>}
   */
  static async deliverToUsers(notification, users) {
    try {
      // Create notification for each user
      const promises = users.map(user => 
        NotificationManager.createNotification(user._id, notification)
      );

      await Promise.allSettled(promises);
    } catch (error) {
      console.error('Error delivering notification to users:', error);
      throw error;
    }
  }

  /**
   * Generate and deliver weekly digest notifications
   * Called via cron job or scheduled task
   * @param {Object} options - Generation options
   * @returns {Promise<Object>} Results
   */
  static async generateWeeklyDigest(options = {}) {
    const {
      weekStart = null,
      includeEmptyDigests = false
    } = options;

    const results = {
      digest: null,
      delivered: 0,
      errors: []
    };

    try {
      const actualWeekStart = weekStart || this.getWeekStart();
      const weekEnd = new Date(actualWeekStart.getTime() + 7 * 24 * 60 * 60 * 1000);

      console.log(`Generating weekly digest for week starting ${actualWeekStart.toISOString()}`);

      // Get all content added during the week
      const weeklyContent = await this.getWeeklyContent(actualWeekStart, weekEnd);

      if (!includeEmptyDigests && 
          weeklyContent.movies.length === 0 && 
          weeklyContent.episodes.length === 0) {
        console.log('No new content for weekly digest, skipping');
        return results;
      }

      // Generate digest notification
      results.digest = NewContentNotificationGenerator.generateWeeklyDigest({
        ...weeklyContent,
        weekStart: actualWeekStart
      });

      // Deliver to all users
      const deliveryResults = await this.deliverNotifications([results.digest], {
        checkDuplicates: true,
        duplicateWindow: 8 * 24 * 60 * 60 * 1000 // 8 days to prevent duplicate weekly digests
      });

      results.delivered = deliveryResults.delivered.length;
      results.errors = deliveryResults.errors;

      console.log(`Weekly digest delivered to ${results.delivered} users`);
      return results;
    } catch (error) {
      console.error('Error generating weekly digest:', error);
      results.errors.push({
        type: 'weekly_digest_error',
        error: error.message
      });
      return results;
    }
  }

  /**
   * Get content added during a specific week
   * @param {Date} weekStart - Start of the week
   * @param {Date} weekEnd - End of the week
   * @returns {Promise<Object>} Weekly content data
   */
  static async getWeeklyContent(weekStart, weekEnd) {
    try {
      const client = await clientPromise;
      const db = client.db('Media');

      // Get movies added during the week
      const movies = await db.collection('FlatMovies')
        .find({
          createdAt: {
            $gte: weekStart,
            $lt: weekEnd
          }
        })
        .toArray();

      // Get episodes added during the week
      const episodes = await db.collection('FlatEpisodes')
        .find({
          createdAt: {
            $gte: weekStart,
            $lt: weekEnd
          }
        })
        .toArray();

      return {
        movies: movies.map(movie => ({
          id: movie._id,
          title: movie.title,
          createdAt: movie.createdAt,
          genre: movie.metadata?.genres?.[0]?.name,
          rating: movie.metadata?.vote_average
        })),
        episodes: episodes.map(episode => ({
          id: episode._id,
          showTitle: episode.showTitle,
          seasonNumber: episode.seasonNumber,
          episodeNumber: episode.episodeNumber,
          title: episode.title,
          createdAt: episode.createdAt
        }))
      };
    } catch (error) {
      console.error('Error getting weekly content:', error);
      return { movies: [], episodes: [] };
    }
  }

  /**
   * Get start of current week (Sunday)
   * @returns {Date} Start of week
   */
  static getWeekStart() {
    const now = new Date();
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);
    return weekStart;
  }

  /**
   * Test notification generation and delivery (for development/testing)
   * @param {Object} testData - Test sync results
   * @param {Object} options - Test options
   * @returns {Promise<Object>} Test results
   */
  static async testNotificationSystem(testData, options = {}) {
    console.log('Testing notification system...');
    
    const testResults = await this.processSyncResults(testData, {
      enableNotifications: true,
      ...options
    });

    console.log('Test Results:', {
      analysisSignificance: testResults.analysis?.significance,
      notificationsGenerated: testResults.summary.totalGenerated,
      notificationsDelivered: testResults.summary.totalDelivered,
      errors: testResults.summary.totalErrors
    });

    return testResults;
  }
}
