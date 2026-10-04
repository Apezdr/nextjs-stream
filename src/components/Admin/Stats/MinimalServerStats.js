'use client'

import useSWR from 'swr'
import Loading from '@src/app/loading'
import { fetcher } from '@src/utils'
import { useSystemStatus } from '@src/contexts/SystemStatusContext'
import { LEVELS, levelFor, storageFromSystemStatus } from './serverLoadDisplay'

const GIB = 1024 ** 3

function SidebarBar({ label, percent, level, detail, title }) {
  return (
    <div className="flex items-center space-x-2" title={title}>
      <span className="text-gray-400 w-8">{label}</span>
      <div className="relative w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`absolute left-0 top-0 h-full ${LEVELS[level].sidebarBar} transition-all duration-300`}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="text-gray-400 text-xs">{detail}</span>
    </div>
  )
}

/** Compact server load for the admin sidebar, on every admin page. */
export default function MinimalServerStats() {
  const { data, error } = useSWR('/api/authenticated/admin/server-load', fetcher, {
    refreshInterval: 3000,
  })
  const { status } = useSystemStatus()

  if (error) {
    return (
      <div className="flex items-center space-x-2 text-sm text-red-500">
        <span>Failed to load stats</span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center h-6 w-48">
        <Loading fullscreenClasses={false} />
      </div>
    )
  }

  const { cpu, memory, config } = data
  const { thresholds } = config
  const storage = config.diskEnabled ? storageFromSystemStatus(status, thresholds.disk) : null

  return (
    <div className="flex flex-col space-y-2 text-sm">
      {cpu && (
        <SidebarBar
          label="CPU"
          percent={cpu.percent}
          level={levelFor(cpu.percent, thresholds.cpu)}
          detail={`${cpu.percent.toFixed(0)}%`}
        />
      )}
      {memory && (
        <SidebarBar
          label="Mem"
          percent={memory.percent}
          level={levelFor(memory.percent, thresholds.memory)}
          detail={`${(memory.usedBytes / GIB).toFixed(0)}/${(memory.totalBytes / GIB).toFixed(0)} GiB`}
        />
      )}
      {storage?.worst && (
        <SidebarBar
          label="Disk"
          percent={storage.worst.percent}
          level={storage.level}
          detail={`${storage.worst.percent.toFixed(0)}%`}
          title={`Fullest drive: ${storage.worst.mount} on ${storage.worst.serverLabel}`}
        />
      )}
    </div>
  )
}
