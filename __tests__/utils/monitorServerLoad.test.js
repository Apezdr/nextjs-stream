jest.mock('child_process', () => ({
  execFile: jest.fn(),
}))

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const ENV_KEYS = [
  'SERVER_LOAD_CPU_ENABLED',
  'SERVER_LOAD_MEMORY_ENABLED',
  'SERVER_LOAD_DISK_ENABLED',
  'SERVER_LOAD_NETWORK_ENABLED',
  'SERVER_LOAD_GPU_ENABLED',
  'SERVER_GPU_INVENTORY',
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
  process.env.SERVER_LOAD_NETWORK_ENABLED = 'false'
  process.env.SERVER_LOAD_GPU_ENABLED = 'false'
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
  const { execFile } = require('child_process')
  execFile.mockClear()
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
    const { execFile } = require('child_process')

    const monitor = loadMonitor()

    expect(monitor.monitorConfig).toMatchObject({
      cpuEnabled: false,
      memoryEnabled: false,
      diskEnabled: false,
      networkEnabled: false,
      gpuEnabled: false,
    })
    expect(setIntervalSpy).not.toHaveBeenCalled()
    expect(processOnSpy).not.toHaveBeenCalled()
    expect(execFile).not.toHaveBeenCalled()

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

  it('parses average Linux CPU clock speed when Node reports zero under WSL', () => {
    disableAllMetrics()
    const monitor = loadMonitor()

    expect(monitor._parseProcCpuClockMHz([
      'processor : 0',
      'cpu MHz : 3000.000',
      'processor : 1',
      'cpu MHz : 3200.000',
    ].join('\n'))).toBe(3100)
  })

  it('reads supported CPU hwmon temperatures and ignores unrelated sensors', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cpu-temperature-'))
    const write = (relativePath, value) => {
      const filePath = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, String(value))
    }
    write('hwmon/hwmon0/name', 'coretemp')
    write('hwmon/hwmon0/temp1_input', '54000')
    write('hwmon/hwmon1/name', 'amdgpu')
    write('hwmon/hwmon1/temp1_input', '89000')

    expect(monitor._readCpuTemperature(root)).toBe(54)
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('parses CPU vendor, sockets, cores, logical processors, and virtualization', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const fixture = [
      'processor : 0\nvendor_id : GenuineIntel\nphysical id : 0\ncore id : 0\nflags : vmx sse',
      'processor : 1\nvendor_id : GenuineIntel\nphysical id : 0\ncore id : 0\nflags : vmx sse',
      'processor : 2\nvendor_id : GenuineIntel\nphysical id : 0\ncore id : 1\nflags : vmx sse',
    ].join('\n\n')
    expect(monitor._parseCpuTopology(fixture)).toEqual({
      vendor: 'Intel',
      sockets: 1,
      physicalCores: 2,
      logicalThreads: 3,
      virtualization: 'Intel VT-x',
    })
  })

  it('parses Task Manager-style Linux memory counters as bytes', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    expect(monitor._parseMeminfoBytes('MemTotal: 1024 kB\nCached: 256 kB\nCommitted_AS: 512 kB'))
      .toEqual({ MemTotal: 1048576, Cached: 262144, Committed_AS: 524288 })
  })

  it('calculates network rates from monotonic interface counter deltas', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const previous = monitor._parseNetworkDev([
      'Inter-| Receive | Transmit',
      ' face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed',
      ' eth0: 1000000 0 0 0 0 0 0 0 2000000 0 0 0 0 0 0 0',
      ' lo: 999 0 0 0 0 0 0 0 999 0 0 0 0 0 0 0',
    ].join('\n'))
    const current = monitor._parseNetworkDev([
      'Inter-| Receive | Transmit',
      ' face |bytes packets errs drop fifo frame compressed multicast|bytes packets errs drop fifo colls carrier compressed',
      ' eth0: 4000000 0 0 0 0 0 0 0 5000000 0 0 0 0 0 0 0',
    ].join('\n'))

    const [rate] = monitor._calculateNetworkRates(previous, current, 3)

    expect(rate).toMatchObject({ name: 'eth0', rxMbps: 8, txMbps: 8, totalMbps: 16 })
    expect(previous.has('lo')).toBe(false)
  })

  it('clamps network counter resets instead of reporting negative throughput', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const previous = new Map([['eth0', { rxBytes: 1000, txBytes: 1000 }]])
    const current = new Map([['eth0', { rxBytes: 10, txBytes: 20 }]])

    expect(monitor._calculateNetworkRates(previous, current, 1)[0]).toMatchObject({
      rxMbps: 0,
      txMbps: 0,
      totalMbps: 0,
    })
  })

  it('calculates disk read, write, and utilization rates from monotonic sector counters', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const options = {
      sectorSizeFor: () => 512,
      hasSlaves: () => false,
      hardwareFor: () => ({ type: 'SSD', model: 'Test SSD', vendor: 'Test' }),
    }
    const previous = monitor._parseDiskStats(
      '8 0 sda 10 0 100 0 20 0 200 0 0 100 100\n7 0 loop0 1 0 10 0 0 0 0 0 0 0 0',
      options
    )
    const current = monitor._parseDiskStats(
      '8 0 sda 20 0 1100 0 40 0 2200 0 0 600 600',
      options
    )

    expect(monitor._calculateDiskIoRates(previous, current, 2)).toEqual([
      expect.objectContaining({
        name: 'sda',
        readBytesPerSecond: 256000,
        writeBytesPerSecond: 512000,
        utilizationPct: 25,
        includeInTotals: true,
        hardwareType: 'SSD',
        model: 'Test SSD',
      }),
    ])
    expect(previous.has('loop0')).toBe(false)
  })

  it('clamps disk counter resets instead of reporting negative throughput', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const options = {
      sectorSizeFor: () => 512,
      hasSlaves: () => false,
      hardwareFor: () => ({ type: 'Unknown' }),
    }
    const previous = monitor._parseDiskStats('8 0 sda 1 0 100 0 1 0 100 0 0 100 100', options)
    const current = monitor._parseDiskStats('8 0 sda 1 0 10 0 1 0 10 0 0 10 10', options)

    expect(monitor._calculateDiskIoRates(previous, current, 1)[0]).toMatchObject({
      readBytesPerSecond: 0,
      writeBytesPerSecond: 0,
      utilizationPct: 0,
    })
  })

  it.each([
    [{ name: 'nvme0n1', rotational: '1', model: 'Controller' }, 'NVMe'],
    [{ name: 'sda', rotational: '0', model: 'Samsung SSD' }, 'SSD'],
    [{ name: 'sdb', rotational: '1', model: 'WDC HDD' }, 'HDD'],
    [{ name: 'sdc', rotational: '1', model: 'Msft Virtual Disk' }, 'Virtual'],
    [{ name: 'sdd', rotational: null, model: '' }, 'Unknown'],
  ])('classifies block hardware %p as %s', (input, expected) => {
    disableAllMetrics()
    const monitor = loadMonitor()
    expect(monitor._classifyDiskHardware(input)).toBe(expected)
  })

  it('keeps only the newest bounded telemetry history points', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const history = [1, 2, 3]

    expect(monitor._appendBoundedHistory(history, 4, 3)).toEqual([2, 3, 4])
    expect(history).toEqual([1, 2, 3])
  })

  it('parses multi-GPU utilization, memory, temperature, and names', () => {
    disableAllMetrics()
    const monitor = loadMonitor()

    expect(monitor._parseNvidiaSmiOutput(
      '0, NVIDIA RTX 4090, 62, 47, 12000, 24564\r\n1, NVIDIA RTX 3060, 81, 96, 4000, 12288\r\n'
    )).toEqual([
      expect.objectContaining({
        index: 0,
        name: 'NVIDIA RTX 4090',
        temperatureC: 62,
        utilizationPct: 47,
        status: 'normal',
      }),
      expect.objectContaining({
        index: 1,
        name: 'NVIDIA RTX 3060',
        temperatureC: 81,
        utilizationPct: 96,
        status: 'critical',
      }),
    ])
  })

  it('merges configured GPUs hidden by Docker without duplicating detected devices', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const inventory = monitor._parseConfiguredGpuInventory(JSON.stringify([
      { vendor: 'Intel', name: 'Intel(R) UHD Graphics 770' },
      { vendor: 'NVIDIA', name: 'NVIDIA RTX 4090' },
    ]))
    const merged = monitor._mergeConfiguredGpuInventory([
      { index: 0, vendor: 'NVIDIA', name: 'NVIDIA RTX 4090', utilizationPct: 25 },
    ], inventory)

    expect(merged).toHaveLength(2)
    expect(merged[1]).toMatchObject({
      vendor: 'Intel',
      name: 'Intel(R) UHD Graphics 770',
      utilizationPct: null,
      temperatureC: null,
      source: 'configured-inventory',
    })
  })

  it('runs one bounded nvidia-smi probe with a fixed argument list', () => {
    process.env.SERVER_LOAD_CPU_ENABLED = 'false'
    process.env.SERVER_LOAD_MEMORY_ENABLED = 'false'
    process.env.SERVER_LOAD_DISK_ENABLED = 'false'
    process.env.SERVER_LOAD_NETWORK_ENABLED = 'false'
    process.env.SERVER_LOAD_GPU_ENABLED = 'true'
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue({})
    const { execFile } = require('child_process')
    execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, '0, NVIDIA RTX 4090, 60, 25, 2048, 24564\n')
    })

    const monitor = loadMonitor()

    expect(execFile).toHaveBeenCalledWith(
      expect.stringMatching(/nvidia-smi(?:\.exe)?$/),
      [
        '--query-gpu=index,name,temperature.gpu,utilization.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits',
      ],
      expect.objectContaining({ timeout: 2000, killSignal: 'SIGKILL', shell: false }),
      expect.any(Function)
    )
    expect(monitor.getGpuStats()).toMatchObject({
      state: 'available',
      devices: [expect.objectContaining({ name: 'NVIDIA RTX 4090' })],
    })
    setIntervalSpy.mockRestore()
  })

  it('reports a missing NVIDIA tool as unavailable instead of healthy zero utilization', () => {
    process.env.SERVER_LOAD_CPU_ENABLED = 'false'
    process.env.SERVER_LOAD_MEMORY_ENABLED = 'false'
    process.env.SERVER_LOAD_DISK_ENABLED = 'false'
    process.env.SERVER_LOAD_NETWORK_ENABLED = 'false'
    process.env.SERVER_LOAD_GPU_ENABLED = 'true'
    const setIntervalSpy = jest.spyOn(global, 'setInterval').mockReturnValue({})
    const { execFile } = require('child_process')
    execFile.mockImplementation((_command, _args, _options, callback) => {
      callback(Object.assign(new Error('missing'), { code: 'ENOENT' }), '')
    })

    const monitor = loadMonitor()

    expect(monitor.getGpuStats()).toMatchObject({
      state: 'unavailable',
      reason: 'tool-missing',
      devices: [],
    })
    setIntervalSpy.mockRestore()
  })

  it('reads AMD and Intel DRM devices without dropping partial telemetry', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drm-telemetry-'))
    const write = (relativePath, value) => {
      const filePath = path.join(root, relativePath)
      fs.mkdirSync(path.dirname(filePath), { recursive: true })
      fs.writeFileSync(filePath, String(value))
    }

    write('card0/device/vendor', '0x1002')
    write('card0/device/device', '0x2684')
    write('card0/device/product_name', 'AMD Radeon RX 7900 XTX')
    write('card0/device/gpu_busy_percent', '42')
    write('card0/device/mem_info_vram_used', String(8 * 1024 * 1024 * 1024))
    write('card0/device/mem_info_vram_total', String(24 * 1024 * 1024 * 1024))
    write('card0/device/hwmon/hwmon0/temp1_input', '67000')

    write('card1/device/vendor', '0x8086')
    write('card1/device/device', '0x56a0')
    write('card1/device/product_name', 'Intel Arc A770')
    write('card1/device/hwmon/hwmon1/temp1_input', '51000')

    expect(monitor._readDrmGpuStats(root)).toEqual([
      expect.objectContaining({
        vendor: 'AMD',
        name: 'AMD Radeon RX 7900 XTX',
        utilizationPct: 42,
        temperatureC: 67,
        memoryUsedMiB: 8192,
        memoryTotalMiB: 24576,
        source: 'drm-sysfs',
      }),
      expect.objectContaining({
        vendor: 'Intel',
        name: 'Intel Arc A770',
        utilizationPct: null,
        temperatureC: 51,
        status: 'normal',
        source: 'drm-sysfs',
      }),
    ])

    fs.rmSync(root, { recursive: true, force: true })
  })

  it('follows card symlinks from the DRM class directory', () => {
    disableAllMetrics()
    const monitor = loadMonitor()
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drm-symlink-'))
    const cardTarget = path.join(root, 'devices', 'card2')
    fs.mkdirSync(path.join(cardTarget, 'device'), { recursive: true })
    fs.writeFileSync(path.join(cardTarget, 'device', 'vendor'), '0x8086')
    fs.writeFileSync(path.join(cardTarget, 'device', 'product_name'), 'Intel Integrated Graphics')
    fs.symlinkSync(cardTarget, path.join(root, 'card2'), 'junction')

    expect(monitor._readDrmGpuStats(root)).toEqual([
      expect.objectContaining({
        index: 2,
        vendor: 'Intel',
        name: 'Intel Integrated Graphics',
        source: 'drm-sysfs',
      }),
    ])

    fs.rmSync(root, { recursive: true, force: true })
  })
})
