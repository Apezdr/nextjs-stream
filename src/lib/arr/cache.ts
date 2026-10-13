// src/lib/arr/cache.ts
// A short-lived answer per key, and one load in flight per key, so a page of
// watchlist cards (or two admin tabs) asking at once costs Radarr/Sonarr one
// request. Failures are never kept: the next caller asks again. Dropping a key
// (after a write) also drops its in-flight load, so the next caller cannot be
// handed an answer that predates the write.

export interface TtlCache<T> {
  get(key: string, load: () => Promise<T>): Promise<T>
  delete(key: string): void
  clear(): void
}

export function createTtlCache<T>(ttlMs: number, maxEntries = 500): TtlCache<T> {
  const values = new Map<string, { at: number; value: T }>()
  const inFlight = new Map<string, Promise<T>>()

  return {
    get(key, load) {
      const hit = values.get(key)
      if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value)
      const pending = inFlight.get(key)
      if (pending) return pending

      const request: Promise<T> = load().then((value) => {
        // Kept only if nothing dropped this key while it loaded.
        if (inFlight.get(key) === request) {
          if (values.size >= maxEntries) values.delete(values.keys().next().value as string)
          values.set(key, { at: Date.now(), value })
        }
        return value
      })
      inFlight.set(key, request)
      const settle = () => {
        if (inFlight.get(key) === request) inFlight.delete(key)
      }
      request.then(settle, settle)
      return request
    },
    delete(key) {
      values.delete(key)
      inFlight.delete(key)
    },
    clear() {
      values.clear()
      inFlight.clear()
    },
  }
}

/** Runs `task` over `items`, at most `limit` at a time, keeping the order. */
export async function mapWithConcurrency<I, O>(items: I[], limit: number, task: (item: I) => Promise<O>): Promise<O[]> {
  const results = new Array<O>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}
