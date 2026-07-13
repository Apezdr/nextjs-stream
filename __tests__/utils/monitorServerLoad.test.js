jest.mock('child_process', () => ({
  execSync: jest.fn(),
}))

const ENV_KEYS = [
  'SERVER_LOAD_CPU_ENABLED',
  'SERVER_LOAD_MEMORY_ENABLED',
  'SERVER_LOAD_DISK_ENABLED',
  'SERVER_LOAD_WARN_THRESHOLD',
  'SERVER_LOAD_CRITICAL_THRESHOLD',
  'SERVER_LOAD_CPU_WARN_THRESHOLD',
  'SERVER_LOAD_CPU_CRITICAL_THRESHOLD',
  'SERVER_LOAD_MEMORY_WARN_THRESHOLD',
  'SERVER_LOAD_MEMORY_CRITICAL_THRESHOLD',
  'SERVER_LOAD_DISK_WARN_THRESHOLD',
  'SERVER_LOAD_DISK_CRITICAL_THRESHOLD',
]

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

function disableAllMetrics() {
  process.env.SERVER_LOAD_CPU_ENABLED = 'false'
  process.env.SERVER_LOAD_MEMORY_ENABLED = '0'
  process.env.SERVER_LOAD_DISK_ENABLED = 'off'
}

function loadMonitor() {
  let monitor
  jest.isolateModules(() => {
    monitor = require('@src/utils/monitor_server_load')
  })
  return monitor
}

beforeEach(() => {
  jest.resetModules()
  const { execSync } = require('child_process')
  execSync.mockClear()
  for (const key of ENV_KEYS) delete process.env[key]
})

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

describe('server load monitoring configuration', () => {
  it('does not schedule or sample metrics that are all disabled', () => {
    disableAllMetrics()
    const setIntervalSpy = jest.spyOn(global, 'setInterval')
    const processOnSpy = jest.spyOn(process, 'on')
    const { execSync } = require('child_process')

    const monitor = loadMonitor()

    expect(monitor.monitorConfig).toMatchObject({
      cpuEnabled: false,
      memoryEnabled: false,
      diskEnabled: false,
    })
    expect(setIntervalSpy).not.toHaveBeenCalled()
    expect(processOnSpy).not.toHaveBeenCalled()
    expect(execSync).not.toHaveBeenCalled()

    setIntervalSpy.mockRestore()
    processOnSpy.mockRestore()
  })

  it('accepts valid global and per-metric threshold pairs', () => {
    disableAllMetrics()
    process.env.SERVER_LOAD_WARN_THRESHOLD = '60'
    process.env.SERVER_LOAD_CRITICAL_THRESHOLD = '90'
    process.env.SERVER_LOAD_MEMORY_WARN_THRESHOLD = '75'
    process.env.SERVER_LOAD_MEMORY_CRITICAL_THRESHOLD = '95'

    const { monitorConfig } = loadMonitor()

    expect(monitorConfig).toMatchObject({
      warnThreshold: 60,
      criticalThreshold: 90,
      cpu: { warnThreshold: 60, criticalThreshold: 90 },
      memory: { warnThreshold: 75, criticalThreshold: 95 },
      disk: { warnThreshold: 60, criticalThreshold: 90 },
    })
  })

  it('falls back safely when warning and critical thresholds are equal or inverted', () => {
    disableAllMetrics()
    process.env.SERVER_LOAD_WARN_THRESHOLD = '90'
    process.env.SERVER_LOAD_CRITICAL_THRESHOLD = '80'
    process.env.SERVER_LOAD_CPU_WARN_THRESHOLD = '70'
    process.env.SERVER_LOAD_CPU_CRITICAL_THRESHOLD = '70'

    const { monitorConfig } = loadMonitor()

    expect(monitorConfig).toMatchObject({
      warnThreshold: 50,
      criticalThreshold: 80,
      cpu: { warnThreshold: 50, criticalThreshold: 80 },
    })
  })
})
