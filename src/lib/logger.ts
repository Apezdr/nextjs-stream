import pino from 'pino'

// Create the root logger with configurable level
// Note: Don't use pino-pretty transport here - it causes bundling issues with OTel instrumentation
// OpenTelemetry logging is already structured and captured automatically
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
})

/**
 * Create a child logger with a component field for structured logging
 * @param component - The component name (e.g., 'FlatSync', 'AuthDB', 'MediaFetch')
 * @returns A child logger with the component field pre-set
 */
export function createLogger(component: string) {
  return logger.child({ component })
}

/**
 * Helper function to log errors in a consistent, structured way
 * @param log - The logger instance to use
 * @param err - The error to log
 * @param ctx - Additional context fields
 */
export function logError(
  log: pino.Logger,
  err: Error | unknown,
  ctx?: Record<string, any>
) {
  const errorContext = {
    ...ctx,
    err: err instanceof Error ? {
      name: err.name,
      message: err.message,
      stack: err.stack,
    } : err,
  }
  
  log.error(errorContext, 'Operation failed')
}
