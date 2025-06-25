'use client'

import { useState, useEffect } from 'react'
import { 
  CheckCircleIcon, 
  ClockIcon, 
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  TrashIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { formatDateToEST } from '@src/utils'

const statusConfig = {
  pending: {
    icon: ClockIcon,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    label: 'Pending'
  },
  email_verification_pending: {
    icon: InformationCircleIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    label: 'Email Verification Pending'
  },
  verified: {
    icon: CheckCircleIcon,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    label: 'Verified'
  },
  scheduled: {
    icon: ClockIcon,
    color: 'text-orange-600',
    bgColor: 'bg-orange-100',
    label: 'Scheduled'
  },
  completed: {
    icon: CheckCircleIcon,
    color: 'text-green-600',
    bgColor: 'bg-green-100',
    label: 'Completed'
  },
  cancelled: {
    icon: XCircleIcon,
    color: 'text-gray-600',
    bgColor: 'bg-gray-100',
    label: 'Cancelled'
  },
  expired: {
    icon: ExclamationTriangleIcon,
    color: 'text-red-600',
    bgColor: 'bg-red-100',
    label: 'Expired'
  }
}

export default function DeletionRequestsAdmin() {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedRequests, setSelectedRequests] = useState(new Set())
  const [actionLoading, setActionLoading] = useState(false)
  const [filter, setFilter] = useState('all')
  const [expandedRequest, setExpandedRequest] = useState(null)

  useEffect(() => {
    fetchRequests()
  }, [])

  const fetchRequests = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/authenticated/admin/deletion-requests')
      if (!response.ok) {
        throw new Error('Failed to fetch deletion requests')
      }
      const data = await response.json()
      setRequests(data.requests || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleAction = async (requestId, action, reason = null) => {
    try {
      setActionLoading(true)
      const response = await fetch('/api/authenticated/admin/deletion-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action,
          requestId,
          reason
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to perform action')
      }

      await fetchRequests()
      setSelectedRequests(new Set())
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const handleBulkAction = async (action, reason = null) => {
    if (selectedRequests.size === 0) return

    try {
      setActionLoading(true)
      const response = await fetch('/api/authenticated/admin/deletion-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'bulk',
          bulkAction: action,
          requestIds: Array.from(selectedRequests),
          reason
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to perform bulk action')
      }

      await fetchRequests()
      setSelectedRequests(new Set())
    } catch (err) {
      setError(err.message)
    } finally {
      setActionLoading(false)
    }
  }

  const toggleRequestSelection = (requestId) => {
    const newSelected = new Set(selectedRequests)
    if (newSelected.has(requestId)) {
      newSelected.delete(requestId)
    } else {
      newSelected.add(requestId)
    }
    setSelectedRequests(newSelected)
  }

  const toggleSelectAll = () => {
    if (selectedRequests.size === filteredRequests.length) {
      setSelectedRequests(new Set())
    } else {
      setSelectedRequests(new Set(filteredRequests.map(r => r._id)))
    }
  }

  const filteredRequests = requests.filter(request => {
    if (filter === 'all') return true
    return request.status === filter
  })

  const getStatusCounts = () => {
    const counts = {}
    Object.keys(statusConfig).forEach(status => {
      counts[status] = requests.filter(r => r.status === status).length
    })
    counts.all = requests.length
    return counts
  }

  const statusCounts = getStatusCounts()

  if (loading) {
    return (
      <div className="flex justify-center items-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4">
        <div className="flex">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800">Error</h3>
            <p className="mt-2 text-sm text-red-700">{error}</p>
            <button
              onClick={fetchRequests}
              className="mt-2 text-sm text-red-600 hover:text-red-500"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="sm:flex sm:items-center">
        <div className="sm:flex-auto">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            Account Deletion Requests
          </h1>
          <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
            Manage user account deletion requests and data privacy compliance.
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <button
            onClick={fetchRequests}
            disabled={loading}
            className="inline-flex items-center rounded-md border border-transparent bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Status Filter Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setFilter('all')}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              filter === 'all'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            All ({statusCounts.all})
          </button>
          {Object.entries(statusConfig).map(([status, config]) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                filter === status
                  ? 'border-indigo-500 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {config.label} ({statusCounts[status] || 0})
            </button>
          ))}
        </nav>
      </div>

      {/* Bulk Actions */}
      {selectedRequests.size > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800 px-4 py-3 rounded-md">
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {selectedRequests.size} request{selectedRequests.size !== 1 ? 's' : ''} selected
            </p>
            <div className="flex space-x-2">
              <button
                onClick={() => handleBulkAction('execute')}
                disabled={actionLoading}
                className="inline-flex items-center rounded-md border border-transparent bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4 mr-1" />
                Execute Selected
              </button>
              <button
                onClick={() => handleBulkAction('cancel')}
                disabled={actionLoading}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
              >
                <XMarkIcon className="h-4 w-4 mr-1" />
                Cancel Selected
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Requests Table */}
      <div className="bg-white dark:bg-gray-800 shadow overflow-hidden sm:rounded-md">
        <ul className="divide-y divide-gray-200 dark:divide-gray-700">
          {filteredRequests.length === 0 ? (
            <li className="px-6 py-8 text-center">
              <p className="text-gray-500 dark:text-gray-400">
                No deletion requests found.
              </p>
            </li>
          ) : (
            filteredRequests.map((request) => {
              const config = statusConfig[request.status] || statusConfig.pending
              const IconComponent = config.icon
              const isExpanded = expandedRequest === request._id

              return (
                <li key={request._id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <div className="px-6 py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center">
                        <input
                          type="checkbox"
                          checked={selectedRequests.has(request._id)}
                          onChange={() => toggleRequestSelection(request._id)}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                        />
                        <div className="ml-4 flex items-center">
                          <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}>
                            <IconComponent className="h-3 w-3 mr-1" />
                            {config.label}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-4">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {request.email || request.userId}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {formatDateToEST(request.createdAt)}
                        </div>
                        <button
                          onClick={() => setExpandedRequest(isExpanded ? null : request._id)}
                          className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <RequestDetails 
                        request={request} 
                        onAction={handleAction}
                        actionLoading={actionLoading}
                      />
                    )}
                  </div>
                </li>
              )
            })
          )}
        </ul>
      </div>
    </div>
  )
}

function RequestDetails({ request, onAction, actionLoading }) {
  const [showActionForm, setShowActionForm] = useState(null)
  const [actionReason, setActionReason] = useState('')

  const handleActionSubmit = async (action) => {
    await onAction(request._id, action, actionReason)
    setShowActionForm(null)
    setActionReason('')
  }

  const canExecute = ['verified', 'scheduled'].includes(request.status)
  const canCancel = ['pending', 'email_verification_pending', 'verified', 'scheduled'].includes(request.status)

  return (
    <div className="mt-4 border-t border-gray-200 dark:border-gray-600 pt-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Request Details</h4>
          <dl className="space-y-1 text-sm">
            <div>
              <dt className="inline font-medium text-gray-700 dark:text-gray-300">ID:</dt>
              <dd className="inline ml-2 text-gray-600 dark:text-gray-400 font-mono">{request._id}</dd>
            </div>
            <div>
              <dt className="inline font-medium text-gray-700 dark:text-gray-300">Type:</dt>
              <dd className="inline ml-2 text-gray-600 dark:text-gray-400">
                {request.userId ? 'Authenticated' : 'Public'}
              </dd>
            </div>
            {request.reason && (
              <div>
                <dt className="font-medium text-gray-700 dark:text-gray-300">Reason:</dt>
                <dd className="text-gray-600 dark:text-gray-400 mt-1">{request.reason}</dd>
              </div>
            )}
            {request.scheduledDeletionDate && (
              <div>
                <dt className="inline font-medium text-gray-700 dark:text-gray-300">Scheduled:</dt>
                <dd className="inline ml-2 text-gray-600 dark:text-gray-400">
                  {formatDateToEST(request.scheduledDeletionDate)}
                </dd>
              </div>
            )}
          </dl>
        </div>

        <div>
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Actions</h4>
          <div className="space-y-2">
            {canExecute && (
              <button
                onClick={() => setShowActionForm('execute')}
                disabled={actionLoading}
                className="w-full inline-flex justify-center items-center rounded-md border border-transparent bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50"
              >
                <TrashIcon className="h-4 w-4 mr-1" />
                Execute Deletion
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => setShowActionForm('cancel')}
                disabled={actionLoading}
                className="w-full inline-flex justify-center items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
              >
                <XMarkIcon className="h-4 w-4 mr-1" />
                Cancel Request
              </button>
            )}
          </div>
        </div>
      </div>

      {showActionForm && (
        <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
          <h5 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            {showActionForm === 'execute' ? 'Execute Deletion' : 'Cancel Request'}
          </h5>
          <div className="space-y-3">
            <textarea
              value={actionReason}
              onChange={(e) => setActionReason(e.target.value)}
              placeholder="Reason for this action (optional)"
              rows={2}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-600 dark:border-gray-500 dark:text-white sm:text-sm"
            />
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowActionForm(null)}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Cancel
              </button>
              <button
                onClick={() => handleActionSubmit(showActionForm)}
                disabled={actionLoading}
                className={`inline-flex items-center rounded-md border border-transparent px-3 py-2 text-sm font-medium text-white shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 ${
                  showActionForm === 'execute'
                    ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                    : 'bg-gray-600 hover:bg-gray-700 focus:ring-gray-500'
                }`}
              >
                Confirm {showActionForm === 'execute' ? 'Deletion' : 'Cancellation'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}