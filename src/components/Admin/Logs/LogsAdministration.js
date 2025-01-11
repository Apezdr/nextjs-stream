'use client'
import React, { useEffect, useState } from 'react';
import { LazyLog, ScrollFollow } from '@melloware/react-logviewer';
import DockerHubLastUpdated from '../DockerHubLastUpdated';
import { buildURL } from '@src/utils';

export default function LogsAdministration() {
  const [servers, setServers] = useState([]);
  const [selectedServers, setSelectedServers] = useState([]);
  const [logUrl, setLogUrl] = useState('');
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [error, setError] = useState('');
  const [categoryError, setCategoryError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0); // State to trigger re-render of LazyLog

  // Fetch server configurations on component mount
  useEffect(() => {
    const fetchServers = async () => {
      try {
        const response = await fetch(buildURL('/api/authenticated/admin/servers')); // Replace with your endpoint for servers
        if (!response.ok) {
          throw new Error('Failed to fetch servers');
        }
        const data = await response.json();
        setServers(data);
      } catch (err) {
        console.error(err);
        setError('Error fetching servers');
      } finally {
        setLoading(false);
      }
    };

    fetchServers();
  }, []);

  // Fetch categories whenever the selected server changes
  useEffect(() => {
    const fetchCategories = async () => {
      if (selectedServers.length === 0) {
        setCategories([]);
        return;
      }

      setLoadingCategories(true);
      setCategoryError('');
      setSelectedCategory(''); // Reset selected category when servers change

      try {
        // Assuming you fetch categories from the first selected server
        const serverEndpoint = selectedServers[0];
        const response = await fetch(`${serverEndpoint}/api/logs/categories`);
        if (!response.ok) {
          throw new Error('Failed to fetch categories');
        }
        const data = await response.json();
        setCategories(data);
      } catch (err) {
        console.error(err);
        setCategoryError('Error fetching categories');
      } finally {
        setLoadingCategories(false);
      }
    };

    fetchCategories();
  }, [selectedServers]);

  // Update log URL whenever selected servers or category changes
  useEffect(() => {
    if (selectedServers.length === 0) {
      setLogUrl('');
    } else if (selectedServers.length === 1) {
      const serverEndpoint = selectedServers[0];
      let url = `${serverEndpoint}/api/logs?format=logViewer`;

      if (selectedCategory) {
        url += `&category=${encodeURIComponent(selectedCategory)}`;
      }

      setLogUrl(url);
    } else {
      setLogUrl('');
    }
  }, [selectedServers, selectedCategory]);

  // Handle server selection
  const handleServerSelection = (e) => {
    const { value } = e.target;

    if (value === '') {
      // Reset states if "Select Server(s)" is chosen
      setSelectedServers([]);
      setSelectedCategory('');
      setCategories([]);
      setLogUrl('');
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

  return (
    <div className="text-black">
      <h1 className="block text-2xl font-bold mb-4">Log Administration</h1>

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
                  {server.id} ({server.baseURL})
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
    </div>
  );
}
