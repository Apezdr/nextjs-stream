/**
 * A media processor's log alert as admin notifications (the bell).
 *
 * The processor decides what is alert-worthy and sends each transition
 * (fired, reminder, resolved) to its home frontend; this turns it into one
 * notification per admin. The groupKey is the processor's ID and the alert's
 * key, so a reminder or the resolve replaces the unread notice for that alert
 * instead of adding another, and two frontends sharing one Mongo don't double
 * it either.
 */

import { NotificationManager } from '@src/utils/notifications/NotificationManager.js'
import { getAdminUserIds } from '@src/utils/notifications/notificationDatabase'
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_CATEGORIES,
} from '@src/utils/notifications/NotificationTypes'
import { adminUserEmails, getAllServers } from '@src/utils/config'
import { formatServerLabel } from '@src/utils/serverLabel'
import { createLogger } from '@src/lib/logger'

const log = createLogger('LogAlerts.AdminNotifier')

const PRIORITY_BY_SEVERITY = {
  critical: NOTIFICATION_PRIORITIES.URGENT,
  warning: NOTIFICATION_PRIORITIES.HIGH,
  info: NOTIFICATION_PRIORITIES.MEDIUM,
}

function serverLabel(serverId) {
  const server = getAllServers().find((candidate) => candidate.id === serverId)
  return server?.displayName || formatServerLabel(serverId)
}

/** The Logs page for that server, filtered to the alert's lines when it has a fingerprint. */
export function logsUrlFor(serverId, alert) {
  const params = new URLSearchParams({ server: serverId })
  if (alert.fp) params.set('q', alert.fp)
  return `/admin/logs?${params}`
}

/**
 * @param {{ alert: object, transition: 'fired' | 'reminder' | 'resolved', serverId: string }} event
 *   `alert` as the processor's lib/alerts/manager.mjs publicAlert() shapes it
 */
export async function notifyAdminsOfLogAlert({ alert, transition, serverId }) {
  const adminIds = await getAdminUserIds(adminUserEmails)
  if (adminIds.length === 0) {
    log.warn({ alertKey: alert.key }, 'No admin users to notify of a log alert')
    return []
  }

  const label = serverLabel(serverId)
  const severity = alert.severity[0].toUpperCase() + alert.severity.slice(1)
  const title =
    transition === 'resolved'
      ? `Resolved on ${label}: ${alert.title}`
      : transition === 'reminder'
        ? `Still ${alert.severity} on ${label}: ${alert.title}`
        : `${label}: ${alert.title}`
  const details = [severity, alert.category, alert.windowMinutes ? `${alert.count} in ${alert.windowMinutes} min` : null]

  return NotificationManager.createCustom(
    adminIds,
    {
      type: NOTIFICATION_TYPES.LOG_ALERT,
      title,
      message: details.filter(Boolean).join(' · '),
      data: {
        actionUrl: logsUrlFor(serverId, alert),
        serverId,
        processorId: alert.processorId,
        alertKey: alert.key,
        rule: alert.rule,
        severity: alert.severity,
        state: alert.state,
        fp: alert.fp ?? null,
      },
      priority: transition === 'resolved' ? NOTIFICATION_PRIORITIES.LOW : PRIORITY_BY_SEVERITY[alert.severity],
      category: NOTIFICATION_CATEGORIES.ADMIN,
      groupKey: `log_alert_${alert.processorId}_${alert.key}`,
    },
    true
  )
}
