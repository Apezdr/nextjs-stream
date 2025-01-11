'use client';

import useSWR from 'swr';
import { buildURL, fetcher } from '@src/utils';
import Loading from '@src/app/loading';

/**
 * Renders a table displaying the full view of server processes, including details such as server, process ID, file key, type, status, and last updated time.
 * This component fetches server process data from the API and displays the information in a tabular format.
 */
export function ServerProcesses() {
  const { data, error } = useSWR(buildURL('/api/authenticated/admin/server-processes'), fetcher, {
    refreshInterval: 5000, // Fetch every 5 seconds
  });

  if (error) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg mb-4">
        <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4 text-center">
          Server Processes (Full View)
        </h3>
        <div className="text-red-500 text-center">Failed to load process data.</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-6xl mx-auto p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg mb-4">
        <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4 text-center">
          Server Processes (Full View)
        </h3>
        <div className="flex justify-center items-center h-48">
          <Loading fullscreenClasses={false} />
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 bg-white dark:bg-gray-800 shadow-md rounded-lg mb-4 overflow-x-auto">
      <h3 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4 text-center">
          Server Processes (Full View)
      </h3>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-gray-200 dark:bg-gray-700">
            <th className="px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200">
              Server
            </th>
            <th className="px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200">
              Process ID
            </th>
            <th className="px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200">
              File Key
            </th>
            <th className="px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200">
              Type
            </th>
            <th className="px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200">
              Status
            </th>
            <th className="px-4 py-2 text-sm font-medium text-gray-800 dark:text-gray-200">
              Last Updated
            </th>
          </tr>
        </thead>
        <tbody>
          {data.map((server) =>
            server.processes && server.processes.length > 0 ? (
              server.processes.map((process) => (
                <tr
                  key={process.id}
                  className="border-b border-gray-200 dark:border-gray-700"
                >
                  <td className="px-4 py-2 text-sm text-gray-800 dark:text-gray-200">
                    {server.server}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-800 dark:text-gray-200">
                    {process.id}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-800 dark:text-gray-200">
                    {process.file_key}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-800 dark:text-gray-200">
                    {process.process_type}
                  </td>
                  <td
                    className={`px-4 py-2 text-sm font-semibold ${
                      process.status === 'completed'
                        ? 'text-green-600'
                        : 'text-yellow-600'
                    }`}
                  >
                    {process.status}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-800 dark:text-gray-200">
                    {new Date(process.last_updated).toLocaleString()}
                  </td>
                </tr>
              ))
            ) : (
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <td
                  colSpan={6}
                  className="px-4 py-2 text-sm text-gray-800 dark:text-gray-200 text-center"
                >
                  No processes found for {server.server}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Renders a minimalized view of server processes, showing only active processes.
 * This component fetches server process data from the API and displays a summary
 * of the active processes, grouped by process type and message.
 */
export function MinimalizedServerProcesses() {
  const { data, error } = useSWR(buildURL('/api/authenticated/admin/server-processes'), fetcher, {
    refreshInterval: 5000,
  });

  if (error) {
    return (
      <div className="w-full px-2 py-2 bg-gray-800 rounded-md mb-4">
        <div className="text-red-400 text-center text-sm">Failed to load process data.</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full px-2 py-2 bg-gray-800 rounded-md mb-4">
        <div className="flex justify-center items-center h-24">
          <Loading fullscreenClasses={false} />
        </div>
      </div>
    );
  }

  // Filter out servers that have no active processes
  const activeServers = data.filter((server) =>
    server.processes.some((proc) => proc.status !== 'completed')
  );

  // If no servers have active processes, render a simple message
  if (activeServers.length === 0) {
    return (
      <div className="w-full px-2 py-2 bg-gray-800 rounded-md mb-4 text-gray-400 text-sm text-center">
        No active processes.
      </div>
    );
  }

  return (
    <div className="w-full space-y-2">
      {activeServers.map((server) => {
        // Only look at processes that are not completed
        const activeProcesses = server.processes.filter(
          (proc) => proc.status !== 'completed'
        );

        // Group processes by (process_type + message) so identical tasks are collapsed
        const processGroups = groupProcesses(activeProcesses);

        return (
          <div key={server.server} className="px-2 py-2 bg-gray-700 rounded-md">
            <div className="text-gray-300 text-xs font-semibold mb-1">
              {server.server}
            </div>
            <ul className="space-y-1">
              {processGroups.map((group, index) => (
                <li key={index} className="text-gray-400 text-xs">
                  <strong className="text-gray-200">
                    {group.count} × {group.process_type}
                  </strong>
                  : {group.message}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Helper function to group processes by both 'process_type' and 'message'.
 * Returns an array of objects like:
 *   { process_type: string, message: string, count: number }
 */
function groupProcesses(processes) {
  const groups = {};

  processes.forEach((p) => {
    const key = `${p.process_type}|||${p.message}`;
    if (!groups[key]) {
      groups[key] = {
        process_type: p.process_type,
        message: p.message,
        count: 0,
      };
    }
    groups[key].count += 1;
  });

  return Object.values(groups);
}
