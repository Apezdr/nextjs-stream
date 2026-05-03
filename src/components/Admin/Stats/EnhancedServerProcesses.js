'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { buildURL, fetcher } from '@src/utils'
import { StatusBadge, MaterialButton } from '../BaseComponents'
import ServerProcessesModal from './ServerProcessesModal'

function ProcessCard({ serverName, processes }) {
    const activeProcesses = processes.filter(proc => proc.status !== 'completed')
    
    if (activeProcesses.length === 0) return null

    // Group processes by type for better display
    const groupedProcesses = activeProcesses.reduce((acc, proc) => {
        const key = proc.process_type || 'Unknown'
        if (!acc[key]) acc[key] = []
        acc[key].push(proc)
        return acc
    }, {})

    const getStatusColor = (status) => {
        switch (status) {
            case 'running': return 'success'
            case 'pending': return 'warning'
            case 'error': return 'error'
            case 'completed': return 'success'
            default: return 'neutral'
        }
    }

    return (
        <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                    <div className="p-1.5 bg-blue-100 rounded-md">
                        <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2" />
                        </svg>
                    </div>
                    <div>
                        <div className="text-sm font-medium text-gray-900">{serverName}</div>
                        <div className="text-xs text-gray-500">{activeProcesses.length} active processes</div>
                    </div>
                </div>
                <StatusBadge 
                    status={activeProcesses.length > 5 ? 'warning' : 'success'} 
                    variant="soft" 
                    size="small"
                >
                    {activeProcesses.length > 5 ? 'High Load' : 'Normal'}
                </StatusBadge>
            </div>

            <div className="space-y-2">
                {Object.entries(groupedProcesses).map(([processType, procs]) => (
                    <div key={processType} className="flex items-center justify-between text-xs">
                        <div className="flex items-center space-x-2">
                            <div className="w-2 h-2 bg-blue-400 rounded-full"></div>
                            <span className="font-medium text-gray-700">{processType}</span>
                        </div>
                        <div className="flex items-center space-x-2">
                            <span className="text-gray-600">{procs.length}×</span>
                            <StatusBadge 
                                status={getStatusColor(procs[0]?.status)} 
                                variant="soft" 
                                size="tiny"
                            >
                                {procs[0]?.status || 'unknown'}
                            </StatusBadge>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}

function SyncProcessCard({ startTime, onViewClick }) {
    const [elapsed, setElapsed] = useState(() =>
        startTime ? Math.round((Date.now() - new Date(startTime).getTime()) / 1000) : null
    )

    useEffect(() => {
        if (!startTime) return
        const tick = () => setElapsed(Math.round((Date.now() - new Date(startTime).getTime()) / 1000))
        tick()
        const id = setInterval(tick, 1000)
        return () => clearInterval(id)
    }, [startTime])

    return (
        <div className="bg-blue-50 rounded-lg p-4 space-y-3 border border-blue-200 mb-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                    <div className="p-1.5 bg-blue-100 rounded-md">
                        <svg className="w-4 h-4 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                    </div>
                    <div>
                        <div className="text-sm font-medium text-gray-900">Media Sync</div>
                        <div className="text-xs text-gray-500">
                            {elapsed != null ? `Running for ${elapsed >= 60 ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s` : `${elapsed}s`}` : 'Running...'}
                        </div>
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <StatusBadge status="info" variant="soft" size="small">Syncing</StatusBadge>
                    {onViewClick && (
                        <MaterialButton
                            variant="text"
                            size="small"
                            color="primary"
                            onClick={onViewClick}
                            startIcon={
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            }
                        >
                            View Info
                        </MaterialButton>
                    )}
                </div>
            </div>
        </div>
    )
}

/**
 * Material Design server processes component with clean, modern styling
 */
const EnhancedServerProcesses = ({ onSyncViewClick }) => {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const { data, error } = useSWR(buildURL('/api/authenticated/admin/server-processes'), fetcher, {
        refreshInterval: 5000,
    })

    // Poll sync status to show active sync in processes list
    const { data: syncStatus } = useSWR(buildURL('/api/authenticated/admin/sync-status'), fetcher, {
        refreshInterval: 3000,
    })

    const hasDataError = Boolean(data && !Array.isArray(data) && data.error)
    const serverProcesses = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []

    if (error || hasDataError) {
        return (
            <div className="p-6 text-center">
                <div className="text-red-600 text-sm">Failed to load server processes</div>
            </div>
        )
    }

    if (!data) {
        return (
            <div className="p-6 text-center">
                <div className="animate-pulse">
                    <div className="space-y-3">
                        <div className="h-4 bg-gray-200 rounded w-2/3 mx-auto"></div>
                        <div className="space-y-2">
                            <div className="h-16 bg-gray-200 rounded"></div>
                            <div className="h-16 bg-gray-200 rounded"></div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="h-12 bg-gray-200 rounded"></div>
                            <div className="h-12 bg-gray-200 rounded"></div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    const isSyncActive = syncStatus?.active === true

    const activeServers = serverProcesses.filter(server =>
        server.processes &&
        server.processes.some(proc => proc.status !== 'completed')
    )

    const totalActiveProcesses = activeServers.reduce((total, server) => {
        return total + server.processes.filter(proc => proc.status !== 'completed').length
    }, 0) + (isSyncActive ? 1 : 0)

    if (activeServers.length === 0 && !isSyncActive) {
        return (
            <div className="p-6 text-center">
                <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200">
                    <div className="flex items-center justify-center space-x-2">
                        <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="text-sm font-medium text-emerald-800">No active processes</span>
                    </div>
                    <div className="text-xs text-emerald-600 mt-1">All systems are idle</div>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6 space-y-4">
            {/* Summary Header */}
            <div className="flex items-center justify-between pb-3 border-b border-gray-200">
                <div>
                    <div className="text-sm font-medium text-gray-900">Active Server Processes</div>
                    <div className="text-xs text-gray-500">
                        {totalActiveProcesses} running across {activeServers.length} servers
                    </div>
                </div>
                <div className="flex items-center space-x-2">
                    <StatusBadge
                        status={totalActiveProcesses > 10 ? 'warning' : totalActiveProcesses > 0 ? 'info' : 'success'}
                        variant="soft"
                    >
                        {totalActiveProcesses > 10 ? 'High Activity' :
                         totalActiveProcesses > 0 ? 'Active' : 'Idle'}
                    </StatusBadge>
                    <MaterialButton
                        variant="text"
                        size="small"
                        color="primary"
                        onClick={() => setIsModalOpen(true)}
                        startIcon={
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                            </svg>
                        }
                    >
                        View All
                    </MaterialButton>
                </div>
            </div>

            {/* Sync Process Card */}
            {isSyncActive && (
                <SyncProcessCard
                    startTime={syncStatus.startTime}
                    onViewClick={onSyncViewClick}
                />
            )}

            {/* Server Process Cards */}
            <div className="space-y-3">
                {activeServers.map(server => (
                    <ProcessCard
                        key={server.server}
                        serverName={server.server}
                        processes={server.processes}
                    />
                ))}
            </div>

            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-4 pt-3 border-t border-gray-200">
                <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{activeServers.length}</div>
                    <div className="text-xs text-gray-500">Active Servers</div>
                </div>
                <div className="text-center">
                    <div className="text-lg font-bold text-gray-900">{totalActiveProcesses}</div>
                    <div className="text-xs text-gray-500">Running Tasks</div>
                </div>
            </div>
            {/* Server Processes Modal */}
            <ServerProcessesModal
                isOpen={isModalOpen}
                setIsOpen={setIsModalOpen}
                onSyncViewClick={onSyncViewClick}
            />
        </div>
    )
}

export default EnhancedServerProcesses