const os = require('os');

// Initialize previous CPU times
let previousTotal = 0;
let previousIdle = 0;

// Initialize usage metrics
let cpuUsage = 0;
let memoryUsage = 0;
let memoryUsed = 0;
let memoryTotal = 0;

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

// Perform an initial sample immediately
sample();

// Graceful shutdown to clear the interval when the process exits
function shutdown() {
  clearInterval(intervalId);
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
};
