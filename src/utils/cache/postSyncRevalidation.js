/**
 * Revalidate media caches from work that runs outside a request.
 *
 * The admin sync is fire-and-forget, and its post-sync cleanup runs in the
 * background after that. revalidateTag called from either is a silent no-op:
 * Next flushes a request's pending tags when its handler resolves, which for
 * the sync is the 202, long before any entity is written. So both POST the
 * changed entities to /admin/revalidate-media, which revalidates in a request
 * scope of its own.
 */

/**
 * @param {{ movies?: string[], shows?: string[], seasons?: object[], episodes?: object[] }} changedMedia
 * @returns {number} How many entities changed
 */
export function countChangedMedia(changedMedia) {
  return (
    (changedMedia?.movies?.length || 0) +
    (changedMedia?.shows?.length || 0) +
    (changedMedia?.seasons?.length || 0) +
    (changedMedia?.episodes?.length || 0)
  )
}

/**
 * POST changed entities to /admin/revalidate-media. Never throws: a missed
 * revalidation must not fail a sync or a cleanup.
 *
 * Self-authenticates: forwards the incoming webhook id when there is one
 * (webhook-triggered sync), otherwise uses WEBHOOK_ID from env (a sync started
 * from the admin UI, or the background cleanup, carries none).
 *
 * @param {{ movies?: string[], shows?: string[], seasons?: object[], episodes?: object[] }} changedMedia
 *   Display titles, which is what the media page tags key on
 * @param {Object} [options]
 * @param {string|null} [options.webhookId] - The incoming webhook id, if any
 * @param {string} [options.port] - The port this server listens on (default: PORT, then 3000)
 * @param {string} [options.label] - Names the caller in the success log
 * @returns {Promise<boolean>} Whether the route accepted the request
 */
export async function requestMediaRevalidation(
  changedMedia,
  { webhookId = null, port, label = 'Post-sync' } = {}
) {
  const totalChanged = countChangedMedia(changedMedia)
  if (totalChanged === 0) return false

  const internalWebhookId = webhookId || process.env.WEBHOOK_ID
  if (!internalWebhookId) {
    console.error('[Cache SWR] No webhook id available for internal revalidation call — skipping')
    return false
  }

  // Target loopback, NOT the incoming request's origin. The sync is usually
  // webhook-triggered, so its request carries the EXTERNAL host, which the
  // container cannot reach from inside (hairpin NAT, and TLS terminates at the
  // proxy): that produced a "fetch failed" and the revalidation silently never
  // ran. The server listens on 127.0.0.1:PORT; Next sets PORT for both
  // `next start` and `next dev -p`, and the Docker image sets it too.
  const revalidateUrl = `http://127.0.0.1:${port || process.env.PORT || '3000'}/api/authenticated/admin/revalidate-media`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(revalidateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-ID': internalWebhookId,
      },
      body: JSON.stringify(changedMedia),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if (!response.ok) {
      console.error(`[Cache SWR] revalidate-media responded ${response.status}`)
      return false
    }
    console.log(`[Cache SWR] ${label} revalidation triggered for ${totalChanged} changed entities`)
    return true
  } catch (fetchError) {
    clearTimeout(timeoutId)
    console.error(`[Cache SWR] revalidate-media request failed: ${fetchError.message}`)
    return false
  }
}
