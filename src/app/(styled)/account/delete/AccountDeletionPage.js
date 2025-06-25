'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import DeletionRequestForm from '@components/DeletionRequest/DeletionRequestForm'
import DeletionStatusCard from '@components/DeletionRequest/DeletionStatusCard'

export default function AccountDeletionPage({ user }) {
  const [existingRequest, setExistingRequest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)
  const router = useRouter()

  useEffect(() => {
    checkExistingRequest()
  }, [])

  const checkExistingRequest = async () => {
    try {
      const response = await fetch('/api/authenticated/account/delete-request')
      if (response.ok) {
        const data = await response.json()
        if (data.request) {
          setExistingRequest(data.request)
        }
      }
    } catch (err) {
      console.error('Failed to check existing request:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSubmitRequest = async (formData) => {
    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/authenticated/account/delete-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: formData.reason,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to submit deletion request')
      }

      const data = await response.json()
      setExistingRequest(data.request)
      setSuccess(true)
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancelRequest = async (requestId, reason) => {
    try {
      const response = await fetch('/api/authenticated/account/delete-request', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId,
          reason,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to cancel deletion request')
      }

      // Refresh the request status
      await checkExistingRequest()
    } catch (err) {
      setError(err.message)
      throw err
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
        <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <Link href="/list" className="self-start mt-16">
        <button
          type="button"
          className="flex flex-row gap-x-2 rounded bg-indigo-600 px-2 py-1 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <ArrowLeftIcon className="w-6 h-6" />
          Back to Library
        </button>
      </Link>

      <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20 w-full max-w-4xl">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              Account Deletion
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Request permanent deletion of your account and personal data
            </p>
          </div>

          {error && (
            <div className="mb-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            </div>
          )}

          {success && !existingRequest && (
            <div className="mb-6 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-md p-4">
              <p className="text-sm text-green-600 dark:text-green-400">
                Your deletion request has been submitted successfully.
              </p>
            </div>
          )}

          {existingRequest ? (
            <div className="space-y-6">
              <DeletionStatusCard
                request={existingRequest}
                onCancel={handleCancelRequest}
                showCancelButton={true}
                isLoading={submitting}
              />

              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                <h3 className="text-lg font-medium text-blue-800 dark:text-blue-200 mb-4">
                  Account Information
                </h3>
                <dl className="space-y-2">
                  <div>
                    <dt className="inline text-sm font-medium text-blue-700 dark:text-blue-300">Name:</dt>
                    <dd className="inline ml-2 text-sm text-blue-600 dark:text-blue-400">{user.name}</dd>
                  </div>
                  <div>
                    <dt className="inline text-sm font-medium text-blue-700 dark:text-blue-300">Email:</dt>
                    <dd className="inline ml-2 text-sm text-blue-600 dark:text-blue-400">{user.email}</dd>
                  </div>
                  <div>
                    <dt className="inline text-sm font-medium text-blue-700 dark:text-blue-300">User ID:</dt>
                    <dd className="inline ml-2 text-sm text-blue-600 dark:text-blue-400 font-mono">{user.id}</dd>
                  </div>
                </dl>
              </div>

              <div className="text-center">
                <Link
                  href="/privacy"
                  className="text-indigo-600 hover:text-indigo-500 text-sm font-medium"
                >
                  Review Privacy Policy
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                <h3 className="text-lg font-medium text-blue-800 dark:text-blue-200 mb-4">
                  Account Information
                </h3>
                <p className="text-sm text-blue-700 dark:text-blue-300 mb-4">
                  The following account will be permanently deleted:
                </p>
                <dl className="space-y-2">
                  <div>
                    <dt className="inline text-sm font-medium text-blue-700 dark:text-blue-300">Name:</dt>
                    <dd className="inline ml-2 text-sm text-blue-600 dark:text-blue-400">{user.name}</dd>
                  </div>
                  <div>
                    <dt className="inline text-sm font-medium text-blue-700 dark:text-blue-300">Email:</dt>
                    <dd className="inline ml-2 text-sm text-blue-600 dark:text-blue-400">{user.email}</dd>
                  </div>
                  <div>
                    <dt className="inline text-sm font-medium text-blue-700 dark:text-blue-300">User ID:</dt>
                    <dd className="inline ml-2 text-sm text-blue-600 dark:text-blue-400 font-mono">{user.id}</dd>
                  </div>
                </dl>
              </div>

              <DeletionRequestForm
                onSubmit={handleSubmitRequest}
                isLoading={submitting}
                isAuthenticated={true}
                showEmailField={false}
              />

              <div className="text-center space-y-2">
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
          )}
        </div>
      </div>
    </div>
  )
}