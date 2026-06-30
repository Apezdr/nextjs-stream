'use client'
import React, { useState } from 'react';
import useSWR from 'swr';
import { LazyLog, ScrollFollow } from '@melloware/react-logviewer';
import DockerHubLastUpdated from '../DockerHubLastUpdated';
import { buildURL } from '@src/utils';
import SyncVerificationPanel from './SyncVerification';
import { formatServerLabel } from '@src/utils/serverLabel';

const fetchServers = async () => {
  const response = await fetch(buildURL('/api/authenticated/admin/servers')); // Replace with your endpoint for servers
  if (!response.ok) {
    throw new Error('Failed to fetch servers');
  }
  return response.json();
};

const fetchCategories = async ([serverEndpoint]) => {
  // Assuming you fetch categories from the first selected server
  const response = await fetch(`${serverEndpoint}/api/logs/categories`);
  if (!response.ok) {
    throw new Error('Failed to fetch categories');
  }
  return response.json();
};

export default function LogsAdministration() {
  const [activeTab, setActiveTab] = useState('logs'); // 'logs' or 'syncVerification'
  const [selectedServers, setSelectedServers] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [refreshKey, setRefreshKey] = useState(0); // State to trigger re-render of LazyLog

  // Fetch server configurations on component mount
  const {
    data: servers = [],
    error: serversError,
    isLoading: loading,
  } = useSWR('/api/authenticated/admin/servers', fetchServers, {
    revalidateOnFocus: false,
    onError: (err) => console.error(err),
  });
  const error = serversError ? 'Error fetching servers' : '';

  // Fetch categories whenever the selected server changes
  const {
    data: categories = [],
    error: categoriesError,
    isLoading: loadingCategories,
  } = useSWR(
    selectedServers.length > 0 ? [selectedServers[0], '/api/logs/categories'] : null,
    fetchCategories,
    { revalidateOnFocus: false, onError: (err) => console.error(err) }
  );
  const categoryError = categoriesError ? 'Error fetching categories' : '';

  // Derive log URL from the selected servers and category
  let logUrl = '';
  if (selectedServers.length === 1) {
    const serverEndpoint = selectedServers[0];
    logUrl = `${serverEndpoint}/api/logs?format=logViewer`;
    if (selectedCategory) {
      logUrl += `&category=${encodeURIComponent(selectedCategory)}`;
    }
  }

  // Handle server selection
  const handleServerSelection = (e) => {
    const { value } = e.target;

    // Reset selected category whenever the selected server changes
    setSelectedCategory('');

    if (value === '') {
      // Reset states if "Select Server(s)" is chosen
      setSelectedServers([]);
    } else {
      setSelectedServers([value]);
    }
  };

  // Handle category selection
  const handleCategorySelection = (e) => {
    setSelectedCategory(e.target.value);
  };

  // Trigger refresh
  const handleRefresh = () => {
    setRefreshKey((prevKey) => prevKey + 1); // Increment the key to force re-render
  };

  // Tab switching
  const handleTabChange = (tab) => {
    setActiveTab(tab);
  };

  return (
    <div className="text-black">
      <h1 className="block text-2xl font-bold mb-4">Log Administration</h1>

      {/* Tab Navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'logs'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => handleTabChange('logs')}
          >
            Server Logs
          </button>
          <button
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'syncVerification'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
            onClick={() => handleTabChange('syncVerification')}
          >
            Sync Verification
          </button>
        </nav>
      </div>

      {/* Logs Tab Content */}
      {activeTab === 'logs' && (
        <>
          <div className='flex flex-col md:flex-row justify-between items-center mb-4'>
            <div className="flex flex-col">
              {/* Server Selection */}
              <div className="mb-4">
                <label htmlFor="server-select" className="block mb-2 font-medium">
                  Select Server(s):
                </label>
                <select
                  id="server-select"
                  value={selectedServers[0] || ''}
                  onChange={handleServerSelection}
                  className="border border-gray-300 rounded p-2 w-full md:w-1/3 md:min-w-96"
                >
                  <option value="">Select Server(s)</option>
                  {servers.map((server) => (
                    <option key={server.id} value={server.syncEndpoint}>
                      {formatServerLabel(server.id)} ({server.baseURL})
                    </option>
                  ))}
                </select>
              </div>
              {/* Category Selection */}
              {selectedServers.length === 1 && (
                <div className="mb-4">
                  <label htmlFor="category-select" className="block mb-2 font-medium">
                    Select Category:
                  </label>
                  {loadingCategories ? (
                    <p>Loading categories...</p>
                  ) : categoryError ? (
                    <p className="text-red-500">{categoryError}</p>
                  ) : (
                    <select
                      id="category-select"
                      value={selectedCategory}
                      onChange={handleCategorySelection}
                      className="border border-gray-300 rounded p-2 w-full md:w-1/3 md:min-w-96"
                    >
                      <option value="">All Categories</option>
                      {categories.map((category) => (
                        <option key={category} value={category}>
                          {category}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )}
            </div>
            <DockerHubLastUpdated />
          </div>

          {/* Log Viewer */}
          <div className="log-viewer-container flex flex-col w-full">
            {selectedServers.length === 1 && (<button
              onClick={handleRefresh}
              className="mb-4 bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-700"
            >
              Refresh Logs
            </button>)}
            {loading && <p>Loading...</p>}
            {error && <p className="text-red-500">{error}</p>}
            {selectedServers.length === 1 && logUrl && (
              <ScrollFollow
                startFollowing={true}
                render={({ follow, onScroll }) => (
                  <LazyLog
                    key={refreshKey} // Use refreshKey to force re-render
                    url={logUrl}
                    stream={false}
                    follow={follow}
                    onScroll={onScroll}
                    height={400}
                    width="100%"
                    enableSearch={true}
                    autoSearch={false}
                    theme="dark" // or "light"
                  />
                )}
              />
            )}
            {!logUrl && !loading && (
              <p className="text-center text-gray-800">
                No logs available. Please select a server.
              </p>
            )}
          </div>
        </>
      )}

      {/* Sync Verification Tab Content */}
      {activeTab === 'syncVerification' && (
        <SyncVerificationPanel />
      )}
    </div>
  );
}
