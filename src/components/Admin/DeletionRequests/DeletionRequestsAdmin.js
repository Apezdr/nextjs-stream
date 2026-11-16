'use client'

import { useState, useEffect, useReducer } from 'react'
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon,
  TrashIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { formatDateToEST } from '@src/utils'

const REQUESTS_URL = '/api/authenticated/admin/deletion-requests'

// The route's page size limit: the newest requests, which is what an admin acts on
const PAGE_SIZE = 100

// The statuses a request moves through (src/utils/accountDeletion.js)
const statusConfig = {
  pending: {
    icon: ClockIcon,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-100',
    label: 'Pending'
  },
  pending_verification: {
    icon: InformationCircleIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-100',
    label: 'Awaiting email verification'
  },
  processing: {
    icon: ExclamationTriangleIcon,
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    label: 'Started, not finished'
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
  }
}

// Who asked for the deletion (the request's requestType)
const typeLabels = {
  authenticated: 'Requested by the user',
  public: 'Requested by email',
  admin: 'Deleted by an admin'
}

// The steps of a deletion, as the request names the one it stopped at
const stepLabels = {
  start: 'before anything was removed',
  signOut: 'while signing the account out',
  activity: 'while removing its watch history and notifications',
  lists: 'while removing its lists',
  legacySignIn: 'while removing its old sign-in rows',
  requests: 'while closing its other requests',
  account: 'while removing the account itself'
}

const auditLabels = {
  request_created: 'Requested by the user',
  public_request_created: 'Requested by email',
  email_verified: 'Email verified',
  admin_request_created: 'Started by an admin',
  request_cancelled: 'Cancelled',
  deletion_started: 'Deletion started',
  deletion_resumed: 'Deletion run again',
  deletion_failed: 'Deletion stopped part-way',
  deletion_completed: 'Deletion completed'
}

/** A date as the page shows it; a request that has none yet shows a dash (formatDateToEST throws on a missing date). */
const when = (value) => (value ? formatDateToEST(value) : '—')

const initialRequestsState = {
  requests: [],
  total: 0,
  loading: true,
  error: null,
  actionLoading: false,
}

function requestsReducer(state, action) {
  switch (action.type) {
    case 'refreshing':
      return { ...state, loading: true, error: null }
    case 'loaded':
      return { ...state, requests: action.requests, total: action.total, loading: false, error: null }
    case 'failed':
      return { ...state, loading: false, error: action.error }
    case 'setActionLoading':
      return { ...state, actionLoading: action.value }
    default:
      return state
  }
}

/** The newest requests. The route answers { success, data: { requests, pagination, filters } }. */
async function loadRequests() {
  const response = await fetch(`${REQUESTS_URL}?limit=${PAGE_SIZE}`)
  if (!response.ok) {
    throw new Error('Failed to fetch deletion requests')
  }
  const { data } = await response.json()
  return { requests: data?.requests || [], total: data?.pagination?.total ?? 0 }
}

/** POST an action for one request; the route's own error text when it refuses. */
async function postAction(body) {
  const response = await fetch(REQUESTS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const answer = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(answer?.error || answer?.message || 'Failed to perform action')
  }
  return answer
}

export default function DeletionRequestsAdmin() {
  const [requestsState, dispatch] = useReducer(requestsReducer, initialRequestsState)
  const { requests, total, loading, error, actionLoading } = requestsState

  const setActionLoading = (value) => dispatch({ type: 'setActionLoading', value })

  const [filter, setFilter] = useState('all')
  const [expandedRequest, setExpandedRequest] = useState(null)
  // Counts the loads asked for: the first, then one per refresh
  const [loads, setLoads] = useState(0)

  useEffect(() => {
    let current = true
    loadRequests()
      .then((loaded) => current && dispatch({ type: 'loaded', ...loaded }))
      .catch((err) => current && dispatch({ type: 'failed', error: err.message }))
    return () => {
      current = false
    }
  }, [loads])

  const fetchRequests = () => {
    dispatch({ type: 'refreshing' })
    setLoads((count) => count + 1)
  }

  // The list stays on screen when an action is refused: the refusal is a toast
  const handleAction = async (requestId, action, reason = null) => {
    try {
      setActionLoading(true)
      await postAction({ action, requestId, reason })
      toast.success(action === 'execute' ? 'The account was deleted.' : 'The request was cancelled.')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setActionLoading(false)
      // Either way the request may have changed (a deletion that stopped has still begun)
      fetchRequests()
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

  if (loading && requests.length === 0) {
    return (
      <div className="flex justify-center items-center h-64" role="status" aria-label="Loading deletion requests">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-md p-4" role="alert">
        <div className="flex">
          <ExclamationTriangleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
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
            Deletions users asked for, and accounts admins deleted from the Users page.
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

      {total > requests.length && (
        <p className="text-sm text-gray-700 dark:text-gray-300">
          Showing the newest {requests.length} of {total} requests.
        </p>
      )}

      {/* Status Filter Tabs */}
      <div className="border-b border-gray-200 dark:border-gray-700">
        <nav className="-mb-px flex flex-wrap gap-x-8" aria-label="Filter by status">
          <button
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
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
              aria-pressed={filter === status}
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
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bgColor} ${config.color}`}>
                          <IconComponent className="h-3 w-3 mr-1" aria-hidden="true" />
                          {config.label}
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          {typeLabels[request.requestType] || request.requestType}
                        </span>
                      </div>

                      <div className="flex items-center space-x-4">
                        <div className="text-sm text-gray-900 dark:text-white">
                          {request.email || request.userId}
                        </div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                          {when(request.requestedAt)}
                        </div>
                        <button
                          onClick={() => setExpandedRequest(isExpanded ? null : request._id)}
                          aria-expanded={isExpanded}
                          className="text-indigo-600 hover:text-indigo-900 text-sm font-medium"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                          <span className="sr-only"> for {request.email || request._id}</span>
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

function Detail({ label, children }) {
  return (
    <div>
      <dt className="inline font-medium text-gray-700 dark:text-gray-300">{label}:</dt>
      <dd className="inline ml-2 text-gray-600 dark:text-gray-400">{children}</dd>
    </div>
  )
}

/** What a deletion removed, per collection, and the shared lists it left in place. */
function DeletionResults({ results, finished }) {
  const { keptSharedPlaylists = [], ...counts } = results || {}
  const removed = Object.entries(counts).filter(([, count]) => typeof count === 'number' && count > 0)
  if (removed.length === 0 && keptSharedPlaylists.length === 0) return null

  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">{finished ? 'Removed' : 'Removed so far'}</h4>
      {removed.length > 0 && (
        <p className="text-sm text-gray-600 dark:text-gray-400">
          {removed.map(([name, count]) => `${name}: ${count}`).join(' · ')}
        </p>
      )}
      {keptSharedPlaylists.length > 0 && (
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
          Kept, without an owner: {keptSharedPlaylists.length} list{keptSharedPlaylists.length !== 1 ? 's' : ''} shared with
          other people (<span className="font-mono">{keptSharedPlaylists.join(', ')}</span>)
        </p>
      )}
    </div>
  )
}

/** Who did what to the request, and when. Loaded when the details open. */
function AuditLog({ requestId, version }) {
  const [state, setState] = useState({ entries: null, error: null })

  useEffect(() => {
    let current = true
    postAction({ action: 'get-audit-logs', requestId })
      .then((answer) => current && setState({ entries: answer?.data?.auditLogs || [], error: null }))
      .catch((err) => current && setState({ entries: null, error: err.message }))
    return () => {
      current = false
    }
    // `version` changes when the request does, so the log is read again after an action
  }, [requestId, version])

  return (
    <div className="mt-4">
      <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Audit log</h4>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
      {!state.error && state.entries === null && <p className="text-sm text-gray-500 dark:text-gray-400">Loading…</p>}
      {state.entries?.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-400">No entries.</p>}
      {state.entries?.length > 0 && (
        <ol className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
          {state.entries.map((entry) => (
            <li key={entry.id}>
              <span className="text-gray-500 dark:text-gray-500">{when(entry.performedAt)}</span>{' '}
              <span className="font-medium text-gray-800 dark:text-gray-200">{auditLabels[entry.action] || entry.action}</span>
              {entry.performedBy && <> by {entry.performedBy.name || entry.performedBy.email}</>}
              {entry.action === 'deletion_failed' && entry.details?.error && <>: {entry.details.error}</>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function RequestDetails({ request, onAction, actionLoading }) {
  const [showActionForm, setShowActionForm] = useState(null)
  const [actionReason, setActionReason] = useState('')

  const handleActionSubmit = async (action) => {
    await onAction(request._id, action, action === 'cancel' ? actionReason : null)
    setShowActionForm(null)
    setActionReason('')
  }

  // What the route will accept (it sends both with each request)
  const { canExecute, canCancel } = request
  const stopped = request.status === 'processing'
  // A user's own request before its grace period is over: the admin can still delete now, knowingly
  const endsGraceEarly = request.status === 'pending' && request.requestType !== 'admin' && !request.gracePeriodOver
  const executeLabel = stopped ? 'Run again' : 'Delete this account now'

  return (
    <div className="mt-4 border-t border-gray-200 dark:border-gray-600 pt-4">
      {stopped && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
          <p className="font-medium">
            This deletion started and stopped {stepLabels[request.lastError?.step] || 'part-way'}.
          </p>
          {request.lastError?.message && <p className="mt-1">{request.lastError.message}</p>}
          <p className="mt-1">
            The account is signed out and can’t sign in. Run the deletion again to finish it: what is already gone
            stays counted.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-2">Request Details</h4>
          <dl className="space-y-1 text-sm">
            <div>
              <dt className="inline font-medium text-gray-700 dark:text-gray-300">ID:</dt>
              <dd className="inline ml-2 text-gray-600 dark:text-gray-400 font-mono">{request._id}</dd>
            </div>
            <Detail label="Type">{typeLabels[request.requestType] || request.requestType}</Detail>
            {request.reason && (
              <div>
                <dt className="font-medium text-gray-700 dark:text-gray-300">Reason:</dt>
                <dd className="text-gray-600 dark:text-gray-400 mt-1">{request.reason}</dd>
              </div>
            )}
            <Detail label="Requested">{when(request.requestedAt)}</Detail>
            {request.requestType !== 'admin' && request.scheduledDeletionAt && (
              <Detail label="Grace period ends">{when(request.scheduledDeletionAt)}</Detail>
            )}
            {request.startedAt && <Detail label="Started">{when(request.startedAt)}</Detail>}
            {request.completedAt && <Detail label="Completed">{when(request.completedAt)}</Detail>}
            {request.cancelledAt && (
              <Detail label="Cancelled">
                {when(request.cancelledAt)}
                {request.cancellationReason ? ` (${request.cancellationReason})` : ''}
              </Detail>
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
                <TrashIcon className="h-4 w-4 mr-1" aria-hidden="true" />
                {executeLabel}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => setShowActionForm('cancel')}
                disabled={actionLoading}
                className="w-full inline-flex justify-center items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50"
              >
                <XMarkIcon className="h-4 w-4 mr-1" aria-hidden="true" />
                Cancel Request
              </button>
            )}
            {!canExecute && !canCancel && (
              <p className="text-sm text-gray-500 dark:text-gray-400">Nothing more to do.</p>
            )}
          </div>
        </div>
      </div>

      {showActionForm && (
        <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
          <h5 className="text-sm font-medium text-gray-900 dark:text-white mb-2">
            {showActionForm === 'execute' ? executeLabel : 'Cancel Request'}
          </h5>
          <div className="space-y-3">
            {showActionForm === 'execute' ? (
              <p className="text-sm text-gray-700 dark:text-gray-200">
                This deletes {request.email}’s account and its data now. It can’t be undone.
                {endsGraceEarly &&
                  ` The user has until ${when(request.scheduledDeletionAt)} to change their mind: deleting now ends that early.`}
              </p>
            ) : (
              <textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="Reason for this action (optional)"
                aria-label="Reason for cancelling (optional)"
                rows={2}
                className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-600 dark:border-gray-500 dark:text-white sm:text-sm"
              />
            )}
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowActionForm(null)}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              >
                Back
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

      <DeletionResults results={request.deletionResults} finished={request.status === 'completed'} />
      <AuditLog requestId={request._id} version={request.updatedAt} />
    </div>
  )
}
