/**
 * @jest-environment node
 *
 * The server-load sampler on a simulated Linux host: what each tick reads, the
 * on-demand disk activity sampling, the dashboard payload, and the
 * admin_telemetry.sampler.duration jobs SigNoz compares sampler versions on.
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

// /proc as the sampler sees it; tests rewrite entries between ticks.
const mockProc = {}
jest.mock('fs', () => {
  const actual = jest.requireActual('fs')
  return {
    ...actual,
    readFileSync: jest.fn((path, encoding) => {
      if (typeof path === 'string' && path.startsWith('/proc/')) {
        if (!(path in mockProc)) throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' })
        return mockProc[path]
      }
      return actual.readFileSync(path, encoding)
    }),
  }
})

jest.mock('os', () => {
  const actual = jest.requireActual('os')
  return {
    ...actual,
    totalmem: () => 64 * 1024 ** 3,
    availableParallelism: () => 72,
    cpus: jest.fn(() => [
      { model: '  Intel(R) Xeon(R) CPU E5-2697 v4 @ 2.30GHz  ', times: { user: 1, nice: 0, sys: 1, idle: 8, irq: 0 } },
    ]),
  }
})

const fs = require('fs')
const os = require('os')

const GIB = 1024 ** 3
const STATE_KEY = Symbol.for('nextjs-stream.serverLoadSampler')
const REAL_PLATFORM = process.platform
const ENV_KEYS = ['SERVER_LOAD_DISK_ENABLED', 'SERVER_LOAD_DISK_WARN_THRESHOLD', 'SERVER_LOAD_DISK_CRITICAL_THRESHOLD']

const procStat = (busy, idle) => `cpu  ${busy} 0 0 ${idle} 0 0 0 0 0 0\ncpu0 ${busy} 0 0 ${idle} 0 0 0 0 0 0\n`
const meminfo = (availableGiB) => `MemTotal: 67108864 kB\nMemFree: 1024 kB\nMemAvailable: ${availableGiB * 1024 * 1024} kB\n`
const diskLine = (name, sectorsRead, sectorsWritten, ioTicksMs) =>
  `   8   0 ${name} 1 0 ${sectorsRead} 1 1 0 ${sectorsWritten} 1 0 ${ioTicksMs} 1 0 0 0 0 0 0`
const diskstats = (lines) => lines.map((args) => diskLine(...args)).join('\n')

const setPlatform = (value) => Object.defineProperty(process, 'platform', { value, configurable: true })
const recordsFor = (job) => mockRecords.filter((record) => record.attributes.job === job)
const procReads = (path) => fs.readFileSync.mock.calls.filter(([file]) => file === path).length

let signalListenersBefore

function loadSampler({ platform = 'linux', env = {} } = {}) {
  setPlatform(platform)
  Object.assign(process.env, env)
  let sampler
  jest.isolateModules(() => {
    sampler = require('@src/utils/monitor_server_load')
  })
  return sampler
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['performance'] })
  delete globalThis[STATE_KEY]
  mockRecords.length = 0
  mockHistogramsCreated.length = 0
  mockCurrentProvider = mockProvider('sdk')
  for (const key of Object.keys(mockProc)) delete mockProc[key]
  Object.assign(mockProc, {
    '/proc/stat': procStat(1000, 9000),
    '/proc/meminfo': meminfo(48),
    '/proc/diskstats': diskstats([['sda', 1000, 2000, 10000], ['sdb', 0, 0, 0], ['sda1', 1000, 2000, 10000]]),
  })
  fs.readFileSync.mockClear()
  os.cpus.mockClear()
  signalListenersBefore = { SIGINT: process.listenerCount('SIGINT'), SIGTERM: process.listenerCount('SIGTERM') }
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  delete globalThis[STATE_KEY]
  setPlatform(REAL_PLATFORM)
  for (const key of ENV_KEYS) delete process.env[key]
})

describe('each tick', () => {
  test('reads CPU from /proc/stat and calls os.cpus() only once, for the model name', () => {
    const sampler = loadSampler()
    jest.advanceTimersByTime(9000)

    expect(os.cpus).not.toHaveBeenCalled()
    expect(procReads('/proc/stat')).toBe(4)
    const { cpu } = sampler.getServerLoadSnapshot()
    expect(cpu).toMatchObject({ logicalCpus: 72, model: 'Intel(R) Xeon(R) CPU E5-2697 v4 @ 2.30GHz' })
    sampler.getServerLoadSnapshot()
    expect(os.cpus).toHaveBeenCalledTimes(1)
  })

  test('computes CPU percent from consecutive /proc/stat readings', () => {
    const sampler = loadSampler()
    mockProc['/proc/stat'] = procStat(1300, 9700)
    jest.advanceTimersByTime(3000)

    expect(sampler.getServerLoadSnapshot().cpu.percent).toBe(30)
  })

  test('reports memory from MemAvailable', () => {
    const sampler = loadSampler()

    expect(sampler.getServerLoadSnapshot().memory).toEqual({
      percent: 25,
      usedBytes: 16 * GIB,
      totalBytes: 64 * GIB,
    })
  })

  test('times each tick as `tick` and leaves the first, delta-less tick out of the history', () => {
    const sampler = loadSampler()
    expect(recordsFor('tick')).toHaveLength(1)
    expect(sampler.getServerLoadSnapshot().history).toHaveLength(0)

    jest.advanceTimersByTime(3000)

    expect(recordsFor('tick')).toHaveLength(2)
    expect(recordsFor('tick').every((record) => Number.isFinite(record.value) && record.value >= 0)).toBe(true)
    expect(sampler.getServerLoadSnapshot().history).toEqual([
      expect.objectContaining({ t: expect.any(Number), cpu: 0, memory: 25 }),
    ])
  })

  test('keeps 60 seconds of history', () => {
    const sampler = loadSampler()
    jest.advanceTimersByTime(30 * 3000)

    expect(sampler.getServerLoadSnapshot().history).toHaveLength(20)
  })
})

describe('disk activity', () => {
  test('is not sampled until the dashboard polls', () => {
    const sampler = loadSampler()
    jest.advanceTimersByTime(9000)

    expect(procReads('/proc/diskstats')).toBe(0)
    expect(recordsFor('disk_io')).toHaveLength(0)
    expect(sampler.getServerLoadSnapshot().diskIo).toEqual({ state: 'starting' })
  })

  test('starts on the first poll and reports per-disk rates on the next tick', () => {
    const sampler = loadSampler()

    sampler.noteServerLoadDemand()
    expect(recordsFor('disk_io')).toHaveLength(1)
    expect(sampler.getServerLoadSnapshot().diskIo).toEqual({ state: 'starting' })

    // Over the next 3 s: sda reads 6000 sectors, writes 12000, is busy 1500 ms.
    mockProc['/proc/diskstats'] = diskstats([['sda', 7000, 14000, 11500], ['sdb', 0, 0, 0], ['sda1', 7000, 14000, 11500]])
    jest.advanceTimersByTime(3000)

    const { diskIo, history } = sampler.getServerLoadSnapshot()
    expect(diskIo).toEqual({
      state: 'active',
      disks: [
        { device: 'sda', readBytesPerSec: 1024000, writeBytesPerSec: 2048000, busyPercent: 50 },
        { device: 'sdb', readBytesPerSec: 0, writeBytesPerSec: 0, busyPercent: 0 },
      ],
    })
    expect(history.at(-1)).toMatchObject({ diskBusy: 50 })
    expect(recordsFor('disk_io')).toHaveLength(2)
  })

  test('stops a minute after the last poll, and restarts from a fresh baseline', () => {
    const sampler = loadSampler()
    sampler.noteServerLoadDemand()
    jest.advanceTimersByTime(63_000)
    const samplesWhileOpen = recordsFor('disk_io').length

    jest.advanceTimersByTime(60_000)

    expect(recordsFor('disk_io')).toHaveLength(samplesWhileOpen)
    expect(sampler.getServerLoadSnapshot().diskIo).toEqual({ state: 'starting' })

    sampler.noteServerLoadDemand()
    expect(recordsFor('disk_io')).toHaveLength(samplesWhileOpen + 1)
    expect(sampler.getServerLoadSnapshot().diskIo).toEqual({ state: 'starting' })
  })

  test('SERVER_LOAD_DISK_ENABLED=off removes it and never reads /proc/diskstats', () => {
    const sampler = loadSampler({ env: { SERVER_LOAD_DISK_ENABLED: 'off' } })
    sampler.noteServerLoadDemand()
    jest.advanceTimersByTime(9000)

    expect(procReads('/proc/diskstats')).toBe(0)
    const snapshot = sampler.getServerLoadSnapshot()
    expect(snapshot).not.toHaveProperty('diskIo')
    expect(snapshot.config.diskEnabled).toBe(false)
  })
})

describe('the process', () => {
  test('registers no SIGINT or SIGTERM handlers, so Next can drain requests on shutdown', () => {
    loadSampler()

    expect(process.listenerCount('SIGINT')).toBe(signalListenersBefore.SIGINT)
    expect(process.listenerCount('SIGTERM')).toBe(signalListenersBefore.SIGTERM)
  })

  test('replaces the timer when the module is evaluated again (dev reload) instead of stacking it', () => {
    loadSampler()
    loadSampler()
    expect(recordsFor('tick')).toHaveLength(2) // one immediate tick per evaluation

    jest.advanceTimersByTime(3000)

    expect(recordsFor('tick')).toHaveLength(3)
  })

  test('on a non-Linux host falls back to os.cpus() and reports disk activity unavailable', () => {
    const sampler = loadSampler({ platform: 'win32' })
    sampler.noteServerLoadDemand()
    jest.advanceTimersByTime(3000)

    expect(fs.readFileSync.mock.calls.some(([file]) => String(file).startsWith('/proc/'))).toBe(false)
    expect(os.cpus).toHaveBeenCalled()
    expect(sampler.getServerLoadSnapshot().diskIo).toEqual({ state: 'unavailable' })
  })
})

describe('the dashboard payload', () => {
  test('carries the configured thresholds', () => {
    const sampler = loadSampler({
      env: { SERVER_LOAD_DISK_WARN_THRESHOLD: '80', SERVER_LOAD_DISK_CRITICAL_THRESHOLD: '99' },
    })

    expect(sampler.getServerLoadSnapshot().config).toEqual({
      cpuEnabled: true,
      memoryEnabled: true,
      diskEnabled: true,
      thresholds: {
        cpu: { warn: 50, critical: 80 },
        memory: { warn: 50, critical: 80 },
        disk: { warn: 80, critical: 99 },
      },
    })
  })

  test('stays small with full history and several busy disks', () => {
    const disks = (step) =>
      diskstats(['sda', 'sdb', 'sdc', 'sdd', 'sde'].map((name, i) => [name, step * 9000 + i, step * 7000 + i, step * 1500]))
    mockProc['/proc/diskstats'] = disks(0)
    const sampler = loadSampler()
    sampler.noteServerLoadDemand()
    for (let step = 1; step <= 25; step += 1) {
      mockProc['/proc/stat'] = procStat(1000 + step * 123, 9000 + step * 877)
      mockProc['/proc/diskstats'] = disks(step)
      jest.advanceTimersByTime(3000)
      sampler.noteServerLoadDemand()
    }

    const json = JSON.stringify(sampler.getServerLoadSnapshot())
    expect(json.length).toBeLessThan(4096)
  })
})

describe('the sampler cost metric', () => {
  test('uses a millisecond histogram with buckets at most 5 ms apart up to 30 ms', () => {
    loadSampler()

    expect(mockHistogramsCreated).toHaveLength(1)
    const [{ name, options }] = mockHistogramsCreated
    expect(name).toBe('admin_telemetry.sampler.duration')
    expect(options.unit).toBe('ms')
    const boundaries = options.advice.explicitBucketBoundaries
    expect(boundaries[0]).toBeLessThan(0.1)
    expect(boundaries).toEqual([...boundaries].sort((a, b) => a - b))
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
})
