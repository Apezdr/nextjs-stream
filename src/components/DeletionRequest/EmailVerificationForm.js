'use client'

import { useState } from 'react'
import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline'

export default function EmailVerificationForm({ 
  token, 
  onVerify, 
  isLoading = false,
  error = null,
  success = false 
}) {
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationError, setVerificationError] = useState(error)

  const handleVerify = async () => {
    if (!token) {
      setVerificationError('Invalid verification token')
      return
    }

    setIsVerifying(true)
    setVerificationError(null)

    try {
      await onVerify(token)
    } catch (err) {
      setVerificationError(err.message || 'Verification failed')
    } finally {
      setIsVerifying(false)
    }
  }

  if (success) {
    return (
      <div className="max-w-md mx-auto">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6">
          <div className="flex items-center">
            <CheckCircleIcon className="h-8 w-8 text-green-600 mr-3" />
            <div>
              <h3 className="text-lg font-medium text-green-800 dark:text-green-200">
                Email Verified Successfully
              </h3>
              <p className="mt-1 text-sm text-green-700 dark:text-green-300">
                Your deletion request has been verified and will be processed according to our data retention policy.
              </p>
            </div>
          </div>
          
          <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md">
            <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
              What happens next?
            </h4>
            <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
              <li>• Your account will be scheduled for deletion</li>
              <li>• You have a 30-day grace period to cancel if needed</li>
              <li>• After 30 days, all data will be permanently deleted</li>
              <li>• You will receive a final confirmation email</li>
            </ul>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto">
      <div className="bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            Verify Email Address
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            Click the button below to verify your email address and confirm your account deletion request.
          </p>

          {verificationError && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
              <div className="flex items-center">
                <ExclamationTriangleIcon className="h-5 w-5 text-red-400 mr-2" />
                <p className="text-sm text-red-600 dark:text-red-400">
                  {verificationError}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-4">
            <button
              onClick={handleVerify}
              disabled={isVerifying || isLoading || !token}
              className="w-full inline-flex justify-center items-center rounded-md border border-transparent bg-indigo-600 py-3 px-4 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isVerifying ? (
                <>
                  <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Verifying...
                </>
              ) : (
                'Verify Email & Confirm Deletion'
              )}
            </button>

            {!token && (
              <p className="text-sm text-red-600 dark:text-red-400">
                Invalid or missing verification token. Please check your email for the correct link.
              </p>
            )}
          </div>

          <div className="mt-6 text-xs text-gray-500 dark:text-gray-400">
            <p>
              This verification link will expire in 24 hours for security purposes.
            </p>
          </div>
        </div>
      </div>

      {/* Information Panel */}
      <div className="mt-6 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
          Important Information
        </h3>
        <ul className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
          <li>• Verification confirms your identity and deletion request</li>
          <li>• You will have 30 days to cancel after verification</li>
          <li>• All personal data will be permanently deleted</li>
          <li>• This action cannot be undone after the grace period</li>
        </ul>
      </div>

      {/* Privacy Notice */}
      <div className="mt-4 bg-gray-50 dark:bg-gray-900/20 border border-gray-200 dark:border-gray-700 rounded-lg p-4">
        <h3 className="text-sm font-medium text-gray-800 dark:text-gray-200 mb-2">
          Privacy Rights
        </h3>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          This deletion request is processed in accordance with GDPR and CCPA regulations. 
          You have the right to request deletion of your personal data, and we will comply 
          with applicable privacy laws.
        </p>
      </div>
    </div>
  )
}
