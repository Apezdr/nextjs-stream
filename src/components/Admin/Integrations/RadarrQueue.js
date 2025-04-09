'use client';

import React from 'react';
import DashboardCard from './DashboardCard';

/**
 * Individual Radarr queue item component
 * @param {Object} props
 * @param {Object} props.item - Radarr queue item data
 */
const RadarrQueueItem = ({ item }) => {
  // Extract relevant properties
  const { title, status, sizeRemaining, progress, estimatedCompletionTime, protocol, downloadClient } = item;
  
  // Calculate progress percentage
  const progressPercentage = Math.min(Math.max(progress || 0, 0), 100);
  
  // Format remaining size
  const formatSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };
  
  // Status color mapping
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'downloading':
        return 'bg-blue-500';
      case 'completed':
        return 'bg-green-500';
      case 'failed':
        return 'bg-red-500';
      case 'warning':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };
  
  // Format ETA
  const formatETA = (timestamp) => {
    if (!timestamp) return 'Unknown';
    const eta = new Date(timestamp);
    return eta.toLocaleString();
  };

  return (
    <div className="mb-6 last:mb-0 bg-gray-50 dark:bg-slate-700 rounded-lg p-4 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
        <h3 className="text-sm sm:text-base font-semibold truncate" title={title}>
          {title}
        </h3>
        <div className="flex items-center">
          <span className={`px-2 py-1 text-xs font-medium text-white rounded-full ${getStatusColor(status)}`}>
            {status}
          </span>
          {downloadClient && (
            <span className="ml-2 text-xs text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-slate-600 px-2 py-1 rounded">
              {protocol} · {downloadClient}
            </span>
          )}
        </div>
      </div>

      <div className="relative pt-1">
        <div className="flex justify-between mb-1 items-center">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {formatSize(sizeRemaining)} remaining
          </div>
          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            {progressPercentage.toFixed(1)}%
          </div>
        </div>
        <div className="overflow-hidden h-2 mb-2 text-xs flex rounded bg-gray-200 dark:bg-slate-600">
          <div
            style={{ width: `${progressPercentage}%` }}
            className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center transition-all duration-300 ease-in-out ${getStatusColor(status)}`}
          ></div>
        </div>
      </div>

      {estimatedCompletionTime && (
        <div className="text-xs text-right text-gray-600 dark:text-gray-400">
          ETA: {formatETA(estimatedCompletionTime)}
        </div>
      )}
    </div>
  );
};

/**
 * Radarr Queue component
 * @param {Object} props
 * @param {Object} props.data - Radarr queue data
 */
const RadarrQueue = ({ data }) => {
  // Handle empty data or unsupported format
  if (!data || !Array.isArray(data.records) || data.records.length === 0) {
    return (
      <DashboardCard 
        title="Radarr Queue" 
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v-2h-1zm-2-2H7v4h6v-4zm2 0h1V9h-1v2zm1-4V5h-1v2h1zM5 5v2H4V5h1zm0 4H4v2h1V9zm-1 4h1v2H4v-2z" clipRule="evenodd" />
          </svg>
        }
        count={0}
      >
        <div className="flex items-center justify-center h-24 text-gray-500 dark:text-gray-400">
          No active downloads
        </div>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard 
      title="Radarr Queue" 
      icon={
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm3 2h6v4H7V5zm8 8v2h1v-2h-1zm-2-2H7v4h6v-4zm2 0h1V9h-1v2zm1-4V5h-1v2h1zM5 5v2H4V5h1zm0 4H4v2h1V9zm-1 4h1v2H4v-2z" clipRule="evenodd" />
        </svg>
      }
      count={data.records.length}
      status={data.status}
    >
      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
        {data.records.map((item, index) => (
          <RadarrQueueItem key={item.id || index} item={item} />
        ))}
      </div>
    </DashboardCard>
  );
};

export default RadarrQueue;