// src/lib/mediaQueues/normalize.ts
// Maps each upstream queue payload onto MediaQueueOk. Pure: no I/O, so every
// branch is testable against recorded payloads. The shapes handled here were
// checked against the live services on 2026-10-11 (Radarr/Sonarr API v3,
// SABnzbd 5.1.3, Tdarr 3.00.00).

import type {
  MediaQueueCount,
  MediaQueueHealth,
  MediaQueueItem,
  MediaQueueNotice,
  MediaQueueOk,
  MediaQueueTone,
} from './types'

/** Items returned per queue: what one dashboard card shows. */
export const ITEM_LIMIT = 3

/** Caps one upstream message so a runaway error string cannot swamp a card. */
const DETAIL_MAX_LENGTH = 200

const BYTES_PER_MIB = 1024 * 1024

/** The payload is not the shape the service documents (or answered before). */
export class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidResponseError'
  }
}

type JsonRecord = Record<string, unknown>

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function toText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value))

function clip(text: string | null): string | null {
  if (!text || text.length <= DETAIL_MAX_LENGTH) return text
  return `${text.slice(0, DETAIL_MAX_LENGTH - 1)}…`
}

/** "downloadClientUnavailable" → "Download client unavailable" */
function humanize(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const TONE_RANK: Record<MediaQueueTone, number> = { error: 0, warning: 1, active: 2, neutral: 3 }

/** Problems first, then active work; upstream order otherwise (sort is stable). */
const byTone = (a: MediaQueueItem, b: MediaQueueItem) => TONE_RANK[a.tone] - TONE_RANK[b.tone]

const countOf = (label: string, value: number, tone: MediaQueueTone = 'neutral'): MediaQueueCount => ({
  label,
  value,
  unit: 'count',
  tone,
})

// .NET TimeSpan as Radarr/Sonarr serialize it: "hh:mm:ss" or "d.hh:mm:ss",
// optionally with a ".fffffff" fraction.
const TIMESPAN = /^(?:(\d+)\.)?(\d{1,2}):(\d{2}):(\d{2})(?:\.\d+)?$/

export function parseTimeSpan(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = TIMESPAN.exec(value.trim())
  if (!match) return null
  const [, days, hours, minutes, seconds] = match
  return Number(days ?? 0) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds)
}

// Colon-separated clock durations: SABnzbd's "h:mm:ss" (with a leading day
// field past 24 h, "d:hh:mm:ss") and Tdarr's worker ETA.
const CLOCK = /^\d+(?::\d{1,2}){1,3}$/
const CLOCK_WEIGHTS = [1, 60, 3_600, 86_400]

export function parseClockDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!CLOCK.test(trimmed)) return null
  return trimmed
    .split(':')
    .reverse()
    .reduce((total, part, index) => total + Number(part) * CLOCK_WEIGHTS[index], 0)
}

// ── Radarr / Sonarr (API v3) ────────────────────────────────────────────────

// Tracked-download states that say more than the download client's status.
// 'downloading' is absent on purpose: the client's own status reads better.
const ARR_TRACKED_STATE_LABELS: Record<string, string> = {
  importPending: 'Import pending',
  importing: 'Importing',
  importBlocked: 'Import blocked',
  imported: 'Imported',
  failedPending: 'Failed (pending)',
  failed: 'Failed',
  ignored: 'Ignored',
}

const ARR_STATUS_LABELS: Record<string, string> = { delay: 'Delayed' }

function arrStatusLabel(record: JsonRecord): string {
  const trackedState = toText(record.trackedDownloadState)
  if (trackedState && ARR_TRACKED_STATE_LABELS[trackedState]) return ARR_TRACKED_STATE_LABELS[trackedState]
  const status = toText(record.status)
  if (!status) return 'Unknown'
  return ARR_STATUS_LABELS[status] ?? humanize(status)
}

function arrTone(record: JsonRecord): MediaQueueTone {
  const trackedStatus = record.trackedDownloadStatus
  const trackedState = record.trackedDownloadState
  const status = record.status
  if (trackedStatus === 'error' || status === 'failed' || trackedState === 'failed' || trackedState === 'failedPending') {
    return 'error'
  }
  // An errorMessage on an "ok" item is still worth surfacing: it is how the
  // download client reports a broken release (e.g. "Corrupt RAR file") that
  // Radarr has not acted on yet.
  if (
    trackedStatus === 'warning' ||
    status === 'warning' ||
    status === 'downloadClientUnavailable' ||
    trackedState === 'importBlocked' ||
    toText(record.errorMessage)
  ) {
    return 'warning'
  }
  if (status === 'downloading' || trackedState === 'importing') return 'active'
  return 'neutral'
}

/** errorMessage, else the first of the statusMessages' messages. */
function arrDetail(record: JsonRecord): string | null {
  const error = toText(record.errorMessage)
  if (error) return clip(error)
  const groups = Array.isArray(record.statusMessages) ? record.statusMessages : []
  for (const group of groups) {
    if (!isRecord(group) || !Array.isArray(group.messages)) continue
    for (const message of group.messages) {
      const text = toText(message)
      if (text) return clip(text)
    }
  }
  return null
}

function arrItem(record: JsonRecord, index: number): MediaQueueItem {
  const size = toNumber(record.size)
  const sizeLeft = toNumber(record.sizeleft)
  const hasSize = size !== null && size > 0
  return {
    id: record.id === undefined || record.id === null ? `item-${index}` : String(record.id),
    title: toText(record.title) ?? 'Unknown release',
    status: arrStatusLabel(record),
    tone: arrTone(record),
    // The v3 queue has no progress field; it is what has arrived of the size.
    progress: hasSize && sizeLeft !== null ? clampPercent(((size - sizeLeft) / size) * 100) : null,
    sizeBytes: hasSize ? size : null,
    timeLeftSeconds: parseTimeSpan(record.timeleft),
    detail: arrDetail(record),
  }
}

/**
 * @param page   GET /api/v3/queue — paged: { totalRecords, records[] }
 * @param status GET /api/v3/queue/status — whole-queue error/warning flags,
 *               or null when that request failed
 */
export function normalizeArrQueue(service: 'radarr' | 'sonarr', page: unknown, status: unknown | null): MediaQueueOk {
  if (!isRecord(page) || !Array.isArray(page.records)) {
    throw new InvalidResponseError(`${service} queue has no records array`)
  }
  const fetched = page.records.filter(isRecord).map(arrItem)
  const totalRecords = toNumber(page.totalRecords)
  const total = totalRecords ?? fetched.length

  // The status flags cover the whole queue; the fetched records only a page.
  const flags = isRecord(status) ? status : null
  const hasErrors = flags?.errors === true || flags?.unknownErrors === true || fetched.some((item) => item.tone === 'error')
  const hasWarnings =
    flags?.warnings === true || flags?.unknownWarnings === true || fetched.some((item) => item.tone === 'warning')
  const inProgress = fetched.filter((item) => item.tone === 'active').length

  let health: MediaQueueHealth = 'idle'
  if (hasErrors) health = 'error'
  else if (hasWarnings) health = 'warning'
  else if (inProgress > 0) health = 'active'
  else if (total > 0) health = 'waiting'

  const withIssues = fetched.filter((item) => item.tone === 'error' || item.tone === 'warning').length
  const counts = [countOf('In queue', total)]
  if (withIssues > 0) counts.push(countOf('Need attention', withIssues, hasErrors ? 'error' : 'warning'))

  const notices: MediaQueueNotice[] = []
  if (!flags) {
    notices.push({ tone: 'warning', message: 'Queue health unavailable; warnings beyond the first page may be missing.' })
  }

  return {
    service,
    state: 'ok',
    health,
    inProgress,
    itemsTotal: total,
    items: [...fetched].sort(byTone).slice(0, ITEM_LIMIT),
    counts,
    notices,
  }
}

// ── SABnzbd ─────────────────────────────────────────────────────────────────

// Slot labels SABnzbd attaches to a job ("DUPLICATE", "ENCRYPTED", "TOO LARGE",
// "PROPAGATING 12 min" …). Propagation is a wait, not a problem.
const isProblemLabel = (label: string) => !/^propagating/i.test(label)

function sabnzbdItem(slot: JsonRecord, index: number): MediaQueueItem {
  const status = toText(slot.status) ?? 'Queued'
  const labels = (Array.isArray(slot.labels) ? slot.labels : []).map(toText).filter((label): label is string => !!label)
  const category = toText(slot.cat)
  const percentage = toNumber(slot.percentage)
  const sizeMiB = toNumber(slot.mb)

  let tone: MediaQueueTone = 'neutral'
  if (labels.some(isProblemLabel)) tone = 'warning'
  else if (status.toLowerCase() === 'downloading') tone = 'active'

  let detail: string | null = null
  if (labels.length > 0) detail = labels.join(' · ')
  else if (category && category !== '*') detail = `Category: ${category}`

  return {
    id: toText(slot.nzo_id) ?? `slot-${index}`,
    title: toText(slot.filename) ?? 'Unknown job',
    status,
    tone,
    progress: percentage === null ? null : clampPercent(percentage),
    sizeBytes: sizeMiB !== null && sizeMiB > 0 ? sizeMiB * BYTES_PER_MIB : null,
    timeLeftSeconds: parseClockDuration(slot.timeleft),
    detail: clip(detail),
  }
}

/**
 * @param body GET /api?mode=queue&output=json — { queue: { status, slots[], … } }.
 *             Request it with `limit` = ITEM_LIMIT; noofslots_total still
 *             counts the whole queue.
 */
export function normalizeSabnzbdQueue(body: unknown): MediaQueueOk {
  if (!isRecord(body) || !isRecord(body.queue) || !Array.isArray(body.queue.slots)) {
    throw new InvalidResponseError('SABnzbd response has no queue slots')
  }
  const queue = body.queue
  const items = (queue.slots as unknown[]).filter(isRecord).map(sabnzbdItem)
  const total = toNumber(queue.noofslots_total) ?? toNumber(queue.noofslots) ?? items.length
  const queueStatus = toText(queue.status)?.toLowerCase()
  const paused = queue.paused === true || queueStatus === 'paused'
  const downloadingSlots = items.filter((item) => item.status.toLowerCase() === 'downloading').length
  // Only the first ITEM_LIMIT slots come back, so trust the queue-level status too.
  const inProgress = paused ? 0 : Math.max(downloadingSlots, queueStatus === 'downloading' ? 1 : 0)

  let health: MediaQueueHealth = 'idle'
  if (paused) health = 'paused'
  else if (inProgress > 0) health = 'active'
  else if (total > 0) health = 'waiting'

  const counts = [countOf('In queue', total)]
  if (inProgress > 0) {
    const kilobytesPerSecond = toNumber(queue.kbpersec)
    if (kilobytesPerSecond !== null) {
      counts.push({ label: 'Speed', value: kilobytesPerSecond * 1024, unit: 'bytesPerSecond', tone: 'active' })
    }
  }
  const queueTimeLeft = parseClockDuration(queue.timeleft)
  if (total > 0 && queueTimeLeft !== null && queueTimeLeft > 0) {
    counts.push({ label: 'Time left', value: queueTimeLeft, unit: 'seconds', tone: 'neutral' })
  }

  const notices: MediaQueueNotice[] = []
  const warnings = toNumber(queue.have_warnings) ?? 0
  if (warnings > 0) {
    notices.push({ tone: 'warning', message: `SABnzbd is reporting ${warnings} warning${warnings === 1 ? '' : 's'}.` })
  }

  return {
    service: 'sabnzbd',
    state: 'ok',
    health,
    inProgress,
    itemsTotal: total,
    items: items.slice(0, ITEM_LIMIT),
    counts,
    notices,
  }
}

// ── Tdarr ───────────────────────────────────────────────────────────────────

const TDARR_WORKER_LABELS: Record<string, string> = {
  transcodecpu: 'Transcode (CPU)',
  transcodegpu: 'Transcode (GPU)',
  healthcheckcpu: 'Health check (CPU)',
  healthcheckgpu: 'Health check (GPU)',
}

const basename = (path: string) => path.split(/[\\/]/).pop() || path

// Worker fields as Tdarr 2.x reports them (and as the earlier dashboard read
// them). No worker was running when 3.00.00 was checked, so each field is
// optional here and a missing one only drops that detail.
function tdarrItem(worker: JsonRecord, nodeName: string | null, index: number): MediaQueueItem {
  const file = toText(worker.file)
  const workerType = toText(worker.workerType)
  const workerStatus = toText(worker.status)
  const percentage = toNumber(worker.percentage)
  const fps = toNumber(worker.fps)
  const label = (workerType && TDARR_WORKER_LABELS[workerType.toLowerCase()]) ?? workerStatus ?? 'Processing'

  const detail = [
    nodeName,
    workerStatus && workerStatus !== label ? workerStatus : null,
    fps !== null && fps > 0 ? `${Math.round(fps)} fps` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return {
    id: toText(worker._id) ?? `${nodeName ?? 'node'}-${index}`,
    title: file ? basename(file) : 'Unknown file',
    status: label,
    tone: workerStatus && /error|fail/i.test(workerStatus) ? 'error' : 'active',
    progress: percentage === null ? null : clampPercent(percentage),
    sizeBytes: null,
    timeLeftSeconds: parseClockDuration(worker.ETA),
    detail: clip(detail || null),
  }
}

/**
 * @param nodes      GET /api/v2/get-nodes — { [nodeId]: { nodeName, nodePaused, workers: { [id]: worker } } }
 * @param statistics POST /api/v2/cruddb StatisticsJSONDB/statistics — library
 *                   queue counts, or null when that request failed. Tables:
 *                   1 transcode queue, 3 transcode errors, 4 health-check
 *                   queue, 6 health-check errors (2 and 5 are successes; the
 *                   three per kind sum to totalFileCount).
 */
export function normalizeTdarr(nodes: unknown, statistics: unknown | null): MediaQueueOk {
  if (!isRecord(nodes)) throw new InvalidResponseError('Tdarr get-nodes is not an object')
  const nodeList = Object.values(nodes).filter(isRecord)

  const workers: MediaQueueItem[] = []
  for (const node of nodeList) {
    const nodeName = toText(node.nodeName)
    const nodeWorkers = isRecord(node.workers) ? Object.values(node.workers).filter(isRecord) : []
    nodeWorkers.forEach((worker) => workers.push(tdarrItem(worker, nodeName, workers.length)))
  }
  const pausedNodes = nodeList.filter((node) => node.nodePaused === true).length

  const stats = isRecord(statistics) ? statistics : null
  const transcodeQueue = toNumber(stats?.table1Count)
  const transcodeErrors = toNumber(stats?.table3Count)
  const healthCheckQueue = toNumber(stats?.table4Count)
  const healthCheckErrors = toNumber(stats?.table6Count)
  const queued = (transcodeQueue ?? 0) + (healthCheckQueue ?? 0)

  let health: MediaQueueHealth = 'idle'
  if (nodeList.length === 0) health = 'warning'
  else if (pausedNodes === nodeList.length) health = 'paused'
  else if (workers.length > 0) health = 'active'
  else if (queued > 0) health = 'waiting'

  const counts = [countOf('Workers running', workers.length, workers.length > 0 ? 'active' : 'neutral')]
  if (transcodeQueue !== null) counts.push(countOf('Transcode queue', transcodeQueue))
  if (healthCheckQueue !== null) counts.push(countOf('Health-check queue', healthCheckQueue))
  // Error tables only grow until someone requeues or clears them; show them
  // when there is something to act on.
  if (transcodeErrors) counts.push(countOf('Transcode errors', transcodeErrors, 'warning'))
  if (healthCheckErrors) counts.push(countOf('Health-check errors', healthCheckErrors, 'warning'))

  const notices: MediaQueueNotice[] = []
  if (nodeList.length === 0) {
    notices.push({ tone: 'warning', message: 'No Tdarr nodes are connected.' })
  } else if (pausedNodes > 0) {
    notices.push({ tone: 'warning', message: `${pausedNodes} of ${nodeList.length} nodes paused.` })
  }
  const processWarning = toText(stats?.processWarning)
  if (processWarning) notices.push({ tone: 'warning', message: clip(processWarning) as string })
  if (!stats) notices.push({ tone: 'warning', message: 'Library queue counts unavailable.' })

  return {
    service: 'tdarr',
    state: 'ok',
    health,
    inProgress: workers.length,
    itemsTotal: workers.length,
    items: [...workers].sort(byTone).slice(0, ITEM_LIMIT),
    counts,
    notices,
  }
}
