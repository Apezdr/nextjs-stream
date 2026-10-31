/**
 * @jest-environment node
 *
 * src/instrumentation.ts: the OpenTelemetry bootstrap. @vercel/otel is mocked,
 * so registerOTel() only records the configuration it was handed; the log and
 * meter providers are the real SDK ones, exporting to in-memory exporters.
 */

const mockRegisterOTel = jest.fn()
jest.mock('@vercel/otel', () => ({ registerOTel: (config) => mockRegisterOTel(config) }))

const mockExportedLogs = []
jest.mock('@opentelemetry/exporter-logs-otlp-http', () => ({
  OTLPLogExporter: class {
    export(records, done) {
      mockExportedLogs.push(...records)
      done({ code: 0 })
    }
    forceFlush() {
      return Promise.resolve()
    }
    shutdown() {
      return Promise.resolve()
    }
  },
}))

const mockExportedMetrics = []
jest.mock('@opentelemetry/exporter-metrics-otlp-http', () => ({
  OTLPMetricExporter: class {
    export(resourceMetrics, done) {
      mockExportedMetrics.push(resourceMetrics)
      done({ code: 0 })
    }
    forceFlush() {
      return Promise.resolve()
    }
    shutdown() {
      return Promise.resolve()
    }
  },
}))

import { metrics } from '@opentelemetry/api'
import { logs } from '@opentelemetry/api-logs'
import { W3CBaggagePropagator, W3CTraceContextPropagator } from '@opentelemetry/core'
import { MongoDBInstrumentation } from '@opentelemetry/instrumentation-mongodb'
import { LoggerProvider } from '@opentelemetry/sdk-logs'
import { MeterProvider } from '@opentelemetry/sdk-metrics'
import { register } from '@src/instrumentation'

const ENV_KEYS = ['OTEL_PROPAGATORS', 'OTEL_RESOURCE_ATTRIBUTES', 'OTEL_SDK_DISABLED', 'OTEL_SERVICE_NAME']
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

function registeredConfig() {
  expect(mockRegisterOTel).toHaveBeenCalledTimes(1)
  return mockRegisterOTel.mock.calls[0][0]
}

beforeEach(() => {
  globalThis.__otelStarted = undefined
  mockRegisterOTel.mockReset()
  mockExportedLogs.length = 0
  mockExportedMetrics.length = 0
  for (const key of ENV_KEYS) delete process.env[key]
})

afterEach(async () => {
  await metrics.getMeterProvider().shutdown?.()
  await logs.getLoggerProvider().shutdown?.()
  metrics.disable()
  logs.disable()
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('provider order', () => {
  it('sets the global log and meter providers before registerOTel runs', () => {
    let providersAtRegistration
    mockRegisterOTel.mockImplementation(() => {
      providersAtRegistration = { meter: metrics.getMeterProvider(), logger: logs.getLoggerProvider() }
    })

    register()

    // An instrumentation built before setGlobalMeterProvider keeps a no-op
    // meter: the metrics API has no proxy provider.
    expect(providersAtRegistration.meter).toBeInstanceOf(MeterProvider)
    expect(providersAtRegistration.logger).toBeInstanceOf(LoggerProvider)
    expect(registeredConfig().instrumentations).toEqual(['fetch', expect.any(MongoDBInstrumentation)])
  })

  it('starts once, however often Next calls register()', () => {
    register()
    register()

    expect(mockRegisterOTel).toHaveBeenCalledTimes(1)
  })

  it('starts nothing when OTEL_SDK_DISABLED is true', () => {
    process.env.OTEL_SDK_DISABLED = 'TRUE'

    register()

    expect(mockRegisterOTel).not.toHaveBeenCalled()
    expect(metrics.getMeterProvider()).not.toBeInstanceOf(MeterProvider)
    expect(logs.getLoggerProvider()).not.toBeInstanceOf(LoggerProvider)
  })
})

describe('resource', () => {
  it('gives logs and metrics the attributes traces get, OTEL_RESOURCE_ATTRIBUTES included', async () => {
    process.env.OTEL_SERVICE_NAME = 'nextjs-stream-test'
    process.env.OTEL_RESOURCE_ATTRIBUTES = 'service.namespace=nextjs-stream,service.version=test-build,deployment.environment=test'

    register()

    logs.getLogger('test').emit({ body: 'hello' })
    await logs.getLoggerProvider().forceFlush()
    metrics.getMeter('test').createCounter('test.count').add(1)
    await metrics.getMeterProvider().forceFlush()

    const expected = {
      'service.name': 'nextjs-stream-test',
      'service.namespace': 'nextjs-stream',
      'service.version': 'test-build',
      'deployment.environment': 'test',
      'process.runtime.name': 'nodejs',
      'node.env': 'test',
    }
    expect(mockExportedLogs).toHaveLength(1)
    expect(mockExportedLogs[0].resource.attributes).toMatchObject(expected)
    expect(mockExportedMetrics.at(-1).resource.attributes).toMatchObject(expected)
    expect(registeredConfig().serviceName).toBe('nextjs-stream-test')
  })
})

describe('propagators', () => {
  it('defaults to tracecontext and baggage, built from the patched @opentelemetry/core', () => {
    register()

    const { propagators } = registeredConfig()
    expect(propagators).toHaveLength(2)
    expect(propagators[0]).toBeInstanceOf(W3CTraceContextPropagator)
    expect(propagators[1]).toBeInstanceOf(W3CBaggagePropagator)
  })

  it('follows OTEL_PROPAGATORS', () => {
    process.env.OTEL_PROPAGATORS = ' tracecontext '

    register()

    const { propagators } = registeredConfig()
    expect(propagators).toHaveLength(1)
    expect(propagators[0]).toBeInstanceOf(W3CTraceContextPropagator)
  })

  it('propagates nothing for "none"', () => {
    process.env.OTEL_PROPAGATORS = 'none'

    register()

    expect(registeredConfig().propagators).toEqual([])
  })

  it('refuses a propagator it cannot build', () => {
    process.env.OTEL_PROPAGATORS = 'tracecontext,b3'

    expect(() => register()).toThrow('unsupported propagator "b3"')
    // Nothing started: no provider, no tracer
    expect(mockRegisterOTel).not.toHaveBeenCalled()
    expect(metrics.getMeterProvider()).not.toBeInstanceOf(MeterProvider)
    expect(logs.getLoggerProvider()).not.toBeInstanceOf(LoggerProvider)
  })
})

describe('SigNoz database keys', () => {
  function startSpan(attributes) {
    register()
    const [auto, processor] = registeredConfig().spanProcessors
    expect(auto).toBe('auto')
    const span = { attributes: { ...attributes }, setAttribute: jest.fn() }
    processor.onStart(span)
    return span
  }

  it('copies the stable database attributes to the keys SigNoz reads', () => {
    const span = startSpan({
      'db.system.name': 'mongodb',
      'db.namespace': 'Media',
      'db.operation.name': 'find',
      'db.collection.name': 'FlatMovies',
    })

    expect(span.setAttribute.mock.calls).toEqual([
      ['db.system', 'mongodb'],
      ['db.name', 'Media'],
      ['db.operation', 'find'],
    ])
  })

  it('leaves spans that are not database calls alone', () => {
    const span = startSpan({ 'http.request.method': 'GET', 'db.namespace': 'not-a-db-span' })

    expect(span.setAttribute).not.toHaveBeenCalled()
  })

  it('keeps a deprecated key a span already carries', () => {
    const span = startSpan({ 'db.system.name': 'mongodb', 'db.system': 'mongodb', 'db.namespace': 'Media' })

    expect(span.setAttribute.mock.calls).toEqual([['db.name', 'Media']])
  })
})
