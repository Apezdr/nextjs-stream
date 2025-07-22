'use client'

import { useState } from 'react'
import { 
  CheckCircleIcon, 
  ClockIcon, 
  ExclamationTriangleIcon,
  XCircleIcon,
  InformationCircleIcon
} from '@heroicons/react/24/outline'
import { formatDateToEST } from '@src/utils'

const statusConfig = {
  pending: {
    icon: ClockIcon,
    color: 'text-yellow-600',
    bgColor: 'bg-yellow-50 dark:bg-yellow-900/20',
    borderColor: 'border-yellow-200 dark:border-yellow-800',
    title: 'Deletion Request Pending',
    description: 'Your account deletion request is being processed.'
  },
  email_verification_pending: {
    icon: InformationCircleIcon,
    color: 'text-blue-600',
    bgColor: 'bg-blue-50 dark:bg-blue-900/20',
    borderColor: 'border-blue-200 dark:border-blue-800',
    title: 'Email Verification Required',
    description: 'Please check your email and click the verification link to confirm your deletion request.'
  },
  verified: {
    icon: CheckCircleIcon,
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    title: 'Request Verified',
    description: 'Your deletion request has been verified and is scheduled for processing.'
  },
  scheduled: {
    icon: ClockIcon,
    color: 'text-orange-600',
    bgColor: 'bg-orange-50 dark:bg-orange-900/20',
    borderColor: 'border-orange-200 dark:border-orange-800',
    title: 'Deletion Scheduled',
    description: 'Your account is scheduled for deletion. You can still cancel this request.'
  },
  completed: {
    icon: CheckCircleIcon,
    color: 'text-green-600',
    bgColor: 'bg-green-50 dark:bg-green-900/20',
    borderColor: 'border-green-200 dark:border-green-800',
    title: 'Account Deleted',
    description: 'Your account and all associated data have been permanently deleted.'
  },
  cancelled: {
    icon: XCircleIcon,
    color: 'text-gray-600',
    bgColor: 'bg-gray-50 dark:bg-gray-900/20',
    borderColor: 'border-gray-200 dark:border-gray-800',
    title: 'Request Cancelled',
    description: 'Your account deletion request has been cancelled.'
  },
  expired: {
    icon: ExclamationTriangleIcon,
    color: 'text-red-600',
    bgColor: 'bg-red-50 dark:bg-red-900/20',
    borderColor: 'border-red-200 dark:border-red-800',
    title: 'Request Expired',
    description: 'Your deletion request has expired and needs to be resubmitted.'
  }
}

export default function DeletionStatusCard({ 
  request, 
  onCancel, 
  showCancelButton = true,
  isLoading = false 
}) {
  const [isCancelling, setIsCancelling] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [showCancelForm, setShowCancelForm] = useState(false)

  if (!request) {
    return null
  }

  const config = statusConfig[request.status] || statusConfig.pending
  const IconComponent = config.icon

  const canCancel = ['pending', 'email_verification_pending', 'verified', 'scheduled'].includes(request.status)
  const showGracePeriod = request.status === 'scheduled' && request.scheduledDeletionDate

  const handleCancelClick = () => {
    setShowCancelForm(true)
  }

  const handleCancelSubmit = async (e) => {
    e.preventDefault()
    setIsCancelling(true)
    
    try {
      await onCancel(request._id, cancelReason)
      setShowCancelForm(false)
      setCancelReason('')
    } catch (error) {
      console.error('Failed to cancel deletion request:', error)
    } finally {
      setIsCancelling(false)
    }
  }

  const calculateDaysRemaining = (scheduledDate) => {
    const now = new Date()
    const scheduled = new Date(scheduledDate)
    const diffTime = scheduled - now
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return Math.max(0, diffDays)
  }

  return (
    <div className={`rounded-lg border p-6 ${config.bgColor} ${config.borderColor}`}>
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <IconComponent className={`h-6 w-6 ${config.color}`} aria-hidden="true" />
        </div>
        <div className="ml-3 flex-1">
          <h3 className={`text-lg font-medium ${config.color}`}>
            {config.title}
          </h3>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {config.description}
          </p>

          {/* Request Details */}
          <div className="mt-4 space-y-2">
            <div className="text-sm">
              <span className="font-medium text-gray-700 dark:text-gray-300">Request ID:</span>
              <span className="ml-2 font-mono text-gray-600 dark:text-gray-400">
                {request._id.slice(-8)}
              </span>
            </div>
            
            <div className="text-sm">
              <span className="font-medium text-gray-700 dark:text-gray-300">Submitted:</span>
              <span className="ml-2 text-gray-600 dark:text-gray-400">
                {formatDateToEST(request.createdAt)}
              </span>
            </div>

            {request.email && (
              <div className="text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">Email:</span>
                <span className="ml-2 text-gray-600 dark:text-gray-400">
                  {request.email}
                </span>
              </div>
            )}

            {request.reason && (
              <div className="text-sm">
                <span className="font-medium text-gray-700 dark:text-gray-300">Reason:</span>
                <p className="mt-1 text-gray-600 dark:text-gray-400">
                  {request.reason}
                </p>
              </div>
            )}

            {showGracePeriod && (
              <div className="mt-4 p-3 bg-orange-100 dark:bg-orange-900/30 rounded-md">
                <div className="flex items-center">
                  <ClockIcon className="h-5 w-5 text-orange-600 mr-2" />
                  <div>
                    <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
                      Grace Period Active
                    </p>
                    <p className="text-sm text-orange-700 dark:text-orange-300">
                      {calculateDaysRemaining(request.scheduledDeletionDate)} days remaining until permanent deletion
                    </p>
                    <p className="text-xs text-orange-600 dark:text-orange-400 mt-1">
                      Scheduled for: {formatDateToEST(request.scheduledDeletionDate)}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {request.verificationToken && request.status === 'email_verification_pending' && (
              <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-900/30 rounded-md">
                <p className="text-sm text-blue-800 dark:text-blue-200">
                  <strong>Next Step:</strong> Check your email for a verification link. 
                  The link will expire in 24 hours.
                </p>
              </div>
            )}
          </div>

          {/* Cancel Button */}
          {showCancelButton && canCancel && !showCancelForm && (
            <div className="mt-6">
              <button
                type="button"
                onClick={handleCancelClick}
                disabled={isLoading}
                className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600"
              >
                Cancel Deletion Request
              </button>
            </div>
          )}

          {/* Cancel Form */}
          {showCancelForm && (
            <div className="mt-6 p-4 bg-white dark:bg-gray-800 rounded-md border border-gray-200 dark:border-gray-700">
              <form onSubmit={handleCancelSubmit}>
                <div className="mb-4">
                  <label htmlFor="cancelReason" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Reason for cancellation (optional)
                  </label>
                  <textarea
                    id="cancelReason"
                    name="cancelReason"
                    rows={3}
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm"
                    placeholder="Why are you cancelling this request?"
                    disabled={isCancelling}
                  />
                </div>
                <div className="flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setShowCancelForm(false)}
                    disabled={isCancelling}
                    className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed dark:bg-gray-700 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-600"
                  >
                    Keep Request
                  </button>
                  <button
                    type="submit"
                    disabled={isCancelling}
                    className="inline-flex items-center rounded-md border border-transparent bg-red-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isCancelling ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Cancelling...
                      </>
                    ) : (
                      'Cancel Request'
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}