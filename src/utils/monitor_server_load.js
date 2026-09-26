const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { metrics } = require('@opentelemetry/api');

// ── Sampler cost metric ──────────────────────────────────────────────────────
// Records how long each sampler job blocks the event loop, as the histogram
// admin_telemetry.sampler.duration (ms, attribute `job`). This process serves
// every request, so SigNoz compares sampler versions on this directly: the
// runtime event-loop metrics sample every 10 ms and cannot resolve a
// sub-millisecond tick. Only synchronous work is timed; `df` runs in a child
// process, so its jobs cover the spawn call and the parsing of its output.
// Buckets are dense from 0.05 ms to 30 ms: a rework aims under 1 ms, while the
// production host (72 CPUs) measured the tick at 3-6 ms and the df spawn at
// 9-13 ms, and percentiles are only as precise as the bucket they land in.
const SAMPLER_DURATION_BUCKETS_MS = [
  0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 100,
];
let samplerDurationHistogram = null;
let samplerDurationProvider = null;

function recordSamplerDuration(job, startedAt) {
  const elapsedMs = performance.now() - startedAt;
  // Metrics have no proxy provider: an instrument created before
  // instrumentation.ts registers the SDK provider stays a no-op for good, and
  // this module can load first. Re-resolve whenever the global provider changes.
  const provider = metrics.getMeterProvider();
  if (provider !== samplerDurationProvider) {
    samplerDurationProvider = provider;
    samplerDurationHistogram = provider
      .getMeter('nextjs-stream/admin-telemetry')
      .createHistogram('admin_telemetry.sampler.duration', {
        description: 'Time one server-load sampler job blocks the event loop',
        unit: 'ms',
        advice: { explicitBucketBoundaries: SAMPLER_DURATION_BUCKETS_MS },
      });
  }
  samplerDurationHistogram.record(elapsedMs, { job });
}

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
const CPU_ENABLED    = process.env.SERVER_LOAD_CPU_ENABLED    !== 'false';
const MEMORY_ENABLED = process.env.SERVER_LOAD_MEMORY_ENABLED !== 'false';
const DISK_ENABLED   = process.env.SERVER_LOAD_DISK_ENABLED   !== 'false';

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
  const parsed = parseInt(process.env[envVar], 10);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100 ? parsed : defaultValue;
}

// Global defaults
const WARN_THRESHOLD     = parseThreshold('SERVER_LOAD_WARN_THRESHOLD',     50);
const CRITICAL_THRESHOLD = parseThreshold('SERVER_LOAD_CRITICAL_THRESHOLD', 80);

// Per-metric thresholds (fall back to global)
const CPU_WARN_THRESHOLD        = parseThreshold('SERVER_LOAD_CPU_WARN_THRESHOLD',        WARN_THRESHOLD);
const CPU_CRITICAL_THRESHOLD    = parseThreshold('SERVER_LOAD_CPU_CRITICAL_THRESHOLD',    CRITICAL_THRESHOLD);
const MEMORY_WARN_THRESHOLD     = parseThreshold('SERVER_LOAD_MEMORY_WARN_THRESHOLD',     WARN_THRESHOLD);
const MEMORY_CRITICAL_THRESHOLD = parseThreshold('SERVER_LOAD_MEMORY_CRITICAL_THRESHOLD', CRITICAL_THRESHOLD);
const DISK_WARN_THRESHOLD       = parseThreshold('SERVER_LOAD_DISK_WARN_THRESHOLD',       WARN_THRESHOLD);
const DISK_CRITICAL_THRESHOLD   = parseThreshold('SERVER_LOAD_DISK_CRITICAL_THRESHOLD',   CRITICAL_THRESHOLD);

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

// Guards against stacking df children when a sample outlives the interval
let diskSampleInProgress = false;

function sampleDisk() {
  // Async by design: `df` can hang for seconds on a slow or unresponsive mount
  // (network share / USB drive in uninterruptible I/O sleep). The previous
  // execSync version blocked the entire event loop for the duration, freezing
  // every in-flight request in the process on each 30s tick.
  if (diskSampleInProgress) return;
  diskSampleInProgress = true;

  // When DISK_HEALTH_PATHS is configured, stat only those filesystems so df
  // never touches unrelated (potentially hanging) mounts at all.
  const args = ['-BGB', '--output=source,target,size,used,avail,pcent'];
  if (DISK_HEALTH_PATHS) {
    args.push(...DISK_HEALTH_PATHS);
  }

  const spawnStartedAt = performance.now();
  execFile(
    'df',
    args,
    { timeout: 5000, killSignal: 'SIGKILL', encoding: 'utf8' },
    (error, stdout) => {
      const parseStartedAt = performance.now();
      diskSampleInProgress = false;

      if (error || !stdout) {
        // df unavailable (Windows dev env) or timed out — keep last-known stats
        return;
      }

      try {
        diskStats = stdout.trim().split('\n')
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
        // Parse failure — keep last-known stats
      }
      recordSamplerDuration('disk_parse', parseStartedAt);
    }
  );
  recordSamplerDuration('disk_spawn', spawnStartedAt);
}

// Sampling function to calculate CPU and Memory usage
function sample() {
  const startedAt = performance.now();
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

  // Calculate Memory usage percentage using MemAvailable on Linux so cached
  // pages aren't counted as "used" — see readAvailableMemBytes() above.
  const totalMemBytes = os.totalmem();
  const availableMemBytes = readAvailableMemBytes();
  const usedMemBytes = totalMemBytes - availableMemBytes;
  memoryUsage = (usedMemBytes / totalMemBytes) * 100;

  // Convert Memory usage from bytes to gigabytes (GB)
  memoryTotal = (totalMemBytes / (1024 ** 3)).toFixed(2); // Total memory in GB
  memoryUsed = (usedMemBytes / (1024 ** 3)).toFixed(2); // Used memory in GB

  recordSamplerDuration('tick', startedAt);
}

// Start sampling at regular intervals (every 3 seconds)
const samplingInterval = 3000; // 3000ms = 3 seconds
const intervalId = setInterval(sample, samplingInterval);
// Disk changes slowly — sample every 30 seconds
const diskIntervalId = setInterval(sampleDisk, 30000);

// Perform an initial sample immediately
sample();
sampleDisk();

// Graceful shutdown to clear the interval when the process exits
function shutdown() {
  clearInterval(intervalId);
  clearInterval(diskIntervalId);
  process.exit();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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
      warnThreshold:     CPU_WARN_THRESHOLD,
      criticalThreshold: CPU_CRITICAL_THRESHOLD,
    },
    memory: {
      warnThreshold:     MEMORY_WARN_THRESHOLD,
      criticalThreshold: MEMORY_CRITICAL_THRESHOLD,
    },
    disk: {
      warnThreshold:     DISK_WARN_THRESHOLD,
      criticalThreshold: DISK_CRITICAL_THRESHOLD,
    },
  },
};
