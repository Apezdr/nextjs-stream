/**
 * @jest-environment node
 *
 * The server-load sampler times how long each job blocks the event loop, as
 * admin_telemetry.sampler.duration, so SigNoz can compare sampler versions
 * directly. These tests pin the metric's shape, cover a meter provider that
 * registers after the module loads, and check that timing leaves the sampler's
 * own results alone.
 */

const mockRecords = []
const mockHistogramsCreated = []
let mockCurrentProvider

function mockProvider(label) {
  return {
    getMeter: () => ({
      createHistogram: (name, options) => {
        mockHistogramsCreated.push({ label, name, options })
        return { record: (value, attributes) => mockRecords.push({ label, value, attributes }) }
      },
    }),
  }
}

jest.mock('@opentelemetry/api', () => ({
  metrics: { getMeterProvider: () => mockCurrentProvider },
}))

let mockDfCallback
jest.mock('child_process', () => ({
  execFile: jest.fn((_command, _args, _options, callback) => {
    mockDfCallback = callback
  }),
}))

const DF_OUTPUT = [
  'Filesystem     Mounted on  1B-blocks  Used  Avail Use%',
  '/dev/sdb1      /mnt/media     1000GB 500GB  500GB  50%',
].join('\n')

let signalListenersBefore

function loadSampler() {
  signalListenersBefore = {
    SIGINT: process.listeners('SIGINT'),
    SIGTERM: process.listeners('SIGTERM'),
  }
  let sampler
  jest.isolateModules(() => {
    sampler = require('@src/utils/monitor_server_load')
  })
  return sampler
}

const recordsFor = (job) => mockRecords.filter((record) => record.attributes.job === job)

beforeEach(() => {
  // Real performance.now(), so recorded durations are genuine measurements.
  jest.useFakeTimers({ doNotFake: ['performance'] })
  mockRecords.length = 0
  mockHistogramsCreated.length = 0
  mockDfCallback = undefined
  mockCurrentProvider = mockProvider('sdk')
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  // The module registers shutdown handlers that call process.exit().
  for (const signal of ['SIGINT', 'SIGTERM']) {
    for (const listener of process.listeners(signal)) {
      if (!signalListenersBefore[signal].includes(listener)) process.removeListener(signal, listener)
    }
  }
})

test('times the first tick and the df spawn as soon as the sampler starts', () => {
  loadSampler()

  for (const job of ['tick', 'disk_spawn']) {
    const [record] = recordsFor(job)
    expect(record).toBeDefined()
    expect(record.attributes).toEqual({ job })
    expect(Number.isFinite(record.value)).toBe(true)
    expect(record.value).toBeGreaterThanOrEqual(0)
  }
})

test('times every 3 s tick', () => {
  loadSampler()

  jest.advanceTimersByTime(9000)

  expect(recordsFor('tick')).toHaveLength(4)
})

test('times parsing df output and still parses it', () => {
  const sampler = loadSampler()

  mockDfCallback(null, DF_OUTPUT)

  expect(recordsFor('disk_parse')).toHaveLength(1)
  expect(sampler.getDiskStats()).toEqual([
    expect.objectContaining({ mountpoint: '/mnt/media', size: 1000, percent: 50, isHealthDrive: true }),
  ])
})

test('records no parse time when df fails', () => {
  loadSampler()

  mockDfCallback(new Error('spawn df ENOENT'), '')

  expect(recordsFor('disk_parse')).toHaveLength(0)
})

test('uses a millisecond histogram with sub-millisecond buckets', () => {
  loadSampler()

  expect(mockHistogramsCreated).toHaveLength(1)
  const [{ name, options }] = mockHistogramsCreated
  expect(name).toBe('admin_telemetry.sampler.duration')
  expect(options.unit).toBe('ms')
  const boundaries = options.advice.explicitBucketBoundaries
  expect(boundaries[0]).toBeLessThan(0.1)
  expect(boundaries).toEqual([...boundaries].sort((a, b) => a - b))
  expect(boundaries.filter((boundary) => boundary < 1).length).toBeGreaterThanOrEqual(4)
  // Production measured the tick at 3-6 ms and the df spawn at 9-13 ms:
  // percentiles there need buckets no wider than 5 ms up to 30 ms.
  const gapsUpTo30 = boundaries
    .filter((boundary) => boundary <= 30)
    .map((boundary, i, list) => (i === 0 ? 0 : boundary - list[i - 1]))
  expect(Math.max(...gapsUpTo30)).toBeLessThanOrEqual(5)
})

test('moves to the real provider when instrumentation registers after the module loads', () => {
  mockCurrentProvider = mockProvider('noop')
  loadSampler()
  mockCurrentProvider = mockProvider('sdk')

  jest.advanceTimersByTime(3000)

  expect(recordsFor('tick').map((record) => record.label)).toEqual(['noop', 'sdk'])
  expect(mockHistogramsCreated.map((histogram) => histogram.label)).toEqual(['noop', 'sdk'])
})
