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

/**
 * Inject `syncRunId` into a MongoDB update operator document so the field
 * is set on every write that flows through a hub helper.
 *
 * - Mutates `$set` so the marker is set on existing records.
 * - Mutates `$setOnInsert` (when present) so the marker is set on the upsert
 *   path too.
 * - Pass-through if no syncRunId is currently active (e.g., a maintenance
 *   write that runs outside an orchestration).
 *
 * Returns the same `updates` object for chaining convenience.
 */
export function withSyncRunIdMarker(updates) {
  const id = _currentSyncRunId
  if (!id || !updates || typeof updates !== 'object') return updates

  if (updates.$set && typeof updates.$set === 'object') {
    updates.$set.syncRunId = id
  } else {
    updates.$set = { syncRunId: id }
  }

  if (updates.$setOnInsert && typeof updates.$setOnInsert === 'object') {
    updates.$setOnInsert.syncRunId = id
  }

  return updates
}

/**
 * Stamp a plain document with `syncRunId` before insertOne / replaceOne.
 * Mutates and returns the same object. Pass-through if no syncRunId active.
 */
export function stampDocumentWithSyncRunId(doc) {
  const id = _currentSyncRunId
  if (!id || !doc || typeof doc !== 'object') return doc
  doc.syncRunId = id
  return doc
}
