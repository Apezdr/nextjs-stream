// src/lib/mediaQueues/getMediaQueues.ts
// Every queue the admin overview shows, fetched in parallel and shared across
// requests for a moment, so N open admin tabs cost the services one poll.
import 'server-only'
import { loadMediaQueue } from './upstream'
import { MEDIA_QUEUE_SERVICES } from './types'
import type { MediaQueueResult, MediaQueueService, MediaQueuesResponse } from './types'

/**
 * How long one answer per service is shared after it lands. While a request is
 * still in flight, later callers join it rather than starting another. Kept
 * under the dashboard's fastest poll (3 s), so a single tab always gets a
 * fresh answer.
 */
export const SHARED_RESULT_MS = 2_000

interface SharedEntry {
  promise: Promise<MediaQueueResult>
  /** null while in flight. */
  settledAt: number | null
  /** Started by a manual refresh rather than a poll. */
  forced: boolean
}

const shared = new Map<MediaQueueService, SharedEntry>()

function startLoad(service: MediaQueueService, forced: boolean): Promise<MediaQueueResult> {
  const entry: SharedEntry = { promise: loadMediaQueue(service), settledAt: null, forced }
  // loadMediaQueue resolves for every outcome, so this never sees a rejection.
  entry.promise.then(() => {
    entry.settledAt = Date.now()
  })
  shared.set(service, entry)
  return entry.promise
}

function loadShared(service: MediaQueueService): Promise<MediaQueueResult> {
  const entry = shared.get(service)
  if (entry && (entry.settledAt === null || Date.now() - entry.settledAt < SHARED_RESULT_MS)) {
    return entry.promise
  }
  return startLoad(service, false)
}

export async function getMediaQueues(): Promise<MediaQueuesResponse> {
  const queues = await Promise.all(MEDIA_QUEUE_SERVICES.map(loadShared))
  return { queues }
}

/**
 * One service, asked again now (the dashboard's per-card refresh button). It
 * skips the shared answer, and joins a request in flight only when that one is
 * also a manual refresh: a poll already under way started before the click,
 * so its answer may predate whatever the admin just fixed. The new answer
 * becomes the shared one, so the next poll — from any tab — cannot hand back
 * the older result.
 */
export async function refreshMediaQueue(service: MediaQueueService): Promise<MediaQueuesResponse> {
  const entry = shared.get(service)
  const queue = await (entry?.forced && entry.settledAt === null ? entry.promise : startLoad(service, true))
  return { queues: [queue] }
}
