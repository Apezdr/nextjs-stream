import 'server-only'

import { AppTimeZoneManager } from '@src/utils/admin_database'
import { DEFAULT_APP_TIME_ZONE } from '@src/utils/dateTime'

const CACHE_TTL_MS = 30000
const manager = new AppTimeZoneManager()
let cachedTimeZone = null
let cacheExpiresAt = 0

export async function getAppTimeZone() {
  if (cachedTimeZone && cacheExpiresAt > Date.now()) return cachedTimeZone
  try {
    cachedTimeZone = await manager.getTimeZone()
    cacheExpiresAt = Date.now() + CACHE_TTL_MS
    return cachedTimeZone
  } catch {
    // Preserve the last good value during a transient database outage.
    return cachedTimeZone || DEFAULT_APP_TIME_ZONE
  }
}

export function clearAppTimeZoneCache() {
  cacheExpiresAt = 0
}