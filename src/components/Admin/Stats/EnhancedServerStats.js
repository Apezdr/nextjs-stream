'use client'

import useSWR from 'swr'
import { fetcher } from '@src/utils'
import { StatusBadge } from '../BaseComponents'

/**
 * Material Design server statistics component with clean, modern styling
 */
const EnhancedServerStats = () => {
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

    const { cpu, memoryUsed, memoryTotal, drives = [] } = data
    const memoryUsage = ((memoryUsed / memoryTotal) * 100)

    // Only health drives (non-system mounts) factor into the overall status
    const healthDrives = drives.filter(d => d.isHealthDrive)
    const worstDrive = healthDrives.reduce((w, d) => (d.percent > (w?.percent ?? 0) ? d : w), null)

    // Helper functions for status and colors
    const getUsageStatus = (percentage) => {
        if (percentage < 50) return 'success'
        if (percentage < 80) return 'warning'
        return 'error'
    }

    const getUsageColor = (percentage) => {
        if (percentage < 50) return 'bg-emerald-500'
        if (percentage < 80) return 'bg-amber-500'
        return 'bg-red-500'
    }

    return (
        <div className="p-6 space-y-6">
            {/* CPU Usage */}
            <div className="space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                            </svg>
                        </div>
                        <div>
                            <div className="text-sm font-medium text-gray-900">CPU Usage</div>
                            <div className="text-xs text-gray-500">OS CPU utilization</div>
                        </div>
                    </div>
                    <div className="text-right">
                        <div className="text-lg font-bold text-gray-900">{cpu}%</div>
                        <StatusBadge status={getUsageStatus(cpu)} variant="soft" size="small">
                            {cpu < 50 ? 'Normal' : cpu < 80 ? 'High' : 'Critical'}
                        </StatusBadge>
                    </div>
                </div>

                {/* CPU Progress Bar */}
                <div className="space-y-2">
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                            className={`h-full ${getUsageColor(cpu)} transition-all duration-300 ease-out`}
                            style={{ width: `${cpu}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                        <span>0%</span>
                        <span>50%</span>
                        <span>100%</span>
                    </div>
                </div>
            </div>

            {/* Memory Usage */}
            <div className="space-y-3">
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
                        <StatusBadge status={getUsageStatus(memoryUsage)} variant="soft" size="small">
                            {memoryUsage < 50 ? 'Normal' : memoryUsage < 80 ? 'High' : 'Critical'}
                        </StatusBadge>
                    </div>
                </div>

                {/* Memory Progress Bar */}
                <div className="space-y-2">
                    <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
                        <div
                            className={`h-full ${getUsageColor(memoryUsage)} transition-all duration-300 ease-out`}
                            style={{ width: `${memoryUsage}%` }}
                        />
                    </div>
                    <div className="flex justify-between text-xs text-gray-500">
                        <span>0 GB</span>
                        <span>{(memoryTotal / 2).toFixed(1)} GB</span>
                        <span>{memoryTotal} GB</span>
                    </div>
                </div>

                {/* Memory Details */}
                <div className="flex justify-between text-xs text-gray-600">
                    <span>Used: {memoryUsed} GB</span>
                    <span>Available: {(memoryTotal - memoryUsed).toFixed(1)} GB</span>
                </div>
            </div>

            {/* Disk Usage */}
            {drives.length > 0 && (
                <div className="space-y-3">
                    <div className="flex items-center space-x-3">
                        <div className="p-2 bg-orange-100 rounded-lg">
                            <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                            </svg>
                        </div>
                        <div className="text-sm font-medium text-gray-900">Disk Usage</div>
                    </div>
                    <div className="space-y-3">
                        {drives.map(drive => (
                            <div key={drive.mountpoint} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                    <span className="text-gray-700 font-medium truncate max-w-[60%]">{drive.mountpoint}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-gray-500">{drive.avail} GB free</span>
                                        <StatusBadge status={getUsageStatus(drive.percent)} variant="soft" size="small">
                                            {drive.percent}%
                                        </StatusBadge>
                                        {!drive.isHealthDrive && (
                                            <span className="text-gray-400 text-[10px]">OS</span>
                                        )}
                                    </div>
                                </div>
                                <div className="w-full bg-gray-200 rounded-full h-1.5 overflow-hidden">
                                    <div
                                        className={`h-full ${getUsageColor(drive.isHealthDrive ? drive.percent : Math.min(drive.percent, 49))} transition-all duration-300 ease-out`}
                                        style={{ width: `${drive.percent}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* System Health Summary — only considers health (non-OS) drives */}
            <div className={`p-4 rounded-lg border ${
                Math.max(cpu, memoryUsage, worstDrive?.percent ?? 0) < 50 ? 'bg-emerald-50 border-emerald-200' :
                Math.max(cpu, memoryUsage, worstDrive?.percent ?? 0) < 80 ? 'bg-amber-50 border-amber-200' :
                'bg-red-50 border-red-200'
            }`}>
                <div className="flex items-center space-x-2">
                    <svg className={`w-4 h-4 ${
                        Math.max(cpu, memoryUsage, worstDrive?.percent ?? 0) < 50 ? 'text-emerald-600' :
                        Math.max(cpu, memoryUsage, worstDrive?.percent ?? 0) < 80 ? 'text-amber-600' :
                        'text-red-600'
                    }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className={`text-sm font-medium ${
                        Math.max(cpu, memoryUsage, worstDrive?.percent ?? 0) < 50 ? 'text-emerald-800' :
                        Math.max(cpu, memoryUsage, worstDrive?.percent ?? 0) < 80 ? 'text-amber-800' :
                        'text-red-800'
                    }`}>
                        {Math.max(cpu, memoryUsage, worstDrive?.percent ?? 0) < 50 ? 'System running optimally' :
                         Math.max(cpu, memoryUsage, worstDrive?.percent ?? 0) < 80 ? 'System under moderate load' :
                         'System under heavy load'}
                    </span>
                </div>
            </div>
        </div>
    )
}

export default EnhancedServerStats