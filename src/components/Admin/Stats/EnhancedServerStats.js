'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { fetcher } from '@src/utils'
import { ArrowsUpDownIcon, BoltIcon } from '@heroicons/react/24/outline'
import { formatBytesAsBitRate } from '@src/utils/formatBitRate'
import { StatusBadge } from '../BaseComponents'
import GpuVendorIcon from './GpuVendorIcon'
import CpuVendorIcon from './CpuVendorIcon'
import TelemetrySparkline from './TelemetrySparkline'
import { resolveServerHealthSummary } from './serverHealthSummary'

/**
 * Material Design server statistics component with clean, modern styling
 */
const EnhancedServerStats = () => {
    const [diskDetailsOpen, setDiskDetailsOpen] = useState(false)
    const { data, error } = useSWR('/api/authenticated/admin/server-load', fetcher, {
        refreshInterval: 3000,
    })

    if (error) {
        return (
            <div className="p-6 text-center">
                <div className="text-red-600 text-sm">Failed to load server statistics</div>
            </div>
        )
    }

    if (!data) {
        return (
            <div className="p-6 text-center">
                <div className="animate-pulse">
                    <div className="space-y-4">
                        <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto"></div>
                        <div className="h-20 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded w-1/2 mx-auto"></div>
                    </div>
                </div>
            </div>
        )
    }

    const {
        cpu,
        cpuInfo = null,
        memoryUsed,
        memoryTotal,
        memoryInfo = null,
        drives = [],
        disk = null,
        network = null,
        gpus = null,
        history = [],
        config: {
            cpuEnabled    = true,
            memoryEnabled = true,
            diskEnabled   = true,
            networkEnabled = true,
            gpuEnabled = true,
            // Global fallback thresholds
            warnThreshold     = 50,
            criticalThreshold = 80,
            // Per-metric thresholds (fall back to global when not individually set)
            cpu:    cpuConfig    = {},
            memory: memoryConfig = {},
            disk:   diskConfig   = {},
        } = {},
    } = data
    const memoryUsage = memoryEnabled && Number.isFinite(Number(memoryUsed)) && Number(memoryTotal) > 0
        ? (Number(memoryUsed) / Number(memoryTotal)) * 100
        : 0
    const diskCapacity = disk?.capacity || null
    const diskIo = disk?.io || null
    const diskFilesystems = diskCapacity?.filesystems || drives
    const diskPercent = Number.isFinite(diskCapacity?.percent)
        ? diskCapacity.percent
        : null
    const formatClock = (clockMHz) => Number.isFinite(clockMHz)
        ? clockMHz >= 1000 ? `${(clockMHz / 1000).toFixed(2)} GHz` : `${clockMHz.toFixed(0)} MHz`
        : '—'
    const formatGiB = (bytes) => Number.isFinite(bytes) ? `${(bytes / (1024 ** 3)).toFixed(1)} GB` : '—'
    // NVIDIA reports VRAM in MiB; convert it at the presentation boundary.
    const formatVram = (mib) => `${(mib / 1024).toFixed(1)} GB`
    const formatUptime = (seconds) => {
        if (!Number.isFinite(seconds)) return '—'
        const days = Math.floor(seconds / 86400)
        const hours = Math.floor((seconds % 86400) / 3600)
        const minutes = Math.floor((seconds % 3600) / 60)
        return `${days}d ${hours}h ${minutes}m`
    }

    // Resolved per-metric thresholds
    const cpuWarn        = cpuConfig.warnThreshold     ?? warnThreshold
    const cpuCrit        = cpuConfig.criticalThreshold ?? criticalThreshold
    const memoryWarn     = memoryConfig.warnThreshold     ?? warnThreshold
    const memoryCrit     = memoryConfig.criticalThreshold ?? criticalThreshold
    const diskWarn       = diskConfig.warnThreshold     ?? warnThreshold
    const diskCrit       = diskConfig.criticalThreshold ?? criticalThreshold

    // Only health drives (non-system mounts) factor into the overall status
    const healthDrives = drives.filter(d => d.isHealthDrive)
    const worstDrive = healthDrives.reduce((w, d) => (d.percent > (w?.percent ?? 0) ? d : w), null)

    // Per-metric helpers
    const getCpuStatus    = (v) => v < cpuWarn    ? 'success' : v < cpuCrit    ? 'warning' : 'error'
    const getMemoryStatus = (v) => v < memoryWarn ? 'success' : v < memoryCrit ? 'warning' : 'error'
    const getDiskStatus   = (v) => v < diskWarn   ? 'success' : v < diskCrit   ? 'warning' : 'error'
    const getCpuColor     = (v) => v < cpuWarn    ? 'bg-emerald-500' : v < cpuCrit    ? 'bg-amber-500' : 'bg-red-500'
    const getMemoryColor  = (v) => v < memoryWarn ? 'bg-emerald-500' : v < memoryCrit ? 'bg-amber-500' : 'bg-red-500'
    const getDiskColor    = (v) => v < diskWarn   ? 'bg-emerald-500' : v < diskCrit   ? 'bg-amber-500' : 'bg-red-500'
    const getCpuLabel     = (v) => v < cpuWarn    ? 'Normal' : v < cpuCrit    ? 'High' : 'Critical'
    const getMemoryLabel  = (v) => v < memoryWarn ? 'Normal' : v < memoryCrit ? 'High' : 'Critical'
    const getDiskLabel    = (v) => v < diskWarn   ? 'Normal' : v < diskCrit   ? 'High' : 'Critical'
    const statusVariant = (state, status) => state !== 'available'
        ? 'warning'
        : status === 'critical' ? 'error' : status === 'warning' ? 'warning' : 'success'
    const statusLabel = (state, status) => state === 'available'
        ? (status === 'critical' ? 'Critical' : status === 'warning' ? 'High' : 'Normal')
        : state === 'partial' ? 'Partial'
        : state === 'stale' ? 'Stale'
        : state === 'warming-up' ? 'Warming up' : 'Unavailable'

    // Collect only the enabled metrics for the overall health summary.
    // Compare each metric against its own thresholds so the summary reflects
    // what a human would actually consider "healthy" per metric.
    const enabledNormalized = [
        ...(cpuEnabled    ? [cpu        >= cpuCrit    ? 100 : cpu        >= cpuWarn    ? 60 : 0] : []),
        ...(memoryEnabled ? [memoryUsage >= memoryCrit ? 100 : memoryUsage >= memoryWarn ? 60 : 0] : []),
        ...(diskEnabled   ? [(diskPercent ?? worstDrive?.percent ?? 0) >= diskCrit ? 100 : (diskPercent ?? worstDrive?.percent ?? 0) >= diskWarn ? 60 : 0] : []),
        ...(networkEnabled && network?.state === 'available'
            ? [network.status === 'critical' ? 100 : network.status === 'warning' ? 60 : 0]
            : []),
        ...(gpuEnabled && ['available', 'partial'].includes(gpus?.state)
            ? [gpus.status === 'critical' ? 100 : gpus.status === 'warning' ? 60 : 0]
            : []),
    ]
    const worstMetric = enabledNormalized.length > 0 ? Math.max(...enabledNormalized) : 0
    const hasUnavailableMetric =
        (networkEnabled && network && !['available', 'warming-up'].includes(network.state)) ||
        (gpuEnabled && gpus && !['available', 'warming-up'].includes(gpus.state))
    const summaryState = resolveServerHealthSummary(worstMetric, hasUnavailableMetric)
    // worstMetric: 0 = optimal, 60 = moderate, 100 = heavy

    return (
        <div className="flex flex-col gap-6 p-6">
            {/* Network counters are container-scoped unless a host collector is added. */}
            {networkEnabled && network && (
                <div className="order-1 space-y-3">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center space-x-3">
                            <div className="rounded-lg bg-sky-100 p-2">
                                <ArrowsUpDownIcon className="h-5 w-5 text-sky-600" />
                            </div>
                            <div>
                                <div className="text-sm font-medium text-gray-900">Network Throughput</div>
                                <div className="text-xs text-gray-500">App container traffic</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-lg font-bold text-gray-900">
                                {network.state === 'available' ? `${network.total?.totalMbps ?? 0} Mbps` : '—'}
                            </div>
                            <StatusBadge status={statusVariant(network.state, network.status)} variant="soft" size="small">
                                {statusLabel(network.state, network.status)}
                            </StatusBadge>
                        </div>
                    </div>
                    {network.state === 'available' && (
                        <div className="grid grid-cols-2 gap-3 text-xs">
                            <div className="rounded bg-sky-50 px-3 py-2 text-sky-800">
                                <span className="block text-sky-600">Receive</span>
                                <strong>{network.total?.rxMbps ?? 0} Mbps</strong>
                            </div>
                            <div className="rounded bg-cyan-50 px-3 py-2 text-cyan-800">
                                <span className="block text-cyan-600">Transmit</span>
                                <strong>{network.total?.txMbps ?? 0} Mbps</strong>
                            </div>
                        </div>
                    )}
                    <TelemetrySparkline
                        values={history.map(point => point.networkMbps)}
                        label="Network throughput over the last 60 seconds"
                        className="text-sky-500"
                    />
                </div>
            )}

            {/* CPU Usage — hidden when SERVER_LOAD_CPU_ENABLED=false */}
            {cpuEnabled && (
            <div className="order-2 space-y-3 border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <CpuVendorIcon vendor={cpuInfo?.vendor} />
                        <div>
                            <div className="text-sm font-medium text-gray-900">CPU Usage</div>
                            <div className="text-xs text-gray-500">OS CPU utilization</div>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-lg font-bold text-gray-900">{cpu}%</div>
                        <StatusBadge status={getCpuStatus(cpu)} variant="soft" size="small">
                            {getCpuLabel(cpu)}
                        </StatusBadge>
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                            className={`h-full ${getCpuColor(cpu)} transition-all duration-300 ease-out`}
                            style={{ width: `${cpu}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                        <span>0%</span>
                        <span>{cpuWarn}%</span>
                        <span>100%</span>
                    </div>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-xs sm:grid-cols-4">
                    <div className="col-span-2">
                        <dt className="text-gray-400">Processor</dt>
                        <dd className="truncate font-medium text-gray-700" title={cpuInfo?.model || undefined}>
                            {cpuInfo?.model || 'Unavailable'}
                        </dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Current clock</dt>
                        <dd className="font-medium text-gray-700">{formatClock(cpuInfo?.clockMHz)}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Base clock</dt>
                        <dd className="font-medium text-gray-700">{formatClock(cpuInfo?.baseClockMHz)}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Sockets</dt>
                        <dd className="font-medium text-gray-700">{cpuInfo?.sockets ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Physical cores</dt>
                        <dd className="font-medium text-gray-700">{cpuInfo?.physicalCores ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Logical processors</dt>
                        <dd className="font-medium text-gray-700">{cpuInfo?.logicalThreads ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Active logical processors</dt>
                        <dd className="font-medium text-gray-700">{cpuInfo?.activeLogicalThreads ?? 'Warming up'}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Processes</dt>
                        <dd className="font-medium text-gray-700">{cpuInfo?.processes ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Software threads</dt>
                        <dd className="font-medium text-gray-700">{cpuInfo?.softwareThreads ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Handles</dt>
                        <dd className="font-medium text-gray-700">{cpuInfo?.handles ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Uptime</dt>
                        <dd className="font-medium text-gray-700">{formatUptime(cpuInfo?.uptimeSeconds)}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">Virtualization</dt>
                        <dd className="font-medium text-gray-700">{cpuInfo?.virtualization || '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-gray-400">CPU temperature</dt>
                        <dd className="font-medium text-gray-700">
                            {Number.isFinite(cpuInfo?.temperatureC)
                                ? `${cpuInfo.temperatureC}°C`
                                : cpuInfo?.temperatureReason === 'not-exposed-by-docker-desktop'
                                    ? 'Not exposed by Docker Desktop' : 'Sensor unavailable'}
                        </dd>
                    </div>
                    <div className="col-span-2 sm:col-span-4">
                        <dt className="text-gray-400">Cache</dt>
                        <dd className="font-medium text-gray-700">
                            L1 {cpuInfo?.caches?.l1 || '—'} · L2 {cpuInfo?.caches?.l2 || '—'} · L3 {cpuInfo?.caches?.l3 || '—'}
                        </dd>
                    </div>
                </dl>
                <TelemetrySparkline
                    values={history.map(point => point.cpuPct)}
                    maxValue={100}
                    label="CPU utilization over the last 60 seconds"
                    className="text-blue-500"
                />
            </div>
            )}

            {/* Memory Usage — hidden when SERVER_LOAD_MEMORY_ENABLED=false */}
            {memoryEnabled && (
            <div className="order-3 space-y-3 border-t border-gray-200 pt-6">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-purple-100 rounded-lg">
                            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.58 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.58 4 8 4s8-1.79 8-4M4 7c0-2.21 3.58-4 8-4s8 1.79 8 4" />
                            </svg>
                        </div>
                        <div>
                            <div className="text-sm font-medium text-gray-900">Memory Usage</div>
                            <div className="text-xs text-gray-500">OS memory utilization</div>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-lg font-bold text-gray-900">{memoryUsage.toFixed(1)}%</div>
                        <StatusBadge status={getMemoryStatus(memoryUsage)} variant="soft" size="small">
                            {getMemoryLabel(memoryUsage)}
                        </StatusBadge>
                    </div>
                </div>
                <div className="space-y-2">
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                            className={`h-full ${getMemoryColor(memoryUsage)} transition-all duration-300 ease-out`}
                            style={{ width: `${memoryUsage}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                        <span>0 GB</span>
                        <span>{(memoryTotal / 2).toFixed(1)} GB</span>
                        <span>{memoryTotal} GB</span>
                    </div>
                </div>
                <div className="flex justify-between text-xs text-gray-600">
                    <span>Used: {memoryUsed} GB</span>
                    <span>Available: {(memoryTotal - memoryUsed).toFixed(1)} GB</span>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t border-gray-100 pt-3 text-xs sm:grid-cols-4">
                    <div><dt className="text-gray-400">Committed</dt><dd className="font-medium text-gray-700">{formatGiB(memoryInfo?.committedBytes)} / {formatGiB(memoryInfo?.commitLimitBytes)}</dd></div>
                    <div><dt className="text-gray-400">Cached</dt><dd className="font-medium text-gray-700">{formatGiB(memoryInfo?.cachedBytes)}</dd></div>
                    <div><dt className="text-gray-400">Reclaimable kernel</dt><dd className="font-medium text-gray-700">{formatGiB(memoryInfo?.reclaimableKernelBytes)}</dd></div>
                    <div><dt className="text-gray-400">Non-reclaimable kernel</dt><dd className="font-medium text-gray-700">{formatGiB(memoryInfo?.nonReclaimableKernelBytes)}</dd></div>
                    <div><dt className="text-gray-400">Swap</dt><dd className="font-medium text-gray-700">{formatGiB(memoryInfo?.swapUsedBytes)} / {formatGiB(memoryInfo?.swapTotalBytes)}</dd></div>
                    <div><dt className="text-gray-400">Installed hardware</dt><dd className="font-medium text-gray-700">{formatGiB(Number(memoryInfo?.hardware?.installedBytes))}</dd></div>
                    <div><dt className="text-gray-400">Speed</dt><dd className="font-medium text-gray-700">{memoryInfo?.hardware?.speedMTs ? `${memoryInfo.hardware.speedMTs} MT/s` : '—'}</dd></div>
                    <div><dt className="text-gray-400">Slots used</dt><dd className="font-medium text-gray-700">{memoryInfo?.hardware?.slotsUsed ?? '—'} of {memoryInfo?.hardware?.totalSlots ?? '—'}</dd></div>
                    <div><dt className="text-gray-400">Form factor</dt><dd className="font-medium text-gray-700">{memoryInfo?.hardware?.formFactor || '—'}</dd></div>
                    <div className="col-span-2 sm:col-span-3"><dt className="text-gray-400">Module</dt><dd className="truncate font-medium text-gray-700">{[memoryInfo?.hardware?.manufacturer, memoryInfo?.hardware?.partNumber].filter(Boolean).join(' · ') || 'Not exposed'}</dd></div>
                </dl>
                <TelemetrySparkline
                    values={history.map(point => point.memoryPct)}
                    maxValue={100}
                    label="Memory utilization over the last 60 seconds"
                    className="text-purple-500"
                />
            </div>
            )}

            {gpuEnabled && gpus && (
                <div className="order-5 space-y-3 border-t border-gray-200 pt-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <div className="text-sm font-medium text-gray-900">GPU Status</div>
                            <div className="text-xs text-gray-500">GPU utilization and temperature</div>
                        </div>
                        <StatusBadge status={statusVariant(gpus.state, gpus.status)} variant="soft" size="small">
                            {statusLabel(gpus.state, gpus.status)}
                        </StatusBadge>
                    </div>
                    {['available', 'partial', 'stale'].includes(gpus.state) && gpus.devices?.length > 0 ? gpus.devices.map((gpu) => (
                        <div key={`${gpu.vendor || 'gpu'}-${gpu.index}`} className="space-y-2 rounded border border-gray-200 p-3">
                            <div className="flex items-start justify-between gap-4">
                                <div className="flex min-w-0 items-center gap-3">
                                    <GpuVendorIcon vendor={gpu.vendor} />
                                    <div className="min-w-0">
                                        <div className="truncate text-sm font-medium text-gray-900">{gpu.name}</div>
                                        <div className="text-xs text-gray-500">
                                            {Number.isFinite(gpu.temperatureC) ? `${gpu.temperatureC}°C` : 'Temp —'}
                                            {' · '}
                                            {Number.isFinite(gpu.memoryUsedMiB) && Number.isFinite(gpu.memoryTotalMiB)
                                                ? `${formatVram(gpu.memoryUsedMiB)} / ${formatVram(gpu.memoryTotalMiB)}`
                                                : 'VRAM —'}
                                        </div>
                                    </div>
                                </div>
                                <div className="text-sm font-bold text-gray-900">
                                    {Number.isFinite(gpu.utilizationPct) ? `${gpu.utilizationPct}%` : '—'}
                                </div>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                                <div
                                    className={`h-full ${gpu.status === 'critical' ? 'bg-red-500' : gpu.status === 'warning' ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                    style={{ width: `${Number.isFinite(gpu.utilizationPct) ? gpu.utilizationPct : 0}%` }}
                                />
                            </div>
                        </div>
                    )) : (
                        <div className="text-xs text-gray-500">
                            {gpus.reason === 'tool-missing'
                                ? 'No supported GPU telemetry source is visible in this runtime.'
                                : 'GPU telemetry is not available.'}
                        </div>
                    )}
                    <TelemetrySparkline
                        values={history.map(point => point.gpuPct)}
                        maxValue={100}
                        label="GPU utilization over the last 60 seconds"
                        className="text-emerald-500"
                    />
                </div>
            )}

            {/* Capacity is filesystem-scoped; I/O is block-device-scoped in Docker. */}
            {diskEnabled && (disk || drives.length > 0) && (
                <div className="order-4 space-y-3 border-t border-gray-200 pt-6">
                    <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center space-x-3">
                            <div className="rounded-lg bg-orange-100 p-2">
                                <svg className="h-5 w-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                                </svg>
                            </div>
                            <div>
                                <div className="text-sm font-medium text-gray-900">Disk Utilization</div>
                                <div className="text-xs text-gray-500">Container-visible capacity and block I/O</div>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <StatusBadge
                                status={Number.isFinite(diskPercent) ? getDiskStatus(diskPercent) : 'warning'}
                                variant="soft"
                                size="small"
                            >
                                {Number.isFinite(diskPercent) ? `${diskPercent}%` : statusLabel(disk?.state)}
                            </StatusBadge>
                            <button
                                type="button"
                                aria-expanded={diskDetailsOpen}
                                aria-controls="disk-resource-details"
                                onClick={() => setDiskDetailsOpen(open => !open)}
                                className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                                {diskDetailsOpen ? 'Hide details' : 'Details'}
                            </button>
                        </div>
                    </div>
                    {diskCapacity ? (
                        <>
                            <div className="h-2 overflow-hidden rounded-full bg-gray-200">
                                <div
                                    className={`h-full ${getDiskColor(diskCapacity.percent)} transition-all duration-300`}
                                    style={{ width: `${diskCapacity.percent}%` }}
                                />
                            </div>
                            <div className="flex justify-between text-xs text-gray-600">
                                <span>{diskCapacity.usedGiB} GiB used</span>
                                <span>{diskCapacity.totalGiB} GiB total · {diskCapacity.availableGiB} GiB free</span>
                            </div>
                        </>
                    ) : (
                        <p className="text-xs text-gray-500">Capacity telemetry is warming up.</p>
                    )}
                    <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="rounded bg-orange-50 px-3 py-2 text-orange-900">
                            <span className="block text-orange-600">Read</span>
                            <strong>{formatBytesAsBitRate(diskIo?.readBytesPerSecond)}</strong>
                        </div>
                        <div className="rounded bg-rose-50 px-3 py-2 text-rose-900">
                            <span className="block text-rose-600">Write</span>
                            <strong>{formatBytesAsBitRate(diskIo?.writeBytesPerSecond)}</strong>
                        </div>
                    </div>
                    <TelemetrySparkline
                        values={history.map(point => point.diskIoPct)}
                        maxValue={100}
                        label="Disk I/O utilization over the last 60 seconds"
                        className="text-orange-500"
                    />
                    {diskDetailsOpen && (
                        <div id="disk-resource-details" className="space-y-4 border-t border-gray-200 pt-3 text-xs">
                            <div>
                                <h4 className="mb-2 font-semibold text-gray-700">Filesystems</h4>
                                <div className="divide-y divide-gray-100">
                                    {diskFilesystems.map(filesystem => (
                                        <div key={`${filesystem.source}-${filesystem.mountpoint}`} className="flex items-center justify-between gap-3 py-2">
                                            <div className="min-w-0">
                                                <p className="truncate font-medium text-gray-700">{filesystem.mountpoint}</p>
                                                <p className="truncate text-gray-400">{filesystem.source}</p>
                                            </div>
                                            <span className="shrink-0 text-gray-600">
                                                {filesystem.used} / {filesystem.size} GiB · {filesystem.percent}%
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <h4 className="mb-2 font-semibold text-gray-700">Block devices</h4>
                                <div className="divide-y divide-gray-100">
                                    {(diskIo?.devices || []).map(device => (
                                        <div key={device.name} className="grid grid-cols-[1fr_auto] gap-3 py-2 sm:grid-cols-[1fr_auto_auto_auto]">
                                            <div className="min-w-0">
                                                <span className="flex items-center gap-1 font-medium text-gray-700">
                                                    {device.name}
                                                    {['NVMe', 'SSD'].includes(device.hardwareType) && (
                                                        <BoltIcon className="h-3.5 w-3.5 text-amber-500" title="Flash storage" />
                                                    )}
                                                    <span className="text-[10px] font-normal text-gray-400">{device.hardwareType || 'Unknown'}</span>
                                                </span>
                                                {device.model && <p className="truncate text-[10px] text-gray-400">{device.model}</p>}
                                            </div>
                                            <span className="text-gray-500">R {formatBytesAsBitRate(device.readBytesPerSecond)}</span>
                                            <span className="text-gray-500">W {formatBytesAsBitRate(device.writeBytesPerSecond)}</span>
                                            <span className="text-right text-gray-500">{device.utilizationPct}% busy</span>
                                        </div>
                                    ))}
                                    {(diskIo?.devices || []).length === 0 && (
                                        <p className="py-2 text-gray-400">No block-device I/O data is visible.</p>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* System Health Summary — only considers enabled metrics */}
            {enabledNormalized.length > 0 && (
                        <div className={`order-6 border-t border-gray-200 pt-6 ${
                summaryState === 'optimal' ? 'bg-emerald-50 border-emerald-200' :
                summaryState === 'critical' ? 'bg-red-50 border-red-200' :
                'bg-amber-50 border-amber-200'
                        }`}>
                            <div className="rounded-lg border p-4">
                <div className="flex items-center space-x-2">
                    <svg className={`w-4 h-4 ${
                        summaryState === 'optimal' ? 'text-emerald-600' :
                        summaryState === 'critical' ? 'text-red-600' :
                        'text-amber-600'
                    }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className={`text-sm font-medium ${
                        summaryState === 'optimal' ? 'text-emerald-800' :
                        summaryState === 'critical' ? 'text-red-800' :
                        'text-amber-800'
                    }`}>
                        {summaryState === 'critical' ? 'System under heavy load' :
                         summaryState === 'moderate' ? 'System under moderate load' :
                         summaryState === 'unavailable' ? 'Some telemetry is unavailable' :
                         'System running optimally'}
                    </span>
                                </div>
                            </div>
            </div>
            )}
        </div>
    )
}

export default EnhancedServerStats