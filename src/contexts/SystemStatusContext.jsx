'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';

const SystemStatusContext = createContext();

/**
 * Provider component for system status information
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export function SystemStatusProvider({ children }) {
  const { data: session, status: authStatus } = useSession();
  const [systemStatus, setSystemStatus] = useState({
    overall: { level: 'normal', message: 'All systems operational' },
    servers: []
  });
  const [loading, setLoading] = useState(true);
  const [etag, setEtag] = useState(null);
  
  const fetchSystemStatus = useCallback(async () => {
    if (authStatus !== 'authenticated' || !session) {
      return;
    }
    
    try {
      setLoading(true);
      
      // Include ETag from previous request if available
      const headers = {};
      if (etag) {
        headers['If-None-Match'] = etag;
      }
      
      const response = await fetch('/api/authenticated/system-status', {
        headers,
        cache: 'no-cache' // Force validation against the server
      });
      
      // If 304 Not Modified, keep using current state
      if (response.status === 304) {
        setLoading(false);
        return;
      }
      
      if (!response.ok) {
        throw new Error(`Failed to fetch system status: ${response.status}`);
      }
      
      // Store new ETag for future requests
      const newEtag = response.headers.get('etag');
      if (newEtag) {
        setEtag(newEtag);
      }
      
      const data = await response.json();
      setSystemStatus(data);
    } catch (error) {
      console.error('Error fetching system status:', error);
    } finally {
      setLoading(false);
    }
  }, [authStatus, session, etag]);
  
  useEffect(() => {
    // Only fetch if the user is authenticated
    if (authStatus !== 'authenticated' || !session) {
      return;
    }
    
    // Initial fetch
    fetchSystemStatus();
    
    // Set up polling interval (every 30 seconds is a good balance)
    const interval = setInterval(fetchSystemStatus, 30000);
    
    return () => clearInterval(interval);
  }, [authStatus, session, fetchSystemStatus]);
  
  // If user is not authenticated, don't provide any status data
  if (authStatus !== 'authenticated' || !session) {
    return <>{children}</>;
  }
  
  return (
    <SystemStatusContext.Provider value={{ status: systemStatus, loading, refetch: fetchSystemStatus }}>
      {children}
    </SystemStatusContext.Provider>
  );
}

/**
 * Hook to access system status
 * @returns {Object} System status context
 */
export function useSystemStatus() {
  const context = useContext(SystemStatusContext);
  if (context === undefined) {
    throw new Error('useSystemStatus must be used within a SystemStatusProvider');
  }
  return context;
}
