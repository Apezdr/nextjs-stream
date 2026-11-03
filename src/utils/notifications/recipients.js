/**
 * Who receives the new-content notices. The one place that decides it.
 *
 * Owner's decision (2026-10-17): approved accounts only. Which notices each
 * one gets is their library scope's to decide (notifications/scope.js): a
 * notice naming a title outside it is not delivered to them. Change the
 * filter here and nowhere else.
 */

import { userQueries } from '@src/lib/userQueries';

/** The accounts (better-auth `user` documents) that get new-content notices. */
export const NEW_CONTENT_RECIPIENTS_FILTER = Object.freeze({
  approved: true,
});

/**
 * @returns {Promise<Array<{_id: import('mongodb').ObjectId, role?: string, roles?: string[]}>>}
 *   The recipients, with what their library scope is decided by
 */
export async function findNewContentRecipients() {
  return userQueries.find({ ...NEW_CONTENT_RECIPIENTS_FILTER }, { _id: 1, role: 1, roles: 1 });
}
