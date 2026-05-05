const WINDOW_MS = 60 * 60 * 1000

const buckets = new Map()

function getLimit() {
  const raw = parseInt(process.env.CAPTIONS_RATE_LIMIT_PER_HOUR ?? '', 10)
  return Number.isFinite(raw) && raw > 0 ? raw : 10
}

export function checkAndRecordTrigger(userKey) {
  if (!userKey) {
    return { allowed: false, retryAfterSec: WINDOW_MS / 1000, remaining: 0 }
  }

  const now = Date.now()
  const cutoff = now - WINDOW_MS
  const limit = getLimit()

  const existing = buckets.get(userKey) ?? []
  const recent = existing.filter((ts) => ts > cutoff)

  if (recent.length >= limit) {
    const oldest = recent[0]
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000))
    buckets.set(userKey, recent)
    return { allowed: false, retryAfterSec, remaining: 0 }
  }

  recent.push(now)
  buckets.set(userKey, recent)
  return { allowed: true, retryAfterSec: 0, remaining: limit - recent.length }
}
