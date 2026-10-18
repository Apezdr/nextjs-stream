/**
 * Who receives the new-content notices. The one place that decides it.
 *
 * Owner's decision (2026-10-17): approved accounts only. Accounts with limited
 * access are left out as well, since they may not be able to open what a
 * notice links to. Change the filter here and nowhere else.
 */

import { userQueries } from '@src/lib/userQueries';

/** The accounts (better-auth `user` documents) that get new-content notices. */
export const NEW_CONTENT_RECIPIENTS_FILTER = Object.freeze({
  approved: true,
  limitedAccess: { $ne: true },
});

/**
 * @returns {Promise<Array<{_id: import('mongodb').ObjectId}>>} The recipients' ids
 */
export async function findNewContentRecipients() {
  return userQueries.find({ ...NEW_CONTENT_RECIPIENTS_FILTER }, { _id: 1 });
}
