import { registerOTel } from '@vercel/otel'
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
import { logs } from '@opentelemetry/api-logs'
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'

declare global {
  // Prevent double-init in dev / hot reload
  // eslint-disable-next-line no-var
  var __otelLogsStarted: boolean | undefined
}

function startOtelLogsOnce() {
  if (globalThis.__otelLogsStarted) return
  globalThis.__otelLogsStarted = true

  // Uses OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS automatically
  // (SigNoz documents this behavior for OTLP log exporter)
  const logExporter = new OTLPLogExporter()

  const loggerProvider = new LoggerProvider({
    processors: [new BatchLogRecordProcessor(logExporter)],
  })

  logs.setGlobalLoggerProvider(loggerProvider)

  // Hook Pino so each logger.* call becomes an OTel LogRecord,
  // and correlation fields can be attached when trace context exists
  registerInstrumentations({
    instrumentations: [
      new PinoInstrumentation({
        // optional: tune later
        // disableLogCorrelation: false,
      }),
    ],
  })

  // Flush on shutdown (nice for containers)
  process.on('SIGTERM', async () => {
    try {
      await loggerProvider.shutdown()
    } finally {
      process.exit(0)
    }
  })
}

export function register() {
  registerOTel({
    serviceName: process.env.OTEL_SERVICE_NAME || 'nextjs-stream',
    // Use "auto" to let @vercel/otel configure the best exporter based on environment variables
    // This will automatically use OTEL_EXPORTER_OTLP_ENDPOINT and other OTEL env vars
    traceExporter: 'auto',
    instrumentations: [
      'fetch',
      new MongoDBInstrumentation({
        // keep it conservative; you can tune later
        enhancedDatabaseReporting: true,
      }),
    ],
  })

  startOtelLogsOnce()
}