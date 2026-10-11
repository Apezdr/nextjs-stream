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
}

const shared = new Map<MediaQueueService, SharedEntry>()

function loadShared(service: MediaQueueService): Promise<MediaQueueResult> {
  const entry = shared.get(service)
  if (entry && (entry.settledAt === null || Date.now() - entry.settledAt < SHARED_RESULT_MS)) {
    return entry.promise
  }
  const next: SharedEntry = { promise: loadMediaQueue(service), settledAt: null }
  // loadMediaQueue resolves for every outcome, so this never sees a rejection.
  next.promise.then(() => {
    next.settledAt = Date.now()
  })
  shared.set(service, next)
  return next.promise
}

export async function getMediaQueues(): Promise<MediaQueuesResponse> {
  const queues = await Promise.all(MEDIA_QUEUE_SERVICES.map(loadShared))
  return { queues }
}
