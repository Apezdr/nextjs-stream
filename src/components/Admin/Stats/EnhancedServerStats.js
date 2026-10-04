'use client'

import useSWR from 'swr'
import { ArrowsUpDownIcon, CircleStackIcon, CpuChipIcon, Square3Stack3DIcon } from '@heroicons/react/24/outline'
import { fetcher } from '@src/utils'
import { useSystemStatus } from '@src/contexts/SystemStatusContext'
import { StatusBadge } from '../BaseComponents'
import TelemetrySparkline from './TelemetrySparkline'
import { LEVELS, formatBytes, levelFor, storageFromSystemStatus, worstLevel } from './serverLoadDisplay'

const SUMMARY = {
  normal: { box: 'bg-emerald-50 border-emerald-200', icon: 'text-emerald-600', text: 'text-emerald-800', message: 'System running optimally' },
  high: { box: 'bg-amber-50 border-amber-200', icon: 'text-amber-600', text: 'text-amber-800', message: 'System under moderate load' },
  critical: { box: 'bg-red-50 border-red-200', icon: 'text-red-600', text: 'text-red-800', message: 'System under heavy load' },
}

function Bar({ percent, className, height = 'h-2' }) {
  return (
    <div className={`w-full bg-gray-200 rounded-full ${height} overflow-hidden`}>
      <div
        className={`h-full ${className} transition-all duration-300 ease-out`}
        style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
      />
    </div>
  )
}

function SectionHeader({ icon: Icon, iconTone, title, subtitle, children }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className={`p-2 rounded-lg ${iconTone}`}>
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-900">{title}</div>
          {subtitle && <div className="text-xs text-gray-500 truncate">{subtitle}</div>}
        </div>
      </div>
      {children && <div className="text-right shrink-0">{children}</div>}
    </div>
  )
}

function LevelValue({ percent, level }) {
  const style = LEVELS[level]
  return (
    <>
      <div className="text-lg font-bold text-gray-900">{percent.toFixed(1)}%</div>
      <StatusBadge status={style.badge} variant="soft" size="small">
        {style.label}
      </StatusBadge>
    </>
  )
}

function UsageSection({ icon, iconTone, title, subtitle, percent, level, history, sparkTone }) {
  return (
    <div className="space-y-3">
      <SectionHeader icon={icon} iconTone={iconTone} title={title} subtitle={subtitle}>
        <LevelValue percent={percent} level={level} />
      </SectionHeader>
      <Bar percent={percent} className={LEVELS[level].bar} />
      <TelemetrySparkline values={history} label={`${title} usage over the last 60 seconds`} className={sparkTone} />
    </div>
  )
}

function StorageSection({ storage, thresholds }) {
  const { servers, worst, level } = storage
  return (
    <div className="space-y-3">
      <SectionHeader
        icon={CircleStackIcon}
        iconTone="bg-orange-100 text-orange-600"
        title="Storage"
        subtitle={worst ? `Fullest: ${worst.mount} on ${worst.serverLabel}` : 'Reported by the file servers'}
      >
        {worst && <LevelValue percent={worst.percent} level={level} />}
      </SectionHeader>
      {!worst && (
        <p className="text-xs text-gray-500">
          No drive report from the file servers yet. It refreshes every 30 seconds.
        </p>
      )}
      {servers.map((server) => (
        <div key={server.serverId} className="space-y-2">
          {servers.length > 1 && <div className="text-xs font-semibold text-gray-600">{server.label}</div>}
          {server.drives.map((drive) => (
            <div key={drive.mount} className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-gray-700 font-medium truncate">{drive.mount}</span>
                <span className="text-gray-500 shrink-0">
                  {drive.available} free of {drive.size} · {drive.percent.toFixed(1)}%
                </span>
              </div>
              <Bar percent={drive.percent} className={LEVELS[levelFor(drive.percent, thresholds)].bar} height="h-1.5" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function DiskActivitySection({ diskIo, history }) {
  const disks = diskIo.state === 'active' ? diskIo.disks : []
  const busiest = disks.reduce((top, disk) => (!top || disk.busyPercent > top.busyPercent ? disk : top), null)
  const totalRead = disks.reduce((sum, disk) => sum + disk.readBytesPerSec, 0)
  const totalWrite = disks.reduce((sum, disk) => sum + disk.writeBytesPerSec, 0)

  return (
    <div className="space-y-3">
      <SectionHeader
        icon={ArrowsUpDownIcon}
        iconTone="bg-teal-100 text-teal-600"
        title="Disk activity"
        subtitle="Measured every 3 seconds while this page is open"
      >
        {busiest && (
          <>
            <div className="text-lg font-bold text-gray-900">{busiest.busyPercent.toFixed(1)}%</div>
            <div className="text-xs text-gray-500">busy, {busiest.device}</div>
          </>
        )}
      </SectionHeader>
      {diskIo.state === 'starting' && <p className="text-xs text-gray-500">Measuring…</p>}
      {diskIo.state === 'active' && (
        <>
          <div className="flex justify-between text-xs text-gray-600">
            <span>Read {formatBytes(totalRead)}/s</span>
            <span>Write {formatBytes(totalWrite)}/s</span>
          </div>
          <TelemetrySparkline
            values={history.map((point) => point.diskBusy)}
            label="Busiest disk, percent of time busy, over the last 60 seconds"
            className="text-teal-500"
          />
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500">
                <th scope="col" className="text-left font-medium">Disk</th>
                <th scope="col" className="text-right font-medium">Read</th>
                <th scope="col" className="text-right font-medium">Write</th>
                <th scope="col" className="text-right font-medium">Busy</th>
              </tr>
            </thead>
            <tbody className="text-gray-700 tabular-nums">
              {disks.map((disk) => (
                <tr key={disk.device}>
                  <td className="text-left font-medium">{disk.device}</td>
                  <td className="text-right">{formatBytes(disk.readBytesPerSec)}/s</td>
                  <td className="text-right">{formatBytes(disk.writeBytesPerSec)}/s</td>
                  <td className="text-right">{disk.busyPercent.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

/**
 * Server load on the admin overview: CPU and memory of the app's host, storage
 * as the file servers report it, and disk activity while the page is open.
 */
const EnhancedServerStats = () => {
  const { data, error } = useSWR('/api/authenticated/admin/server-load', fetcher, {
    refreshInterval: 3000,
  })
  const { status } = useSystemStatus()

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

  const { cpu, memory, diskIo, history = [], config } = data
  const { thresholds } = config
  const storage = config.diskEnabled ? storageFromSystemStatus(status, thresholds.disk) : null
  const cpuLevel = cpu && levelFor(cpu.percent, thresholds.cpu)
  const memoryLevel = memory && levelFor(memory.percent, thresholds.memory)
  const overall = worstLevel([cpuLevel, memoryLevel, storage?.level])
  const summary = overall && SUMMARY[overall]

  return (
    <div className="p-6 space-y-6">
      {cpu && (
        <UsageSection
          icon={CpuChipIcon}
          iconTone="bg-blue-100 text-blue-600"
          title="CPU"
          subtitle={[`${cpu.logicalCpus} logical CPUs`, cpu.model].filter(Boolean).join(' · ')}
          percent={cpu.percent}
          level={cpuLevel}
          history={history.map((point) => point.cpu)}
          sparkTone="text-blue-500"
        />
      )}

      {memory && (
        <UsageSection
          icon={Square3Stack3DIcon}
          iconTone="bg-purple-100 text-purple-600"
          title="Memory"
          subtitle={`${formatBytes(memory.usedBytes)} of ${formatBytes(memory.totalBytes)} in use`}
          percent={memory.percent}
          level={memoryLevel}
          history={history.map((point) => point.memory)}
          sparkTone="text-purple-500"
        />
      )}

      {storage && <StorageSection storage={storage} thresholds={thresholds.disk} />}

      {diskIo && diskIo.state !== 'unavailable' && <DiskActivitySection diskIo={diskIo} history={history} />}

      {summary && (
        <div className={`p-4 rounded-lg border ${summary.box}`}>
          <div className="flex items-center space-x-2">
            <svg className={`w-4 h-4 ${summary.icon}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className={`text-sm font-medium ${summary.text}`}>{summary.message}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default EnhancedServerStats
