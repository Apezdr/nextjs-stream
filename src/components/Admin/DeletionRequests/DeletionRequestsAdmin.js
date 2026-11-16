'use client'

import { useState, useEffect, useReducer } from 'react'
import {
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
  TrashIcon,
  XMarkIcon
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { formatDateToEST } from '@src/utils'
import { DELETION_GRACE_DAYS } from '@src/utils/deletionSchedule'

const REQUESTS_URL = '/api/authenticated/admin/deletion-requests'

// The route's page size limit: the newest requests, which is what an admin acts on
const PAGE_SIZE = 100

// The statuses a request moves through (src/utils/accountDeletion.js).
//
// Colours here have no `dark:` variants: the admin pages sit on the app's dark
// backdrop whatever the device's theme is, and a colour that follows the
// device left this page's title and labels dark on dark in a light theme.
const statusConfig = {
  // Waiting for its date (a signed-in user's request) or for an admin (one
  // from the public form): each row says which
  pending: {
    icon: ClockIcon,
    badge: 'bg-amber-400/15 text-amber-200',
    label: 'Waiting'
  },
  processing: {
    icon: ExclamationTriangleIcon,
    badge: 'bg-rose-500/20 text-rose-200',
    label: 'Started, not finished'
  },
  completed: {
    icon: CheckCircleIcon,
    badge: 'bg-emerald-400/15 text-emerald-200',
    label: 'Completed'
  },
  cancelled: {
    icon: XCircleIcon,
    badge: 'bg-white/10 text-slate-300',
    label: 'Cancelled'
  }
}

// Who asked for the deletion (the request's requestType)
const typeLabels = {
  authenticated: 'Requested by the user, signed in',
  // Anyone can type any address into the public form, and no mail is sent to check it
  public: 'Public form, address not verified',
  admin: 'Deleted by an admin'
}

/**
 * What a waiting request waits for. One with a date is carried out by the
 * server itself on that date (src/lib/scheduledDeletions.ts); one without
 * waits for an admin. The route sends `deletesAutomatically` with each.
 */
const waitsFor = (request) =>
  request.deletesAutomatically ? `Deletes automatically ${when(request.scheduledDeletionAt)}` : 'Waits for an admin'

const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-100 transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300 disabled:cursor-not-allowed disabled:opacity-50'

const DANGER_BUTTON =
  'inline-flex items-center justify-center rounded-xl bg-rose-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:opacity-50'

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
  public_request_created: 'Requested on the public form',
  admin_request_created: 'Started by an admin',
  request_cancelled: 'Cancelled',
  deletion_started: 'Deletion started',
  deletion_resumed: 'Deletion run again',
  deletion_failed: 'Deletion stopped part-way',
  deletion_completed: 'Deletion completed'
}

/**
 * What a request calls its account: its email, or the name of an account
 * that had none (an old sign-in whose provider gave no address), or its id.
 */
const accountOf = (request) => request.email || request.accountName || request.userId

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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-300"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4" role="alert">
        <div className="flex">
          <ExclamationTriangleIcon className="h-5 w-5 text-rose-300" aria-hidden="true" />
          <div className="ml-3">
            <h3 className="text-sm font-semibold text-rose-100">The requests could not be loaded</h3>
            <p className="mt-2 text-sm text-rose-200">{error}</p>
            <button onClick={fetchRequests} className={`mt-3 ${SECONDARY_BUTTON}`}>
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
          <h1 className="text-2xl font-semibold text-white">
            Account Deletion Requests
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">
            Deletions people asked for, and accounts admins deleted from the Users page. A request a user made
            while signed in is carried out automatically {DELETION_GRACE_DAYS} days later, unless they cancel
            or you act first. A request from the public form waits for you: nobody verified its address.
          </p>
        </div>
        <div className="mt-4 sm:mt-0 sm:ml-16 sm:flex-none">
          <button
            onClick={fetchRequests}
            disabled={loading}
            className={SECONDARY_BUTTON}
          >
            Refresh
          </button>
        </div>
      </div>

      {total > requests.length && (
        <p className="text-sm text-slate-300">
          Showing the newest {requests.length} of {total} requests.
        </p>
      )}

      {/* Status Filter Tabs */}
      <div className="border-b border-white/10">
        <nav className="-mb-px flex flex-wrap gap-x-8" aria-label="Filter by status">
          <button
            onClick={() => setFilter('all')}
            aria-pressed={filter === 'all'}
            className={`py-2 px-1 border-b-2 font-medium text-sm ${
              filter === 'all'
                ? 'border-indigo-400 text-white'
                : 'border-transparent text-slate-400 hover:border-white/30 hover:text-slate-200'
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
                  ? 'border-indigo-400 text-white'
                  : 'border-transparent text-slate-400 hover:border-white/30 hover:text-slate-200'
              }`}
            >
              {config.label} ({statusCounts[status] || 0})
            </button>
          ))}
        </nav>
      </div>

      {/* Requests Table */}
      <div className="overflow-hidden rounded-2xl bg-slate-900/80 shadow-xl ring-1 ring-white/10">
        <ul className="divide-y divide-white/10">
          {filteredRequests.length === 0 ? (
            <li className="px-6 py-8 text-center">
              <p className="text-slate-400">
                No deletion requests found.
              </p>
            </li>
          ) : (
            filteredRequests.map((request) => {
              const config = statusConfig[request.status] || statusConfig.pending
              const IconComponent = config.icon
              const isExpanded = expandedRequest === request._id

              return (
                <li key={request._id} className={isExpanded ? 'bg-white/[0.03]' : 'hover:bg-white/5'}>
                  <div className="px-6 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-3">
                        <div className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.badge}`}>
                          <IconComponent className="h-3 w-3 mr-1" aria-hidden="true" />
                          {config.label}
                        </div>
                        <span className={`text-xs ${request.requestType === 'public' ? 'font-medium text-amber-200' : 'text-slate-400'}`}>
                          {typeLabels[request.requestType] || request.requestType}
                        </span>
                        {request.status === 'pending' && (
                          <span className="text-xs text-slate-400">{waitsFor(request)}</span>
                        )}
                      </div>

                      <div className="flex items-center space-x-4">
                        <div className="text-sm text-white">
                          {accountOf(request)}
                          {!request.email && <span className="ml-2 text-xs font-normal text-slate-400">no email address</span>}
                        </div>
                        <div className="text-sm text-slate-400">
                          {when(request.requestedAt)}
                        </div>
                        <button
                          onClick={() => setExpandedRequest(isExpanded ? null : request._id)}
                          aria-expanded={isExpanded}
                          className="rounded text-sm font-medium text-indigo-300 hover:text-indigo-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300"
                        >
                          {isExpanded ? 'Hide' : 'Details'}
                          <span className="sr-only"> for {accountOf(request)}</span>
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
      <dt className="inline font-medium text-slate-200">{label}:</dt>
      <dd className="inline ml-2 text-slate-300">{children}</dd>
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
      <h4 className="text-sm font-medium text-white mb-2">{finished ? 'Removed' : 'Removed so far'}</h4>
      {removed.length > 0 && (
        <p className="text-sm text-slate-300">
          {removed.map(([name, count]) => `${name}: ${count}`).join(' · ')}
        </p>
      )}
      {keptSharedPlaylists.length > 0 && (
        <p className="mt-1 text-sm text-slate-300">
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
      <h4 className="text-sm font-medium text-white mb-2">Audit log</h4>
      {state.error && <p className="text-sm text-rose-300">{state.error}</p>}
      {!state.error && state.entries === null && <p className="text-sm text-slate-400">Loading…</p>}
      {state.entries?.length === 0 && <p className="text-sm text-slate-400">No entries.</p>}
      {state.entries?.length > 0 && (
        <ol className="space-y-1 text-sm text-slate-300">
          {state.entries.map((entry) => (
            <li key={entry.id}>
              <span className="text-slate-400">{when(entry.performedAt)}</span>{' '}
              <span className="font-medium text-slate-100">{auditLabels[entry.action] || entry.action}</span>
              {entry.performedBy && <> by {entry.performedBy.name || entry.performedBy.email}</>}
              {!entry.performedBy && entry.details?.automatic && <> automatically, by the server’s hourly check</>}
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
  // Made on the public form: nobody has proved the address is theirs
  const unverified = request.requestType === 'public'
  const executeLabel = stopped ? 'Run again' : 'Delete this account now'

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      {stopped && (
        <div className="mb-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-100" role="alert">
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

      {unverified && request.status === 'pending' && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-relaxed text-amber-100" role="note">
          This request came from the public form, where anyone can type any email address, and no email was
          sent to check it. Make sure it really is from {request.email || 'the account’s owner'} before
          deleting. The account has been told in the app and can cancel the request.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <h4 className="text-sm font-medium text-white mb-2">Request Details</h4>
          <dl className="space-y-1 text-sm">
            <div>
              <dt className="inline font-medium text-slate-200">ID:</dt>
              <dd className="inline ml-2 text-slate-300 font-mono">{request._id}</dd>
            </div>
            <Detail label="Type">{typeLabels[request.requestType] || request.requestType}</Detail>
            {request.reason && (
              <div>
                <dt className="font-medium text-slate-200">Reason:</dt>
                <dd className="text-slate-300 mt-1">{request.reason}</dd>
              </div>
            )}
            <Detail label="Requested">{when(request.requestedAt)}</Detail>
            {request.status === 'pending' && typeof request.waitingDays === 'number' && (
              <Detail label="Waiting">
                {request.waitingDays === 0 ? 'less than a day' : `${request.waitingDays} day${request.waitingDays !== 1 ? 's' : ''}`}
              </Detail>
            )}
            {request.status === 'pending' && <Detail label="Next">{waitsFor(request)}</Detail>}
            {request.startedAt && <Detail label="Started">{when(request.startedAt)}</Detail>}
            {request.completedAt && (
              <Detail label="Completed">
                {when(request.completedAt)}
                {request.completedAutomatically ? ' (automatically)' : ''}
              </Detail>
            )}
            {request.cancelledAt && (
              <Detail label="Cancelled">
                {when(request.cancelledAt)}
                {request.cancellationReason ? ` (${request.cancellationReason})` : ''}
              </Detail>
            )}
          </dl>
        </div>

        <div>
          <h4 className="text-sm font-medium text-white mb-2">Actions</h4>
          <div className="space-y-2">
            {canExecute && (
              <button
                onClick={() => setShowActionForm('execute')}
                disabled={actionLoading}
                className={`w-full ${DANGER_BUTTON}`}
              >
                <TrashIcon className="h-4 w-4 mr-1" aria-hidden="true" />
                {executeLabel}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => setShowActionForm('cancel')}
                disabled={actionLoading}
                className={`w-full ${SECONDARY_BUTTON}`}
              >
                <XMarkIcon className="h-4 w-4 mr-1" aria-hidden="true" />
                Cancel Request
              </button>
            )}
            {!canExecute && !canCancel && (
              <p className="text-sm text-slate-400">Nothing more to do.</p>
            )}
          </div>
        </div>
      </div>

      {showActionForm && (
        <div className="mt-4 rounded-xl bg-slate-950/60 p-4 ring-1 ring-white/10">
          <h5 className="text-sm font-medium text-white mb-2">
            {showActionForm === 'execute' ? executeLabel : 'Cancel Request'}
          </h5>
          <div className="space-y-3">
            {showActionForm === 'execute' ? (
              <p className="text-sm leading-relaxed text-slate-200">
                This deletes {accountOf(request)}’s account and its data now. It can’t be undone.
                {unverified && !stopped && ' Nobody has proved this request is theirs: it came from the public form.'}
                {request.deletesAutomatically &&
                  ` The user has until ${when(request.scheduledDeletionAt)} to cancel: deleting now ends that early.`}
              </p>
            ) : (
              <textarea
                value={actionReason}
                onChange={(e) => setActionReason(e.target.value)}
                placeholder="Reason for this action (optional)"
                aria-label="Reason for cancelling (optional)"
                rows={2}
                className="block w-full rounded-xl border-0 bg-slate-950/60 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/15 placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-indigo-400"
              />
            )}
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowActionForm(null)}
                className={SECONDARY_BUTTON}
              >
                Back
              </button>
              <button
                onClick={() => handleActionSubmit(showActionForm)}
                disabled={actionLoading}
                className={showActionForm === 'execute' ? DANGER_BUTTON : SECONDARY_BUTTON}
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
