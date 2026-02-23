import pino from 'pino'

// Create the root logger with configurable level
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  // For production, use JSON format (structured)
  // For development, you can optionally use pretty-print
  ...(process.env.NODE_ENV === 'development' && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
      },
    },
  }),
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