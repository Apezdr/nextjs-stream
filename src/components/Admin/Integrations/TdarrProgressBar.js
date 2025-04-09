'use client';

import React from 'react';
import DashboardCard from './DashboardCard';

/**
 * Individual Tdarr worker progress component
 * @param {Object} props
 * @param {Object} props.worker - Tdarr worker data
 */
const WorkerProgressBar = ({ worker }) => {
  const { _id, file, percentage, status, workerType, fps, job, ETA } = worker;
  const fileName = file?.split('/').pop() || 'Unknown file';
  const progressPercentage = Math.min(Math.max(percentage || 0, 0), 100);
  
  // Status color mapping
  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'transcoding':
      case 'processing':
        return 'bg-blue-500';
      case 'complete':
      case 'completed':
        return 'bg-green-500';
      case 'error':
      case 'failed':
        return 'bg-red-500';
      case 'queued':
      case 'waiting':
        return 'bg-yellow-500';
      default:
        return 'bg-gray-500';
    }
  };

  return (
    <div className="mb-6 last:mb-0 bg-gray-50 dark:bg-slate-700 rounded-lg p-4 shadow-sm">
      <div className="flex flex-col mb-3">
        <div className="flex justify-between items-start gap-2 flex-wrap">
          <h3 
            className="text-sm sm:text-base font-semibold truncate max-w-full"
            title={`Worker ID: ${_id}\nFile: ${file}\nWorker Type: ${workerType}\nJob type: ${job?.type || 'Unknown'}`}
          >
            {fileName}
          </h3>
          <span className={`px-2 py-1 text-xs font-medium text-white rounded-full ${getStatusColor(status)}`}>
            {status}
          </span>
        </div>
        
        <div className="flex flex-wrap justify-between items-center mt-2 gap-2">
          {workerType && (
            <div className="text-xs text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-slate-600 px-2 py-1 rounded">
              {workerType}
            </div>
          )}
          {job?.type && (
            <div className="text-xs text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-slate-600 px-2 py-1 rounded">
              {job.type}
            </div>
          )}
        </div>
      </div>

      <div className="relative pt-1">
        <div className="flex justify-between mb-2 items-center">
          <div className="text-xs text-gray-600 dark:text-gray-300">
            {fps && <span className="mr-4">{fps} FPS</span>}
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

      {ETA && (
        <div className="text-xs text-right text-gray-600 dark:text-gray-400">
          ETA: {ETA}
        </div>
      )}
    </div>
  );
};

/**
 * Tdarr Progress Bar component
 * @param {Object} props
 * @param {Object} props.data - Tdarr data
 */
const TdarrProgressBar = ({ data }) => {
  // Handle empty data or unsupported format
  if (!data) {
    return (
      <DashboardCard 
        title="Tdarr Progress" 
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" />
          </svg>
        }
        count={0}
      >
        <div className="flex items-center justify-center h-24 text-gray-500 dark:text-gray-400">
          No active transcoding jobs
        </div>
      </DashboardCard>
    );
  }

  const nodes = Object.values(data);
  const allWorkers = nodes.flatMap((node) =>
    Object.values(node.workers || {}).filter((worker) => worker.percentage != null)
  );

  if (allWorkers.length === 0) {
    return (
      <DashboardCard 
        title="Tdarr Progress" 
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" />
          </svg>
        }
        count={0}
      >
        <div className="flex items-center justify-center h-24 text-gray-500 dark:text-gray-400">
          No active transcoding jobs
        </div>
      </DashboardCard>
    );
  }

  return (
    <DashboardCard 
      title="Tdarr Progress" 
      icon={
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" />
        </svg>
      } 
      count={allWorkers.length}
    >
      <div className="space-y-4 max-h-[400px] overflow-y-auto pr-1">
        {allWorkers.map((worker, index) => (
          <WorkerProgressBar key={worker._id || index} worker={worker} />
        ))}
      </div>
    </DashboardCard>
  );
};

export default TdarrProgressBar;