'use client';

import { useSystemStatus } from '@src/contexts/SystemStatusContext';
import { useState, useEffect, useRef } from 'react';

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
 * Status banner component that displays system health information
 */
export default function StatusBanner() {
  const { status, loading } = useSystemStatus();
  const [visible, setVisible] = useState(true);
  
  // Reset visibility when status changes to a more severe level
  useEffect(() => {
    const currentLevel = status.overall?.level;
    const previousLevel = previousStatus.current?.overall?.level;
    
    // Always show critical, reset visibility for any level change to a worse state
    if (currentLevel === 'critical' || 
        (currentLevel === 'heavy' && previousLevel === 'normal') || 
        !visible) {
      setVisible(true);
    }
    
    // Keep track of previous status
    previousStatus.current = status;
  }, [status, visible]);
  
  // Ref to keep track of previous status
  const previousStatus = useRef(status);
  
  // Only show banner for non-normal status
  if (loading || 
      !status.overall || 
      status.overall.level === 'normal' || 
      !visible) {
    return null;
  }
  
  // Determine banner style based on status level
  const getBannerStyle = () => {
    switch (status.overall.level) {
      case 'critical':
        return 'bg-red-600 text-white';
      case 'heavy':
        return 'bg-yellow-500 text-white';
      default:
        return 'bg-blue-500 text-white';
    }
  };
  
  return (
    <div className={`fixed top-0 left-0 right-0 z-50 p-2 ${getBannerStyle()}`}>
      <div className="container mx-auto flex justify-between items-center">
        <div className="flex items-center">
          {status.overall.level === 'critical' && (
            <span className="mr-2" aria-hidden="true">⚠️</span>
          )}
          <p className="font-medium">{status.overall.message}</p>
          
          {/* If any servers have active incidents, show incident timing */}
          {status.servers.some(s => s.isIncidentActive) && (
            <span className="ml-3 text-sm opacity-75">
              • Incident reported {formatTimeAgo(status.servers.find(s => s.isIncidentActive)?.incidentStartedAt)}
            </span>
          )}
        </div>
        
        <button 
          onClick={() => setVisible(false)}
          className="text-white hover:text-gray-200"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
