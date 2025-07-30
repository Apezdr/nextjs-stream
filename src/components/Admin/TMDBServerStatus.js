'use client'

import { useEffect, useState } from 'react'
import { testTMDBConnection, validateTMDBConfiguration } from '@src/utils/tmdb/client'

/**
 * TMDB Server Status Component for Admin Dashboard
 * Shows TMDB server connectivity, configuration status, and health metrics
 */
export function TMDBServerStatus() {
  const [status, setStatus] = useState({
    loading: true,
    connection: null,
    validation: null,
    lastChecked: null
  })

  const [isRefreshing, setIsRefreshing] = useState(false)

  const checkTMDBStatus = async () => {
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

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await checkTMDBStatus()
    setIsRefreshing(false)
  }

  useEffect(() => {
    checkTMDBStatus()
    
    // Auto-refresh every 30 seconds
    const interval = setInterval(checkTMDBStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  const getStatusColor = (isHealthy) => {
    return isHealthy ? 'text-green-600' : 'text-red-600'
  }

  const getStatusBadge = (isHealthy) => {
    return isHealthy 
      ? 'bg-green-100 text-green-800 border-green-200'
      : 'bg-red-100 text-red-800 border-red-200'
  }

  if (status.loading) {
    return (
      <div className="bg-white shadow-md rounded-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">TMDB Server Status</h3>
          <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
        </div>
        <p className="text-gray-600">Checking TMDB server status...</p>
      </div>
    )
  }

  const { connection, validation } = status
  const isOverallHealthy = connection?.success && validation?.overall

  return (
    <div className="bg-white shadow-md rounded-lg">
      <div className="px-6 py-4 border-b border-gray-200">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <h3 className="text-lg font-semibold text-gray-900">TMDB Server Status</h3>
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusBadge(isOverallHealthy)}`}>
              {isOverallHealthy ? 'Healthy' : 'Issues Detected'}
            </span>
          </div>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
          >
            {isRefreshing ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-2"></div>
            ) : (
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            )}
            Refresh
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Connection Status */}
        <div>
          <h4 className="text-sm font-medium text-gray-900 mb-3">Connection Status</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Server URL</span>
                <span className={`text-sm font-medium ${getStatusColor(validation?.serverURL?.configured)}`}>
                  {validation?.serverURL?.configured ? 'Configured' : 'Missing'}
                </span>
              </div>
              {validation?.serverURL?.value && (
                <p className="text-xs text-gray-500 mt-1 truncate" title={validation.serverURL.value}>
                  {validation.serverURL.value}
                </p>
              )}
            </div>

            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Connectivity</span>
                <span className={`text-sm font-medium ${getStatusColor(connection?.success)}`}>
                  {connection?.success ? 'Connected' : 'Failed'}
                </span>
              </div>
              {connection?.responseTime && (
                <p className="text-xs text-gray-500 mt-1">
                  {connection.responseTime}ms response time
                </p>
              )}
            </div>

            <div className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">TMDB API</span>
                <span className={`text-sm font-medium ${getStatusColor(connection?.tmdbConfigured)}`}>
                  {connection?.tmdbConfigured ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Error Details */}
        {(!connection?.success || !validation?.overall) && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-3">Issues</h4>
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <ul className="space-y-2 text-sm text-red-700">
                {!validation?.serverURL?.configured && (
                  <li>• TMDB server URL not configured (set TMDB_NODE_SERVER_URL environment variable)</li>
                )}
                {validation?.serverURL?.configured && !validation?.serverURL?.valid && (
                  <li>• Invalid server URL format: {validation.serverURL.error}</li>
                )}
                {!validation?.connectivity?.reachable && validation?.connectivity?.error && (
                  <li>• Connection failed: {validation.connectivity.error}</li>
                )}
                {connection?.success && !connection?.tmdbConfigured && (
                  <li>• TMDB API not properly configured on the server</li>
                )}
                {connection?.error && (
                  <li>• {connection.error}</li>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* Health Details */}
        {connection?.success && connection?.details && (
          <div>
            <h4 className="text-sm font-medium text-gray-900 mb-3">Health Details</h4>
            <div className="bg-gray-50 rounded-lg p-4">
              <pre className="text-xs text-gray-600 overflow-x-auto">
                {JSON.stringify(connection.details, null, 2)}
              </pre>
            </div>
          </div>
        )}

        {/* Last Checked */}
        {status.lastChecked && (
          <div className="text-xs text-gray-500 text-center">
            Last checked: {new Date(status.lastChecked).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  )
}

export default TMDBServerStatus