'use client';

import { createContext, useContext } from 'react';
import useSWR from 'swr';
import { fetcher } from '@src/utils';

const SystemStatusContext = createContext();

/**
 * Provider component for system status information
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export function SystemStatusProvider({ children }) {
  // Use SWR for data fetching with automatic polling
  // The API endpoint will handle authentication checks
  const {
    data: systemStatus,
    error,
    isLoading: loading,
    mutate: refetch
  } = useSWR(
    '/api/authenticated/system-status',
    fetcher,
    {
      refreshInterval: 30000, // Poll every 30 seconds
      revalidateOnFocus: true, // Revalidate when window gains focus
      revalidateOnReconnect: true, // Revalidate when network reconnects
      dedupingInterval: 5000, // Dedupe requests within 5 seconds
      errorRetryInterval: 10000, // Retry failed requests every 10 seconds
      errorRetryCount: 3, // Retry failed requests up to 3 times
      fallbackData: {
        overall: { level: 'normal', message: 'All systems operational' },
        servers: []
      },
      // Don't throw on error, just return fallback data
      shouldRetryOnError: false,
      onError: (error) => {
        // Silently handle auth errors - API will return 401 for unauthenticated users
        console.debug('System status fetch error (expected for unauthenticated users):', error.message);
      }
    }
  );
  
  // Always provide context, even if user is not authenticated
  const contextValue = {
    status: systemStatus || {
      overall: { level: 'normal', message: 'All systems operational' },
      servers: []
    },
    loading,
    error,
    refetch
  };
  
  return (
    <SystemStatusContext.Provider value={contextValue}>
      {children}
    </SystemStatusContext.Provider>
  );
}

/**
 * Hook to access system status
 * @returns {Object} System status context including data, loading state, error, and refetch function
 */
export function useSystemStatus() {
  const context = useContext(SystemStatusContext);
  if (context === undefined) {
    throw new Error('useSystemStatus must be used within a SystemStatusProvider');
  }
  return context;
}
