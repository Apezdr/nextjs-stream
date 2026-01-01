'use client'

import { useState, useEffect } from 'react'
import { MaterialButton, StatusBadge, MetricCard } from './BaseComponents'
import { buildURL } from '@src/utils'
import WipeDbButton from '@src/app/(styled)/admin/WipeDBButton'

/**
 * Material Design dashboard header with key metrics and actions
 * @param {Object} props
 * @param {Function} [props.onSyncClick] - Sync button click handler
 * @param {Function} [props.onSettingsClick] - Settings button click handler
 * @param {string} [props.lastSyncTime] - Last sync time
 * @param {string} [props.organizrURL] - Organizr URL
 */
const DashboardHeader = ({
  onSyncClick,
  onSettingsClick,
  lastSyncTime,
  organizrURL
}) => {
  const [metrics, setMetrics] = useState({
    totalUsers: 0,
    activeProcesses: 0,
    systemHealth: 'unknown',
    loading: true
  })
  
  // State to force re-renders for time-based displays
  const [, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        // Fetch basic metrics from existing endpoints
        const [usersRes, processesRes] = await Promise.all([
          fetch(buildURL('/api/authenticated/admin/users')),
          fetch(buildURL('/api/authenticated/admin/server-processes'))
        ])

        const usersData = await usersRes.json()
        const processesData = await processesRes.json()

        // Calculate active processes across all servers
        const activeProcessCount = processesData.reduce((total, server) => {
          return total + server.processes.filter(p => p.status !== 'completed').length
        }, 0)

        // Determine system health based on sync time and processes
        let systemHealth = 'success'
        if (lastSyncTime === "Sync hasn't been run yet") {
          systemHealth = 'warning'
        }
        if (activeProcessCount > 10) {
          systemHealth = 'warning'
        }

        setMetrics({
          totalUsers: usersData.processedUserData?.data?.length || 0,
          activeProcesses: activeProcessCount,
          systemHealth,
          loading: false
        })
      } catch (error) {
        console.error('Error fetching dashboard metrics:', error)
        setMetrics(prev => ({ ...prev, loading: false, systemHealth: 'error' }))
      }
    }

    fetchMetrics()
    const interval = setInterval(fetchMetrics, 30000) // Update every 30 seconds
    return () => clearInterval(interval)
  }, [lastSyncTime])

  // Timer to update time-based displays every minute
  useEffect(() => {
    const updateTimer = setInterval(() => {
      setCurrentTime(new Date())
    }, 60000) // Update every minute

    return () => clearInterval(updateTimer)
  }, [])

  const getHealthStatus = () => {
    switch (metrics.systemHealth) {
      case 'success': return { status: 'success', text: 'Healthy' }
      case 'warning': return { status: 'warning', text: 'Warning' }
      case 'error': return { status: 'error', text: 'Issues' }
      default: return { status: 'neutral', text: 'Unknown' }
    }
  }

  const healthStatus = getHealthStatus()

  // Helper function to determine sync display value
  const getSyncDisplayValue = (syncTime) => {
    if (syncTime === "Sync hasn't been run yet") return 'Never'
    
    // Try to parse the sync time
    const syncDate = new Date(syncTime)
    if (isNaN(syncDate.getTime())) return 'Unknown'
    
    const now = new Date()
    const diffMs = now - syncDate
    const diffMinutes = Math.floor(diffMs / (1000 * 60))
    const diffHours = diffMs / (1000 * 60 * 60)
    
    // Show individual minutes for the first 15 minutes
    if (diffMinutes < 1) return 'Just now'
    if (diffMinutes <= 15) return `${diffMinutes} min${diffMinutes === 1 ? '' : 's'} ago`
    
    // After 15 minutes, use the prefab labels
    if (diffHours < 2) return 'Recent'
    if (diffHours < 24) return 'Today'
    if (diffHours < 48) return 'Yesterday'
    if (diffHours < 168) return 'This week' // 7 days
    return 'Outdated'
  }

  // Helper function to determine sync status
  const getSyncStatus = (syncTime) => {
    if (syncTime === "Sync hasn't been run yet") return 'warning'
    
    const syncDate = new Date(syncTime)
    if (isNaN(syncDate.getTime())) return 'error'
    
    const now = new Date()
    const diffHours = (now - syncDate) / (1000 * 60 * 60)
    
    if (diffHours < 24) return 'success'   // Recent
    if (diffHours < 168) return 'warning' // Within a week
    return 'error' // More than a week old
  }

  // Helper function to format sync time for subtitle display
  const formatSyncTimeSubtitle = (syncTime) => {
    if (syncTime === "Sync hasn't been run yet") return "Never run"
    
    const syncDate = new Date(syncTime)
    if (isNaN(syncDate.getTime())) return "Invalid date"
    
    // Check if it's today
    const now = new Date()
    const isSameDay = (date1, date2) => {
      return date1.getFullYear() === date2.getFullYear() &&
             date1.getMonth() === date2.getMonth() &&
             date1.getDate() === date2.getDate()
    }
    
    if (isSameDay(now, syncDate)) {
      return `Today at ${syncDate.toLocaleString('en-US', {
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true,
      })}`
    } else {
      return syncDate.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        second: 'numeric',
        hour12: true,
      })
    }
  }

  return (
    <div className="space-y-6 mb-8">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-blue-600 rounded-xl shadow-md">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Admin Dashboard
              </h1>
              <p className="text-gray-600 mt-1">
                System overview and management
              </p>
            </div>
          </div>
          <StatusBadge 
            status={healthStatus.status} 
            variant="soft"
            icon={
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
          >
            {healthStatus.text}
          </StatusBadge>
        </div>

        {/* Quick Actions */}
        <div className="flex flex-col sm:flex-row items-center space-x-3 space-y-3">
          <MaterialButton
            variant="outlined"
            color="primary"
            onClick={onSyncClick}
            startIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            }
          >
            Sync Media
          </MaterialButton>

          <div className="scale-90 origin-center">
            <WipeDbButton />
          </div>

          {organizrURL && (
            <MaterialButton
              variant="text"
              color="primary"
              onClick={() => window.open(organizrURL, '_blank')}
              startIcon={
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              }
            >
              Organizr
            </MaterialButton>
          )}

          <MaterialButton
            variant="text"
            color="neutral"
            onClick={onSettingsClick}
            startIcon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
          >
            Settings
          </MaterialButton>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          title="Total Users"
          value={metrics.loading ? '...' : metrics.totalUsers}
          icon={
            <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
          }
          status="info"
          subtitle="Registered users"
        />

        <MetricCard
          title="Active Processes"
          value={metrics.loading ? '...' : metrics.activeProcesses}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
          }
          status={metrics.activeProcesses > 5 ? 'warning' : 'success'}
          subtitle="Running tasks"
        />

        <MetricCard
          title="System Status"
          value={healthStatus.text}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          }
          status={healthStatus.status}
          subtitle="Overall health"
        />

        <MetricCard
          title="Last Sync"
          value={getSyncDisplayValue(lastSyncTime)}
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
          status={getSyncStatus(lastSyncTime)}
          subtitle={formatSyncTimeSubtitle(lastSyncTime)}
        />
      </div>
    </div>
  )
}

export default DashboardHeader