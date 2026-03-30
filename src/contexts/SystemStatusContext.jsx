'use client';

import { createContext, useContext } from 'react';
import useSWR from 'swr';
import { fetcher } from '@src/utils';
import { authClient } from '@src/lib/auth-client';

const SystemStatusContext = createContext();

/**
 * Provider component for system status information
 * @param {Object} props - Component props
 * @param {React.ReactNode} props.children - Child components
 */
export function SystemStatusProvider({ children }) {
  // Check auth state to avoid unnecessary API calls
  const { data: session, isPending } = authClient.useSession();
  
  // Only fetch system status if user is authenticated
  // This prevents 401 errors for unauthenticated users
  const shouldFetch = Boolean(session?.user && !isPending);
  
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
    // During hydration, the context might not be available yet
    // Return a safe fallback instead of throwing an error
    return {
      status: {
        overall: { level: 'normal', message: 'All systems operational' },
        servers: []
      },
      loading: false,
      error: null,
      refetch: () => Promise.resolve()
    };
  }
  return context;
}
