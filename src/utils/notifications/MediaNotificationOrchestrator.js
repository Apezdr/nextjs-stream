/**
 * Main orchestrator for media addition notifications.
 *
 * The new-content notices: run/newContent (src/utils/sync/run/newContent)
 * decides once per sync run which titles to announce, has the notices composed
 * here (composeNewContentNotices), queues them, and has them delivered here
 * (deliverNewContentNotices) until a delivery succeeds.
 */

import { createHash } from 'crypto';
import { MediaAdditionAnalyzer } from './analyzers/MediaAdditionAnalyzer.js';
import { NewContentNotificationGenerator } from './generators/NewContentNotificationGenerator.js';
import { insertNotificationsOnce } from './notificationDatabase.js';
import { findNewContentRecipients } from './recipients.js';
import { noticesInScope } from './scope.js';
import { libraryAccessFor } from '@src/lib/roles/libraryAccess';
import { ObjectId } from 'mongodb';

/**
 * A notification's `_id`, the same every time the same queued delivery is
 * delivered to the same user: the queued delivery's timestamp, then a hash of
 * the delivery, the notice's place in it and the user. A retry that finds the
 * notification already there inserts nothing (insertNotificationsOnce).
 *
 * @param {string} deliveryId - The queued delivery's id (an ObjectId's hex)
 * @param {number} noticeIndex
 * @param {string} userId
 * @returns {ObjectId}
 */
export function newContentNotificationId(deliveryId, noticeIndex, userId) {
  const hash = createHash('sha256').update(`${deliveryId}:${noticeIndex}:${userId}`).digest('hex');
  return new ObjectId(`${String(deliveryId).slice(0, 8)}${hash.slice(0, 16)}`);
}

export class MediaNotificationOrchestrator {
  /**
   * The notices for the titles a sync run is announcing: movies five to a
   * notice, episodes one notice per show, or one digest when that comes to
   * more than `generationOptions.maxNotifications`.
   * @param {Object} newContent - `{ movies, episodes }`, selected by run/newContent
   * @param {Object} generationOptions - NewContentNotificationGenerator options
   * @returns {Array<Object>} The notices (none when there is nothing to announce)
   */
  static composeNewContentNotices(newContent, generationOptions = {}) {
    const analysis = MediaAdditionAnalyzer.analyzeNewContent(newContent);
    if (!analysis.shouldNotify) return [];
    return NewContentNotificationGenerator.generateNotifications(analysis, generationOptions);
  }

  /**
   * Deliver a queued batch of new-content notices to every recipient
   * (notifications/recipients). Safe to repeat: each notification's `_id` is
   * derived from the batch, the notice and the user, so a second delivery of
   * the same batch inserts only what the first did not. Throws when a
   * notification could not be inserted; the caller delivers the batch again
   * on a later run.
   *
   * @param {Array<Object>} notices - From composeNewContentNotices
   * @param {string} deliveryId - The queued batch's id
   * @returns {Promise<{recipients: number, notices: number, inserted: number, alreadyThere: number}>}
   */
  static async deliverNewContentNotices(notices, deliveryId) {
    const recipients = await findNewContentRecipients();
    // Each recipient gets the notices their library scope holds
    // (notifications/scope.js), worked out once per scope, not per user. A
    // notice keeps its place in the batch, so its ids stay the same on a retry.
    const indexed = notices.map((notice, noticeIndex) => ({ ...notice, noticeIndex }));
    const byScope = new Map();
    for (const user of recipients) {
      const access = await libraryAccessFor(user);
      if (!byScope.has(access.id)) byScope.set(access.id, { access, users: [] });
      byScope.get(access.id).users.push(user);
    }
    const docs = [];
    for (const { access, users } of byScope.values()) {
      const held = await noticesInScope(indexed, access);
      for (const { noticeIndex, ...notice } of held) {
        for (const user of users) {
          const userId = user._id.toString();
          docs.push({ ...notice, _id: newContentNotificationId(deliveryId, noticeIndex, userId), userId });
        }
      }
    }
    const { inserted, alreadyThere } = await insertNotificationsOnce(docs);
    return { recipients: recipients.length, notices: notices.length, inserted, alreadyThere };
  }
}
