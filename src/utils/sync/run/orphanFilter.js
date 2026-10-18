/**
 * Which documents post-sync cleanup deletes after a run (postSyncCleanup.js):
 * those the run did not stamp, that are not manual entries, and — the R2
 * backstop — that were last written before the run started. A document with
 * no `updatedAt` (legacy) is never deleted.
 *
 * Shared with the sync-tick skip check (run/tickSkip.js), which asks the same
 * question after the fact: is anything left that cleanup should have deleted?
 *
 * @param {string} syncRunId - The run whose stamp marks a document as kept
 * @param {Date|null} runStart - When the run started; null drops the backstop
 * @returns {Object} A MongoDB filter, the same for find() and deleteMany()
 */
export function cleanupOrphanFilter(syncRunId, runStart) {
  return {
    syncRunId: { $ne: syncRunId },
    manualEntry: { $ne: true },
    ...(runStart ? { updatedAt: { $lt: runStart } } : {}),
  }
}
