// src/lib/mediaQueues/types.ts
// The one shape the admin dashboard reads for every download/processing queue.
// Each upstream API (Radarr/Sonarr v3, SABnzbd, Tdarr) answers in its own
// format; normalize.ts maps them onto this so the UI depends on none of them.

export const MEDIA_QUEUE_SERVICES = ['sabnzbd', 'radarr', 'sonarr', 'tdarr'] as const
export type MediaQueueService = (typeof MEDIA_QUEUE_SERVICES)[number]

/** How one queue item reads at a glance. */
export type MediaQueueTone = 'neutral' | 'active' | 'warning' | 'error'

/**
 * How the whole queue reads at a glance. `waiting` is work queued with nothing
 * moving (delayed releases, a Tdarr queue with no free workers); `idle` is an
 * empty queue.
 */
export type MediaQueueHealth = 'idle' | 'active' | 'waiting' | 'paused' | 'warning' | 'error'

export interface MediaQueueItem {
  id: string
  title: string
  /** Display label, e.g. "Downloading", "Import pending", "Transcode (GPU)". */
  status: string
  tone: MediaQueueTone
  /** 0–100, or null when the upstream gives no way to know. */
  progress: number | null
  sizeBytes: number | null
  timeLeftSeconds: number | null
  /** The upstream's own warning/error text, or short context (node, category). */
  detail: string | null
}

export interface MediaQueueCount {
  label: string
  value: number
  unit: 'count' | 'bytesPerSecond' | 'seconds'
  tone: MediaQueueTone
}

export interface MediaQueueNotice {
  tone: MediaQueueTone
  message: string
}

export type UnreachableReason =
  | 'timeout'
  | 'unauthorized'
  | 'refused'
  | 'network'
  | 'bad_url'
  | 'http_error'
  | 'invalid_response'

export interface MediaQueueNotConfigured {
  service: MediaQueueService
  state: 'not_configured'
  /** The environment variables that are unset. */
  missing: string[]
}

export interface MediaQueueUnreachable {
  service: MediaQueueService
  state: 'unreachable'
  reason: UnreachableReason
  httpStatus: number | null
}

export interface MediaQueueOk {
  service: MediaQueueService
  state: 'ok'
  health: MediaQueueHealth
  /**
   * Items moving right now (downloading, importing, transcoding). Kept apart
   * from `health` because a queue with a warning can still be moving, and the
   * dashboard polls faster while anything is.
   */
  inProgress: number
  /** Every item of the kind `items` lists, not just the ones returned. */
  itemsTotal: number
  /** The most relevant few: problems first, then active work. */
  items: MediaQueueItem[]
  counts: MediaQueueCount[]
  notices: MediaQueueNotice[]
}

export type MediaQueueResult = MediaQueueNotConfigured | MediaQueueUnreachable | MediaQueueOk

export interface MediaQueuesResponse {
  queues: MediaQueueResult[]
}
