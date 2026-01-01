'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'
import { siteTitle } from '@src/utils/config'
import EmailVerificationForm from '@components/DeletionRequest/EmailVerificationForm'

export default function VerifyDeletionPage() {
  const searchParams = useSearchParams()
  const [token, setToken] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    const tokenParam = searchParams.get('token')
    if (tokenParam) {
      setToken(tokenParam)
    } else {
      setError('No verification token provided')
    }
  }, [searchParams])

  const handleVerify = async (verificationToken) => {
    setVerifying(true)
    setError(null)

    try {
      const response = await fetch('/api/public/verify-deletion', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: verificationToken,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Verification failed')
      }

      const data = await response.json()
      setSuccess(true)
    } catch (err) {
      setError(err.message)
      throw err
    } finally {
      setVerifying(false)
    }
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

      <div className="h-auto flex flex-col items-center justify-center py-32 lg:py-0 sm:mt-20 w-full max-w-2xl">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              Verify Account Deletion
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400">
              Confirm your email address to proceed with account deletion
            </p>
          </div>

          <EmailVerificationForm
            token={token}
            onVerify={handleVerify}
            isLoading={verifying}
            error={error}
            success={success}
          />

          {!success && (
            <div className="mt-8 text-center space-y-4">
              <div className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                <p>
                  <strong>Having trouble?</strong>
                </p>
                <ul className="space-y-1">
                  <li>• Check that you clicked the correct link from your email</li>
                  <li>• Ensure the verification link hasn't expired (24 hours)</li>
                  <li>• Try submitting a new deletion request if needed</li>
                </ul>
              </div>
              
              <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                <Link
                  href="/privacy/delete-account"
                  className="text-indigo-600 hover:text-indigo-500 text-sm font-medium"
                >
                  Submit New Deletion Request
                </Link>
              </div>
              
              <Link
                href="/privacy"
                className="block text-indigo-600 hover:text-indigo-500 text-sm font-medium"
              >
                Review Privacy Policy
              </Link>
            </div>
          )}

          {success && (
            <div className="mt-8 text-center space-y-4">
              <Link
                href="/privacy"
                className="block text-indigo-600 hover:text-indigo-500 text-sm font-medium"
              >
                Review Privacy Policy
              </Link>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Questions about the deletion process? Contact the administrator for assistance.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}