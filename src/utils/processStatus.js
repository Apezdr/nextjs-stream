// Rows from the media processor's process_queue (GET /processes, written by
// node/sqlite/processTracking.mjs in nextjs-stream-media-processor). Its
// statuses are 'queued', 'in-progress', 'completed', 'error', and
// 'interrupted' for a process a restart cut off.

/** Statuses that mean a process is running or waiting to run. */
export const ACTIVE_PROCESS_STATUSES = ['in-progress', 'queued']

/**
 * Whether a process row is current activity. 'error' and 'interrupted' rows
 * are history: counting them kept failures from weeks ago in Active Processes.
 * @param {{status?: string}} process
 * @returns {boolean}
 */
export function isActiveProcess(process) {
  return ACTIVE_PROCESS_STATUSES.includes(process?.status)
}

const STATUS_BADGES = {
  'in-progress': { status: 'info', text: 'In progress' },
  queued: { status: 'warning', text: 'Queued' },
  completed: { status: 'success', text: 'Completed' },
  error: { status: 'error', text: 'Error' },
  interrupted: { status: 'neutral', text: 'Interrupted' },
}

/**
 * StatusBadge props for a process status.
 * @param {string} status
 * @returns {{status: 'success'|'warning'|'error'|'info'|'neutral', text: string}}
 */
export function getProcessStatusBadge(status) {
  return STATUS_BADGES[status] ?? { status: 'neutral', text: status || 'Unknown' }
}

/**
 * Percent complete from the row's step counters, or null when it has none.
 * @param {{current_step?: number, total_steps?: number}} process
 * @returns {number|null}
 */
export function getProcessPercent(process) {
  const total = Number(process?.total_steps)
  const current = Number(process?.current_step)
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(current)) return null
  return Math.min(100, Math.max(0, Math.round((current / total) * 100)))
}
