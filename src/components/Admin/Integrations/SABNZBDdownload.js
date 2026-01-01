'use client';

import React from 'react';

/**
 * Format bytes to human-readable size
 * @param {number} bytes - Size in bytes
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted size
 */
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
};

/**
 * Format seconds to time format (HH:MM:SS)
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time
 */
const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return 'Unknown';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  return [
    hours > 0 ? hours : null,
    minutes > 0 || hours > 0 ? minutes.toString().padStart(2, '0') : null,
    secs.toString().padStart(2, '0')
  ]
    .filter(Boolean)
    .join(':');
};

/**
 * Download Status component for SABNZBD
 * @param {Object} props
 * @param {Object} props.data - SABNZBD queue data
 */
const DownloadStatus = ({ data }) => {
  if (!data || !data.slots || data.slots.length === 0) {
    return (
      <div className="flex items-center justify-center h-24 text-gray-500 dark:text-gray-400">
        No active downloads
      </div>
    );
  }

  // Sort slots by index to ensure they're in the right order
  const slots = [...data.slots].sort((a, b) => a.index - b.index);

  return (
    <div className="space-y-6 max-h-[400px] overflow-y-auto pr-1">
      {slots.map((slot) => {
        const progressPercentage = Math.min(Math.max(slot.percentage || 0, 0), 100);
        const statusLower = slot.status?.toLowerCase();
        
        // Status color mapping
        const getStatusColor = (status) => {
          switch (status) {
            case 'downloading':
              return 'bg-blue-500';
            case 'complete':
            case 'completed':
              return 'bg-green-500';
            case 'paused':
              return 'bg-yellow-500';
            case 'failed':
              return 'bg-red-500';
            default:
              return 'bg-gray-500';
          }
        };

        return (
          <div key={slot.nzo_id} className="bg-gray-50 dark:bg-slate-700 rounded-lg p-4 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
              <h3 className="text-sm sm:text-base font-semibold truncate" title={slot.filename}>
                {slot.filename}
              </h3>
              <div className="flex items-center">
                <span className={`px-2 py-1 text-xs font-medium text-white rounded-full ${getStatusColor(statusLower)}`}>
                  {slot.status}
                </span>
                {slot.cat && (
                  <span className="ml-2 text-xs text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-slate-600 px-2 py-1 rounded">
                    {slot.cat}
                  </span>
                )}
              </div>
            </div>

            <div className="relative pt-1">
              <div className="flex justify-between mb-1 items-center">
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  {formatBytes(slot.mb * 1024 * 1024)} • {slot.sizeleft ? formatBytes(slot.sizeleft * 1024 * 1024) + ' left' : 'Complete'}
                </div>
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {progressPercentage.toFixed(1)}%
                </div>
              </div>
              <div className="overflow-hidden h-2 mb-2 text-xs flex rounded bg-gray-200 dark:bg-slate-600">
                <div
                  style={{ width: `${progressPercentage}%` }}
                  className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center transition-all duration-300 ease-in-out ${getStatusColor(statusLower)}`}
                ></div>
              </div>
            </div>

            <div className="flex justify-between items-center text-xs text-gray-600 dark:text-gray-400 mt-2">
              <div>
                {slot.timeleft && (
                  <span className="inline-block">
                    {formatTime(slot.timeleft)} remaining
                  </span>
                )}
              </div>
              <div>
                {slot.eta && (
                  <span className="inline-block">
                    ETA: {new Date(slot.eta).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {/* Overall queue stats */}
      {data.status && data.speedlimit && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300">
          <div className="flex justify-between">
            <span>Download speed: {formatBytes(data.speed || 0)}/s</span>
            <span>Speed limit: {data.speedlimit === '100' ? 'None' : data.speedlimit + '%'}</span>
          </div>
          {data.timeleft && (
            <div className="mt-1">
              Queue will complete in approximately {formatTime(data.timeleft)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DownloadStatus;