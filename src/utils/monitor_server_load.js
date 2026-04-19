const os = require('os');
const { execSync } = require('child_process');

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

  // Calculate Memory usage percentage
  const totalMemBytes = os.totalmem();
  const freeMemBytes = os.freemem();
  memoryUsage = ((totalMemBytes - freeMemBytes) / totalMemBytes) * 100;

  // Convert Memory usage from bytes to gigabytes (GB)
  memoryTotal = (totalMemBytes / (1024 ** 3)).toFixed(2); // Total memory in GB
  memoryUsed = ((totalMemBytes - freeMemBytes) / (1024 ** 3)).toFixed(2); // Used memory in GB
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
};
