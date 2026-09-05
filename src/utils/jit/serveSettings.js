/**
 * Cached runtime read of the admin-controlled JIT serve settings
 * (app_config.settings doc 'jitServe', written from /admin/settings).
 *
 * Precedence in the serve layer: valid runtime override > env var > default.
 * The admin toggle exists precisely so flipping delivery behavior does not
 * require a redeploy — but the serve path runs per request/heartbeat, so the
 * DB read is cached module-level with a short TTL. A toggle takes effect
 * within TTL seconds on every running instance.
 *
 * Failure-safe by construction: any read error (DB down, cold start,
 * missing doc) yields null and callers fall back to env — delivery keeps
 * working on the last-deployed configuration.
 */

const TTL_MS = 20_000

let cached = { value: null, expiresAt: 0 }

export async function getCachedJitServeSettings() {
  // Unit tests exercise the env-fallback paths; a module-scope Mongo client
  // (admin_database → clientPromise) must never be pulled into a jest
  // import graph. Tests inject via _setJitServeSettingsForTests instead.
  if (process.env.NODE_ENV === 'test' && !cached.value) return null

  if (cached.expiresAt > Date.now()) return cached.value

  try {
    const { JitServeSettingsManager } = await import('@src/utils/admin_database')
    const settings = await new JitServeSettingsManager().getJitServeSettings()
    cached = { value: settings, expiresAt: Date.now() + TTL_MS }
    return settings
  } catch (e) {
    // Negative-cache briefly so an outage doesn't add a failed read to
    // every heartbeat.
    cached = { value: null, expiresAt: Date.now() + TTL_MS }
    return null
  }
}

/**
 * Drop this process's runtime-settings snapshot after an admin write.
 *
 * Other instances still converge within TTL_MS, but the instance handling the
 * mutation must not render a freshly revalidated player with the old setting.
 */
export function invalidateCachedJitServeSettings() {
  cached = { value: null, expiresAt: 0 }
}

/** Test hook — inject settings (or null) and bypass the DB entirely. */
export function _setJitServeSettingsForTests(value) {
  if (value === undefined) {
    invalidateCachedJitServeSettings()
    return
  }
  cached = { value, expiresAt: Date.now() + TTL_MS }
}
