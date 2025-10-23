/**
 * Performance-optimized logger with level controls for sync operations
 * Reduces console logging overhead that can block the event loop
 */

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

class SyncLogger {
  private level: LogLevel = LogLevel.INFO
  private logCount = 0
  private lastLogTime = 0
  private readonly LOG_RATE_LIMIT = 100 // max logs per second

  constructor() {
    // Set log level from environment variable
    const envLevel = process.env.SYNC_LOG_LEVEL?.toUpperCase()
    switch (envLevel) {
      case 'ERROR':
        this.level = LogLevel.ERROR
        break
      case 'WARN':
        this.level = LogLevel.WARN
        break
      case 'INFO':
        this.level = LogLevel.INFO
        break
      case 'DEBUG':
        this.level = LogLevel.DEBUG
        break
      default:
        this.level = LogLevel.INFO
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level
  }

  private shouldLog(level: LogLevel): boolean {
    // Check log level
    if (level > this.level) {
      return false
    }

    // Rate limiting to prevent console spam
    const now = Date.now()
    if (now - this.lastLogTime < 1000) {
      // Same second - check rate limit
      if (this.logCount >= this.LOG_RATE_LIMIT) {
        return false
      }
      this.logCount++
    } else {
      // New second - reset counter
      this.logCount = 1
      this.lastLogTime = now
    }

    return true
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.ERROR)) {
      console.error(`🔴 [SYNC]`, message, ...args)
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.WARN)) {
      console.warn(`🟡 [SYNC]`, message, ...args)
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`🔵 [SYNC]`, message, ...args)
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`⚪ [SYNC]`, message, ...args)
    }
  }

  // Performance-critical logging (always rate limited)
  progress(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.INFO)) {
      console.log(`📈 [SYNC]`, message, ...args)
    }
  }

  batch(message: string, ...args: any[]): void {
    if (this.shouldLog(LogLevel.DEBUG)) {
      console.log(`📦 [SYNC]`, message, ...args)
    }
  }

  // Utility for performance measurements
  time(label: string): void {
    if (this.level >= LogLevel.DEBUG) {
      console.time(`⏱️ [SYNC] ${label}`)
    }
  }

  timeEnd(label: string): void {
    if (this.level >= LogLevel.DEBUG) {
      console.timeEnd(`⏱️ [SYNC] ${label}`)
    }
  }

  getStats(): {
    level: LogLevel
    logCount: number
    rateLimited: boolean
  } {
    return {
      level: this.level,
      logCount: this.logCount,
      rateLimited: this.logCount >= this.LOG_RATE_LIMIT
    }
  }
}

// Export singleton instance
export const syncLogger = new SyncLogger()

// Convenience functions
export const logError = syncLogger.error.bind(syncLogger)
export const logWarn = syncLogger.warn.bind(syncLogger)
export const logInfo = syncLogger.info.bind(syncLogger)
export const logDebug = syncLogger.debug.bind(syncLogger)
export const logProgress = syncLogger.progress.bind(syncLogger)
export const logBatch = syncLogger.batch.bind(syncLogger)