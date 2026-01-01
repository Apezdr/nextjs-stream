'use client';

import React from 'react';
import DashboardCard from './DashboardCard';

/**
 * Individual Sonarr queue item component
 * @param {Object} props
 * @param {Object} props.item - Sonarr queue item data
 */
const SonarrQueueItem = ({ item }) => {
  // Extract relevant properties
  const { title, status, episode, series, sizeRemaining, progress, estimatedCompletionTime, protocol, downloadClient } = item;
  
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
      <div className="flex flex-col mb-2">
        <div className="flex justify-between items-start">
          <h3 className="text-sm sm:text-base font-semibold truncate" title={series?.title || title}>
            {series?.title || title}
          </h3>
          <span className={`ml-2 px-2 py-1 text-xs font-medium text-white rounded-full ${getStatusColor(status)}`}>
            {status}
          </span>
        </div>
        
        {episode && (
          <div className="text-xs text-gray-600 dark:text-gray-300 mt-1">
            S{episode.seasonNumber}E{episode.episodeNumber} - {episode.title}
          </div>
        )}
        
        <div className="text-xs flex mt-1 items-center">
          {downloadClient && (
            <span className="text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-slate-600 px-2 py-1 rounded">
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
 * Sonarr Queue component
 * @param {Object} props
 * @param {Object} props.data - Sonarr queue data
 */
const SonarrQueue = ({ data }) => {
  // Handle empty data or unsupported format
  if (!data || !Array.isArray(data.records) || data.records.length === 0) {
    return (
      <DashboardCard 
        title="Sonarr Queue" 
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
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
      title="Sonarr Queue" 
      icon={
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
        </svg>
      }
      count={data.records.length}
      status={data.status}
    >
      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
        {data.records.map((item, index) => (
          <SonarrQueueItem key={item.id || index} item={item} />
        ))}
      </div>
    </DashboardCard>
  );
};

export default SonarrQueue;