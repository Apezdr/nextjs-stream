'use client';

import { useState, useEffect, useCallback } from 'react';

/**
 * Format a date string as "time ago"
 * @param {string} dateStr - ISO date string
 * @returns {string} Human-readable time ago
 */
function formatTimeAgo(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/**
 * Fetches the latest system status from the API
 * @returns {Promise<Object|null>} The system status or null if fetch failed
 */
async function fetchSystemStatus() {
  try {
    const response = await fetch('/api/authenticated/system-status', {
      method: 'GET',
      headers: {
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      },
      next: { revalidate: 0 } // Ensure fresh data
    });
    
    if (!response.ok) {
      console.error('Failed to fetch system status:', response.statusText);
      return null;
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching system status:', error);
    return null;
  }
}

/**
 * Client-side banner component that handles dismissal and styling
 * Periodically refreshes status data
 */
export default function StatusBannerClient({ status: initialStatus }) {
  const [visible, setVisible] = useState(true);
  const [status, setStatus] = useState(initialStatus);
  const [timeAgoRefresh, setTimeAgoRefresh] = useState(0); // Trigger time ago refreshes
  
  // Function to refresh status data
  const refreshStatus = useCallback(async () => {
    const freshStatus = await fetchSystemStatus();
    if (freshStatus && freshStatus.servers) {
      const statusLevels = ['normal', 'heavy', 'critical'];
      
      // Find the server with the worst status level
      const serverWithWorstStatus = freshStatus.servers.reduce((worst, current) => {
        if (!worst) return current;
        
        // Check both 'level' and 'status' fields since API might use either
        const currentLevel = current.level || current.status || 'normal';
        const worstLevel = worst.level || worst.status || 'normal';
        
        const currentIndex = statusLevels.indexOf(currentLevel);
        const worstIndex = statusLevels.indexOf(worstLevel);
        
        return currentIndex > worstIndex ? current : worst;
      }, null);
      
      // Check if we have a server with non-normal status
      if (serverWithWorstStatus && 
          (serverWithWorstStatus.level || serverWithWorstStatus.status) !== 'normal' &&
          (serverWithWorstStatus.level || serverWithWorstStatus.status) !== 'unknown') {
        setStatus({
          level: serverWithWorstStatus.level || serverWithWorstStatus.status,
          message: serverWithWorstStatus.message || freshStatus.overall.message,
          isIncidentActive: !!serverWithWorstStatus.incident,
          incidentStartedAt: serverWithWorstStatus.incident?.startedAt,
          serverId: serverWithWorstStatus.serverId
        });
      } else if (freshStatus.overall.level !== 'normal') {
        // Use overall status if no server has issues
        setStatus({
          level: freshStatus.overall.level,
          message: freshStatus.overall.message,
          isIncidentActive: freshStatus.hasActiveIncidents,
          incidentStartedAt: null,
          serverId: null
        });
      } else {
        // No status issues, clear any previous status
        setStatus(initialStatus);
      }
      
      // If status was previously dismissed but now there's a critical issue, show it again
      if ((serverWithWorstStatus?.level === 'critical' || freshStatus.overall.level === 'critical') && !visible) {
        setVisible(true);
      }
    }
  }, [initialStatus, visible]);
  
  // Periodically refresh status data (every 2 minutes)
  useEffect(() => {
    const interval = setInterval(refreshStatus, 120000); // 2 minutes
    
    // Refresh time ago display more frequently (every 30 seconds)
    const timeAgoInterval = setInterval(() => {
      setTimeAgoRefresh(prev => prev + 1);
    }, 30000);
    
    return () => {
      clearInterval(interval);
      clearInterval(timeAgoInterval);
    };
  }, [refreshStatus]);
  
  // Reset visibility when status level changes to a more severe level
  useEffect(() => {
    if (status.level === 'critical' || !visible) {
      setVisible(true);
    }
  }, [status.level, visible]);
  
  // Track loading state for refresh button
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Handle manual refresh
  const handleManualRefresh = async () => {
    setIsRefreshing(true);
    await refreshStatus();
    setIsRefreshing(false);
  };
  
  // Determine banner style based on status level
  const getBannerStyle = () => {
    switch (status.level) {
      case 'critical':
        return 'bg-red-600 text-white';
      case 'heavy':
        return 'bg-yellow-500 text-white';
      default:
        return 'bg-blue-500 text-white';
    }
  };
  
  if (!visible) {
    return null;
  }
  
  return (
    <div className={`fixed top-0 left-0 right-0 z-50 p-2 ${getBannerStyle()}`}>
      <div className="container mx-auto flex justify-between items-center">
        <div className="flex items-center">
          {status.level === 'critical' && (
            <span className="mr-2" aria-hidden="true">⚠️</span>
          )}
          <p className="font-medium">{status.message}</p>
          
          {/* If this is an active incident, show timing */}
          {status.isIncidentActive && status.incidentStartedAt && (
            <span className="ml-3 text-sm opacity-75">
              • Incident reported {formatTimeAgo(status.incidentStartedAt)}
            </span>
          )}
        </div>
        
        <div className="flex items-center">
          <button 
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            className="text-white hover:text-gray-200 mr-3 flex items-center"
            aria-label="Refresh status"
            title="Check for status updates"
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`}
              viewBox="0 0 24 24" 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="2"
            >
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
          
          <button 
            onClick={() => setVisible(false)}
            className="text-white hover:text-gray-200"
            aria-label="Dismiss"
            title="Dismiss notification"
          >
            &times;
          </button>
        </div>
      </div>
    </div>
  );
}
