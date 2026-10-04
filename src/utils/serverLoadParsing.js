// Pure parsing for the server-load sampler (monitor_server_load.js). No I/O
// here, so the tests can feed it real /proc text.

/**
 * Aggregate CPU times from the first line of /proc/stat.
 *
 * Mirrors what os.cpus() reports (libuv keeps user, nice, sys, idle and irq
 * and drops iowait, softirq and steal), so the CPU percentage keeps its
 * meaning. One read of /proc/stat replaces os.cpus(), which also collects
 * per-core model and clock data and cost ~2.9 ms per call on the 72-CPU
 * production host, against ~0.2 ms for the read.
 *
 * @param {string} text - contents of /proc/stat
 * @returns {{ idle: number, total: number } | null}
 */
function parseProcStatCpu(text) {
  if (typeof text !== 'string' || !text.startsWith('cpu ')) return null
  const end = text.indexOf('\n')
  const fields = text.slice(4, end === -1 ? undefined : end).trim().split(/\s+/).map(Number)
  if (fields.length < 6 || fields.slice(0, 6).some((n) => !Number.isFinite(n))) return null
  const [user, nice, system, idle, , irq] = fields // index 4 is iowait
  return { idle, total: user + nice + system + idle + irq }
}

/**
 * MemAvailable from /proc/meminfo, in bytes. MemFree (what os.freemem()
 * returns) excludes reclaimable page cache, so a server with a warm disk
 * cache would read as nearly full.
 *
 * @param {string} text - contents of /proc/meminfo
 * @returns {number | null}
 */
function parseMemAvailableBytes(text) {
  const match = /^MemAvailable:\s+(\d+)\s+kB/m.exec(text ?? '')
  return match ? Number(match[1]) * 1024 : null
}

// Whole disks only: partitions (sda1, nvme0n1p1) and device-mapper volumes
// (dm-0) carry the same I/O again, and loop devices are snap images.
const WHOLE_DISK = /^(?:sd[a-z]+|hd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/

/**
 * Per-disk counters from /proc/diskstats.
 *
 * @param {string} text - contents of /proc/diskstats
 * @returns {Map<string, { readSectors: number, writeSectors: number, ioTicksMs: number }>}
 */
function parseDiskStats(text) {
  const disks = new Map()
  for (const line of (text ?? '').split('\n')) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 14 || !WHOLE_DISK.test(fields[2])) continue
    disks.set(fields[2], {
      readSectors: Number(fields[5]),
      writeSectors: Number(fields[9]),
      ioTicksMs: Number(fields[12]),
    })
  }
  return disks
}

// /proc/diskstats counts sectors in 512-byte units whatever the device's own
// sector size is.
const DISKSTATS_SECTOR_BYTES = 512

/**
 * Per-disk throughput and busy time between two /proc/diskstats readings.
 *
 * @param {ReturnType<typeof parseDiskStats>} previous
 * @param {ReturnType<typeof parseDiskStats>} current
 * @param {number} elapsedMs
 * @returns {{ device: string, readBytesPerSec: number, writeBytesPerSec: number, busyPercent: number }[]}
 */
function computeDiskIo(previous, current, elapsedMs) {
  if (!previous || !(elapsedMs > 0)) return []
  const seconds = elapsedMs / 1000
  // A counter that went backwards means the device was re-attached; treat it
  // as no activity rather than reporting a negative rate.
  const delta = (now, before) => Math.max(0, now - before)
  const disks = []
  for (const [device, now] of current) {
    const before = previous.get(device)
    if (!before) continue
    disks.push({
      device,
      readBytesPerSec: (delta(now.readSectors, before.readSectors) * DISKSTATS_SECTOR_BYTES) / seconds,
      writeBytesPerSec: (delta(now.writeSectors, before.writeSectors) * DISKSTATS_SECTOR_BYTES) / seconds,
      busyPercent: Math.min(100, (delta(now.ioTicksMs, before.ioTicksMs) / elapsedMs) * 100),
    })
  }
  return disks.sort((a, b) => a.device.localeCompare(b.device))
}

const OFF_VALUES = new Set(['false', '0', 'off', 'no'])

/** A metric is on unless its flag is explicitly false, 0, off or no. */
function parseFlag(value) {
  return !OFF_VALUES.has(String(value ?? '').trim().toLowerCase())
}

/** A whole-number percentage from 0 to 100, or the fallback. */
function parseThreshold(value, fallback) {
  if (typeof value !== 'string' || !/^\s*\d{1,3}\s*$/.test(value)) return fallback
  const percent = Number(value)
  return percent <= 100 ? percent : fallback
}

/**
 * A warn/critical pair. A warning at or above the critical level would make
 * one of the two unreachable, so such a pair falls back as a whole.
 */
function resolveThresholdPair(warnValue, criticalValue, fallback) {
  const warn = parseThreshold(warnValue, fallback.warn)
  const critical = parseThreshold(criticalValue, fallback.critical)
  return warn < critical ? { warn, critical } : { warn: fallback.warn, critical: fallback.critical }
}

module.exports = {
  parseProcStatCpu,
  parseMemAvailableBytes,
  parseDiskStats,
  computeDiskIo,
  parseFlag,
  parseThreshold,
  resolveThresholdPair,
}
