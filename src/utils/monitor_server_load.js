const os = require('os');
const fs = require('fs');
const { execSync } = require('child_process');

// On Linux, os.freemem() returns MemFree, which excludes reclaimable page
// cache and buffers — on a server warming a disk cache this routinely shows
// 90%+ "used" memory that isn't really under pressure. Parse MemAvailable
// from /proc/meminfo instead, falling back to os.freemem() if unavailable
// (Windows, macOS, or read failure).
function readAvailableMemBytes() {
  if (process.platform !== 'linux') return os.freemem();
  try {
    const meminfo = fs.readFileSync('/proc/meminfo', 'utf8');
    const line = meminfo.split('\n').find(l => l.startsWith('MemAvailable:'));
    if (!line) return os.freemem();
    const kb = parseInt(line.split(/\s+/)[1], 10);
    if (Number.isNaN(kb)) return os.freemem();
    return kb * 1024;
  } catch {
    return os.freemem();
  }
}

// Initialize previous CPU times
let previousTotal = 0;
let previousIdle = 0;

// Initialize usage metrics
let cpuUsage = 0;
let memoryUsage = 0;
let memoryUsed = 0;
let memoryTotal = 0;
let diskStats = [];

// System mount points that should NOT trigger health alerts
const SYSTEM_MOUNTS = new Set(['/', '/boot', '/boot/efi', '/run', '/tmp', '/var/lib/docker']);

// Optional: comma-separated mount paths to use for health alerts
// e.g. DISK_HEALTH_PATHS=/var/www/html,/mnt/ssd_media
// If unset, all non-system /dev/* mounts are used for health
const DISK_HEALTH_PATHS = process.env.DISK_HEALTH_PATHS
  ? new Set(process.env.DISK_HEALTH_PATHS.split(',').map(p => p.trim()))
  : null;

// ── Per-metric enable/disable flags ─────────────────────────────────────────
// Set SERVER_LOAD_CPU_ENABLED=false, SERVER_LOAD_MEMORY_ENABLED=false, or
// SERVER_LOAD_DISK_ENABLED=false to suppress that metric from the API response.
function isMetricEnabled(value) {
  if (value === undefined) return true;
  return !['false', '0', 'off', 'no'].includes(String(value).trim().toLowerCase());
}

const CPU_ENABLED    = isMetricEnabled(process.env.SERVER_LOAD_CPU_ENABLED);
const MEMORY_ENABLED = isMetricEnabled(process.env.SERVER_LOAD_MEMORY_ENABLED);
const DISK_ENABLED   = isMetricEnabled(process.env.SERVER_LOAD_DISK_ENABLED);

// ── Alert thresholds ─────────────────────────────────────────────────────────
// Percentages at which the admin panel transitions from "normal" → "warning"
// and "warning" → "critical" colour / badge.
//
// Two levels of granularity:
//   Global (applies to all metrics unless overridden):
//     SERVER_LOAD_WARN_THRESHOLD     (default 50)
//     SERVER_LOAD_CRITICAL_THRESHOLD (default 80)
//
//   Per-metric overrides (fall back to the global value when not set):
//     SERVER_LOAD_CPU_WARN_THRESHOLD / SERVER_LOAD_CPU_CRITICAL_THRESHOLD
//     SERVER_LOAD_MEMORY_WARN_THRESHOLD / SERVER_LOAD_MEMORY_CRITICAL_THRESHOLD
//     SERVER_LOAD_DISK_WARN_THRESHOLD / SERVER_LOAD_DISK_CRITICAL_THRESHOLD
function parseThreshold(envVar, defaultValue) {
  const raw = process.env[envVar];
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return defaultValue;
  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : defaultValue;
}

function resolveThresholdPair(warnEnvVar, criticalEnvVar, fallback) {
  const warnThreshold = parseThreshold(warnEnvVar, fallback.warnThreshold);
  const criticalThreshold = parseThreshold(criticalEnvVar, fallback.criticalThreshold);

  // Equal or inverted levels make the warning state unreachable or misleading.
  // Reject the pair as a unit rather than silently swapping operator intent.
  if (warnThreshold >= criticalThreshold) return fallback;
  return { warnThreshold, criticalThreshold };
}

const DEFAULT_THRESHOLDS = { warnThreshold: 50, criticalThreshold: 80 };
const globalThresholds = resolveThresholdPair(
  'SERVER_LOAD_WARN_THRESHOLD',
  'SERVER_LOAD_CRITICAL_THRESHOLD',
  DEFAULT_THRESHOLDS
);
const WARN_THRESHOLD = globalThresholds.warnThreshold;
const CRITICAL_THRESHOLD = globalThresholds.criticalThreshold;

// Per-metric thresholds (fall back to global)
const cpuThresholds = resolveThresholdPair(
  'SERVER_LOAD_CPU_WARN_THRESHOLD',
  'SERVER_LOAD_CPU_CRITICAL_THRESHOLD',
  globalThresholds
);
const memoryThresholds = resolveThresholdPair(
  'SERVER_LOAD_MEMORY_WARN_THRESHOLD',
  'SERVER_LOAD_MEMORY_CRITICAL_THRESHOLD',
  globalThresholds
);
const diskThresholds = resolveThresholdPair(
  'SERVER_LOAD_DISK_WARN_THRESHOLD',
  'SERVER_LOAD_DISK_CRITICAL_THRESHOLD',
  globalThresholds
);

// Function to aggregate CPU times across all cores
function getCpuTimes() {
  const cpus = os.cpus();

  let user = 0;
  let nice = 0;
  let sys = 0;
  let idle = 0;
  let irq = 0;

  for (let cpu of cpus) {
    user += cpu.times.user;
    nice += cpu.times.nice;
    sys += cpu.times.sys;
    idle += cpu.times.idle;
    irq += cpu.times.irq;
  }

  return { idle, total: user + nice + sys + idle + irq };
}

// Flag to check if initial sampling is done
let initialized = false;

function sampleDisk() {
  try {
    const output = execSync(
      'df -BGB --output=source,target,size,used,avail,pcent 2>/dev/null',
      { timeout: 3000, encoding: 'utf8' }
    );
    diskStats = output.trim().split('\n')
      .slice(1)
      .filter(Boolean)
      .map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 6) return null;
        const [source, mountpoint, sizeRaw, usedRaw, availRaw, pcentRaw] = parts;
        const percent = parseInt(pcentRaw);
        const size = parseInt(sizeRaw);
        const used = parseInt(usedRaw);
        const avail = parseInt(availRaw);
        if (isNaN(percent) || isNaN(size) || size === 0) return null;
        const isHealthDrive = DISK_HEALTH_PATHS
          ? DISK_HEALTH_PATHS.has(mountpoint)
          : !SYSTEM_MOUNTS.has(mountpoint) && source.startsWith('/dev/');
        return { source, mountpoint, size, used, avail, percent, isHealthDrive };
      })
      .filter(Boolean)
      .filter(d => !d.source.startsWith('/dev/loop'))
      .filter(d => d.source.startsWith('/dev/'));
  } catch {
    // df unavailable (Windows dev env) — leave diskStats empty
  }
}

// Sampling function to calculate CPU and Memory usage
function sample() {
  if (CPU_ENABLED) {
    const { idle, total } = getCpuTimes();

    if (initialized) {
      const deltaTotal = total - previousTotal;
      const deltaIdle = idle - previousIdle;

      // Calculate CPU usage percentage
      cpuUsage = deltaTotal ? ((deltaTotal - deltaIdle) / deltaTotal) * 100 : 0;
    } else {
      initialized = true;
    }

    // Update previous CPU times for next sampling
    previousTotal = total;
    previousIdle = idle;
  }

  if (MEMORY_ENABLED) {
    // Calculate Memory usage percentage using MemAvailable on Linux so cached
    // pages aren't counted as "used" — see readAvailableMemBytes() above.
    const totalMemBytes = os.totalmem();
    const availableMemBytes = readAvailableMemBytes();
    const usedMemBytes = totalMemBytes - availableMemBytes;
    memoryUsage = (usedMemBytes / totalMemBytes) * 100;

    // Convert Memory usage from bytes to gigabytes (GB)
    memoryTotal = (totalMemBytes / (1024 ** 3)).toFixed(2); // Total memory in GB
    memoryUsed = (usedMemBytes / (1024 ** 3)).toFixed(2); // Used memory in GB
  }
}

// Start sampling at regular intervals (every 3 seconds)
const samplingInterval = 3000; // 3000ms = 3 seconds
const intervalId = CPU_ENABLED || MEMORY_ENABLED
  ? setInterval(sample, samplingInterval)
  : null;
// Disk changes slowly — sample every 30 seconds
const diskIntervalId = DISK_ENABLED ? setInterval(sampleDisk, 30000) : null;

// Perform an initial sample immediately
if (CPU_ENABLED || MEMORY_ENABLED) sample();
if (DISK_ENABLED) sampleDisk();

// Graceful shutdown to clear the interval when the process exits
function shutdown() {
  if (intervalId) clearInterval(intervalId);
  if (diskIntervalId) clearInterval(diskIntervalId);
  process.exit();
}

if (intervalId || diskIntervalId) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Export the usage metrics
module.exports = {
  /**
   * Get CPU usage percentage.
   * @returns {number} CPU usage rounded to two decimal places.
   */
  getCpuUsage: () => parseFloat(cpuUsage.toFixed(2)),

  /**
   * Get Memory usage percentage.
   * @returns {number} Memory usage rounded to two decimal places.
   */
  getMemoryUsage: () => parseFloat(memoryUsage.toFixed(2)),

  /**
   * Get used Memory in gigabytes (GB).
   * @returns {number} Used memory rounded to two decimal places.
   */
  getMemoryUsed: () => parseFloat(memoryUsed),

  /**
   * Get total Memory in gigabytes (GB).
   * @returns {number} Total memory rounded to two decimal places.
   */
  getMemoryTotal: () => parseFloat(memoryTotal),

  /**
   * Get disk stats for all non-loop /dev/* mounts.
   * Excludes system mounts from health alerting unless DISK_HEALTH_PATHS is set.
   * @returns {Array} Array of drive objects
   */
  getDiskStats: () => diskStats,

  /**
   * Monitor configuration derived from environment variables.
   * Passed through the API so the client can apply the same thresholds.
   * Per-metric thresholds fall back to the global warn/critical values.
   */
  monitorConfig: {
    cpuEnabled:    CPU_ENABLED,
    memoryEnabled: MEMORY_ENABLED,
    diskEnabled:   DISK_ENABLED,
    // Global fallback thresholds
    warnThreshold:     WARN_THRESHOLD,
    criticalThreshold: CRITICAL_THRESHOLD,
    // Per-metric thresholds (equal to global when not individually overridden)
    cpu: {
      warnThreshold:     cpuThresholds.warnThreshold,
      criticalThreshold: cpuThresholds.criticalThreshold,
    },
    memory: {
      warnThreshold:     memoryThresholds.warnThreshold,
      criticalThreshold: memoryThresholds.criticalThreshold,
    },
    disk: {
      warnThreshold:     diskThresholds.warnThreshold,
      criticalThreshold: diskThresholds.criticalThreshold,
    },
  },
};
