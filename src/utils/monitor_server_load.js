const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

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
let previousPerCpuTimes = null;

// Initialize usage metrics
let cpuUsage = 0;
let cpuInfo = null;
let memoryUsage = 0;
let memoryUsed = 0;
let memoryTotal = 0;
let memoryInfo = null;
let diskStats = [];
let diskCapacityState = 'warming-up';
let diskCapacitySampledAt = null;
let diskIoStats = null;
let previousDiskIoSample = null;
let networkStats = null;
let gpuStats = null;
let telemetryHistory = [];
let previousNetworkSample = null;
let gpuSampleInProgress = false;
let nvidiaRetryAfter = 0;
let cpuProcessInfo = { processes: null, softwareThreads: null, handles: null };
let cpuProcessSampledAt = 0;

// System mount points that should NOT trigger health alerts
const SYSTEM_MOUNTS = new Set(['/', '/boot', '/boot/efi', '/run', '/tmp', '/var/lib/docker']);
const CONTAINER_NOISE_MOUNTS = new Set(['/etc/hosts', '/etc/hostname', '/etc/resolv.conf']);

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
const NETWORK_ENABLED = isMetricEnabled(process.env.SERVER_LOAD_NETWORK_ENABLED);
const GPU_ENABLED = isMetricEnabled(process.env.SERVER_LOAD_GPU_ENABLED);
const CONFIGURED_GPU_INVENTORY = parseConfiguredGpuInventory(process.env.SERVER_GPU_INVENTORY);
const CONFIGURED_CPU_HARDWARE = parseHardwareInventory(process.env.SERVER_CPU_HARDWARE);
const CONFIGURED_MEMORY_HARDWARE = parseHardwareInventory(process.env.SERVER_MEMORY_HARDWARE);

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
const networkThresholds = resolveThresholdPair(
  'SERVER_LOAD_NETWORK_WARN_THRESHOLD',
  'SERVER_LOAD_NETWORK_CRITICAL_THRESHOLD',
  globalThresholds
);
const gpuThresholds = resolveThresholdPair(
  'SERVER_LOAD_GPU_WARN_THRESHOLD',
  'SERVER_LOAD_GPU_CRITICAL_THRESHOLD',
  { warnThreshold: 80, criticalThreshold: 95 }
);
const gpuTemperatureThresholds = resolveThresholdPair(
  'SERVER_LOAD_GPU_TEMP_WARN_THRESHOLD',
  'SERVER_LOAD_GPU_TEMP_CRITICAL_THRESHOLD',
  { warnThreshold: 75, criticalThreshold: 90 }
);

networkStats = {
  state: NETWORK_ENABLED ? 'warming-up' : 'disabled',
  scope: 'container',
  sampledAt: null,
  total: null,
  interfaces: [],
};
cpuInfo = {
  state: CPU_ENABLED ? 'warming-up' : 'disabled',
  sampledAt: null,
  model: null,
  logicalThreads: null,
  activeLogicalThreads: null,
  physicalCores: null,
  sockets: null,
  vendor: null,
  baseClockMHz: null,
  clockMHz: null,
  temperatureC: null,
  temperatureState: CPU_ENABLED ? 'warming-up' : 'disabled',
  temperatureReason: null,
  virtualization: null,
  caches: null,
  processes: null,
  softwareThreads: null,
  handles: null,
  uptimeSeconds: null,
};
memoryInfo = {
  state: MEMORY_ENABLED ? 'warming-up' : 'disabled',
  scope: 'container',
  sampledAt: null,
};
diskIoStats = {
  state: DISK_ENABLED ? 'warming-up' : 'disabled',
  scope: 'container',
  sampledAt: null,
  utilizationPct: null,
  readBytesPerSecond: null,
  writeBytesPerSecond: null,
  devices: [],
};
gpuStats = {
  state: GPU_ENABLED ? 'warming-up' : 'disabled',
  reason: null,
  sampledAt: null,
  status: null,
  devices: [],
};

function metricStatus(value, thresholds) {
  if (value >= thresholds.criticalThreshold) return 'critical';
  if (value >= thresholds.warnThreshold) return 'warning';
  return 'normal';
}

function roundMetric(value, places = 2) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function parseHardwareInventory(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readProcKeyValueBlocks(contents) {
  return String(contents || '').trim().split(/\n\n+/).map(block => {
    const result = {};
    for (const line of block.split('\n')) {
      const separator = line.indexOf(':');
      if (separator < 0) continue;
      result[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
    }
    return result;
  });
}

function parseCpuTopology(contents) {
  const blocks = readProcKeyValueBlocks(contents).filter(block => block.processor !== undefined);
  if (blocks.length === 0) return {};
  const first = blocks[0];
  const sockets = new Set(blocks.map(block => block['physical id'] || '0'));
  const cores = new Set(blocks.map(block => `${block['physical id'] || '0'}:${block['core id'] || block.processor}`));
  const flags = new Set(String(first.flags || '').split(/\s+/));
  return {
    vendor: first.vendor_id === 'GenuineIntel' ? 'Intel'
      : first.vendor_id === 'AuthenticAMD' ? 'AMD' : first.vendor_id || null,
    sockets: sockets.size,
    physicalCores: cores.size,
    logicalThreads: blocks.length,
    virtualization: flags.has('vmx') ? 'Intel VT-x' : flags.has('svm') ? 'AMD-V' : 'Unavailable',
  };
}

function parseMeminfoBytes(contents) {
  const result = {};
  for (const line of String(contents || '').split('\n')) {
    const match = line.match(/^([^:]+):\s+(\d+)/);
    if (match) result[match[1]] = Number(match[2]) * 1024;
  }
  return result;
}

function readCpuProcessInfo(nowMs = Date.now()) {
  if (process.platform !== 'linux' || nowMs - cpuProcessSampledAt < 15000) return cpuProcessInfo;
  let processes = 0;
  let softwareThreads = 0;
  let handles = 0;
  try {
    for (const entry of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      processes += 1;
      try {
        const status = fs.readFileSync(`/proc/${entry}/status`, 'utf8');
        softwareThreads += Number(status.match(/^Threads:\s+(\d+)/m)?.[1] || 0);
      } catch { /* process exited during sampling */ }
      try { handles += fs.readdirSync(`/proc/${entry}/fd`).length; } catch { /* permission/exit */ }
    }
  } catch {
    return cpuProcessInfo;
  }
  cpuProcessSampledAt = nowMs;
  cpuProcessInfo = { processes, softwareThreads, handles };
  return cpuProcessInfo;
}

function perCpuTimes(cpus) {
  return cpus.map(cpu => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return { idle: cpu.times.idle, total };
  });
}

function appendBoundedHistory(history, point, limit = 20) {
  return [...history, point].slice(-Math.max(1, limit));
}

function recordTelemetrySnapshot(nowMs = Date.now()) {
  const gpuUtilizations = (gpuStats?.devices || [])
    .map(device => device.utilizationPct)
    .filter(Number.isFinite);
  telemetryHistory = appendBoundedHistory(telemetryHistory, {
    timestamp: new Date(nowMs).toISOString(),
    cpuPct: CPU_ENABLED ? roundMetric(cpuUsage) : null,
    memoryPct: MEMORY_ENABLED ? roundMetric(memoryUsage) : null,
    networkMbps: NETWORK_ENABLED && networkStats?.state === 'available'
      ? networkStats.total?.totalMbps ?? null
      : null,
    diskIoPct: DISK_ENABLED && diskIoStats?.state === 'available'
      ? diskIoStats.utilizationPct
      : null,
    gpuPct: GPU_ENABLED && gpuUtilizations.length > 0 ? Math.max(...gpuUtilizations) : null,
  });
}

function parseProcCpuClockMHz(contents) {
  const values = String(contents || '')
    .split('\n')
    .map(line => line.match(/^cpu MHz\s*:\s*([\d.]+)/i)?.[1])
    .filter(Boolean)
    .map(Number)
    .filter(value => Number.isFinite(value) && value > 0);
  return values.length > 0
    ? roundMetric(values.reduce((sum, value) => sum + value, 0) / values.length, 1)
    : null;
}

function readCpuTemperature(sysClassRoot = '/sys/class') {
  const values = [];
  const pushTemperature = (filePath) => {
    const raw = readText(filePath);
    if (raw === null) return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const celsius = Math.abs(parsed) > 1000 ? parsed / 1000 : parsed;
    if (celsius >= -20 && celsius <= 150) values.push(celsius);
  };

  try {
    const thermalRoot = path.join(sysClassRoot, 'thermal');
    for (const directory of fs.readdirSync(thermalRoot)) {
      if (!directory.startsWith('thermal_zone')) continue;
      const zoneRoot = path.join(thermalRoot, directory);
      const type = readText(path.join(zoneRoot, 'type')) || '';
      if (/cpu|package|x86|acpi|soc/i.test(type)) pushTemperature(path.join(zoneRoot, 'temp'));
    }
  } catch {
    // Thermal zones are optional in containers and WSL.
  }

  try {
    const hwmonRoot = path.join(sysClassRoot, 'hwmon');
    for (const directory of fs.readdirSync(hwmonRoot)) {
      const deviceRoot = path.join(hwmonRoot, directory);
      const name = readText(path.join(deviceRoot, 'name')) || '';
      if (!/coretemp|k10temp|zenpower|cpu_thermal|x86_pkg_temp|acpitz/i.test(name)) continue;
      for (const fileName of fs.readdirSync(deviceRoot)) {
        if (/^temp\d+_input$/.test(fileName)) pushTemperature(path.join(deviceRoot, fileName));
      }
    }
  } catch {
    // hwmon is optional; a nullable result is more honest than a zero.
  }

  return values.length > 0 ? roundMetric(Math.max(...values), 1) : null;
}

function sampleCpuInfo(nowMs = Date.now()) {
  if (!CPU_ENABLED) return;
  const cpus = os.cpus();
  const model = cpus.find(cpu => cpu?.model)?.model?.trim() || null;
  const nodeSpeeds = cpus.map(cpu => Number(cpu.speed)).filter(speed => Number.isFinite(speed) && speed > 0);
  let clockMHz = nodeSpeeds.length > 0
    ? roundMetric(nodeSpeeds.reduce((sum, speed) => sum + speed, 0) / nodeSpeeds.length, 1)
    : null;
  if (clockMHz === null && process.platform === 'linux') {
    try {
      clockMHz = parseProcCpuClockMHz(fs.readFileSync('/proc/cpuinfo', 'utf8'));
    } catch {
      clockMHz = null;
    }
  }
  const temperatureC = process.platform === 'linux' ? readCpuTemperature() : null;
  let topology = {};
  if (process.platform === 'linux') {
    try { topology = parseCpuTopology(fs.readFileSync('/proc/cpuinfo', 'utf8')); } catch { topology = {}; }
  }
  const currentPerCpu = perCpuTimes(cpus);
  let activeLogicalThreads = null;
  if (previousPerCpuTimes?.length === currentPerCpu.length) {
    activeLogicalThreads = currentPerCpu.reduce((active, current, index) => {
      const previous = previousPerCpuTimes[index];
      const deltaTotal = current.total - previous.total;
      const deltaIdle = current.idle - previous.idle;
      const utilization = deltaTotal > 0 ? ((deltaTotal - deltaIdle) / deltaTotal) * 100 : 0;
      return active + (utilization >= 1 ? 1 : 0);
    }, 0);
  }
  previousPerCpuTimes = currentPerCpu;
  const processInfo = readCpuProcessInfo(nowMs);
  const temperatureReason = temperatureC !== null ? null
    : fs.existsSync('/dev/dxg') ? 'not-exposed-by-docker-desktop' : 'sensor-unavailable';
  cpuInfo = {
    state: temperatureC === null ? 'partial' : 'available',
    sampledAt: new Date(nowMs).toISOString(),
    model,
    logicalThreads: Number(CONFIGURED_CPU_HARDWARE.logicalThreads) || topology.logicalThreads || cpus.length || null,
    activeLogicalThreads,
    physicalCores: Number(CONFIGURED_CPU_HARDWARE.physicalCores) || topology.physicalCores || null,
    sockets: Number(CONFIGURED_CPU_HARDWARE.sockets) || topology.sockets || null,
    vendor: CONFIGURED_CPU_HARDWARE.vendor || topology.vendor || null,
    baseClockMHz: Number(CONFIGURED_CPU_HARDWARE.baseClockMHz) || null,
    clockMHz,
    temperatureC,
    temperatureState: temperatureC === null ? 'unavailable' : 'available',
    temperatureReason,
    virtualization: CONFIGURED_CPU_HARDWARE.virtualization || topology.virtualization || null,
    caches: CONFIGURED_CPU_HARDWARE.caches || null,
    ...processInfo,
    uptimeSeconds: Math.round(os.uptime()),
  };
}

function parseNetworkDev(contents) {
  const interfaces = new Map();
  for (const line of String(contents || '').split('\n').slice(2)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const name = line.slice(0, separator).trim();
    if (!name || name === 'lo') continue;
    const fields = line.slice(separator + 1).trim().split(/\s+/);
    const rxBytes = Number(fields[0]);
    const txBytes = Number(fields[8]);
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) continue;
    interfaces.set(name, { rxBytes, txBytes });
  }
  return interfaces;
}

function readInterfaceSpeedMbps(interfaceName) {
  try {
    const speed = Number(fs.readFileSync(`/sys/class/net/${interfaceName}/speed`, 'utf8').trim());
    return Number.isFinite(speed) && speed > 0 ? speed : null;
  } catch {
    return null;
  }
}

function calculateNetworkRates(previous, current, elapsedSeconds) {
  if (!previous || elapsedSeconds <= 0) return [];
  const rates = [];
  for (const [name, counters] of current) {
    const prior = previous.get(name);
    if (!prior) continue;
    // Interface resets and namespace changes can move counters backwards;
    // treating that as zero avoids a bogus negative utilization spike.
    const rxDelta = Math.max(0, counters.rxBytes - prior.rxBytes);
    const txDelta = Math.max(0, counters.txBytes - prior.txBytes);
    const rxMbps = (rxDelta * 8) / elapsedSeconds / 1_000_000;
    const txMbps = (txDelta * 8) / elapsedSeconds / 1_000_000;
    const speedMbps = readInterfaceSpeedMbps(name);
    const utilizationPct = speedMbps
      ? Math.min(100, ((rxMbps + txMbps) / speedMbps) * 100)
      : null;
    rates.push({
      name,
      rxMbps: roundMetric(rxMbps),
      txMbps: roundMetric(txMbps),
      totalMbps: roundMetric(rxMbps + txMbps),
      speedMbps,
      utilizationPct: utilizationPct === null ? null : roundMetric(utilizationPct, 1),
    });
  }
  return rates;
}

function sampleNetwork(nowMs = Date.now()) {
  if (!NETWORK_ENABLED) return;
  if (process.platform !== 'linux') {
    networkStats = { ...networkStats, state: 'unavailable', reason: 'unsupported-platform' };
    return;
  }
  try {
    const current = parseNetworkDev(fs.readFileSync('/proc/net/dev', 'utf8'));
    if (!previousNetworkSample) {
      previousNetworkSample = { counters: current, timestampMs: nowMs };
      networkStats = { ...networkStats, state: 'warming-up', sampledAt: new Date(nowMs).toISOString() };
      return;
    }
    const elapsedSeconds = (nowMs - previousNetworkSample.timestampMs) / 1000;
    const interfaces = calculateNetworkRates(previousNetworkSample.counters, current, elapsedSeconds);
    previousNetworkSample = { counters: current, timestampMs: nowMs };
    const rxMbps = interfaces.reduce((sum, item) => sum + item.rxMbps, 0);
    const txMbps = interfaces.reduce((sum, item) => sum + item.txMbps, 0);
    const utilizations = interfaces.map(item => item.utilizationPct).filter(Number.isFinite);
    const utilizationPct = utilizations.length > 0 ? Math.max(...utilizations) : null;
    networkStats = {
      state: 'available',
      scope: 'container',
      sampledAt: new Date(nowMs).toISOString(),
      status: utilizationPct === null ? 'normal' : metricStatus(utilizationPct, networkThresholds),
      total: {
        rxMbps: roundMetric(rxMbps),
        txMbps: roundMetric(txMbps),
        totalMbps: roundMetric(rxMbps + txMbps),
        utilizationPct,
      },
      interfaces,
    };
  } catch {
    networkStats = { ...networkStats, state: 'unavailable', reason: 'read-failed' };
  }
}

function readDiskSectorSize(deviceName) {
  try {
    const value = Number(fs.readFileSync(`/sys/class/block/${deviceName}/queue/hw_sector_size`, 'utf8').trim());
    return Number.isFinite(value) && value > 0 ? value : 512;
  } catch {
    return 512;
  }
}

function blockDeviceHasSlaves(deviceName) {
  try {
    return fs.readdirSync(`/sys/class/block/${deviceName}/slaves`).length > 0;
  } catch {
    return false;
  }
}

function classifyDiskHardware({ name = '', rotational = null, model = '' } = {}) {
  if (/^nvme\d+n\d+(?:p\d+)?$/i.test(name)) return 'NVMe';
  if (/virtual|vhd/i.test(model)) return 'Virtual';
  if (String(rotational).trim() === '0') return 'SSD';
  if (String(rotational).trim() === '1') return 'HDD';
  return 'Unknown';
}

function readDiskHardware(deviceName) {
  const deviceRoot = `/sys/class/block/${deviceName}`;
  const rotational = readText(path.join(deviceRoot, 'queue', 'rotational'));
  const model = readText(path.join(deviceRoot, 'device', 'model'));
  const vendor = readText(path.join(deviceRoot, 'device', 'vendor'));
  return {
    type: classifyDiskHardware({ name: deviceName, rotational, model }),
    model: model || null,
    vendor: vendor || null,
  };
}

function partitionParentName(deviceName) {
  const nvme = deviceName.match(/^(nvme\d+n\d+)p\d+$/);
  if (nvme) return nvme[1];
  const mmc = deviceName.match(/^(mmcblk\d+)p\d+$/);
  if (mmc) return mmc[1];
  const standard = deviceName.match(/^((?:sd|vd|xvd)[a-z]+)\d+$/);
  return standard?.[1] || null;
}

function parseDiskStats(contents, options = {}) {
  const sectorSizeFor = options.sectorSizeFor || readDiskSectorSize;
  const hasSlaves = options.hasSlaves || blockDeviceHasSlaves;
  const hardwareFor = options.hardwareFor || readDiskHardware;
  const devices = new Map();

  for (const line of String(contents || '').split('\n')) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 14) continue;
    const [majorRaw, minorRaw, name] = fields;
    if (!name || /^(?:loop|ram|zram|fd|sr)\d*/.test(name)) continue;
    const values = {
      major: Number(majorRaw),
      minor: Number(minorRaw),
      name,
      sectorsRead: Number(fields[5]),
      sectorsWritten: Number(fields[9]),
      inProgress: Number(fields[11]),
      ioMs: Number(fields[12]),
      sectorBytes: Number(sectorSizeFor(name)) || 512,
      hasSlaves: hasSlaves(name),
      hardware: hardwareFor(name),
    };
    if (![
      values.major,
      values.minor,
      values.sectorsRead,
      values.sectorsWritten,
      values.inProgress,
      values.ioMs,
      values.sectorBytes,
    ].every(Number.isFinite)) continue;
    devices.set(name, values);
  }

  for (const device of devices.values()) {
    const parent = partitionParentName(device.name);
    device.includeInTotals = !device.hasSlaves && !(parent && devices.has(parent));
  }
  return devices;
}

function calculateDiskIoRates(previous, current, elapsedSeconds) {
  if (!previous || elapsedSeconds <= 0) return [];
  const elapsedMs = elapsedSeconds * 1000;
  const devices = [];
  for (const [name, counters] of current) {
    const prior = previous.get(name);
    if (!prior) continue;
    const readBytesPerSecond = Math.max(
      0,
      (counters.sectorsRead - prior.sectorsRead) * counters.sectorBytes / elapsedSeconds
    );
    const writeBytesPerSecond = Math.max(
      0,
      (counters.sectorsWritten - prior.sectorsWritten) * counters.sectorBytes / elapsedSeconds
    );
    const utilizationPct = Math.min(
      100,
      Math.max(0, counters.ioMs - prior.ioMs) / elapsedMs * 100
    );
    devices.push({
      name,
      major: counters.major,
      minor: counters.minor,
      readBytesPerSecond: roundMetric(readBytesPerSecond),
      writeBytesPerSecond: roundMetric(writeBytesPerSecond),
      utilizationPct: roundMetric(utilizationPct, 1),
      inProgress: counters.inProgress,
      includeInTotals: counters.includeInTotals,
      hardwareType: counters.hardware?.type || 'Unknown',
      model: counters.hardware?.model || null,
      vendor: counters.hardware?.vendor || null,
    });
  }
  return devices;
}

function sampleDiskIo(nowMs = Date.now()) {
  if (!DISK_ENABLED) return;
  if (process.platform !== 'linux') {
    diskIoStats = { ...diskIoStats, state: 'unavailable', reason: 'unsupported-platform' };
    return;
  }
  try {
    const current = parseDiskStats(fs.readFileSync('/proc/diskstats', 'utf8'));
    if (!previousDiskIoSample) {
      previousDiskIoSample = { counters: current, timestampMs: nowMs };
      diskIoStats = { ...diskIoStats, state: 'warming-up', sampledAt: new Date(nowMs).toISOString() };
      return;
    }
    const elapsedSeconds = (nowMs - previousDiskIoSample.timestampMs) / 1000;
    const devices = calculateDiskIoRates(previousDiskIoSample.counters, current, elapsedSeconds);
    previousDiskIoSample = { counters: current, timestampMs: nowMs };
    const totalDevices = devices.filter(device => device.includeInTotals);
    const readBytesPerSecond = totalDevices.reduce((sum, device) => sum + device.readBytesPerSecond, 0);
    const writeBytesPerSecond = totalDevices.reduce((sum, device) => sum + device.writeBytesPerSecond, 0);
    const utilizationPct = totalDevices.length > 0
      ? Math.max(...totalDevices.map(device => device.utilizationPct))
      : null;
    diskIoStats = {
      state: devices.length > 0 ? 'available' : 'unavailable',
      scope: 'container',
      sampledAt: new Date(nowMs).toISOString(),
      utilizationPct,
      readBytesPerSecond: roundMetric(readBytesPerSecond),
      writeBytesPerSecond: roundMetric(writeBytesPerSecond),
      devices,
    };
  } catch {
    diskIoStats = { ...diskIoStats, state: 'unavailable', reason: 'read-failed' };
  }
}

function parseNvidiaSmiOutput(stdout) {
  return String(stdout || '')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [indexRaw, name, temperatureRaw, utilizationRaw, memoryUsedRaw, memoryTotalRaw] =
        line.split(',').map(value => value.trim());
      const index = Number(indexRaw);
      const temperatureC = Number(temperatureRaw);
      const utilizationPct = Number(utilizationRaw);
      const memoryUsedMiB = Number(memoryUsedRaw);
      const memoryTotalMiB = Number(memoryTotalRaw);
      if (
        !name ||
        ![index, temperatureC, utilizationPct, memoryUsedMiB, memoryTotalMiB].every(Number.isFinite) ||
        memoryTotalMiB <= 0
      ) return null;
      const status = temperatureC >= gpuTemperatureThresholds.criticalThreshold || utilizationPct >= gpuThresholds.criticalThreshold
        ? 'critical'
        : temperatureC >= gpuTemperatureThresholds.warnThreshold || utilizationPct >= gpuThresholds.warnThreshold
          ? 'warning'
          : 'normal';
      return {
        index,
        vendor: 'NVIDIA',
        name,
        temperatureC,
        utilizationPct,
        memoryUsedMiB,
        memoryTotalMiB,
        memoryUtilizationPct: roundMetric((memoryUsedMiB / memoryTotalMiB) * 100, 1),
        status,
        source: 'nvidia-smi',
      };
    })
    .filter(Boolean);
}

function parseConfiguredGpuInventory(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => {
      if (!item || typeof item.name !== 'string' || !item.name.trim()) return null;
      const vendorValue = String(item.vendor || '').trim().toLowerCase();
      const vendor = vendorValue === 'nvidia' ? 'NVIDIA'
        : vendorValue === 'amd' ? 'AMD'
          : vendorValue === 'intel' ? 'Intel' : 'Unknown';
      return { vendor, name: item.name.trim() };
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function mergeConfiguredGpuInventory(devices, inventory = CONFIGURED_GPU_INVENTORY) {
  const merged = [...devices];
  for (const [inventoryIndex, configured] of inventory.entries()) {
    const exists = merged.some(device =>
      String(device.vendor).toLowerCase() === configured.vendor.toLowerCase() &&
      String(device.name).toLowerCase() === configured.name.toLowerCase()
    );
    if (exists) continue;
    merged.push({
      index: `inventory-${inventoryIndex}`,
      vendor: configured.vendor,
      name: configured.name,
      temperatureC: null,
      utilizationPct: null,
      memoryUsedMiB: null,
      memoryTotalMiB: null,
      memoryUtilizationPct: null,
      status: 'unknown',
      source: 'configured-inventory',
    });
  }
  return merged;
}

function readText(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return null;
  }
}

function readNumber(filePath, divisor = 1) {
  const raw = readText(filePath);
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value / divisor : null;
}

function resolveGpuStatus(utilizationPct, temperatureC) {
  if (!Number.isFinite(utilizationPct) && !Number.isFinite(temperatureC)) return 'unknown';
  if (
    (Number.isFinite(utilizationPct) && utilizationPct >= gpuThresholds.criticalThreshold) ||
    (Number.isFinite(temperatureC) && temperatureC >= gpuTemperatureThresholds.criticalThreshold)
  ) return 'critical';
  if (
    (Number.isFinite(utilizationPct) && utilizationPct >= gpuThresholds.warnThreshold) ||
    (Number.isFinite(temperatureC) && temperatureC >= gpuTemperatureThresholds.warnThreshold)
  ) return 'warning';
  return 'normal';
}

function readDrmTemperature(deviceRoot) {
  const hwmonRoot = path.join(deviceRoot, 'hwmon');
  try {
    for (const directory of fs.readdirSync(hwmonRoot)) {
      const temperature = readNumber(path.join(hwmonRoot, directory, 'temp1_input'), 1000);
      if (Number.isFinite(temperature)) return roundMetric(temperature, 1);
    }
  } catch {
    // Some drivers expose no hwmon device; identity/utilization remain useful.
  }
  return null;
}

function readDrmGpuStats(drmRoot = process.env.DRM_SYSFS_PATH || '/sys/class/drm') {
  const vendors = {
    '0x1002': 'AMD',
    '0x8086': 'Intel',
  };
  try {
    return fs.readdirSync(drmRoot, { withFileTypes: true })
      // /sys/class/drm exposes cardN as symlinks into /sys/devices, while test
      // fixtures and some mounted sysfs views may present real directories.
      .filter(entry => (entry.isDirectory() || entry.isSymbolicLink()) && /^card\d+$/.test(entry.name))
      .map((entry) => {
        const deviceRoot = path.join(drmRoot, entry.name, 'device');
        const vendor = vendors[String(readText(path.join(deviceRoot, 'vendor'))).toLowerCase()];
        if (!vendor) return null;
        const index = Number(entry.name.slice(4));
        const deviceId = readText(path.join(deviceRoot, 'device'));
        const name =
          readText(path.join(deviceRoot, 'product_name')) ||
          readText(path.join(deviceRoot, 'marketing_name')) ||
          `${vendor} GPU${deviceId ? ` (${deviceId})` : ` ${index}`}`;
        const utilizationPct = [
          path.join(deviceRoot, 'gpu_busy_percent'),
          path.join(deviceRoot, 'gt_busy_percent'),
        ].map(candidate => readNumber(candidate)).find(Number.isFinite) ?? null;
        const memoryUsedBytes = readNumber(path.join(deviceRoot, 'mem_info_vram_used'));
        const memoryTotalBytes = readNumber(path.join(deviceRoot, 'mem_info_vram_total'));
        const memoryUsedMiB = Number.isFinite(memoryUsedBytes)
          ? roundMetric(memoryUsedBytes / 1024 / 1024, 1)
          : null;
        const memoryTotalMiB = Number.isFinite(memoryTotalBytes) && memoryTotalBytes > 0
          ? roundMetric(memoryTotalBytes / 1024 / 1024, 1)
          : null;
        const temperatureC = readDrmTemperature(deviceRoot);
        return {
          index,
          vendor,
          name,
          temperatureC,
          utilizationPct,
          memoryUsedMiB,
          memoryTotalMiB,
          memoryUtilizationPct:
            Number.isFinite(memoryUsedMiB) && Number.isFinite(memoryTotalMiB) && memoryTotalMiB > 0
              ? roundMetric((memoryUsedMiB / memoryTotalMiB) * 100, 1)
              : null,
          status: resolveGpuStatus(utilizationPct, temperatureC),
          source: 'drm-sysfs',
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function publishGpuDevices(devices, reason = null) {
  devices = mergeConfiguredGpuInventory(devices);
  if (devices.length === 0) {
    gpuStats = gpuStats.devices.length > 0
      ? { ...gpuStats, state: 'stale', reason }
      : { ...gpuStats, state: 'unavailable', reason: reason || 'no-devices', devices: [] };
    return;
  }
  const statusOrder = { unknown: -1, normal: 0, warning: 1, critical: 2 };
  const status = devices.reduce(
    (worst, device) => statusOrder[device.status] > statusOrder[worst] ? device.status : worst,
    'unknown'
  );
  const partial = devices.some(device =>
    !Number.isFinite(device.utilizationPct) || !Number.isFinite(device.temperatureC)
  );
  gpuStats = {
    state: partial ? 'partial' : 'available',
    reason: partial ? 'partial-telemetry' : null,
    sampledAt: new Date().toISOString(),
    status,
    devices,
  };
}

function sampleGpu() {
  if (!GPU_ENABLED || gpuSampleInProgress) return;
  gpuSampleInProgress = true;
  // DRM sysfs is the lowest-cost mainstream path on Linux: amdgpu exposes
  // busy/VRAM/hwmon data, while Intel drivers may expose a partial subset.
  const drmDevices = readDrmGpuStats();
  if (Date.now() < nvidiaRetryAfter) {
    gpuSampleInProgress = false;
    publishGpuDevices(drmDevices, drmDevices.length > 0 ? null : 'tool-missing');
    return;
  }
  const executable = process.env.NVIDIA_SMI_PATH || (process.platform === 'win32' ? 'nvidia-smi.exe' : 'nvidia-smi');
  const args = [
    '--query-gpu=index,name,temperature.gpu,utilization.gpu,memory.used,memory.total',
    '--format=csv,noheader,nounits',
  ];
  // A fixed executable/argument list avoids shell interpretation while the
  // timeout and overlap guard keep a missing or wedged driver off the event loop.
  execFile(executable, args, { shell: false, timeout: 2000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, encoding: 'utf8' }, (error, stdout) => {
    gpuSampleInProgress = false;
    if (error) {
      const reason = error.code === 'ENOENT' ? 'tool-missing' : error.killed ? 'timeout' : 'probe-failed';
      // Retry missing NVIDIA utility access periodically so a runtime/device
      // attachment can recover without restarting the app process.
      if (reason === 'tool-missing') nvidiaRetryAfter = Date.now() + 5 * 60 * 1000;
      if (gpuStats.devices.length > 0 && drmDevices.length === 0) {
        gpuStats = { ...gpuStats, state: 'stale', reason };
      } else {
        publishGpuDevices(drmDevices, drmDevices.length > 0 ? null : reason);
      }
      return;
    }
    publishGpuDevices([...drmDevices, ...parseNvidiaSmiOutput(stdout)]);
  });
}

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
  const args = ['-B1', '--output=source,target,size,used,avail,pcent'];
  if (DISK_HEALTH_PATHS) {
    args.push(...DISK_HEALTH_PATHS);
  }

  execFile(
    'df',
    args,
    { timeout: 5000, killSignal: 'SIGKILL', encoding: 'utf8' },
    (error, stdout) => {
      diskSampleInProgress = false;

      if (error || !stdout) {
        // df unavailable (Windows dev env) or timed out — keep last-known stats
        if (diskStats.length === 0) diskCapacityState = 'unavailable';
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
            const sizeBytes = Number(sizeRaw);
            const usedBytes = Number(usedRaw);
            const availBytes = Number(availRaw);
            if (isNaN(percent) || !Number.isFinite(sizeBytes) || sizeBytes === 0) return null;
            const isConfiguredHealthDrive = DISK_HEALTH_PATHS
              ? [...DISK_HEALTH_PATHS].some(healthPath =>
                  healthPath === mountpoint ||
                  (mountpoint === '/' ? healthPath.startsWith('/') : healthPath.startsWith(`${mountpoint}/`))
                )
              : false;
            const isHealthDrive = DISK_HEALTH_PATHS
              ? isConfiguredHealthDrive
              : !SYSTEM_MOUNTS.has(mountpoint) && source.startsWith('/dev/');
            return {
              source,
              mountpoint,
              size: roundMetric(sizeBytes / (1024 ** 3), 1),
              used: roundMetric(usedBytes / (1024 ** 3), 1),
              avail: roundMetric(availBytes / (1024 ** 3), 1),
              sizeBytes,
              usedBytes,
              availBytes,
              percent,
              isHealthDrive,
            };
          })
          .filter(Boolean)
          .filter(d => !d.source.startsWith('/dev/loop'))
          .filter(d => !CONTAINER_NOISE_MOUNTS.has(d.mountpoint))
          .filter(d => DISK_HEALTH_PATHS || d.mountpoint === '/' || d.source.startsWith('/dev/'));
        diskCapacityState = diskStats.length > 0 ? 'available' : 'unavailable';
        diskCapacitySampledAt = new Date().toISOString();
      } catch {
        // Parse failure — keep last-known stats
        if (diskStats.length === 0) diskCapacityState = 'unavailable';
      }
    }
  );
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
    sampleCpuInfo();
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
    let meminfo = {};
    if (process.platform === 'linux') {
      try { meminfo = parseMeminfoBytes(fs.readFileSync('/proc/meminfo', 'utf8')); } catch { meminfo = {}; }
    }
    memoryInfo = {
      state: 'available',
      scope: 'container',
      sampledAt: new Date().toISOString(),
      inUseBytes: usedMemBytes,
      availableBytes: availableMemBytes,
      cachedBytes: (meminfo.Cached || 0) + (meminfo.SReclaimable || 0),
      committedBytes: meminfo.Committed_AS || null,
      commitLimitBytes: meminfo.CommitLimit || null,
      reclaimableKernelBytes: meminfo.SReclaimable || null,
      nonReclaimableKernelBytes: meminfo.SUnreclaim || null,
      swapUsedBytes: Number.isFinite(meminfo.SwapTotal) && Number.isFinite(meminfo.SwapFree)
        ? meminfo.SwapTotal - meminfo.SwapFree : null,
      swapTotalBytes: meminfo.SwapTotal || null,
      hardware: CONFIGURED_MEMORY_HARDWARE,
    };
  }

  if (NETWORK_ENABLED) sampleNetwork();
  if (DISK_ENABLED) sampleDiskIo();
  recordTelemetrySnapshot();
}

function getDiskSummary() {
  const healthFilesystems = diskStats.filter(drive => drive.isHealthDrive);
  const rootFilesystem = diskStats.filter(drive => drive.mountpoint === '/');
  const aggregateFilesystems = healthFilesystems.length > 0
    ? healthFilesystems
    : rootFilesystem.length > 0 ? rootFilesystem : diskStats;
  const deduped = [...new Map(
    aggregateFilesystems.map(drive => [`${drive.source}:${drive.sizeBytes}`, drive])
  ).values()];
  const sizeBytes = deduped.reduce((sum, drive) => sum + drive.sizeBytes, 0);
  const usedBytes = deduped.reduce((sum, drive) => sum + drive.usedBytes, 0);
  const availBytes = deduped.reduce((sum, drive) => sum + drive.availBytes, 0);
  const percent = usedBytes + availBytes > 0
    ? roundMetric((usedBytes / (usedBytes + availBytes)) * 100, 1)
    : null;
  const capacity = sizeBytes > 0 ? {
    totalGiB: roundMetric(sizeBytes / (1024 ** 3), 1),
    usedGiB: roundMetric(usedBytes / (1024 ** 3), 1),
    availableGiB: roundMetric(availBytes / (1024 ** 3), 1),
    percent,
    status: metricStatus(percent, diskThresholds),
    filesystems: diskStats,
  } : null;
  const states = [diskCapacityState, diskIoStats.state];
  const state = states.every(value => value === 'available')
    ? 'available'
    : states.some(value => value === 'available') ? 'partial'
      : states.includes('warming-up') ? 'warming-up' : 'unavailable';
  return {
    state,
    scope: 'container',
    sampledAt: diskIoStats.sampledAt || diskCapacitySampledAt,
    capacity,
    io: diskIoStats,
  };
}

// Start sampling at regular intervals (every 3 seconds)
const samplingInterval = 3000; // 3000ms = 3 seconds
const intervalId = CPU_ENABLED || MEMORY_ENABLED || NETWORK_ENABLED || DISK_ENABLED
  ? setInterval(sample, samplingInterval)
  : null;
// Disk changes slowly — sample every 30 seconds
const diskIntervalId = DISK_ENABLED ? setInterval(sampleDisk, 30000) : null;
// GPU state changes more slowly than CPU/network and requires a child process.
const gpuIntervalId = GPU_ENABLED ? setInterval(sampleGpu, 10000) : null;

// Perform an initial sample immediately
if (CPU_ENABLED || MEMORY_ENABLED || NETWORK_ENABLED || DISK_ENABLED) sample();
if (DISK_ENABLED) sampleDisk();
if (GPU_ENABLED) sampleGpu();

// Graceful shutdown to clear the interval when the process exits
function shutdown() {
  if (intervalId) clearInterval(intervalId);
  if (diskIntervalId) clearInterval(diskIntervalId);
  if (gpuIntervalId) clearInterval(gpuIntervalId);
  process.exit();
}

if (intervalId || diskIntervalId || gpuIntervalId) {
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

  /** Processor identity, logical threads, current clock, and nullable temperature. */
  getCpuInfo: () => cpuInfo,

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

  /** Task Manager-style container memory counters plus optional host hardware inventory. */
  getMemoryInfo: () => memoryInfo,

  /**
   * Get disk stats for all non-loop /dev/* mounts.
   * Excludes system mounts from health alerting unless DISK_HEALTH_PATHS is set.
   * @returns {Array} Array of drive objects
   */
  getDiskStats: () => diskStats,

  /** Container-visible capacity summary and block-device I/O rates. */
  getDiskSummary,

  /**
   * Container-network throughput derived from monotonic Linux interface counters.
   */
  getNetworkStats: () => networkStats,

  /**
   * NVIDIA GPU snapshots, or an explicit unavailable/disabled state.
   */
  getGpuStats: () => gpuStats,

  /** Last ~60 seconds at the existing three-second sampler cadence. */
  getTelemetryHistory: () => telemetryHistory,

  // Pure parsers are exported for deterministic fixture tests; sampling stays
  // module-owned so production never creates more than one timer/probe set.
  _parseNetworkDev: parseNetworkDev,
  _parseProcCpuClockMHz: parseProcCpuClockMHz,
  _parseCpuTopology: parseCpuTopology,
  _parseMeminfoBytes: parseMeminfoBytes,
  _readCpuTemperature: readCpuTemperature,
  _appendBoundedHistory: appendBoundedHistory,
  _calculateNetworkRates: calculateNetworkRates,
  _parseDiskStats: parseDiskStats,
  _calculateDiskIoRates: calculateDiskIoRates,
  _classifyDiskHardware: classifyDiskHardware,
  _parseNvidiaSmiOutput: parseNvidiaSmiOutput,
  _parseConfiguredGpuInventory: parseConfiguredGpuInventory,
  _mergeConfiguredGpuInventory: mergeConfiguredGpuInventory,
  _readDrmGpuStats: readDrmGpuStats,

  /**
   * Monitor configuration derived from environment variables.
   * Passed through the API so the client can apply the same thresholds.
   * Per-metric thresholds fall back to the global warn/critical values.
   */
  monitorConfig: {
    cpuEnabled:    CPU_ENABLED,
    memoryEnabled: MEMORY_ENABLED,
    diskEnabled:   DISK_ENABLED,
    networkEnabled: NETWORK_ENABLED,
    gpuEnabled: GPU_ENABLED,
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
    network: {
      warnThreshold:     networkThresholds.warnThreshold,
      criticalThreshold: networkThresholds.criticalThreshold,
    },
    gpu: {
      warnThreshold:     gpuThresholds.warnThreshold,
      criticalThreshold: gpuThresholds.criticalThreshold,
      temperatureWarnThreshold: gpuTemperatureThresholds.warnThreshold,
      temperatureCriticalThreshold: gpuTemperatureThresholds.criticalThreshold,
    },
  },
};
