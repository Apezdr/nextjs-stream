/**
 * When the watch-history validation runs.
 *
 * The app must never show a user a watch-history item for something that is no
 * longer in it. The lists that show history join each row against the catalog
 * as they read it (getFlatRecentlyWatchedForUser hydrates every row from the
 * Flat* documents a list may show, and a row that finds none is dropped), so a
 * removed title is never drawn. `isValid` is what those lists page and count on
 * (and what decides whether the Recently Watched row is offered at all): the
 * validation (run/watchHistoryValidation) brings it in line with the catalog.
 *
 * It has two jobs, and runs for each:
 *
 *  1. Media was removed. Run right after anything removes media: after a full
 *     pass (post-sync cleanup's deletes, and the pass's own removals — a video
 *     a server no longer has), and after an admin delete. A skipped tick
 *     changed nothing in the library, so it has nothing to validate for this.
 *  2. A row was wrongly marked invalid. The player marks a row invalid when its
 *     HEAD request fails, a network blip included, and only the validation
 *     marks it valid again. That needs no tick of its own: it runs with every
 *     full pass, and on a skipped tick once REVALIDATE_INTERVAL_MS have passed
 *     since the last validation finished (validateWatchHistoryIfDue).
 *
 * Runs never overlap. A request that arrives while one is running waits for it
 * and then runs once more, because the running one may have read the catalog
 * before the change that prompted the request; any number of requests made
 * during one run share that one follow-up.
 */

import { createLogger } from '@src/lib/logger'
import { validateWatchHistoryAgainstDatabase } from './watchHistoryValidation'

/** A skipped tick validates only when the last validation finished at least this long ago. */
export const REVALIDATE_INTERVAL_MS = 15 * 60 * 1000

/**
 * Kept on globalThis: the sync route, the admin actions and the admin API are
 * separate bundles in one process, and they must share one schedule.
 */
function state() {
  globalThis.__watchHistoryValidationState ??= { running: null, followUp: null, lastFinishedAt: 0 }
  return globalThis.__watchHistoryValidationState
}

function start(s, reason) {
  const log = createLogger('FlatSync.WatchHistoryValidation')
  const run = (async () => {
    const startedAt = Date.now()
    try {
      const results = await validateWatchHistoryAgainstDatabase()
      log.info({ reason, durationMs: Date.now() - startedAt }, 'WatchHistory validation run finished')
      return results
    } catch (error) {
      log.error({ reason, err: error?.message }, 'WatchHistory validation run failed')
      return { error: error?.message ?? String(error) }
    } finally {
      s.lastFinishedAt = Date.now()
    }
  })()
  s.running = run
  run.then(() => {
    if (s.running === run) s.running = null
  })
  return run
}

/**
 * Validate watch history against the catalog now (or right after the run in
 * progress). Never throws: a failure is logged and returned as `{ error }`.
 *
 * @param {string} reason - What prompted it, for the log ('full pass', 'admin delete', ...)
 * @returns {Promise<Object>} The validation's results
 */
export function validateWatchHistory(reason) {
  const s = state()
  if (!s.running) return start(s, reason)
  s.followUp ??= s.running.then(() => {
    s.followUp = null
    return start(s, reason)
  })
  return s.followUp
}

/**
 * The skipped tick's check: validate when none has finished for
 * REVALIDATE_INTERVAL_MS and none is running.
 *
 * @param {number} [now]
 * @returns {Promise<Object|null>} The validation's results, or null when it was not due
 */
export async function validateWatchHistoryIfDue(now = Date.now()) {
  const s = state()
  if (s.running || now - s.lastFinishedAt < REVALIDATE_INTERVAL_MS) return null
  return validateWatchHistory('restore timer')
}
