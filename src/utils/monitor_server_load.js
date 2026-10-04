const os = require('os');
const fs = require('fs');
const { metrics } = require('@opentelemetry/api');
const {
  parseProcStatCpu,
  parseMemAvailableBytes,
  parseDiskStats,
  computeDiskIo,
  parseFlag,
  resolveThresholdPair,
} = require('./serverLoadParsing');

// ── Sampler cost metric ──────────────────────────────────────────────────────
// Records how long each sampler job blocks the event loop, as the histogram
// admin_telemetry.sampler.duration (ms, attribute `job`). This process serves
// every request, so SigNoz compares sampler versions on this directly: the
// runtime event-loop metrics sample every 10 ms and cannot resolve a
// sub-millisecond tick. Jobs: `tick` (CPU and memory, every 3 s, always on)
// and `disk_io` (/proc/diskstats, only while the admin dashboard is open).
// Buckets are dense from 0.05 ms to 30 ms: the previous sampler measured
// 3-6 ms per tick on the 72-CPU production host, this one aims under 1 ms, and
// percentiles are only as precise as the bucket they land in.
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

// ── Configuration ────────────────────────────────────────────────────────────
// SERVER_LOAD_{CPU,MEMORY,DISK}_ENABLED=false (or 0, off, no) hides a metric
// and stops sampling it. Thresholds are whole percentages: a per-metric pair
// falls back to SERVER_LOAD_WARN_THRESHOLD / SERVER_LOAD_CRITICAL_THRESHOLD
// (default 50 / 80). The disk pair grades the drives the file servers report.
const env = process.env;
const CPU_ENABLED = parseFlag(env.SERVER_LOAD_CPU_ENABLED);
const MEMORY_ENABLED = parseFlag(env.SERVER_LOAD_MEMORY_ENABLED);
const DISK_ENABLED = parseFlag(env.SERVER_LOAD_DISK_ENABLED);
const GLOBAL_THRESHOLDS = resolveThresholdPair(
  env.SERVER_LOAD_WARN_THRESHOLD,
  env.SERVER_LOAD_CRITICAL_THRESHOLD,
  { warn: 50, critical: 80 }
);

const monitorConfig = {
  cpuEnabled: CPU_ENABLED,
  memoryEnabled: MEMORY_ENABLED,
  diskEnabled: DISK_ENABLED,
  thresholds: {
    cpu: resolveThresholdPair(env.SERVER_LOAD_CPU_WARN_THRESHOLD, env.SERVER_LOAD_CPU_CRITICAL_THRESHOLD, GLOBAL_THRESHOLDS),
    memory: resolveThresholdPair(env.SERVER_LOAD_MEMORY_WARN_THRESHOLD, env.SERVER_LOAD_MEMORY_CRITICAL_THRESHOLD, GLOBAL_THRESHOLDS),
    disk: resolveThresholdPair(env.SERVER_LOAD_DISK_WARN_THRESHOLD, env.SERVER_LOAD_DISK_CRITICAL_THRESHOLD, GLOBAL_THRESHOLDS),
  },
};

const IS_LINUX = process.platform === 'linux';
const TICK_MS = 3000;
// 20 ticks feed the dashboard's 60-second sparklines.
const HISTORY_POINTS = 20;
// Disk activity is sampled only while the dashboard polls (every 3 s while it
// is visible), and stops a minute after the last poll.
const DISK_IO_IDLE_MS = 60_000;

// One sampler per process. Dev hot reload re-evaluates this module, so the
// state lives on globalThis and the previous evaluation's timer is replaced
// rather than stacked.
const STATE_KEY = Symbol.for('nextjs-stream.serverLoadSampler');
const state = (globalThis[STATE_KEY] ??= {
  timer: null,
  previousCpu: null,
  cpuPercent: 0,
  memoryUsedBytes: 0,
  memoryTotalBytes: 0,
  history: [],
  lastDemandAt: -Infinity,
  previousDiskStats: null,
  previousDiskStatsAt: 0,
  disks: null,
  cpuModel: undefined,
});

const round1 = (n) => Math.round(n * 10) / 10;

function readCpuTimes() {
  if (IS_LINUX) {
    try {
      const times = parseProcStatCpu(fs.readFileSync('/proc/stat', 'utf8'));
      if (times) return { ...times, source: 'proc' };
    } catch {
      // Unreadable /proc/stat: fall back to os.cpus() below.
    }
  }
  let idle = 0;
  let total = 0;
  for (const { times } of os.cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total, source: 'os' };
}

function readAvailableMemoryBytes() {
  if (IS_LINUX) {
    try {
      const bytes = parseMemAvailableBytes(fs.readFileSync('/proc/meminfo', 'utf8'));
      if (bytes != null) return bytes;
    } catch {
      // Fall back to os.freemem() below.
    }
  }
  return os.freemem();
}

function memoryPercent() {
  return state.memoryTotalBytes ? (state.memoryUsedBytes / state.memoryTotalBytes) * 100 : 0;
}

function diskIoWanted() {
  return DISK_ENABLED && IS_LINUX && Date.now() - state.lastDemandAt <= DISK_IO_IDLE_MS;
}

function sampleDiskIo() {
  const startedAt = performance.now();
  const now = Date.now();
  let current;
  try {
    current = parseDiskStats(fs.readFileSync('/proc/diskstats', 'utf8'));
  } catch {
    return;
  }
  if (state.previousDiskStats) {
    state.disks = computeDiskIo(state.previousDiskStats, current, now - state.previousDiskStatsAt);
  }
  state.previousDiskStats = current;
  state.previousDiskStatsAt = now;
  recordSamplerDuration('disk_io', startedAt);
}

function stopDiskIo() {
  state.previousDiskStats = null;
  state.disks = null;
}

function sampleTick() {
  const startedAt = performance.now();
  let cpuReady = false;
  if (CPU_ENABLED) {
    const cpu = readCpuTimes();
    const previous = state.previousCpu;
    // A percentage needs two readings from the same source (clock ticks from
    // /proc/stat, milliseconds from os.cpus()).
    if (previous && previous.source === cpu.source) {
      const totalDelta = cpu.total - previous.total;
      const idleDelta = cpu.idle - previous.idle;
      state.cpuPercent = totalDelta > 0 ? ((totalDelta - idleDelta) / totalDelta) * 100 : 0;
      cpuReady = true;
    }
    state.previousCpu = cpu;
  }
  if (MEMORY_ENABLED) {
    const totalBytes = os.totalmem();
    state.memoryTotalBytes = totalBytes;
    state.memoryUsedBytes = totalBytes - readAvailableMemoryBytes();
  }
  recordSamplerDuration('tick', startedAt);

  if (diskIoWanted()) sampleDiskIo();
  else if (state.previousDiskStats) stopDiskIo();

  // The first tick has no CPU delta yet, so it stays out of the sparklines.
  if (CPU_ENABLED && !cpuReady) return;
  state.history.push({
    t: Date.now(),
    ...(CPU_ENABLED && { cpu: round1(state.cpuPercent) }),
    ...(MEMORY_ENABLED && { memory: round1(memoryPercent()) }),
    ...(state.disks?.length && { diskBusy: round1(Math.max(...state.disks.map((d) => d.busyPercent))) }),
  });
  if (state.history.length > HISTORY_POINTS) state.history.shift();
}

/**
 * Called on every dashboard poll. Disk activity sampling starts with the first
 * poll, reading a baseline at once so rates follow on the next tick, and stops
 * a minute after the last poll.
 */
function noteServerLoadDemand() {
  const wasIdle = !diskIoWanted();
  state.lastDemandAt = Date.now();
  if (wasIdle && diskIoWanted()) {
    stopDiskIo(); // a baseline from an earlier session would average over the gap
    sampleDiskIo();
  }
}

function cpuModel() {
  // os.cpus() is the per-core call the tick avoids; read the model once.
  if (state.cpuModel === undefined) state.cpuModel = os.cpus()[0]?.model?.trim() || null;
  return state.cpuModel;
}

/** The admin dashboard's server-load payload. */
function getServerLoadSnapshot() {
  const snapshot = { config: monitorConfig, history: state.history.slice() };
  if (CPU_ENABLED) {
    snapshot.cpu = {
      percent: round1(state.cpuPercent),
      logicalCpus: os.availableParallelism(),
      model: cpuModel(),
    };
  }
  if (MEMORY_ENABLED) {
    snapshot.memory = {
      percent: round1(memoryPercent()),
      usedBytes: state.memoryUsedBytes,
      totalBytes: state.memoryTotalBytes,
    };
  }
  if (DISK_ENABLED) {
    if (!IS_LINUX) snapshot.diskIo = { state: 'unavailable' };
    else if (!state.disks) snapshot.diskIo = { state: 'starting' };
    else {
      snapshot.diskIo = {
        state: 'active',
        disks: state.disks.map((disk) => ({
          device: disk.device,
          readBytesPerSec: Math.round(disk.readBytesPerSec),
          writeBytesPerSec: Math.round(disk.writeBytesPerSec),
          busyPercent: round1(disk.busyPercent),
        })),
      };
    }
  }
  return snapshot;
}

if (CPU_ENABLED || MEMORY_ENABLED || DISK_ENABLED) {
  clearInterval(state.timer);
  state.timer = setInterval(sampleTick, TICK_MS);
  // Sampling never keeps the process alive, and there are no SIGINT/SIGTERM
  // handlers here: Next owns shutdown, so in-flight requests can drain.
  state.timer.unref?.();
  sampleTick();
}

module.exports = { getServerLoadSnapshot, noteServerLoadDemand, monitorConfig };
