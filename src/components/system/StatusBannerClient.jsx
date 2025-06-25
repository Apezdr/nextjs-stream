'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSystemStatus } from '@src/contexts/SystemStatusContext';

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
 * Client-side banner component that handles dismissal and styling
 * Uses SystemStatusContext for data fetching with automatic refreshing
 */
export default function StatusBannerClient({ status: initialStatus }) {
  const [visible, setVisible] = useState(true);
  const [timeAgoRefresh, setTimeAgoRefresh] = useState(0); // Trigger time ago refreshes
  
  // Use SystemStatusContext for consistent data fetching
  const { status: contextStatus, loading: isLoading, refetch } = useSystemStatus();
  
  // Process the context data to determine the current status to display
  const status = useMemo(() => {
    // If context hasn't loaded data yet, use initial status
    if (!contextStatus) {
      return initialStatus;
    }
    
    const freshStatus = contextStatus;
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
        return {
          level: serverWithWorstStatus.level || serverWithWorstStatus.status,
          message: serverWithWorstStatus.message || freshStatus.overall.message,
          isIncidentActive: !!serverWithWorstStatus.incident,
          incidentStartedAt: serverWithWorstStatus.incident?.startedAt,
          serverId: serverWithWorstStatus.serverId
        };
      } else if (freshStatus.overall.level !== 'normal') {
        // Use overall status if no server has issues
        return {
          level: freshStatus.overall.level,
          message: freshStatus.overall.message,
          isIncidentActive: freshStatus.hasActiveIncidents,
          incidentStartedAt: null,
          serverId: null
        };
      }
    }
    
    // No status issues, use initial status
    return initialStatus;
  }, [contextStatus, initialStatus]);
  
  // Reset visibility when status level changes to critical
  useEffect(() => {
    if (status.level === 'critical') {
      setVisible(true);
    }
  }, [status.level]);
  
  // Refresh time ago display more frequently (every 30 seconds)
  useEffect(() => {
    const timeAgoInterval = setInterval(() => {
      setTimeAgoRefresh(prev => prev + 1);
    }, 30000);
    
    return () => clearInterval(timeAgoInterval);
  }, []);
  
  // Handle manual refresh using context's refetch function
  const handleManualRefresh = async () => {
    await refetch(); // This will trigger a fresh fetch through the context
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
            disabled={isLoading}
            className="text-white hover:text-gray-200 mr-3 flex items-center"
            aria-label="Refresh status"
            title="Check for status updates"
          >
            <svg 
              xmlns="http://www.w3.org/2000/svg" 
              className={`h-5 w-5 ${isLoading ? 'animate-spin' : ''}`}
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
