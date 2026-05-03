/**
 * ResourceManager - Centralized resource control for the sync architecture
 *
 * Prevents sync operations from hogging system resources by enforcing:
 * - Global HTTP request concurrency limits (via p-limit)
 * - Adaptive batch delays based on memory pressure
 * - Memory usage monitoring with configurable thresholds
 * - Configurable per-batch concurrency for movie processing
 *
 * All limits are configurable via environment variables:
 *   SYNC_CONCURRENCY          – max movies processed in parallel (default: 3)
 *   SYNC_HTTP_CONCURRENCY     – max concurrent outbound HTTP requests (default: 8)
 *   SYNC_BATCH_DELAY_MS       – minimum ms between movie batches (default: 200)
 *   SYNC_MEMORY_THRESHOLD_MB  – heap MB at which throttling kicks in (default: 512)
 *   SYNC_DB_BATCH_SIZE        – max DB writes batched together (default: 25)
 *   SYNC_DB_WRITE_CONCURRENCY – max concurrent bulkWrites per collection (default: 1)
 */

import pLimit from 'p-limit'

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

function envInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const parsed = parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

// ---------------------------------------------------------------------------
// Public configuration (read once, cached)
// ---------------------------------------------------------------------------

export interface ResourceConfig {
  /** Max movies processed concurrently in a single batch */
  syncConcurrency: number
  /** Max outbound HTTP requests across all strategies */
  httpConcurrency: number
  /** Minimum delay (ms) between movie batches */
  batchDelayMs: number
  /** Heap threshold (MB) that triggers adaptive throttling */
  memoryThresholdMb: number
  /** Max DB upserts batched together before flushing */
  dbBatchSize: number
  /** Max concurrent bulkWrite operations per MongoDB collection */
  dbWriteConcurrency: number
}

export function getResourceConfig(): ResourceConfig {
  return {
    syncConcurrency: envInt('SYNC_CONCURRENCY', 15),
    httpConcurrency: envInt('SYNC_HTTP_CONCURRENCY', 20),
    batchDelayMs: envInt('SYNC_BATCH_DELAY_MS', 0),
    memoryThresholdMb: envInt('SYNC_MEMORY_THRESHOLD_MB', 1024),
    dbBatchSize: envInt('SYNC_DB_BATCH_SIZE', 50),
    dbWriteConcurrency: envInt('SYNC_DB_WRITE_CONCURRENCY', 1),
  }
}

// ---------------------------------------------------------------------------
// Resource Manager (singleton)
// ---------------------------------------------------------------------------

export class ResourceManager {
  private static instance: ResourceManager | null = null

  readonly config: ResourceConfig
  /** p-limit instance for outbound HTTP calls */
  readonly httpLimit: ReturnType<typeof pLimit>

  private _activeHttpRequests = 0
  private _totalHttpRequests = 0
  private _peakMemoryMb = 0
  /**
   * Per-collection p-limit gates. Caps concurrent bulkWrite callers on the same
   * MongoDB collection so parallel sync workers don't pile up on the WiredTiger
   * collection-level write lock. Created lazily per collection name.
   */
  private readonly _dbWriteLimits = new Map<string, ReturnType<typeof pLimit>>()

  private constructor(config?: Partial<ResourceConfig>) {
    const defaults = getResourceConfig()
    this.config = { ...defaults, ...config }
    this.httpLimit = pLimit(this.config.httpConcurrency)
    console.log(
      `⚙️  ResourceManager initialised — ` +
      `syncConcurrency=${this.config.syncConcurrency}, ` +
      `httpConcurrency=${this.config.httpConcurrency}, ` +
      `batchDelay=${this.config.batchDelayMs}ms, ` +
      `memoryThreshold=${this.config.memoryThresholdMb}MB, ` +
      `dbBatchSize=${this.config.dbBatchSize}, ` +
      `dbWriteConcurrency=${this.config.dbWriteConcurrency}`
    )
  }

  /** Get (or create) the singleton instance */
  static getInstance(config?: Partial<ResourceConfig>): ResourceManager {
    if (!ResourceManager.instance) {
      ResourceManager.instance = new ResourceManager(config)
    }
    return ResourceManager.instance
  }

  /** Reset the singleton — primarily for testing */
  static resetInstance(): void {
    ResourceManager.instance = null
  }

  // -----------------------------------------------------------------------
  // HTTP concurrency gate
  // -----------------------------------------------------------------------

  /**
   * Wrap any async function that makes an outbound HTTP request so it
   * respects the global concurrency limit.
   *
   * Usage:
   *   const data = await resourceManager.throttleHttp(() => fetch(url))
   */
  async throttleHttp<T>(fn: () => Promise<T>): Promise<T> {
    return this.httpLimit(async () => {
      this._activeHttpRequests++
      this._totalHttpRequests++
      try {
        return await fn()
      } finally {
        this._activeHttpRequests--
      }
    })
  }

  // -----------------------------------------------------------------------
  // Database write concurrency gate
  // -----------------------------------------------------------------------

  /**
   * Get (or lazily create) a p-limit gate for a specific collection's writes.
   * Wrap each `collection.bulkWrite()` so concurrent sync workers can't queue
   * up on the same WiredTiger collection-level write lock. Separate collections
   * get separate limits, so writes to FlatEpisodes and FlatSeasons still run
   * in parallel — only writes to the SAME collection serialize.
   */
  dbWriteLimitFor(collectionName: string): ReturnType<typeof pLimit> {
    let limit = this._dbWriteLimits.get(collectionName)
    if (!limit) {
      limit = pLimit(this.config.dbWriteConcurrency)
      this._dbWriteLimits.set(collectionName, limit)
    }
    return limit
  }

  // -----------------------------------------------------------------------
  // Memory monitoring
  // -----------------------------------------------------------------------

  /** Current heap usage in MB */
  getHeapUsedMb(): number {
    const mb = process.memoryUsage().heapUsed / (1024 * 1024)
    if (mb > this._peakMemoryMb) this._peakMemoryMb = mb
    return Math.round(mb * 10) / 10
  }

  /** True when heap usage exceeds the configured threshold */
  isMemoryPressure(): boolean {
    return this.getHeapUsedMb() > this.config.memoryThresholdMb
  }

  // -----------------------------------------------------------------------
  // Adaptive batch delay
  // -----------------------------------------------------------------------

  /**
   * Returns the delay to wait between batches.
   * Under memory pressure the delay doubles; under extreme pressure it
   * quadruples so the GC gets a chance to reclaim.
   */
  getAdaptiveBatchDelay(): number {
    const heapMb = this.getHeapUsedMb()
    const threshold = this.config.memoryThresholdMb
    const baseDelay = this.config.batchDelayMs

    if (heapMb > threshold * 1.5) {
      // Extreme pressure — quadruple delay and hint to GC
      if (global.gc) {
        try { global.gc() } catch { /* not exposed */ }
      }
      return baseDelay * 4
    }
    if (heapMb > threshold) {
      // Moderate pressure — double delay
      return baseDelay * 2
    }
    return baseDelay
  }

  /**
   * Convenience: sleep for the adaptive batch delay.
   * Call this between processing batches.
   */
  async waitBetweenBatches(): Promise<void> {
    const delay = this.getAdaptiveBatchDelay()
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  // -----------------------------------------------------------------------
  // Observability
  // -----------------------------------------------------------------------

  getStats(): {
    activeHttpRequests: number
    totalHttpRequests: number
    pendingHttpRequests: number
    heapUsedMb: number
    peakHeapMb: number
    isMemoryPressure: boolean
    config: ResourceConfig
  } {
    return {
      activeHttpRequests: this._activeHttpRequests,
      totalHttpRequests: this._totalHttpRequests,
      pendingHttpRequests: this.httpLimit.pendingCount,
      heapUsedMb: this.getHeapUsedMb(),
      peakHeapMb: Math.round(this._peakMemoryMb * 10) / 10,
      isMemoryPressure: this.isMemoryPressure(),
      config: { ...this.config },
    }
  }

  /** Log a concise summary line — useful at the end of each batch */
  logStats(label = 'ResourceManager'): void {
    const s = this.getStats()
    console.log(
      `📊 ${label}: HTTP active=${s.activeHttpRequests} pending=${s.pendingHttpRequests} total=${s.totalHttpRequests} | ` +
      `Heap ${s.heapUsedMb}MB (peak ${s.peakHeapMb}MB) ${s.isMemoryPressure ? '⚠️ PRESSURE' : '✅ OK'}`
    )
  }
}
