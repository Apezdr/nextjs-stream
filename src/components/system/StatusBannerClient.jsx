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
      const statusLevels = ['normal', 'elevated', 'heavy', 'critical'];
      
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
  
  // Track dismissal and status level changes
  const [dismissed, setDismissed] = useState(false);
  const [trackedLevel, setTrackedLevel] = useState(status.level);
  
  // Reset dismissal when status level changes (React-approved pattern for deriving state from props)
  if (trackedLevel !== status.level) {
    setTrackedLevel(status.level);
    setDismissed(false);
  }
  
  // Derive visibility: not dismissed (critical status forces visibility through reset above)
  const visible = !dismissed;
  
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
  
  // State for auto-dock behavior
  const [docked, setDocked] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Auto-dock timer for elevated/heavy status (not critical)
  useEffect(() => {
    if (status.level === 'elevated' || status.level === 'heavy') {
      const timer = setTimeout(() => {
        setDocked(true);
      }, 4000); // 4 seconds

      return () => clearTimeout(timer);
    }
  }, [status.level]);

  // Get status styling based on level and UI state
  const getStatusInfo = () => {
    const baseInfo = {
      critical: {
        borderColor: 'border-l-red-400',
        chipBg: 'bg-red-400/15',
        chipText: 'text-red-200',
        chipBorder: 'border-red-400/25',
        icon: '🚨',
        label: 'CRITICAL',
        description: 'System Performance Degraded'
      },
      heavy: {
        borderColor: 'border-l-orange-400',
        chipBg: 'bg-orange-400/15',
        chipText: 'text-orange-200',
        chipBorder: 'border-orange-400/25',
        icon: '⚠️',
        label: 'HIGH LOAD',
        description: 'Performance May Be Affected'
      },
      elevated: {
        borderColor: 'border-l-amber-400',
        chipBg: 'bg-amber-400/15',
        chipText: 'text-amber-200',
        chipBorder: 'border-amber-400/25',
        icon: '⚡',
        label: 'ELEVATED',
        description: 'System Under Increased Load'
      },
      normal: {
        borderColor: 'border-l-blue-400',
        chipBg: 'bg-blue-400/15',
        chipText: 'text-blue-200',
        chipBorder: 'border-blue-400/25',
        icon: 'ℹ️',
        label: 'INFO',
        description: 'System Status Update'
      }
    };

    return baseInfo[status.level] || baseInfo.normal;
  };

  if (!visible) {
    return null;
  }

  const statusInfo = getStatusInfo();
  
  // Critical status always shows full-width banner
  if (status.level === 'critical') {
    return (
      <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white shadow-lg border-b-2 border-red-800">
        <div className="container mx-auto px-4 py-3">
          <div className="flex justify-between items-center gap-3">
            <div className="flex items-center gap-3 flex-1">
              <span className="text-xl" aria-hidden="true">{statusInfo.icon}</span>
              <div>
                <div className="font-semibold text-sm">{statusInfo.description}</div>
                <p className="text-sm opacity-90">{status.message}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button 
                onClick={handleManualRefresh}
                disabled={isLoading}
                className="p-2 rounded hover:bg-red-700 transition-colors"
                aria-label="Refresh status"
              >
                <svg 
                  className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="p-2 rounded hover:bg-red-700 transition-colors"
                aria-label="Dismiss"
              >
                ×
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Elevated/Heavy status: floating pill with auto-dock
  if (docked && !expanded) {
    // Docked state - compact pill on left edge
    return (
      <div 
        className="fixed bottom-4 sm:top-20 left-3 sm:left-3 z-50 group cursor-pointer"
        onClick={() => setExpanded(true)}
        onMouseEnter={() => setExpanded(true)}
      >
        <div className="rounded-full bg-[rgba(18,18,24,0.55)] backdrop-blur-md border border-white/10 shadow-lg px-3 py-2 flex items-center gap-2 transition-all duration-300 hover:bg-[rgba(18,18,24,0.75)]">
          <span className="text-sm" aria-hidden="true">{statusInfo.icon}</span>
          <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></div>
          <span className="text-[10px] relative top-[1px] font-medium text-white opacity-35 sm:group-hover:opacity-100 transition-opacity duration-200 whitespace-nowrap">
            {statusInfo.label}
          </span>
        </div>
      </div>
    );
  }

  // Expanded floating pill
  return (
    <>
      {/* Backdrop for expanded state */}
      {expanded && (
        <div 
          className="fixed inset-0 z-40 bg-black/20"
          onClick={() => setExpanded(false)}
        />
      )}
      
      {/* Floating pill */}
      <div className={`fixed z-50 transition-all duration-300 ease-out ${
        docked && expanded 
          ? 'top-16 left-4 w-[min(92vw,480px)]' // Expanded from dock
          : 'top-4 left-1/2 -translate-x-1/2 w-[min(92vw,560px)]' // Initial center position
      }`}>
        <div className={`
          rounded-2xl bg-[rgba(18,18,24,0.62)] backdrop-blur-md 
          shadow-[0_12px_40px_rgba(0,0,0,0.45)] 
          border border-white/10 ${statusInfo.borderColor}
          p-4 pr-12 transition-all duration-300 relative
        `}>
          {/* Close button - top right corner */}
          <button
            onClick={() => setDismissed(true)}
            className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-white/10 transition-all duration-200 text-white/50 hover:text-white text-lg leading-none"
            aria-label="Dismiss"
            title="Dismiss notification"
          >
            ×
          </button>

          <div className="flex flex-col sm:flex-row items-start gap-3">
            <div className="flex flex-col sm:flex-row items-start gap-3 flex-1 min-w-0">
              {/* Status Icon & Chip */}
              <div className="flex items-center gap-2 flex-shrink-0">
                <span className="text-lg" aria-hidden="true">{statusInfo.icon}</span>
                <div className={`
                  text-[11px] font-semibold px-2 py-0.5 rounded-full
                  ${statusInfo.chipBg} ${statusInfo.chipText} border ${statusInfo.chipBorder}
                `}>
                  {statusInfo.label}
                </div>
              </div>
              
              {/* Status Content */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white mb-0.5">
                  {statusInfo.description}
                </div>
                <p className="text-xs text-white/70 leading-relaxed">
                  {status.message}
                </p>
                
                {/* Meta information */}
                {status.isIncidentActive && (
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-white/50">
                    {status.incidentStartedAt && (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        Started {formatTimeAgo(status.incidentStartedAt)}
                      </span>
                    )}
                    {status.serverId && (
                      <span className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm1 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V8zm1 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1v-2z" clipRule="evenodd" />
                        </svg>
                        Server: {status.serverId}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
            
            {/* Refresh button - bottom right of content */}
            <div className="flex items-end justify-end flex-shrink-0 mt-2 sm:mt-0">
              <button 
                onClick={handleManualRefresh}
                disabled={isLoading}
                className={`
                  p-1.5 rounded-lg hover:bg-white/10 transition-all duration-200 text-white/50 hover:text-white
                  ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}
                `}
                aria-label="Refresh status"
                title="Check for status updates"
              >
                <svg 
                  className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
