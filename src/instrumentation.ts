import { registerOTel } from '@vercel/otel'
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
import { logs } from '@opentelemetry/api-logs'
import { metrics } from '@opentelemetry/api'
import { LoggerProvider, BatchLogRecordProcessor } from '@opentelemetry/sdk-logs'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

declare global {
  // Prevent double-init in dev / hot reload
  // eslint-disable-next-line no-var
  var __otelLogsStarted: boolean | undefined
  // eslint-disable-next-line no-var
  var __otelMetricsStarted: boolean | undefined
}

function buildResource() {
  return resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'nextjs-stream',
  })
}

function startOtelLogsOnce() {
  if (globalThis.__otelLogsStarted) return
  globalThis.__otelLogsStarted = true

  // Uses OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS automatically
  // (SigNoz documents this behavior for OTLP log exporter)
  const logExporter = new OTLPLogExporter()

  const loggerProvider = new LoggerProvider({
    resource: buildResource(),
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
}

function startOtelMetricsOnce() {
  if (globalThis.__otelMetricsStarted) return
  globalThis.__otelMetricsStarted = true

  // Reads OTEL_EXPORTER_OTLP_ENDPOINT / _PROTOCOL / _HEADERS automatically,
  // same as the trace and log exporters
  const metricExporter = new OTLPMetricExporter()

  const meterProvider = new MeterProvider({
    resource: buildResource(),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: metricExporter,
        // 15s gives fast feedback while leak-hunting; bump to 60s
        // once stable if cardinality cost is a concern
        exportIntervalMillis: 15_000,
      }),
    ],
  })

  metrics.setGlobalMeterProvider(meterProvider)

  // Emits v8js.memory.heap.used, v8js.gc.duration,
  // nodejs.eventloop.delay.*, nodejs.eventloop.utilization, etc.
  registerInstrumentations({
    instrumentations: [new RuntimeNodeInstrumentation()],
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
  startOtelMetricsOnce()
}
