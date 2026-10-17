/**
 * Module-level sync-run context.
 *
 * Holds the current `syncRunId` for the duration of one sync orchestration so
 * that every Flat* write site can stamp the record with the same id without
 * the id needing to be threaded through ~47 call paths.
 *
 * Why module state is safe here:
 *   - `runPostSyncCleanup` already enforces a module-scoped in-flight lock, and
 *     `syncAllServers` is not invoked concurrently within a single Node
 *     process — the admin sync route serializes each call.
 *   - Multi-process deployments are fine: each process generates its own
 *     syncRunId per orchestration; cleanup runs in the same process that
 *     wrote the records (so it sees the matching marker).
 *
 * `setCurrentSyncRunId` should be called at the top of `syncAllServers` and
 * `clearCurrentSyncRunId` in the matching `finally` so the value never leaks
 * into a later orchestration.
 */

let _currentSyncRunId = null

/**
 * Set the syncRunId for the current orchestration. Subsequent writes through
 * the Flat* helpers will tag records with this id.
 */
export function setCurrentSyncRunId(id) {
  _currentSyncRunId = id
}

/** Clear the active syncRunId. Call this in the `finally` of the orchestration. */
export function clearCurrentSyncRunId() {
  _currentSyncRunId = null
}

/** Read the current syncRunId. Returns null when no orchestration is in progress. */
export function getCurrentSyncRunId() {
  return _currentSyncRunId
}

// ─── Orchestration single-flight lock ────────────────────────────────────────
// A whole-orchestration mutex covering pre-tag → per-server writes → post-sync
// cleanup. Unlike `_currentSyncRunId` (cleared at the end of the WRITE phase,
// before the background cleanup runs), this lock is held until the cleanup that
// consumes the markers has fully settled — so a new orchestration cannot begin
// its pre-tag/writes while a previous run's cleanup is still doing its
// find→delete. The race guard in postSyncCleanup is a coarse single read; this
// lock closes that window.
//
// Single-process only (the app runs one Node process — see Dockerfile). For a
// horizontally-scaled deployment, swap this for a distributed lock (e.g. Redis
// `SET NX PX` + token); the acquire/release shape is intentionally compatible.
let _orchestrationLock = null // { syncRunId, acquiredAt } | null

/**
 * Try to acquire the orchestration lock. Returns true on success (the caller now
 * owns it and MUST call `releaseSyncLock` with the same id once its cleanup has
 * settled), or false if another orchestration already holds it.
 */
export function tryAcquireSyncLock(syncRunId) {
  if (_orchestrationLock) return false
  _orchestrationLock = { syncRunId, acquiredAt: Date.now() }
  return true
}

/**
 * Release the orchestration lock. Ownership-checked and idempotent: a release
 * with a non-owning id (e.g. a watchdog firing after the lock was already
 * released and re-acquired by a newer run) is a no-op, so it can never free
 * another orchestration's lock. Returns true iff this call released it.
 */
export function releaseSyncLock(syncRunId) {
  if (_orchestrationLock && _orchestrationLock.syncRunId === syncRunId) {
    _orchestrationLock = null
    return true
  }
  return false
}

/** The current orchestration lock holder ({ syncRunId, acquiredAt }) or null. */
export function getSyncLockHolder() {
  return _orchestrationLock
}
