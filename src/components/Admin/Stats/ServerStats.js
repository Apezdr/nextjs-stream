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
import { formatBytesAsBitRate } from '@src/utils/formatBitRate';

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

  const { cpu = 0, cpuInfo, memoryUsed = 0, memoryTotal = 0, network, disk, gpus } = data;
  const memoryPercentage = memoryTotal > 0 ? ((memoryUsed / memoryTotal) * 100).toFixed(1) : '0.0';

  return (
    <div className="flex flex-col gap-2 text-sm">
      {network?.state === 'available' && (
        <div className="order-5 flex items-center space-x-2 text-xs text-gray-400">
          <span className="w-8">Net</span>
          <span>↓ {network.total?.rxMbps ?? 0}</span>
          <span>↑ {network.total?.txMbps ?? 0} Mbps</span>
        </div>
      )}

      {/* CPU Bar */}
      <div className="order-1 space-y-1" title={cpuInfo?.model || undefined}>
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
        <div className="pl-10 text-[10px] text-gray-500">
          {Number.isFinite(cpuInfo?.clockMHz) ? `${(cpuInfo.clockMHz / 1000).toFixed(2)} GHz` : 'Clock —'}
          {' · '}{cpuInfo?.logicalThreads ?? '—'} threads
          {' · '}{Number.isFinite(cpuInfo?.temperatureC) ? `${cpuInfo.temperatureC}°C` : 'Temp —'}
        </div>
      </div>

      {/* Memory Bar */}
      <div className="order-2 flex items-center space-x-2">
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

      {disk?.capacity && (
        <div className="order-3 space-y-1 text-xs text-gray-400">
          <div className="flex items-center space-x-2">
            <span className="w-8">Disk</span>
            <div className="relative h-1.5 w-24 overflow-hidden rounded-full bg-gray-700">
              <div
                className={`absolute left-0 top-0 h-full ${getColorClass(disk.capacity.percent)}`}
                style={{ width: `${disk.capacity.percent}%` }}
              />
            </div>
            <span>{disk.capacity.percent}%</span>
          </div>
          <div className="pl-10 text-[10px] text-gray-500">
            R {formatBytesAsBitRate(disk.io?.readBytesPerSecond)} · W {formatBytesAsBitRate(disk.io?.writeBytesPerSecond)}
          </div>
        </div>
      )}

      {['available', 'partial', 'stale'].includes(gpus?.state) && gpus.devices?.[0] && (
        <div className="order-4 flex items-center space-x-2 text-xs text-gray-400">
          <span className="w-8">GPU</span>
          <span className="truncate">{gpus.devices[0].name}</span>
          <span>{Number.isFinite(gpus.devices[0].utilizationPct) ? `${gpus.devices[0].utilizationPct}%` : '—'}</span>
          <span>{Number.isFinite(gpus.devices[0].temperatureC) ? `${gpus.devices[0].temperatureC}°C` : '—'}</span>
        </div>
      )}
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
    labels: ['CPU Used', 'Available'],
    type: 'cpu',
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
    labels: ['Memory Used', 'Available'],
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
            if (label.indexOf('Used') > -1) {
              if (context.chart.data.labels[0] === 'CPU Used') {
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