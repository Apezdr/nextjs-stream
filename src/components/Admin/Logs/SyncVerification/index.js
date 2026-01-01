'use client'
import React, { useState, Suspense, useCallback } from 'react';
import { buildURL } from '@src/utils';
import { PercentageBadge } from './Components/UIComponents';
import { formatNumber } from './utils';
import useSWR, { mutate } from 'swr';
import { ErrorBoundary } from 'react-error-boundary';
import { StatCardSkeleton } from './Components/LoadingStates';

// Tab imports
import OverviewTab from './Tabs/OverviewTab';
import ByCategoryTab from './Tabs/ByCategoryTab';
import AnalyticsTab from './Tabs/AnalyticsTab';
import DetailedIssuesTab from './Tabs/DetailedIssuesTab';
import { ArrowPathIcon } from '@heroicons/react/24/outline';

// Fetcher function for SWR
const fetcher = async (url) => {
  const response = await fetch(buildURL(url));
  if (!response.ok) {
    throw new Error(`Error fetching sync verification data: ${response.status}`);
  }
  return response.json();
};

// Loading state component
const LoadingIndicator = () => (
  <div className="flex items-center justify-center p-8">
    <div className="bg-white p-8 rounded-lg text-center">
      <div className="animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-500 mx-auto"></div>
      <p className="mt-4 text-gray-600">Loading sync verification data...</p>
    </div>
  </div>
);

// Error state component
const ErrorDisplay = ({ error, resetError }) => (
  <div className="bg-red-50 p-4 rounded-lg">
    <div className="flex">
      <div className="flex-shrink-0">
        <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      </div>
      <div className="ml-3">
        <h3 className="text-sm font-medium text-red-800">Error loading sync verification data</h3>
        <div className="mt-2 text-sm text-red-700">
          <p>{error.message}</p>
        </div>
        <div className="mt-4">
          <button
            type="button"
            onClick={resetError}
            className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-red-700 bg-red-100 hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  </div>
);

// Content component that uses Suspense with SWR
function SyncVerificationContent({ compareWithFileServers }) {
  const [activeTab, setActiveTab] = useState('overview');
  
  // Use SWR with suspense enabled
  const url = compareWithFileServers 
    ? `/api/authenticated/admin/sync-verification` 
    : `/api/authenticated/admin/sync-verification?compare=false`;
  
  const { data, isValidating } = useSWR(url, fetcher, { 
    suspense: true,
    revalidateOnFocus: false, 
    revalidateIfStale: false,
    shouldRetryOnError: true,
    errorRetryCount: 3
  });
  
  const { overview } = data;
  const generatedAt = new Date(overview.generatedAt).toLocaleString();
  
  return (
    <>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
        <h2 className="text-xl font-bold">Media Sync Verification</h2>
        
        <div className="text-xs text-gray-500 mt-2">
          Report generated at {generatedAt}
        </div>
      </div>
      
      {/* Overview stats */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-4">
          {isValidating ? (
            <>
              <StatCardSkeleton />
              <StatCardSkeleton />
              <StatCardSkeleton />
            </>
          ) : (
            <>
              <div className="flex-1 min-w-[200px] bg-gray-50 rounded-lg p-4">
                <div className="text-sm font-medium text-gray-500">Total Media Items</div>
                <div className="mt-1 text-3xl font-semibold">{formatNumber(overview.totalMedia)}</div>
              </div>
              
              <div className="flex-1 min-w-[200px] bg-gray-50 rounded-lg p-4">
                <div className="text-sm font-medium text-gray-500">Items With Issues</div>
                <div className="mt-1 text-3xl font-semibold">{formatNumber(overview.totalIssues)}</div>
              </div>
              
              <div className="flex-1 min-w-[200px] bg-gray-50 rounded-lg p-4">
                <div className="text-sm font-medium text-gray-500">Issue Percentage</div>
                <div className="mt-1 text-3xl font-semibold">
                  <PercentageBadge value={overview.issuePercentage} />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      
      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8 overflow-x-auto">
          <button
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'overview'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'byCategory'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('byCategory')}
          >
            By Media Type
          </button>
          <button
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'analytics'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('analytics')}
          >
            Analytics
          </button>
          <button
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'detailedIssues'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => setActiveTab('detailedIssues')}
          >
            Detailed Issues
          </button>
        </nav>
      </div>
      
        {/* Tab Content */}
        <div className="mt-6">
          {/* Each tab content is rendered conditionally based on activeTab, with loading state */}
          {activeTab === 'overview' && <OverviewTab data={data} isLoading={isValidating} />}
          {activeTab === 'byCategory' && <ByCategoryTab data={data} isLoading={isValidating} />}
          {activeTab === 'analytics' && <AnalyticsTab data={data} isLoading={isValidating} />}
          {activeTab === 'detailedIssues' && <DetailedIssuesTab data={data} isLoading={isValidating} />}
        </div>
    </>
  );
}

export default function SyncVerificationPanel() {
  const [compareWithFileServers, setCompareWithFileServers] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Create the actual refresh function that will be debounced
  const performRefresh = useCallback(async () => {
    setCompareWithFileServers(true);
    
    // Create a key for cache invalidation
    const url = `/api/authenticated/admin/sync-verification`;
    
    // Force cache revalidation to ensure Suspense is triggered
    return mutate(url)
      .then(() => {
        // Reset loading state after refresh completes (with small delay to ensure UI updates)
        setTimeout(() => {
          setIsRefreshing(false);
        }, 300);
      })
      .catch(() => {
        // Reset loading state if refresh fails
        setIsRefreshing(false);
      });
  }, []);
  
  // Create a debounced version of the refresh function
  // Using useCallback to ensure the debounced function doesn't get recreated on every render
  const refresh = useCallback(()=> performRefresh(),[performRefresh]);
  
  // This is the function that gets called when the refresh button is clicked
  const handleRefresh = useCallback(() => {
    // Set loading state immediately on button click for better UI feedback
    setIsRefreshing(true);
    
    refresh();
  }, [refresh]);

  return (
    <div className="text-black">
      <div className="bg-white rounded-lg shadow-lg p-6">
        {/* Main content with error boundary and suspense */}
        <ErrorBoundary
          FallbackComponent={({ error, resetErrorBoundary }) => (
            <ErrorDisplay error={error} resetError={resetErrorBoundary} />
          )}
          onReset={() => handleRefresh(compareWithFileServers)}
        >
          <Suspense fallback={<LoadingIndicator />}>
            {/* Refresh buttons section */}
            <div className="flex justify-end mb-4">
              <div className="flex space-x-3">
                <button 
                  onClick={() => handleRefresh()}
                  disabled={isRefreshing}
                  className={`group px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 text-sm relative ${
                    isRefreshing ? 'cursor-not-allowed opacity-70' : ''
                  }`}
                >
                  {isRefreshing ? (
                    <>
                      <span className="opacity-0">Full Refresh</span>
                      <span className="absolute inset-0 flex items-center justify-center">
                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      </span>
                    </>
                  ) : (
                    <>
                      <ArrowPathIcon className="text-white w-5 group-hover:animate-[spin_1s_ease-in-out_1] inline mx-2" />
                      Full Refresh
                    </>
                  )}
                </button>
              </div>
            </div>
            <SyncVerificationContent compareWithFileServers={compareWithFileServers} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </div>
  );
}
