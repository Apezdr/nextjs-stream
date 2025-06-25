'use client';

import { createContext, useContext } from 'react';
import { useSession } from 'next-auth/react';
import useSWR from 'swr';
import { fetcher } from '@src/utils';

const SystemStatusContext = createContext();

/**
 * Provider component for system status information
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export function SystemStatusProvider({ children }) {
  const { data: session, status: authStatus } = useSession();
  
  // Only fetch if the user is authenticated
  const shouldFetch = authStatus === 'authenticated' && session;
  
  // Use SWR for data fetching with automatic polling
  const { 
    data: systemStatus, 
    error, 
    isLoading: loading, 
    mutate: refetch 
  } = useSWR(
    shouldFetch ? '/api/authenticated/system-status' : null,
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
      }
    }
  );
  
  // If user is not authenticated, don't provide any status data
  if (authStatus !== 'authenticated' || !session) {
    return <>{children}</>;
  }
  
  return (
    <SystemStatusContext.Provider 
      value={{ 
        status: systemStatus, 
        loading, 
        error,
        refetch 
      }}
    >
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
