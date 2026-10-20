/**
 * POST /api/authenticated/admin/log-alert: a media processor reporting one of
 * its log alert transitions (its lib/alerts/notifier.mjs), to become admin
 * notifications.
 *
 * Webhook only: the processor authenticates with the webhook ID this frontend
 * gave it, which also says which server it is. Today only a processor's home
 * frontend (its FRONT_END_1) gets these. Only known fields are kept, and
 * capped, so a processor can't store arbitrary data in admins' notifications.
 */

import { notifyAdminsOfLogAlert } from './adminNotifier'

const SEVERITIES = new Set(['critical', 'warning', 'info'])
const TRANSITIONS = new Set(['fired', 'reminder', 'resolved'])

const text = (value, max) => (typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null)

/** The alert and transition from a request body, or an error saying what is wrong. */
export function readLogAlert(body) {
  const alert = body?.alert
  if (!alert || typeof alert !== 'object') return { error: 'alert is missing' }
  if (!TRANSITIONS.has(body.transition)) return { error: 'transition must be fired, reminder or resolved' }
  if (!SEVERITIES.has(alert.severity)) return { error: 'alert.severity must be critical, warning or info' }
  const key = text(alert.key, 200)
  const title = text(alert.title, 500)
  const processorId = text(alert.processorId, 100)
  if (!key || !title || !processorId) return { error: 'alert.key, alert.title and alert.processorId are required' }
  return {
    transition: body.transition,
    alert: {
      key,
      title,
      processorId,
      severity: alert.severity,
      rule: text(alert.rule, 50),
      state: alert.state === 'resolved' ? 'resolved' : 'firing',
      category: text(alert.category, 100),
      fp: text(alert.fp, 32),
      count: Number.isFinite(alert.count) ? alert.count : null,
      windowMinutes: Number.isFinite(alert.windowMinutes) ? alert.windowMinutes : null,
    },
  }
}

const json = (body, status) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function handleLogAlert(request, { webhookId, serverId }) {
  if (!webhookId || !serverId) {
    return json({ error: 'Unauthorized', message: 'Log alerts come from a media processor, with its webhook ID' }, 401)
  }
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Bad Request', message: 'Invalid JSON in request body' }, 400)
  }
  const parsed = readLogAlert(body)
  if (parsed.error) return json({ error: 'Bad Request', message: parsed.error }, 400)

  try {
    await notifyAdminsOfLogAlert({ ...parsed, serverId })
  } catch (error) {
    return json({ error: 'Internal Server Error', message: `Couldn't notify admins: ${error.message}` }, 500)
  }
  return json({ success: true, serverId }, 200)
}
