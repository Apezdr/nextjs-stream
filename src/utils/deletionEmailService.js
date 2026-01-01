import { NotificationManager } from '@src/utils/notifications/NotificationManager'
import { NOTIFICATION_TYPES, NOTIFICATION_PRIORITIES } from '@src/utils/notifications/NotificationTypes'

/**
 * Email notification service for account deletion workflow
 * Uses the existing notification system to send deletion-related notifications
 */

/**
 * Send deletion request confirmation notification
 * @param {string} userId - User ID
 * @param {Object} deletionRequest - Deletion request object
 * @returns {Promise<Object>} Created notification
 */
export async function sendDeletionRequestConfirmation(userId, deletionRequest) {
  const scheduledDate = new Date(deletionRequest.scheduledDeletionAt).toLocaleDateString()
  
  const notificationData = {
    type: 'account_deletion_request',
    title: 'Account Deletion Request Received',
    message: `Your account deletion request has been received. Your account will be permanently deleted on ${scheduledDate} unless you cancel this request.`,
    data: {
      deletionRequestId: deletionRequest._id.toString(),
      scheduledDeletionAt: deletionRequest.scheduledDeletionAt,
      actionUrl: '/account/deletion-status',
      canCancel: true
    },
    priority: NOTIFICATION_PRIORITIES.HIGH,
    category: 'account',
    groupKey: `deletion_request_${userId}`
  }
  
  return await NotificationManager.createCustom(userId, notificationData, true)
}

/**
 * Send email verification notification for public deletion requests
 * @param {string} email - Email address
 * @param {string} verificationToken - Verification token
 * @param {Object} deletionRequest - Deletion request object
 * @returns {Promise<Object>} Notification result
 */
export async function sendEmailVerificationNotification(email, verificationToken, deletionRequest) {
  // Since this is for email verification, we'll create a system notification
  // In a real implementation, this would send an actual email
  // For now, we'll create a notification that can be viewed by admins
  
  const verificationUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/public/verify-deletion?token=${verificationToken}`
  
  console.log(`
=== ACCOUNT DELETION EMAIL VERIFICATION ===
To: ${email}
Subject: Verify Your Account Deletion Request

Dear User,

You have requested to delete your account. To proceed with this request, please click the link below to verify your email address:

${verificationUrl}

This link will expire in 24 hours.

If you did not request this deletion, please ignore this email.

Important: Once verified, your account will be scheduled for permanent deletion in 30 days. You can cancel this request at any time before the deletion date.

Best regards,
The Support Team
===========================================
  `)
  
  // Create an admin notification about the verification email being sent
  const adminNotificationData = {
    type: 'deletion_verification_sent',
    title: 'Deletion Verification Email Sent',
    message: `Account deletion verification email sent to ${email}`,
    data: {
      email,
      deletionRequestId: deletionRequest._id.toString(),
      verificationToken,
      actionUrl: '/admin/deletion-requests'
    },
    priority: NOTIFICATION_PRIORITIES.LOW,
    category: 'admin'
  }
  
  // Send to admin users only
  return await NotificationManager.createCustom(
    await getAdminUserIds(),
    adminNotificationData,
    false
  )
}

/**
 * Send deletion cancellation confirmation
 * @param {string} userId - User ID (if authenticated user)
 * @param {string} email - Email address
 * @param {Object} deletionRequest - Cancelled deletion request
 * @returns {Promise<Object>} Created notification
 */
export async function sendDeletionCancellationConfirmation(userId, email, deletionRequest) {
  const notificationData = {
    type: 'account_deletion_cancelled',
    title: 'Account Deletion Cancelled',
    message: 'Your account deletion request has been successfully cancelled. Your account will remain active.',
    data: {
      deletionRequestId: deletionRequest._id.toString(),
      cancelledAt: deletionRequest.cancelledAt,
      actionUrl: '/account/settings'
    },
    priority: NOTIFICATION_PRIORITIES.MEDIUM,
    category: 'account',
    groupKey: `deletion_cancelled_${userId || email}`
  }
  
  if (userId) {
    return await NotificationManager.createCustom(userId, notificationData, true)
  } else {
    // For public users, log the cancellation
    console.log(`
=== ACCOUNT DELETION CANCELLATION ===
To: ${email}
Subject: Account Deletion Request Cancelled

Dear User,

Your account deletion request has been successfully cancelled. Your account will remain active and no data will be deleted.

If you did not cancel this request, please contact support immediately.

Best regards,
The Support Team
=====================================
    `)
    
    return { success: true, method: 'email_logged' }
  }
}

/**
 * Send deletion completion notification
 * @param {string} email - Email address of deleted account
 * @param {Object} deletionResults - Results of the deletion process
 * @returns {Promise<Object>} Notification result
 */
export async function sendDeletionCompletionNotification(email, deletionResults) {
  // Log the completion email (in real implementation, this would send an actual email)
  console.log(`
=== ACCOUNT DELETION COMPLETED ===
To: ${email}
Subject: Account Deletion Completed

Dear User,

Your account deletion request has been completed. All your personal data has been permanently removed from our systems in accordance with GDPR/CCPA regulations.

Deletion Summary:
- User account: Deleted
- Authentication data: Deleted
- Session data: Deleted
- Activity history: Deleted
- Notifications: Deleted

If you have any questions about this process, please contact our support team.

Best regards,
The Support Team
==================================
  `)
  
  // Create admin notification about completion
  const adminNotificationData = {
    type: 'deletion_completed',
    title: 'Account Deletion Completed',
    message: `Account deletion completed for ${email}`,
    data: {
      email,
      deletionResults,
      completedAt: new Date(),
      actionUrl: '/admin/deletion-requests'
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
 * Send deletion reminder notification (7 days before scheduled deletion)
 * @param {string} userId - User ID (if authenticated)
 * @param {string} email - Email address
 * @param {Object} deletionRequest - Deletion request object
 * @returns {Promise<Object>} Created notification
 */
export async function sendDeletionReminder(userId, email, deletionRequest) {
  const scheduledDate = new Date(deletionRequest.scheduledDeletionAt).toLocaleDateString()
  const daysRemaining = Math.ceil((new Date(deletionRequest.scheduledDeletionAt) - new Date()) / (1000 * 60 * 60 * 24))
  
  const notificationData = {
    type: 'account_deletion_reminder',
    title: 'Account Deletion Reminder',
    message: `Your account is scheduled for deletion in ${daysRemaining} days (${scheduledDate}). You can still cancel this request if you change your mind.`,
    data: {
      deletionRequestId: deletionRequest._id.toString(),
      scheduledDeletionAt: deletionRequest.scheduledDeletionAt,
      daysRemaining,
      actionUrl: '/account/deletion-status',
      canCancel: true
    },
    priority: NOTIFICATION_PRIORITIES.HIGH,
    category: 'account',
    groupKey: `deletion_reminder_${userId || email}`
  }
  
  if (userId) {
    return await NotificationManager.createCustom(userId, notificationData, true)
  } else {
    // For public users, log the reminder
    console.log(`
=== ACCOUNT DELETION REMINDER ===
To: ${email}
Subject: Account Deletion Reminder - ${daysRemaining} Days Remaining

Dear User,

This is a reminder that your account is scheduled for permanent deletion in ${daysRemaining} days on ${scheduledDate}.

If you want to keep your account, you can cancel the deletion request by contacting our support team.

If you take no action, your account and all associated data will be permanently deleted on the scheduled date.

Best regards,
The Support Team
=================================
    `)
    
    return { success: true, method: 'email_logged' }
  }
}

/**
 * Send admin notification about new deletion request
 * @param {Object} deletionRequest - Deletion request object
 * @returns {Promise<Array>} Created notifications for admins
 */
export async function sendAdminDeletionRequestNotification(deletionRequest) {
  const notificationData = {
    type: 'admin_deletion_request',
    title: 'New Account Deletion Request',
    message: `New ${deletionRequest.requestType} deletion request from ${deletionRequest.email}`,
    data: {
      deletionRequestId: deletionRequest._id.toString(),
      email: deletionRequest.email,
      requestType: deletionRequest.requestType,
      requestedAt: deletionRequest.requestedAt,
      scheduledDeletionAt: deletionRequest.scheduledDeletionAt,
      actionUrl: '/admin/deletion-requests'
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
 * Send notification about failed deletion attempt
 * @param {Object} deletionRequest - Deletion request object
 * @param {Error} error - Error that occurred
 * @returns {Promise<Array>} Created notifications for admins
 */
export async function sendDeletionFailureNotification(deletionRequest, error) {
  const notificationData = {
    type: 'deletion_failure',
    title: 'Account Deletion Failed',
    message: `Failed to delete account for ${deletionRequest.email}: ${error.message}`,
    data: {
      deletionRequestId: deletionRequest._id.toString(),
      email: deletionRequest.email,
      error: error.message,
      failedAt: new Date(),
      actionUrl: '/admin/deletion-requests'
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

/**
 * Schedule deletion reminder notifications
 * This function should be called by a cron job or scheduled task
 * @returns {Promise<Array>} Results of reminder notifications sent
 */
export async function scheduleReminderNotifications() {
  const { getDeletionRequests } = await import('./accountDeletion')
  
  // Get deletion requests that are 7 days away from execution
  const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  const oneDayFromSevenDays = new Date(sevenDaysFromNow.getTime() + 24 * 60 * 60 * 1000)
  
  const { requests } = await getDeletionRequests({
    status: 'pending',
    scheduledDeletionAt: {
      $gte: sevenDaysFromNow,
      $lt: oneDayFromSevenDays
    }
  }, { page: 0, limit: 100 })
  
  const results = []
  
  for (const request of requests) {
    try {
      const result = await sendDeletionReminder(
        request.userId?.toString(),
        request.email,
        request
      )
      results.push({ success: true, requestId: request._id, result })
    } catch (error) {
      results.push({ success: false, requestId: request._id, error: error.message })
    }
  }
  
  return results
}

/**
 * Process automatic deletions for requests that have reached their scheduled time
 * This function should be called by a cron job or scheduled task
 * @returns {Promise<Array>} Results of automatic deletions
 */
export async function processAutomaticDeletions() {
  const { getReadyForDeletion, executeAccountDeletion } = await import('./accountDeletion')
  
  const readyRequests = await getReadyForDeletion()
  const results = []
  
  for (const request of readyRequests) {
    try {
      // Execute deletion with system as performer
      await executeAccountDeletion(request._id.toString(), 'system')
      
      // Send completion notification
      await sendDeletionCompletionNotification(request.email, {})
      
      results.push({ success: true, requestId: request._id, email: request.email })
    } catch (error) {
      // Send failure notification
      await sendDeletionFailureNotification(request, error)
      
      results.push({ 
        success: false, 
        requestId: request._id, 
        email: request.email, 
        error: error.message 
      })
    }
  }
  
  return results
}