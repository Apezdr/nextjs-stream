/**
 * A task the server runs as it starts (instrumentation.ts register()): once
 * per process, since register() can run again in development, and retried
 * with backoff until a run succeeds, since Mongo can still be starting when
 * the server does. Never throws, and its timers never keep the process alive.
 */

const FIRST_RETRY_MS = 5_000
const MAX_RETRY_MS = 5 * 60_000

export type Schedule = (retry: () => void, ms: number) => void

const defaultSchedule: Schedule = (retry, ms) => {
  setTimeout(retry, ms).unref?.()
}

export function runStartupTaskOnce(
  key: symbol,
  run: () => Promise<unknown>,
  onFailure: (error: unknown, retryInMs: number) => void,
  schedule: Schedule = defaultSchedule
): void {
  const store = globalThis as typeof globalThis & Record<symbol, boolean | undefined>
  if (store[key]) return
  store[key] = true

  const attempt = (delayMs: number) => {
    run().catch((error) => {
      onFailure(error, delayMs)
      schedule(() => attempt(Math.min(delayMs * 2, MAX_RETRY_MS)), delayMs)
    })
  }
  attempt(FIRST_RETRY_MS)
}
