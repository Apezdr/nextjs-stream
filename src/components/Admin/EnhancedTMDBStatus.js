'use client'

import { useEffect, useState, useCallback } from 'react'
import { testTMDBConnection, validateTMDBConfiguration } from '@src/utils/tmdb/client'
import { MaterialCard, MaterialCardHeader, MaterialCardContent, MaterialButton, StatusBadge } from './BaseComponents'

/**
 * Enhanced TMDB Server Status Component with Material Design styling
 */
export function EnhancedTMDBStatus() {
  const [status, setStatus] = useState({
    loading: true,
    connection: null,
    validation: null,
    lastChecked: null
  })

  const [isRefreshing, setIsRefreshing] = useState(false)

  const checkTMDBStatus = useCallback(async () => {
    try {
      const [connectionTest, validation] = await Promise.all([
        testTMDBConnection(),
        validateTMDBConfiguration()
      ])

      setStatus({
        loading: false,
        connection: connectionTest,
        validation,
        lastChecked: new Date().toISOString()
      })
    } catch (error) {
      console.error('Error checking TMDB status:', error)
      setStatus({
        loading: false,
        connection: {
          success: false,
          error: error.message,
          timestamp: new Date().toISOString()
        },
        validation: null,
        lastChecked: new Date().toISOString()
      })
    }
  }, [])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await checkTMDBStatus()
    setIsRefreshing(false)
  }

  useEffect(() => {
    // Async function inside effect to satisfy ESLint rule
    const fetchStatus = async () => {
      try {
        const [connectionTest, validation] = await Promise.all([
          testTMDBConnection(),
          validateTMDBConfiguration()
        ])

        setStatus({
          loading: false,
          connection: connectionTest,
          validation,
          lastChecked: new Date().toISOString()
        })
      } catch (error) {
        console.error('Error checking TMDB status:', error)
        setStatus({
          loading: false,
          connection: {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
          },
          validation: null,
          lastChecked: new Date().toISOString()
        })
      }
    }

    // Initial fetch
    fetchStatus()
    
    // Set up polling interval using the callback
    const interval = setInterval(() => {
      checkTMDBStatus()
    }, 30000)
    
    return () => clearInterval(interval)
  }, [checkTMDBStatus])

  const { connection, validation } = status
  const isOverallHealthy = connection?.success && validation?.overall

  if (status.loading) {
    return (
      <MaterialCard elevation="medium">
        <MaterialCardHeader
          title="TMDB Server Status"
          subtitle="Checking connection..."
          icon={
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
            </svg>
          }
        />
        <MaterialCardContent>
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </MaterialCardContent>
      </MaterialCard>
    )
  }

  return (
    <MaterialCard elevation="medium">
      <MaterialCardHeader
        title="TMDB Server Status"
        subtitle="The Movie Database connectivity and configuration"
        icon={
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
          </svg>
        }
        action={
          <div className="flex items-center space-x-3">
            <StatusBadge
              status={isOverallHealthy ? 'success' : 'error'}
              variant="soft"
            >
              {isOverallHealthy ? 'Healthy' : 'Issues'}
            </StatusBadge>
            <MaterialButton
              variant="outlined"
              size="small"
              onClick={handleRefresh}
              loading={isRefreshing}
              startIcon={
                !isRefreshing && (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                )
              }
            >
              Refresh
            </MaterialButton>
          </div>
        }
      />

      <MaterialCardContent>
        {/* Connection Status Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Server URL</span>
              <StatusBadge
                status={validation?.serverURL?.configured ? 'success' : 'error'}
                size="small"
                variant="soft"
              >
                {validation?.serverURL?.configured ? 'Configured' : 'Missing'}
              </StatusBadge>
            </div>
            {validation?.serverURL?.value && (
              <p className="text-xs text-gray-500 truncate" title={validation.serverURL.value}>
                {validation.serverURL.value}
              </p>
            )}
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">Connectivity</span>
              <StatusBadge
                status={connection?.success ? 'success' : 'error'}
                size="small"
                variant="soft"
              >
                {connection?.success ? 'Connected' : 'Failed'}
              </StatusBadge>
            </div>
            {connection?.responseTime && (
              <p className="text-xs text-gray-500">
                {connection.responseTime}ms response time
              </p>
            )}
          </div>

          <div className="bg-gray-50 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700">TMDB API</span>
              <StatusBadge
                status={connection?.tmdbConfigured ? 'success' : 'error'}
                size="small"
                variant="soft"
              >
                {connection?.tmdbConfigured ? 'Active' : 'Inactive'}
              </StatusBadge>
            </div>
          </div>
        </div>

        {/* Error Details */}
        {(!connection?.success || !validation?.overall) && (
          <div className="mb-6">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Issues Detected</h4>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <ul className="space-y-2 text-sm text-red-700">
                {!validation?.serverURL?.configured && (
                  <li className="flex items-start space-x-2">
                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></span>
                    <span>TMDB server URL not configured (set TMDB_NODE_SERVER_URL environment variable)</span>
                  </li>
                )}
                {validation?.serverURL?.configured && !validation?.serverURL?.valid && (
                  <li className="flex items-start space-x-2">
                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></span>
                    <span>Invalid server URL format: {validation.serverURL.error}</span>
                  </li>
                )}
                {!validation?.connectivity?.reachable && validation?.connectivity?.error && (
                  <li className="flex items-start space-x-2">
                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></span>
                    <span>Connection failed: {validation.connectivity.error}</span>
                  </li>
                )}
                {connection?.success && !connection?.tmdbConfigured && (
                  <li className="flex items-start space-x-2">
                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></span>
                    <span>TMDB API not properly configured on the server</span>
                  </li>
                )}
                {connection?.error && (
                  <li className="flex items-start space-x-2">
                    <span className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></span>
                    <span>{connection.error}</span>
                  </li>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Health Details */}
        {connection?.success && connection?.details && (
          <div className="mb-4">
            <h4 className="text-sm font-semibold text-gray-900 mb-3">Health Details</h4>
            <div className="bg-gray-50 rounded-lg p-4">
              <pre className="text-xs text-gray-600 overflow-x-auto whitespace-pre-wrap">
                {JSON.stringify(connection.details, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Last Checked */}
        {status.lastChecked && (
          <div className="text-xs text-gray-500 text-center border-t border-gray-200 pt-4">
            Last checked: {new Date(status.lastChecked).toLocaleString()}
          </div>
        )}
      </MaterialCardContent>
    </MaterialCard>
  )
}

export default EnhancedTMDBStatus