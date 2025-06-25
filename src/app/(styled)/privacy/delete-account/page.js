'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeftIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import { siteTitle } from '@src/utils/config'
import DeletionRequestForm from '@components/DeletionRequest/DeletionRequestForm'

export default function PublicDeleteAccountPage() {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState('')

  const handleSubmitRequest = async (formData) => {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/public/delete-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: formData.email,
          reason: formData.reason,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to submit deletion request')
      }

      setSubmittedEmail(formData.email)
      setSuccess(true)
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setSubmitting(false)
    }
  }

  if (success) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-between xl:p-24 bg-gray-800">
        <Link href="/" className="self-start mt-16">
          <button
            type="button"
            className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <ArrowLeftIcon className="w-6 h-6" />
            Back to Home
          </button>
        </Link>

        <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20 w-full max-w-2xl">
          <div className="container mx-auto px-4 py-8">
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-8 text-center">
              <CheckCircleIcon className="h-16 w-16 text-green-600 mx-auto mb-4" />
              <h1 className="text-2xl font-bold text-green-800 dark:text-green-200 mb-4">
                Deletion Request Submitted
              </h1>
              <p className="text-green-700 dark:text-green-300 mb-6">
                We've sent a verification email to <strong>{submittedEmail}</strong>. 
                Please check your inbox and click the verification link to confirm your deletion request.
              </p>
              
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4 mb-6">
                <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
                  Next Steps
                </h3>
                <ol className="text-sm text-blue-700 dark:text-blue-300 text-left space-y-1">
                  <li>1. Check your email inbox (and spam folder)</li>
                  <li>2. Click the verification link in the email</li>
                  <li>3. Your account will be scheduled for deletion</li>
                  <li>4. You'll have 30 days to cancel if needed</li>
                </ol>
              </div>

              <p className="text-sm text-gray-600 dark:text-gray-400">
                The verification link will expire in 24 hours for security purposes.
              </p>
            </div>

            <div className="mt-8 text-center space-y-4">
              <Link
                href="/privacy"
                className="block text-indigo-600 hover:text-indigo-500 text-sm font-medium"
              >
                Review Privacy Policy
              </Link>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Questions about data deletion? Contact the administrator for assistance.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <Link href="/" className="self-start mt-16">
        <button
          type="button"
          className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <ArrowLeftIcon className="w-6 h-6" />
          Back to Home
        </button>
      </Link>

      <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20 w-full max-w-4xl bg-gray-800 rounded-lg shadow-lg">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              Request Account Deletion
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-6">
              Submit a request to permanently delete your {siteTitle} account and personal data
            </p>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-md p-4">
              <p className="text-sm text-yellow-800 dark:text-yellow-200">
                <strong>Note:</strong> If you have an active account, please{' '}
                <Link href="/auth/signin" className="underline hover:no-underline">
                  sign in
                </Link>{' '}
                to access the account deletion feature directly.
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          <DeletionRequestForm
            onSubmit={handleSubmitRequest}
            isLoading={submitting}
            isAuthenticated={false}
            showEmailField={true}
          />

          <div className="mt-8 text-center space-y-4">
            <Link
              href="/privacy"
              className="block text-indigo-600 hover:text-indigo-500 text-sm font-medium"
            >
              Review Privacy Policy
            </Link>
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
              <p>
                This request is processed in accordance with GDPR and CCPA regulations.
              </p>
              <p>
                Questions about data deletion? Contact the administrator for assistance.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}