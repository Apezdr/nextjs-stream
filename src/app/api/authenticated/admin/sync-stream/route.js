/**
 * GET /api/authenticated/admin/sync-stream
 *
 * Server-Sent Events endpoint that forwards syncEventBus events to the client
 * in real time. The client connects once and receives progress events for the
 * entire sync operation without blocking the HTTP response.
 *
 * SSE frame format:
 *   id: <incrementing integer>
 *   data: <JSON payload>\n\n
 *
 * Heartbeat (every 15s):
 *   : heartbeat\n\n
 *
 * Reconnect support:
 *   The client sends `Last-Event-ID` on reconnect; this handler replays
 *   missed events from syncEventBus.getRecentEvents().
 */

import { isAdmin } from '../../../../../utils/routeAuth'
import { syncEventBus } from '../../../../../utils/sync/core/events'
import { SyncEventType } from '../../../../../utils/sync/core/types'

export async function GET(request) {
  const authResult = await isAdmin(request)
  if (authResult instanceof Response) {
    return authResult
  }

  const encoder = new TextEncoder()

  // Running counter shared by the closure — gives each SSE frame a unique id
  // so the browser can send Last-Event-ID on reconnect.
  let eventId = 0

  // Incrementing totals sent with every event so the client can render a progress bar
  const totals = { processed: 0, errors: 0, total: 0 }

  // Unsubscribe handles — collected so cleanup is a single loop
  const unsubscribers = []

  // Heartbeat timer
  let heartbeatTimer = null

  const stream = new ReadableStream({
    start(controller) {
      let closed = false

      const enqueue = (payload) => {
        if (closed) return
        let frame
        try {
          frame = `id: ${eventId++}\n` + `data: ${JSON.stringify(payload)}\n\n`
        } catch (err) {
          console.error('[SSE] JSON.stringify failed for event type=%s entity=%s:', payload?.type, payload?.entityId, err.message)
          closed = true
          return
        }
        try {
          controller.enqueue(encoder.encode(frame))
        } catch (err) {
          console.error('[SSE] controller.enqueue failed:', err.message)
          closed = true
        }
      }

      const enqueueHeartbeat = () => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'))
        } catch {
          closed = true
        }
      }

      // Sentinel entity IDs that must not count toward processed/error totals
      const SENTINELS = new Set(['__sync_complete__', '__server_complete__', '__server_start__', '__sync_warmup__'])

      const updateTotals = (event, type) => {
        if (type === SyncEventType.Complete && !SENTINELS.has(event.entityId)) totals.processed++
        if (type === SyncEventType.Error) totals.errors++
      }

      // ── Subscribe FIRST so no live events are lost during history replay ───
      // Node.js is single-threaded: nothing emits between subscribe and replay.
      const eventTypes = [
        SyncEventType.Started,
        SyncEventType.Progress,
        SyncEventType.Complete,
        SyncEventType.Error,
        SyncEventType.Warning,
      ]

      for (const type of eventTypes) {
        const unsub = syncEventBus.subscribe(type, (event) => {
          updateTotals(event, type)
          enqueue({ ...event, totals: { ...totals } })

          // The '__sync_complete__' sentinel signals end of sync
          if (event.entityId === '__sync_complete__') {
            // Immediately tear down so stale callbacks from a future sync
            // never attempt to enqueue on this dead controller.
            closed = true
            clearInterval(heartbeatTimer)
            for (const unsub of unsubscribers) unsub()
            // Give the client time to process the final event before closing
            setTimeout(() => {
              try { controller.close() } catch { /* already closed */ }
            }, 500)
          }
        })
        unsubscribers.push(unsub)
      }

      // ── Replay history so late-connecting clients catch up ─────────────────
      const allHistory = syncEventBus.getRecentEvents(1000)
      const lastEventIdHeader = request.headers.get('Last-Event-ID')

      if (lastEventIdHeader !== null) {
        // Reconnect: replay only events the client missed
        const lastId = parseInt(lastEventIdHeader, 10)
        if (!isNaN(lastId)) {
          for (const event of allHistory.slice(lastId + 1)) {
            updateTotals(event, event.type)
            enqueue({ ...event, replayed: true, totals: { ...totals } })
          }
        }
      } else {
        // Initial connect: replay from the most recent __sync_warmup__ so the
        // client sees all server-start/progress events even if it connected late.
        const warmupIdx = allHistory.findLastIndex(e => e.entityId === '__sync_warmup__')
        if (warmupIdx >= 0) {
          for (const event of allHistory.slice(warmupIdx)) {
            updateTotals(event, event.type)
            enqueue({ ...event, replayed: true, totals: { ...totals } })
          }
        }
      }

      // ── Heartbeat to prevent proxy/load-balancer idle timeout ─────────────
      heartbeatTimer = setInterval(enqueueHeartbeat, 15_000)

      // ── Cleanup on client disconnect ───────────────────────────────────────
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeatTimer)
        for (const unsub of unsubscribers) unsub()
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable Nginx buffering
    },
  })
}
