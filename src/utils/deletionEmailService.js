import { NotificationManager } from '@src/utils/notifications/NotificationManager'
import { NOTIFICATION_PRIORITIES } from '@src/utils/notifications/NotificationTypes'
import { DELETION_GRACE_DAYS, DELETION_REMINDER_DAYS } from '@src/utils/deletionSchedule'

/**
 * The notifications of the account deletion flow.
 *
 * They are notifications in the app (the bell), to the account and to the
 * admins. The app sends no email, whatever this file is called: nothing here
 * may tell anyone to check their inbox.
 *
 * None of them names the date of a deletion. A notification is read days
 * after it was written and in another time zone than the server's: it says
 * how the date is set, and the Delete account page shows the date itself.
 */

/** A request the server carries out by itself when its date comes (a signed-in user's). */
const isScheduled = (deletionRequest) => Boolean(deletionRequest.scheduledDeletionAt)

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

  let message
  if (byEmail) {
    message =
      'A deletion of this account was requested with its email address, on the public form. If that wasn’t you, cancel the request on the Delete account page.'
  } else if (isScheduled(deletionRequest)) {
    message = `Your account will be deleted ${DELETION_GRACE_DAYS} days after your request, or sooner if an admin carries it out. The Delete account page shows the date, and is where to cancel.`
  } else {
    message =
      'Your request is with the admins, who delete accounts by hand. Until one of them does, you can cancel it on the Delete account page.'
  }

  const notificationData = {
    type: 'account_deletion_request',
    title: byEmail ? 'Someone asked for this account to be deleted' : 'Account deletion requested',
    message,
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
 * Remind an account, DELETION_REMINDER_DAYS or less before its date, that it
 * is about to be deleted (the hourly check, src/lib/scheduledDeletions.ts).
 * It takes the place of the notification sent when the request was made.
 * @param {string} userId - The account
 * @param {Object} deletionRequest - Its waiting request
 * @returns {Promise<Object>} Created notification
 */
export async function sendDeletionReminder(userId, deletionRequest) {
  const notificationData = {
    type: 'account_deletion_reminder',
    title: 'Your account will be deleted soon',
    message: `Your account will be deleted within ${DELETION_REMINDER_DAYS} days. The Delete account page shows the date, and is where to cancel if you have changed your mind.`,
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
 * @param {Object} [options]
 * @param {boolean} [options.automatic=false] - The hourly check carried it out, no admin did
 * @returns {Promise<Object>} Notification result
 */
export async function sendDeletionCompletionNotification(email, deletionResults, { automatic = false } = {}) {
  const adminNotificationData = {
    type: 'deletion_completed',
    title: 'Account deleted',
    message: automatic
      ? `The account of ${email} was deleted automatically, ${DELETION_GRACE_DAYS} days after its owner asked.`
      : `The account of ${email} was deleted, as requested.`,
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
      ? `A deletion of ${deletionRequest.email}’s account was requested on the public form. Nobody has proved they own that address: it waits for an admin, so check before deleting.`
      : isScheduled(deletionRequest)
        ? `${deletionRequest.email} asked for their account to be deleted. It is deleted automatically ${DELETION_GRACE_DAYS} days after the request unless they cancel; an admin can delete it sooner.`
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
