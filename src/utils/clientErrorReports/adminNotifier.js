/**
 * Admin notifications for fatal client error reports.
 *
 * Fans a notification out to admin users only (per-user docs, matching the
 * createSyncCompleteForAdmins precedent). Uses a dedupeKey-derived groupKey
 * so repeated fatal reports collapse into one unread notification per admin
 * instead of flooding the bell.
 */

import { NotificationManager } from '@src/utils/notifications/NotificationManager.js'
import { getAdminUserIds } from '@src/utils/notifications/notificationDatabase'
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_CATEGORIES,
} from '@src/utils/notifications/NotificationTypes'
import { adminUserEmails } from '@src/utils/config'
import rateLimiter from '@src/utils/rateLimiter'
import { createLogger } from '@src/lib/logger'

const log = createLogger('ClientErrorReports.AdminNotifier')

const MAX_NOTIFICATION_MESSAGE_CHARS = 140

// Throttles on top of the ingest rate limit: reports are user-supplied, so a
// client stuck in a fatal loop (or a hostile user minting unique dedupeKeys)
// must not flood every admin's bell. In-memory per process, matching the
// repo's accepted rate-limiter pattern.
const NOTIFY_WINDOW_MS = 60 * 60 * 1000
const MAX_NOTIFICATIONS_PER_REPORTER_PER_HOUR = 5
const MAX_NOTIFICATIONS_PER_GROUP_PER_HOUR = 1

/**
 * Notify admin users about a fatal client error report.
 * Failures are logged and swallowed — ingesting the report must never fail
 * because notifying did.
 *
 * @param {Object} report - Stored report document (insertClientErrorReport output)
 */
export async function notifyAdminsOfFatalClientError(report) {
  try {
    const reporterLimit = rateLimiter.isRateLimited(
      `client-error-notify-user_${String(report.userId)}`,
      MAX_NOTIFICATIONS_PER_REPORTER_PER_HOUR,
      NOTIFY_WINDOW_MS
    )
    if (reporterLimit.isLimited) {
      log.info(
        { userId: String(report.userId), dedupeKey: report.dedupeKey },
        'Skipping admin notification: reporter notification throttle reached'
      )
      return []
    }

    const groupLimit = rateLimiter.isRateLimited(
      `client-error-notify-group_${report.dedupeKey}`,
      MAX_NOTIFICATIONS_PER_GROUP_PER_HOUR,
      NOTIFY_WINDOW_MS
    )
    if (groupLimit.isLimited) {
      return []
    }

    const adminIds = await getAdminUserIds(adminUserEmails)
    if (adminIds.length === 0) {
      log.warn('No admin users found for fatal client error notification')
      return []
    }

    const deviceLabel =
      report.device?.model || report.device?.brand || report.app?.platform || 'Unknown device'
    const rawMessage = report.message || ''
    const shortMessage =
      rawMessage.length > MAX_NOTIFICATION_MESSAGE_CHARS
        ? `${rawMessage.slice(0, MAX_NOTIFICATION_MESSAGE_CHARS)}…`
        : rawMessage

    const notificationData = {
      type: NOTIFICATION_TYPES.CLIENT_ERROR,
      title: `Fatal Client Error (${report.category})`,
      message: `${deviceLabel}: ${shortMessage}`,
      data: {
        dedupeKey: report.dedupeKey,
        category: report.category,
        platform: report.app?.platform || null,
        appVersion: report.app?.version || null,
        deviceModel: report.device?.model || null,
        actionUrl: '/admin/client-errors',
      },
      priority: NOTIFICATION_PRIORITIES.HIGH,
      category: NOTIFICATION_CATEGORIES.ADMIN,
      groupKey: `client_error_${report.dedupeKey}`,
    }

    return await NotificationManager.createCustom(adminIds, notificationData, true)
  } catch (error) {
    log.error({ error }, 'Failed to create fatal client error notification')
    return []
  }
}
