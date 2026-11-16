import { NotificationManager } from '@src/utils/notifications/NotificationManager'
import { NOTIFICATION_PRIORITIES } from '@src/utils/notifications/NotificationTypes'

/**
 * The notifications of the account deletion flow.
 *
 * They are notifications in the app (the bell), to the account and to the
 * admins. The app sends no email, whatever this file is called: nothing here
 * may tell anyone to check their inbox, and nothing here runs on a schedule.
 */

/** Where an account sees its deletion request, and cancels it. */
const ACCOUNT_PAGE = '/account/delete'

/** Where an admin handles the requests. */
const ADMIN_PAGE = '/admin/deletion-requests'

/**
 * Tell an account that its deletion was asked for. A request made on the
 * public form, by email address, may not be the account owner's doing: the
 * notification is how they find out, and it says where to cancel.
 * @param {string} userId - The account
 * @param {Object} deletionRequest - The request just recorded
 * @returns {Promise<Object>} Created notification
 */
export async function sendDeletionRequestConfirmation(userId, deletionRequest) {
  const byEmail = deletionRequest.requestType === 'public'

  const notificationData = {
    type: 'account_deletion_request',
    title: byEmail ? 'Someone asked for this account to be deleted' : 'Account deletion requested',
    message: byEmail
      ? 'A deletion of this account was requested with its email address, on the public form. If that wasn’t you, cancel the request on the Delete account page.'
      : 'Your request is with the admins, who delete accounts by hand. Until one of them does, you can cancel it on the Delete account page.',
    data: {
      deletionRequestId: deletionRequest._id.toString(),
      actionUrl: ACCOUNT_PAGE,
      canCancel: true
    },
    priority: NOTIFICATION_PRIORITIES.HIGH,
    category: 'account',
    groupKey: `deletion_request_${userId}`
  }

  return await NotificationManager.createCustom(userId, notificationData, true)
}

/**
 * Tell an account that its deletion request was cancelled, by them or by an admin.
 * @param {string} userId - The account
 * @param {Object} deletionRequest - The cancelled request
 * @returns {Promise<Object>} Created notification
 */
export async function sendDeletionCancellationConfirmation(userId, deletionRequest) {
  const notificationData = {
    type: 'account_deletion_cancelled',
    title: 'Account deletion cancelled',
    message: 'The request to delete your account was cancelled. Your account stays as it is.',
    data: {
      deletionRequestId: deletionRequest._id.toString(),
      cancelledAt: deletionRequest.cancelledAt,
      actionUrl: ACCOUNT_PAGE
    },
    priority: NOTIFICATION_PRIORITIES.MEDIUM,
    category: 'account',
    groupKey: `deletion_cancelled_${userId}`
  }

  return await NotificationManager.createCustom(userId, notificationData, true)
}

/**
 * Tell the admins that an account a user asked to have deleted is gone. The
 * account itself can't be told: its notifications went with it.
 * @param {string} email - Email address of the deleted account
 * @param {Object} deletionResults - What the deletion removed
 * @returns {Promise<Object>} Notification result
 */
export async function sendDeletionCompletionNotification(email, deletionResults) {
  const adminNotificationData = {
    type: 'deletion_completed',
    title: 'Account deleted',
    message: `The account of ${email} was deleted, as requested.`,
    data: {
      email,
      deletionResults,
      completedAt: new Date(),
      actionUrl: ADMIN_PAGE
    },
    priority: NOTIFICATION_PRIORITIES.MEDIUM,
    category: 'admin'
  }

  return await NotificationManager.createCustom(
    await getAdminUserIds(),
    adminNotificationData,
    false
  )
}

/**
 * Tell the admins about a new deletion request: it waits for one of them.
 * @param {Object} deletionRequest - Deletion request object
 * @returns {Promise<Array>} Created notifications for admins
 */
export async function sendAdminDeletionRequestNotification(deletionRequest) {
  const byEmail = deletionRequest.requestType === 'public'

  const notificationData = {
    type: 'admin_deletion_request',
    title: 'Account deletion requested',
    message: byEmail
      ? `A deletion of ${deletionRequest.email}’s account was requested on the public form. Nobody has proved they own that address: check before deleting.`
      : `${deletionRequest.email} asked for their account to be deleted. It waits for an admin.`,
    data: {
      deletionRequestId: deletionRequest._id.toString(),
      email: deletionRequest.email,
      requestType: deletionRequest.requestType,
      requestedAt: deletionRequest.requestedAt,
      actionUrl: ADMIN_PAGE
    },
    priority: NOTIFICATION_PRIORITIES.MEDIUM,
    category: 'admin'
  }

  return await NotificationManager.createCustom(
    await getAdminUserIds(),
    notificationData,
    false
  )
}

/**
 * Tell the admins that a deletion stopped part-way.
 * @param {Object} deletionRequest - Deletion request object
 * @param {Error} error - Error that occurred
 * @returns {Promise<Array>} Created notifications for admins
 */
export async function sendDeletionFailureNotification(deletionRequest, error) {
  const notificationData = {
    type: 'deletion_failure',
    title: 'Account deletion did not finish',
    message: `Deleting the account of ${deletionRequest.email} stopped: ${error.message}. Run the request again.`,
    data: {
      deletionRequestId: deletionRequest._id.toString(),
      email: deletionRequest.email,
      error: error.message,
      failedAt: new Date(),
      actionUrl: ADMIN_PAGE
    },
    priority: NOTIFICATION_PRIORITIES.HIGH,
    category: 'admin'
  }

  return await NotificationManager.createCustom(
    await getAdminUserIds(),
    notificationData,
    false
  )
}

/**
 * Get admin user IDs for notifications
 * @returns {Promise<Array>} Array of admin user IDs
 */
async function getAdminUserIds() {
  const { adminUserEmails } = await import('@src/utils/config')
  const { getAdminUserIds } = await import('@src/utils/notifications/notificationDatabase')

  return await getAdminUserIds(adminUserEmails)
}
