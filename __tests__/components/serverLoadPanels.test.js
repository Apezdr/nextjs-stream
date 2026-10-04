/**
 * The admin server-load panels: the overview card (EnhancedServerStats) and
 * the sidebar (MinimalServerStats). Storage comes from the drives each file
 * server reports in system-status; disk activity is measured only while the
 * page is open.
 */

import { render, screen } from '@testing-library/react'

const mockUseSWR = jest.fn()
jest.mock('swr', () => ({ __esModule: true, default: (...args) => mockUseSWR(...args) }))

jest.mock('@src/utils', () => ({
  fetcher: jest.fn(),
  classNames: (...args) => args.flat().filter(Boolean).join(' '),
}))

let mockSystemStatus
jest.mock('@src/contexts/SystemStatusContext', () => ({
  useSystemStatus: () => ({ status: mockSystemStatus }),
}))

const EnhancedServerStats = require('@components/Admin/Stats/EnhancedServerStats').default
const MinimalServerStats = require('@components/Admin/Stats/MinimalServerStats').default
const { buildSparklinePoints } = require('@components/Admin/Stats/TelemetrySparkline')
const { formatBytes, storageFromSystemStatus } = require('@components/Admin/Stats/serverLoadDisplay')

const GIB = 1024 ** 3
const thresholds = {
  cpu: { warn: 50, critical: 80 },
  memory: { warn: 75, critical: 90 },
  disk: { warn: 80, critical: 95 },
}

function payload(overrides = {}) {
  return {
    config: { cpuEnabled: true, memoryEnabled: true, diskEnabled: true, thresholds },
    history: [
      { t: 1, cpu: 10, memory: 40 },
      { t: 2, cpu: 30, memory: 41, diskBusy: 20 },
    ],
    cpu: { percent: 30, logicalCpus: 72, model: 'Intel(R) Xeon(R) CPU E5-2697 v4' },
    memory: { percent: 41, usedBytes: 26 * GIB, totalBytes: 64 * GIB },
    diskIo: { state: 'starting' },
    ...overrides,
  }
}

// Drive entries as the media processor's /api/system-status formats them.
const drive = (mount, use, available = '1.2 TB', size = '8.0 TB') => ({
  fs: '/dev/sdb1',
  type: 'ext4',
  mount,
  size,
  used: '6.8 TB',
  available,
  use: `${use}%`,
})
const fileServer = (serverId, serverName, drives) => ({ serverId, serverName, metrics: { disk: { drives } } })

const withData = (data) => mockUseSWR.mockReturnValue({ data, error: undefined })

beforeEach(() => {
  mockUseSWR.mockReset()
  mockSystemStatus = {
    overall: { level: 'normal' },
    servers: [fileServer('default', 'Default', [drive('/mnt/media', 20), drive('/mnt/media2', 98)])],
  }
})

describe('the overview card', () => {
  test('grades storage by the fullest drive, not an average across drives', () => {
    withData(payload())
    render(<EnhancedServerStats />)

    expect(screen.getByText('Fullest: /mnt/media2 on Default')).toBeInTheDocument()
    expect(screen.getByText('98.0%')).toBeInTheDocument()
    expect(screen.getByText('1.2 TB free of 8.0 TB · 98.0%')).toBeInTheDocument()
    expect(screen.getByText('1.2 TB free of 8.0 TB · 20.0%')).toBeInTheDocument()
    expect(screen.getByText('System under heavy load')).toBeInTheDocument()
  })

  test('shows CPU and memory with a sparkline each', () => {
    withData(payload())
    render(<EnhancedServerStats />)

    expect(screen.getByText('72 logical CPUs · Intel(R) Xeon(R) CPU E5-2697 v4')).toBeInTheDocument()
    expect(screen.getByText('26.0 GiB of 64.0 GiB in use')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'CPU usage over the last 60 seconds' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Memory usage over the last 60 seconds' })).toBeInTheDocument()
  })

  test('says so when no file server has reported its drives yet', () => {
    mockSystemStatus = { servers: [] }
    withData(payload())
    render(<EnhancedServerStats />)

    expect(screen.getByText('No drive report from the file servers yet. It refreshes every 30 seconds.')).toBeInTheDocument()
    expect(screen.getByText('System running optimally')).toBeInTheDocument()
  })

  test('labels each file server when there are several', () => {
    mockSystemStatus = {
      servers: [
        fileServer('default', 'Default', [drive('/mnt/media', 40)]),
        fileServer('server2', 'Server 2', [drive('/srv/library', 60)]),
      ],
    }
    withData(payload())
    render(<EnhancedServerStats />)

    expect(screen.getByText('Default')).toBeInTheDocument()
    expect(screen.getByText('Server 2')).toBeInTheDocument()
    expect(screen.getByText('Fullest: /srv/library on Server 2')).toBeInTheDocument()
  })

  test('shows "Measuring…" until disk activity has two readings, then per-disk rates', () => {
    withData(payload())
    const { rerender } = render(<EnhancedServerStats />)
    expect(screen.getByText('Measuring…')).toBeInTheDocument()

    withData(
      payload({
        diskIo: {
          state: 'active',
          disks: [
            { device: 'sda', readBytesPerSec: 1024000, writeBytesPerSec: 2048000, busyPercent: 50 },
            { device: 'sdb', readBytesPerSec: 0, writeBytesPerSec: 0, busyPercent: 2.5 },
          ],
        },
      })
    )
    rerender(<EnhancedServerStats />)

    expect(screen.queryByText('Measuring…')).not.toBeInTheDocument()
    expect(screen.getByText('busy, sda')).toBeInTheDocument()
    expect(screen.getByText('Read 1000 KiB/s')).toBeInTheDocument()
    expect(screen.getByText('Write 2.0 MiB/s')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'sdb' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /Busiest disk/ })).toBeInTheDocument()
  })

  test('leaves out metrics that are turned off', () => {
    const data = payload({ config: { cpuEnabled: false, memoryEnabled: true, diskEnabled: false, thresholds } })
    delete data.cpu
    delete data.diskIo
    withData(data)
    render(<EnhancedServerStats />)

    expect(screen.queryByText('CPU')).not.toBeInTheDocument()
    expect(screen.queryByText('Storage')).not.toBeInTheDocument()
    expect(screen.queryByText('Disk activity')).not.toBeInTheDocument()
    expect(screen.getByText('Memory')).toBeInTheDocument()
  })

  test('leaves out disk activity where the host cannot measure it', () => {
    withData(payload({ diskIo: { state: 'unavailable' } }))
    render(<EnhancedServerStats />)

    expect(screen.queryByText('Disk activity')).not.toBeInTheDocument()
  })
})

describe('the sidebar', () => {
  test('shows CPU, memory and the fullest drive', () => {
    withData(payload())
    render(<MinimalServerStats />)

    expect(screen.getByText('30%')).toBeInTheDocument()
    expect(screen.getByText('26/64 GiB')).toBeInTheDocument()
    expect(screen.getByText('98%')).toBeInTheDocument()
    expect(screen.getByTitle('Fullest drive: /mnt/media2 on Default')).toBeInTheDocument()
  })

  test('leaves out disk when no file server has reported drives', () => {
    mockSystemStatus = { servers: [{ serverId: 'default', serverName: 'Default', level: 'unknown' }] }
    withData(payload())
    render(<MinimalServerStats />)

    expect(screen.queryByText('Disk')).not.toBeInTheDocument()
  })
})

describe('helpers', () => {
  test('sparkline points scale to 100 and skip missing samples', () => {
    expect(buildSparklinePoints([0, null, 50, 100], { maxValue: 100 })).toBe('0.0,32.0 60.0,16.0 120.0,0.0')
    expect(buildSparklinePoints([null, undefined])).toBe('')
  })

  test('storage ignores servers without drive data and drives without a usable percentage', () => {
    const storage = storageFromSystemStatus(
      {
        servers: [
          { serverId: 'server3', serverName: 'Server 3', level: 'unknown' },
          fileServer('default', 'Default', [drive('/mnt/media', 85), { mount: '/broken', use: 'n/a' }]),
        ],
      },
      thresholds.disk
    )

    expect(storage.servers).toEqual([
      { serverId: 'default', label: 'Default', drives: [{ mount: '/mnt/media', percent: 85, available: '1.2 TB', size: '8.0 TB' }] },
    ])
    expect(storage.worst).toMatchObject({ mount: '/mnt/media', serverLabel: 'Default' })
    expect(storage.level).toBe('high')
  })

  test('formatBytes uses binary units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1.5 KiB')
    expect(formatBytes(26 * GIB)).toBe('26.0 GiB')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})
