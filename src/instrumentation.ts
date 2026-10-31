import { registerOTel } from '@vercel/otel'
import { metrics, type Attributes, type Span, type TextMapPropagator } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core'
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-http'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { registerInstrumentations } from '@opentelemetry/instrumentation'
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino'
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node'
import { detectResources, envDetector, resourceFromAttributes } from '@opentelemetry/resources'
import { BatchLogRecordProcessor, LoggerProvider } from '@opentelemetry/sdk-logs'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'

declare global {
  // Prevent double-init in dev / hot reload
  var __otelStarted: boolean | undefined
}

// Which build is running: the image's Docker Hub tag and the commit it was
// built from, baked in by build.ps1 (Dockerfile ARG APP_VERSION, GIT_COMMIT).
// SigNoz marks a deployment each time service.version changes. Unset (a dev
// server, a plain `docker build`), no version is reported.
function buildAttributes(): Attributes {
  const attributes: Attributes = {}
  if (process.env.APP_VERSION) attributes[ATTR_SERVICE_VERSION] = process.env.APP_VERSION
  if (process.env.GIT_COMMIT) attributes['vcs.ref.head.revision'] = process.env.GIT_COMMIT
  return attributes
}

// Logs and metrics carry the resource @vercel/otel gives traces: service.name,
// node.env and process.runtime.name, with OTEL_RESOURCE_ATTRIBUTES
// (service.namespace, deployment.environment) merged over them by the same env
// detector. Without it, SigNoz showed the pino logs and the runtime metrics
// with service.name alone.
function buildResource(serviceName: string) {
  const attributes: Attributes = {
    [ATTR_SERVICE_NAME]: serviceName,
    'process.runtime.name': 'nodejs',
    ...buildAttributes(),
  }
  if (process.env.NODE_ENV) attributes['node.env'] = process.env.NODE_ENV
  return resourceFromAttributes(attributes).merge(detectResources({ detectors: [envDetector] }))
}

// @vercel/otel bundles its own @opentelemetry/core (2.1.0), and its baggage
// propagator from that copy parses an incoming `baggage` header with no size
// limit (GHSA-8988-4f7v-96qf, fixed in core 2.8.0). It uses an explicit
// `propagators` list over OTEL_PROPAGATORS, so the propagators are built here,
// from the patched core, with OTEL_PROPAGATORS read as the spec defines it
// (default "tracecontext,baggage").
function propagatorsFromEnv(): TextMapPropagator[] {
  const names = (process.env.OTEL_PROPAGATORS || 'tracecontext,baggage')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  if (names.includes('none')) return []
  return names.map((name) => {
    switch (name) {
      case 'tracecontext':
        return new W3CTraceContextPropagator()
      case 'baggage':
        return new W3CBaggagePropagator()
      default:
        throw new Error(`OTEL_PROPAGATORS: unsupported propagator "${name}" (use tracecontext, baggage or none)`)
    }
  })
}

// instrumentation-mongodb emits only the stable database conventions
// (db.system.name, db.namespace, db.operation.name), but SigNoz still reads the
// deprecated keys: its span metrics count a database call only when the span
// has db.system (the service's Database Calls tab), and its trace index fills
// the DB system, name and operation columns from db.system, db.name and
// db.operation. This copies each stable value to its old key as the span starts.
// Remove it once SigNoz reads db.system.name.
const DEPRECATED_DB_KEYS: [stable: string, deprecated: string][] = [
  ['db.system.name', 'db.system'],
  ['db.namespace', 'db.name'],
  ['db.operation.name', 'db.operation'],
]

const signozDbKeysProcessor = {
  onStart(span: Span & { attributes: Attributes }) {
    const { attributes } = span
    if (attributes['db.system.name'] === undefined) return
    for (const [stable, deprecated] of DEPRECATED_DB_KEYS) {
      const value = attributes[stable]
      if (value !== undefined && attributes[deprecated] === undefined) span.setAttribute(deprecated, value)
    }
  },
  onEnd() {},
  forceFlush: () => Promise.resolve(),
  shutdown: () => Promise.resolve(),
}

function startOtelLogs(serviceName: string) {
  // Uses OTEL_EXPORTER_OTLP_ENDPOINT / OTEL_EXPORTER_OTLP_HEADERS automatically
  // (SigNoz documents this behavior for OTLP log exporter)
  const loggerProvider = new LoggerProvider({
    resource: buildResource(serviceName),
    processors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],
  })

  logs.setGlobalLoggerProvider(loggerProvider)
}

function startOtelMetrics(serviceName: string) {
  // Reads OTEL_EXPORTER_OTLP_ENDPOINT / _HEADERS automatically. It always sends
  // OTLP/JSON: OTEL_EXPORTER_OTLP_PROTOCOL only picks the trace exporter's encoding.
  const meterProvider = new MeterProvider({
    resource: buildResource(serviceName),
    readers: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter(),
        // 15s gives fast feedback while leak-hunting; bump to 60s
        // once stable if cardinality cost is a concern
        exportIntervalMillis: 15_000,
      }),
    ],
  })

  metrics.setGlobalMeterProvider(meterProvider)
}

export function register() {
  if (globalThis.__otelStarted) return
  // OTEL_SDK_DISABLED=true turns every signal off. @vercel/otel only checks it
  // for traces; without this the logs and metrics below would still export.
  if (process.env.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true') return
  // Read before anything starts: an OTEL_PROPAGATORS value this can't build
  // fails the boot, as @vercel/otel's own parser would
  const propagators = propagatorsFromEnv()
  globalThis.__otelStarted = true

  // The same rule @vercel/otel applies to traces
  const serviceName = process.env.OTEL_SERVICE_NAME || 'nextjs-stream'

  // The log and meter providers go first. The metrics API has no proxy
  // provider: an instrumentation registered before setGlobalMeterProvider keeps
  // a no-op meter for good, which is how MongoDB's connection metrics went
  // missing when registerOTel() ran first.
  startOtelLogs(serviceName)
  startOtelMetrics(serviceName)

  registerOTel({
    serviceName,
    attributes: buildAttributes(),
    // Use "auto" to let @vercel/otel configure the best exporter based on environment variables
    // This will automatically use OTEL_EXPORTER_OTLP_ENDPOINT and other OTEL env vars
    traceExporter: 'auto',
    propagators,
    spanProcessors: ['auto', signozDbKeysProcessor],
    instrumentations: [
      'fetch',
      new MongoDBInstrumentation({
        // Record query shapes, not values: with this on, db.query.text carried
        // every value verbatim, including the better-auth session token of each
        // session lookup, so SigNoz held live credentials. Off, every value is
        // '?' while keys and operators stay readable.
        enhancedDatabaseReporting: false,
      }),
    ],
  })

  registerInstrumentations({
    instrumentations: [
      // Hook Pino so each logger.* call becomes an OTel LogRecord,
      // and correlation fields can be attached when trace context exists
      new PinoInstrumentation(),
      // Emits v8js.memory.heap.used, v8js.memory.heap.space.size,
      // v8js.gc.duration, nodejs.eventloop.delay.*, nodejs.eventloop.utilization, etc.
      new RuntimeNodeInstrumentation(),
    ],
  })
}
