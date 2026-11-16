// src/lib/scheduledDeletions.ts
// The automatic part of account deletion: a check the server runs on itself,
// shortly after it starts and then once an hour (instrumentation.ts).
//
// Each check
// - reminds, in the app, the accounts whose deletion is DELETION_REMINDER_DAYS
//   away or less (once each), and
// - carries out the requests that are due: a request a user made while signed
//   in, DELETION_GRACE_DAYS after it was made. Never a request from the public
//   form (nobody verified its address) and never one an admin has to decide:
//   accountDeletion.js isDueForAutomaticRun is the rule.
//
// The timer is only a heartbeat. What is due, and how far a deletion got, is
// in the database on each request, so a restart or a missed hour delays a
// deletion and never loses one; a deletion that stops part-way is taken up by
// the next check (up to MAX_AUTOMATIC_ATTEMPTS, then it waits for an admin).
// A request is held by one run at a time (its runLeaseUntil), so two server
// processes, or this check and an admin, cannot both delete the same account.
//
// It lives in the app's own process because the app is one long-running Node
// server. On hosting where no process stays alive between requests this file
// would never tick: the check (runScheduledDeletions) would then need calling
// from outside, on a schedule.
import { createLogger } from './logger'
import {
  claimDeletionReminders,
  DeletionNotStarted,
  executeAccountDeletion,
  getDeletionsDueForAutomaticRun,
} from '@src/utils/accountDeletion'
import {
  sendDeletionCompletionNotification,
  sendDeletionFailureNotification,
  sendDeletionReminder,
} from '@src/utils/deletionEmailService'

const log = createLogger('AccountDeletion.Scheduled')

/** After the server starts: late enough for Mongo to be answering, soon enough that a restart loop still gets to it. */
export const FIRST_CHECK_MS = 60_000

/** Between checks. A request is carried out within this long of its date. */
export const CHECK_EVERY_MS = 60 * 60_000

const STARTED = Symbol.for('nextjs_stream.scheduledDeletionsStarted')
const RUNNING = Symbol.for('nextjs_stream.scheduledDeletionsRunning')

type Store = typeof globalThis & Record<symbol, boolean | undefined>

export type CheckSummary = {
  /** Accounts reminded of their date */
  reminded: number
  /** Accounts deleted */
  deleted: number
  /** Deletions that stopped part-way: the next check takes them up */
  failed: number
  /** True when another check was still running, and this one did nothing */
  skipped: boolean
}

const messageOf = (error: unknown) => (error as Error)?.message ?? String(error)

/** A notification that fails is logged: it does not undo, or fail, what it reports. */
async function notify(what: string, requestId: string, send: () => Promise<unknown>): Promise<void> {
  try {
    await send()
  } catch (error) {
    log.error({ requestId, error: messageOf(error) }, `Could not send the notification: ${what}`)
  }
}

/**
 * One check. Never throws: whatever fails is logged (ids only, never an
 * email address) and left for the next check.
 */
export async function runScheduledDeletions(now: Date = new Date()): Promise<CheckSummary> {
  const store = globalThis as Store
  const summary: CheckSummary = { reminded: 0, deleted: 0, failed: 0, skipped: false }
  // A check still running when the next is due: let it finish
  if (store[RUNNING]) return { ...summary, skipped: true }
  store[RUNNING] = true

  try {
    try {
      for (const request of await claimDeletionReminders(now)) {
        const requestId = String(request._id)
        await notify('a deletion reminder', requestId, () => sendDeletionReminder(String(request.userId), request))
        summary.reminded += 1
      }
    } catch (error) {
      log.error({ error: messageOf(error) }, 'The deletion reminders could not be read; the next check tries again')
    }

    let due: Array<{ _id: unknown; email: string }> = []
    try {
      due = await getDeletionsDueForAutomaticRun(now)
    } catch (error) {
      log.error({ error: messageOf(error) }, 'The deletions that are due could not be read; the next check tries again')
      return summary
    }

    for (const request of due) {
      const requestId = String(request._id)
      try {
        const { deletionResults } = await executeAccountDeletion(requestId, null, { automatic: true })
        summary.deleted += 1
        log.info({ requestId }, 'An account was deleted automatically: its request had waited its full time')
        await notify('a completed automatic deletion', requestId, () =>
          sendDeletionCompletionNotification(request.email, deletionResults, { automatic: true })
        )
      } catch (error) {
        // Cancelled a moment ago, or being run right now by an admin or
        // another process: nothing was removed by this call, and nothing failed
        if (error instanceof DeletionNotStarted) continue
        summary.failed += 1
        log.error({ requestId, error: messageOf(error) }, 'An automatic account deletion stopped part-way; the next check takes it up')
        await notify('a stopped automatic deletion', requestId, () => sendDeletionFailureNotification(request, error as Error))
      }
    }
  } finally {
    store[RUNNING] = false
  }

  if (summary.reminded > 0 || summary.deleted > 0 || summary.failed > 0) {
    log.info({ ...summary }, 'Scheduled account deletions checked')
  }
  return summary
}

/** How the check is timed. A test hands in its own; the server uses timers that never keep the process alive. */
export type Timers = {
  once: (run: () => void, ms: number) => void
  every: (run: () => void, ms: number) => void
}

const serverTimers: Timers = {
  once: (run, ms) => {
    setTimeout(run, ms).unref?.()
  },
  every: (run, ms) => {
    setInterval(run, ms).unref?.()
  },
}

/**
 * Start the checks: once per process, however often Next calls register()
 * (it can run again in development).
 */
export function startScheduledDeletions(timers: Timers = serverTimers): void {
  const store = globalThis as Store
  if (store[STARTED]) return
  store[STARTED] = true

  const check = () => {
    void runScheduledDeletions()
  }
  timers.once(check, FIRST_CHECK_MS)
  timers.every(check, CHECK_EVERY_MS)
}
