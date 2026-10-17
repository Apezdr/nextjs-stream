/**
 * @jest-environment node
 *
 * Post-sync cleanup and the sync-tick skip check ask the same question —
 * which documents does cleanup delete after a run — through one filter.
 */

const { cleanupOrphanFilter } = require('@src/utils/flatSync/orphanFilter')

it('keeps what the run stamped, manual entries, and anything written since the run started', () => {
  const runStart = new Date('2026-10-17T00:00:00Z')

  expect(cleanupOrphanFilter('run-1', runStart)).toEqual({
    syncRunId: { $ne: 'run-1' },
    manualEntry: { $ne: true },
    updatedAt: { $lt: runStart },
  })
})

it('drops the written-since backstop when the run start is unknown', () => {
  expect(cleanupOrphanFilter('run-1', null)).toEqual({
    syncRunId: { $ne: 'run-1' },
    manualEntry: { $ne: true },
  })
})
