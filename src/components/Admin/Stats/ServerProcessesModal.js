'use client'

import { Dialog, Transition } from '@headlessui/react'
import { Fragment, useRef, useState, useMemo } from 'react'
import useSWR from 'swr'
import { buildURL, fetcher } from '@src/utils'
import { StatusBadge } from '../BaseComponents'

export default function ServerProcessesModal({ isOpen, setIsOpen }) {
  const cancelButtonRef = useRef(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  
  const { data, error } = useSWR(
    isOpen ? buildURL('/api/authenticated/admin/server-processes') : null, 
    fetcher, 
    {
      refreshInterval: isOpen ? 5000 : 0,
    }
  )

  // Flatten all processes from all servers into a single array
  const allProcesses = useMemo(() => {
    if (!data) return [];
    
    const processes = [];
    data.forEach((server) => {
      if (server.processes && server.processes.length > 0) {
        server.processes.forEach((process) => {
          processes.push({
            ...process,
            serverName: server.server
          });
        });
      }
    });
    return processes;
  }, [data]);

  // Calculate pagination
  const totalProcesses = allProcesses.length;
  const totalPages = pageSize === 'all' ? 1 : Math.ceil(totalProcesses / pageSize);
  const startIndex = pageSize === 'all' ? 0 : (currentPage - 1) * pageSize;
  const endIndex = pageSize === 'all' ? totalProcesses : startIndex + pageSize;
  const currentProcesses = allProcesses.slice(startIndex, endIndex);

  // Reset to page 1 when page size changes
  const handlePageSizeChange = (newPageSize) => {
    setPageSize(newPageSize);
    setCurrentPage(1);
  };

  const handlePageChange = (newPage) => {
    setCurrentPage(Math.max(1, Math.min(newPage, totalPages)));
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'completed': return { status: 'success', text: 'Completed' }
      case 'running': return { status: 'info', text: 'Running' }
      case 'pending': return { status: 'warning', text: 'Pending' }
      case 'error': return { status: 'error', text: 'Error' }
      default: return { status: 'neutral', text: status || 'Unknown' }
    }
  }

  return (
    <Transition.Root show={isOpen} as={Fragment}>
      <Dialog
        as="div"
        className="relative z-10"
        initialFocus={cancelButtonRef}
        onClose={setIsOpen}
      >
        <Transition.Child
          as={Fragment}
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" />
        </Transition.Child>

        <div className="fixed inset-0 z-10 w-screen overflow-y-auto">
          <div className="flex min-h-full items-end justify-center p-4 text-center sm:items-center sm:p-0">
            <Transition.Child
              as={Fragment}
              enter="ease-out duration-300"
              enterFrom="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
              enterTo="opacity-100 translate-y-0 sm:scale-100"
              leave="ease-in duration-200"
              leaveFrom="opacity-100 translate-y-0 sm:scale-100"
              leaveTo="opacity-0 translate-y-4 sm:translate-y-0 sm:scale-95"
            >
              <Dialog.Panel className="relative transform overflow-hidden rounded-lg bg-white text-left shadow-xl transition-all sm:my-8 sm:w-full sm:max-w-6xl">
                {/* Header */}
                <div className="bg-white px-6 py-4 border-b border-gray-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      </div>
                      <div>
                        <Dialog.Title as="h3" className="text-lg font-medium text-gray-900">
                          Server Processes - Detailed View
                        </Dialog.Title>
                        <p className="text-sm text-gray-500">
                          Complete list of all server processes with detailed information
                        </p>
                      </div>
                    </div>
                    
                    {/* Page Size Selector */}
                    <div className="flex items-center gap-2">
                      <label className="text-sm text-gray-600">Show:</label>
                      <select
                        value={pageSize}
                        onChange={(e) => handlePageSizeChange(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                        className="px-3 py-1 text-sm border border-gray-300 rounded-md bg-white text-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value={5}>5</option>
                        <option value={10}>10</option>
                        <option value={25}>25</option>
                        <option value={50}>50</option>
                        <option value="all">Show All</option>
                      </select>
                      <span className="text-sm text-gray-600">entries</span>
                    </div>
                  </div>
                </div>

                {/* Content */}
                <div className="bg-white px-6 py-4">
                  {error ? (
                    <div className="text-center py-12">
                      <div className="text-red-600 text-sm">Failed to load server processes</div>
                    </div>
                  ) : !data ? (
                    <div className="text-center py-12">
                      <div className="animate-pulse">
                        <div className="space-y-3">
                          <div className="h-4 bg-gray-200 rounded w-1/4 mx-auto"></div>
                          <div className="space-y-2">
                            {[...Array(5)].map((_, i) => (
                              <div key={i} className="h-12 bg-gray-200 rounded"></div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Results Summary */}
                      <div className="mb-4 text-sm text-gray-600">
                        {totalProcesses === 0 ? (
                          'No processes found'
                        ) : pageSize === 'all' ? (
                          `Showing all ${totalProcesses} entries`
                        ) : (
                          `Showing ${startIndex + 1} to ${Math.min(endIndex, totalProcesses)} of ${totalProcesses} entries`
                        )}
                      </div>

                      {/* Table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                              <th className="px-4 py-3 text-sm font-medium text-gray-900">Server</th>
                              <th className="px-4 py-3 text-sm font-medium text-gray-900">Process ID</th>
                              <th className="px-4 py-3 text-sm font-medium text-gray-900">File Key</th>
                              <th className="px-4 py-3 text-sm font-medium text-gray-900">Type</th>
                              <th className="px-4 py-3 text-sm font-medium text-gray-900">Status</th>
                              <th className="px-4 py-3 text-sm font-medium text-gray-900">Last Updated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {currentProcesses.length > 0 ? (
                              currentProcesses.map((process) => {
                                const statusInfo = getStatusBadge(process.status)
                                return (
                                  <tr
                                    key={`${process.serverName}-${process.id}`}
                                    className="border-b border-gray-100 hover:bg-gray-50"
                                  >
                                    <td className="px-4 py-3 text-sm text-gray-900 font-medium">
                                      {process.serverName}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-600 font-mono">
                                      {process.id}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate">
                                      {process.file_key}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-600">
                                      {process.process_type}
                                    </td>
                                    <td className="px-4 py-3">
                                      <StatusBadge 
                                        status={statusInfo.status} 
                                        variant="soft" 
                                        size="small"
                                      >
                                        {statusInfo.text}
                                      </StatusBadge>
                                    </td>
                                    <td className="px-4 py-3 text-sm text-gray-600">
                                      {new Date(process.last_updated).toLocaleString()}
                                    </td>
                                  </tr>
                                )
                              })
                            ) : (
                              <tr>
                                <td colSpan={6} className="px-4 py-8 text-center text-gray-500">
                                  No processes found
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination */}
                      {pageSize !== 'all' && totalPages > 1 && (
                        <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handlePageChange(currentPage - 1)}
                              disabled={currentPage === 1}
                              className="px-3 py-1 text-sm border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Previous
                            </button>
                            <button
                              onClick={() => handlePageChange(currentPage + 1)}
                              disabled={currentPage === totalPages}
                              className="px-3 py-1 text-sm border border-gray-300 rounded-md bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              Next
                            </button>
                          </div>

                          {/* Page Numbers */}
                          <div className="flex items-center gap-1">
                            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                              let pageNum;
                              if (totalPages <= 5) {
                                pageNum = i + 1;
                              } else if (currentPage <= 3) {
                                pageNum = i + 1;
                              } else if (currentPage >= totalPages - 2) {
                                pageNum = totalPages - 4 + i;
                              } else {
                                pageNum = currentPage - 2 + i;
                              }

                              return (
                                <button
                                  key={pageNum}
                                  onClick={() => handlePageChange(pageNum)}
                                  className={`px-3 py-1 text-sm border rounded-md ${
                                    currentPage === pageNum
                                      ? 'bg-blue-500 text-white border-blue-500'
                                      : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
                                  }`}
                                >
                                  {pageNum}
                                </button>
                              );
                            })}
                          </div>

                          <div className="text-sm text-gray-600">
                            Page {currentPage} of {totalPages}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>

                {/* Footer */}
                <div className="bg-gray-50 px-6 py-4 flex justify-end">
                  <button
                    type="button"
                    className="inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:text-sm"
                    onClick={() => setIsOpen(false)}
                    ref={cancelButtonRef}
                  >
                    Close
                  </button>
                </div>
              </Dialog.Panel>
            </Transition.Child>
          </div>
        </div>
      </Dialog>
    </Transition.Root>
  )
}