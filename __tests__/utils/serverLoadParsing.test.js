/**
 * @jest-environment node
 *
 * Parsing for the server-load sampler, fed text shaped like the production
 * host's /proc files (72 CPUs, sda-sde whole disks with partitions, LVM
 * device-mapper volumes and snap loop devices).
 */

import {
  computeDiskIo,
  parseDiskStats,
  parseFlag,
  parseMemAvailableBytes,
  parseProcStatCpu,
  parseThreshold,
  resolveThresholdPair,
} from '@src/utils/serverLoadParsing'

const PROC_STAT = [
  'cpu  4705356 1206 2304523 296131486 61833 0 39813 0 0 0',
  'cpu0 65537 18 32003 4112963 860 0 553 0 0 0',
  'cpu1 65310 15 31977 4113276 829 0 1201 0 0 0',
  'intr 1140356711 9 0 0 0 0 0 0 0 1 0 0 0 0',
  'ctxt 2150738331',
].join('\n')

// major minor name, then reads, reads merged, sectors read, ms reading,
// writes, writes merged, sectors written, ms writing, in flight, io ms,
// weighted io ms (newer kernels append discard/flush fields).
const diskLine = (name, sectorsRead, sectorsWritten, ioTicksMs) =>
  `   8       0 ${name} 100 0 ${sectorsRead} 500 200 0 ${sectorsWritten} 900 0 ${ioTicksMs} 1400 0 0 0 0 0 0`

describe('parseProcStatCpu', () => {
  test('sums the same fields os.cpus() reports (iowait, softirq and steal excluded)', () => {
    // user + nice + system + idle + irq
    expect(parseProcStatCpu(PROC_STAT)).toEqual({
      idle: 296131486,
      total: 4705356 + 1206 + 2304523 + 296131486 + 0,
    })
  })

  test('rejects text that does not start with the aggregate cpu line', () => {
    expect(parseProcStatCpu('cpu0 1 2 3 4 5 6')).toBeNull()
    expect(parseProcStatCpu('')).toBeNull()
    expect(parseProcStatCpu('cpu  1 2 x 4 5 6')).toBeNull()
    expect(parseProcStatCpu(undefined)).toBeNull()
  })
})

describe('parseMemAvailableBytes', () => {
  test('reads MemAvailable, not MemFree', () => {
    const meminfo = 'MemTotal:       65752660 kB\nMemFree:         4718664 kB\nMemAvailable:   31834232 kB\n'
    expect(parseMemAvailableBytes(meminfo)).toBe(31834232 * 1024)
  })

  test('returns null when MemAvailable is missing', () => {
    expect(parseMemAvailableBytes('MemTotal: 1 kB\n')).toBeNull()
  })
})

describe('parseDiskStats', () => {
  const text = [
    diskLine('loop0', 50, 0, 7),
    diskLine('sdc', 10492378908, 28017521656, 99484131),
    diskLine('sdc1', 10492365420, 28017521656, 110224068),
    diskLine('nvme0n1', 10, 20, 30),
    diskLine('nvme0n1p1', 10, 20, 30),
    diskLine('mmcblk0', 1, 2, 3),
    diskLine('mmcblk0p1', 1, 2, 3),
    diskLine('dm-0', 4029454394, 729990648, 14508244),
    '   8      33 short 1 2 3',
  ].join('\n')

  test('keeps whole disks and drops partitions, device-mapper and loop devices', () => {
    expect([...parseDiskStats(text).keys()]).toEqual(['sdc', 'nvme0n1', 'mmcblk0'])
  })

  test('reads sectors read, sectors written and time spent doing I/O', () => {
    expect(parseDiskStats(text).get('sdc')).toEqual({
      readSectors: 10492378908,
      writeSectors: 28017521656,
      ioTicksMs: 99484131,
    })
  })
})

describe('computeDiskIo', () => {
  const before = parseDiskStats([diskLine('sda', 1000, 2000, 10000), diskLine('sdb', 0, 0, 0)].join('\n'))

  test('turns counter deltas into bytes per second and percent busy', () => {
    // 3 s apart: 6000 sectors read and 12000 written on sda, busy 1500 ms.
    const after = parseDiskStats([diskLine('sda', 7000, 14000, 11500), diskLine('sdb', 0, 0, 0)].join('\n'))
    expect(computeDiskIo(before, after, 3000)).toEqual([
      { device: 'sda', readBytesPerSec: (6000 * 512) / 3, writeBytesPerSec: (12000 * 512) / 3, busyPercent: 50 },
      { device: 'sdb', readBytesPerSec: 0, writeBytesPerSec: 0, busyPercent: 0 },
    ])
  })

  test('caps busy time at 100% and treats counters that went backwards as idle', () => {
    const after = parseDiskStats(diskLine('sda', 10, 20, 99999))
    const [sda] = computeDiskIo(before, after, 3000)
    expect(sda).toMatchObject({ readBytesPerSec: 0, writeBytesPerSec: 0, busyPercent: 100 })
  })

  test('skips disks without a previous reading, and reports nothing without a baseline', () => {
    const after = parseDiskStats(diskLine('sdz', 1, 1, 1))
    expect(computeDiskIo(before, after, 3000)).toEqual([])
    expect(computeDiskIo(null, after, 3000)).toEqual([])
    expect(computeDiskIo(before, after, 0)).toEqual([])
  })
})

describe('flags and thresholds', () => {
  test.each([
    [undefined, true],
    ['', true],
    ['true', true],
    ['yes', true],
    ['false', false],
    ['FALSE', false],
    ['0', false],
    ['off', false],
    [' no ', false],
  ])('parseFlag(%p) is %p', (value, expected) => {
    expect(parseFlag(value)).toBe(expected)
  })

  test.each([
    ['75', 75],
    [' 90 ', 90],
    ['0', 0],
    ['100', 100],
    ['101', 50],
    ['75%', 50],
    ['7.5', 50],
    ['-5', 50],
    [undefined, 50],
  ])('parseThreshold(%p) is %p', (value, expected) => {
    expect(parseThreshold(value, 50)).toBe(expected)
  })

  test('a pair whose warning is not below its critical value falls back as a whole', () => {
    const fallback = { warn: 50, critical: 80 }
    expect(resolveThresholdPair('75', '90', fallback)).toEqual({ warn: 75, critical: 90 })
    expect(resolveThresholdPair('90', '90', fallback)).toEqual(fallback)
    expect(resolveThresholdPair('95', undefined, fallback)).toEqual(fallback)
    expect(resolveThresholdPair('60', undefined, fallback)).toEqual({ warn: 60, critical: 80 })
  })
})
