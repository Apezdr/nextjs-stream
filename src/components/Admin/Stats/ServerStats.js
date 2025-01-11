'use client';

import useSWR from 'swr';
import { Doughnut } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
} from 'chart.js';
import Loading from '@src/app/loading';
import { fetcher } from '@src/utils';

ChartJS.register(ArcElement, Tooltip, Legend);

// Shared utility function for color selection
const getColorClass = (percentage) => {
  if (percentage < 50) return 'bg-emerald-400';
  if (percentage < 80) return 'bg-amber-400';
  return 'bg-red-400';
};

function MinimalServerStats() {
  const { data, error } = useSWR('/api/authenticated/admin/server-load', fetcher, {
    refreshInterval: 3000,
  });

  if (error) {
    return (
      <div className="flex items-center space-x-2 text-sm text-red-500">
        <span>Failed to load stats</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center h-6 w-48">
        <Loading fullscreenClasses={false} />
      </div>
    );
  }

  const { cpu, memoryUsed, memoryTotal } = data;
  const memoryPercentage = ((memoryUsed / memoryTotal) * 100).toFixed(1);

  return (
    <div className="flex flex-col space-y-2 text-sm">
      {/* CPU Bar */}
      <div className="flex items-center space-x-2">
        <span className="text-gray-400 w-8">CPU</span>
        <div className="relative w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div 
            className={`absolute left-0 top-0 h-full ${getColorClass(cpu)} transition-all duration-300`} 
            style={{ width: `${cpu}%` }}
          />
        </div>
        <span className="text-gray-400 text-xs">{cpu}%</span>
      </div>

      {/* Memory Bar */}
      <div className="flex items-center space-x-2">
        <span className="text-gray-400 w-8">Mem</span>
        <div className="relative w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div 
            className={`absolute left-0 top-0 h-full ${getColorClass(memoryPercentage)} transition-all duration-300`}
            style={{ width: `${memoryPercentage}%` }}
          />
        </div>
        <span className="text-gray-400 text-xs">
          {memoryUsed}/{memoryTotal}GB
        </span>
      </div>
    </div>
  );
}

function ServerStats() {
  const { data, error } = useSWR('/api/authenticated/admin/server-load', fetcher, {
    refreshInterval: 3000, // Fetch every 3 seconds
  });

  if (error) {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg mb-4">
        <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4 text-center">
          Server Resource Usage
        </h3>
        <div className="text-red-500 text-center">Failed to load server statistics.</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg mb-4">
        <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4 text-center">
          Server Resource Usage
        </h3>
        <div className="flex justify-center items-center h-48">
          <Loading fullscreenClasses={false} />
        </div>
      </div>
    );
  }

  const { cpu, memoryUsed, memoryTotal } = data;

  // Calculate memory available
  const memoryAvailable = memoryTotal - memoryUsed;

  // Data for CPU Doughnut Chart
  const cpuData = {
    labels: ['Used', 'Available'],
    datasets: [
      {
        data: [cpu, 100 - cpu],
        backgroundColor: [
          cpu < 50 ? 'rgba(75, 192, 192, 0.6)' :
          cpu < 80 ? 'rgba(255, 159, 64, 0.6)' :
          'rgba(255, 99, 132, 0.6)',
          'rgba(200, 200, 200, 0.3)', // Available
        ],
        borderColor: [
          cpu < 50 ? 'rgba(75, 192, 192, 1)' :
          cpu < 80 ? 'rgba(255, 159, 64, 1)' :
          'rgba(255, 99, 132, 1)',
          'rgba(200, 200, 200, 1)', // Available
        ],
        borderWidth: 1,
      },
    ],
  };

  // Data for Memory Doughnut Chart
  const memoryData = {
    labels: ['Used', 'Available'],
    datasets: [
      {
        data: [memoryUsed, memoryAvailable],
        backgroundColor: [
          memoryUsed / memoryTotal * 100 < 50 ? 'rgba(153, 102, 255, 0.6)' :
          memoryUsed / memoryTotal * 100 < 80 ? 'rgba(255, 206, 86, 0.6)' :
          'rgba(255, 99, 132, 0.6)',
          'rgba(200, 200, 200, 0.3)', // Available
        ],
        borderColor: [
          memoryUsed / memoryTotal * 100 < 50 ? 'rgba(153, 102, 255, 1)' :
          memoryUsed / memoryTotal * 100 < 80 ? 'rgba(255, 206, 86, 1)' :
          'rgba(255, 99, 132, 1)',
          'rgba(200, 200, 200, 1)', // Available
        ],
        borderWidth: 1,
      },
    ],
  };

  // Common Chart Options
  const commonOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        onClick: null,
        labels: {
          font: {
            size: 12,
          },
          color: 'currentColor',
        },
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.parsed;
            if (label === 'Used') {
              if (context.chart.data.labels === 'CPU') {
                return `${label}: ${value}%`;
              } else {
                return `${label}: ${value} GB`;
              }
            } else {
              return '';
            }
          },
        },
      },
    },
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg mb-4">
      <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-6 text-center">
        Server Resource Usage
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* CPU Doughnut Chart */}
        <div className="flex flex-col items-center">
          <div className="relative w-48 h-48" aria-label={`Doughnut chart showing OS CPU usage: ${cpu}%`}>
            <Doughnut data={cpuData} options={commonOptions} />
          </div>
          <h4 className="mt-4 text-lg font-medium text-gray-800 dark:text-gray-200">
            OS CPU: {cpu}%
          </h4>
        </div>

        {/* Memory Doughnut Chart */}
        <div className="flex flex-col items-center">
          <div className="relative w-48 h-48" aria-label={`Doughnut chart showing OS Memory usage: ${memoryUsed} GB used out of ${memoryTotal} GB`}>
            <Doughnut data={memoryData} options={commonOptions} />
          </div>
          <h4 className="mt-4 text-lg font-medium text-gray-800 dark:text-gray-200">
            OS Mem: {memoryUsed} GB / {memoryTotal} GB
          </h4>
        </div>
      </div>
    </div>
  );
}

export { ServerStats, MinimalServerStats };