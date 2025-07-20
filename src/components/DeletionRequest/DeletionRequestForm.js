'use client'

import { useState } from 'react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'

export default function DeletionRequestForm({ 
  onSubmit, 
  isLoading = false, 
  isAuthenticated = false,
  initialReason = '',
  showEmailField = false 
}) {
  const [formData, setFormData] = useState({
    reason: initialReason,
    email: '',
    confirmDeletion: false,
    acknowledgeConsequences: false
  })
  const [errors, setErrors] = useState({})

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }))
    
    // Clear error when user starts typing/checking
    if (errors[name]) {
      setErrors(prev => ({ ...prev, [name]: null }))
    }
  }

  const validateForm = () => {
    const newErrors = {}

    if (!formData.reason.trim()) {
      newErrors.reason = 'Please provide a reason for account deletion'
    }

    if (showEmailField && !formData.email.trim()) {
      newErrors.email = 'Email address is required'
    }

    if (showEmailField && formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address'
    }

    if (!formData.confirmDeletion) {
      newErrors.confirmDeletion = 'You must confirm that you want to delete your account'
    }

    if (!formData.acknowledgeConsequences) {
      newErrors.acknowledgeConsequences = 'You must acknowledge the consequences of account deletion'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!validateForm()) {
      return
    }

    try {
      await onSubmit(formData)
    } catch (error) {
      setErrors({ submit: error.message || 'An error occurred while processing your request' })
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      {/* Warning Banner */}
      <div className="bg-red-50 dark:bg-red-900/20 border-l-4 border-red-400 p-4 mb-6">
        <div className="flex">
          <div className="shrink-0">
            <ExclamationTriangleIcon className="h-5 w-5 text-red-400" aria-hidden="true" />
          </div>
          <div className="ml-3">
            <h3 className="text-sm font-medium text-red-800 dark:text-red-200">
              Account Deletion Warning
            </h3>
            <div className="mt-2 text-sm text-red-700 dark:text-red-300">
              <p>
                This action will permanently delete your account and all associated data. This includes:
              </p>
              <ul className="list-disc list-inside mt-2 space-y-1">
                <li>Your viewing history and watch progress</li>
                <li>Account preferences and settings</li>
                <li>All personal information and profile data</li>
                <li>Access to this streaming service</li>
              </ul>
              <p className="mt-2 font-medium">
                This action cannot be undone after the 30-day grace period.
              </p>
            </div>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Email Field (for public requests) */}
        {showEmailField && (
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              Email Address
            </label>
            <div className="mt-1">
              <input
                type="email"
                name="email"
                id="email"
                value={formData.email}
                onChange={handleInputChange}
                className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm ${
                  errors.email ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''
                }`}
                placeholder="Enter the email address associated with your account"
                disabled={isLoading}
              />
              {errors.email && (
                <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errors.email}</p>
              )}
            </div>
          </div>
        )}

        {/* Reason Field */}
        <div>
          <label htmlFor="reason" className="block text-sm font-medium text-gray-700 dark:text-gray-300">
            Reason for Account Deletion
          </label>
          <div className="mt-1">
            <textarea
              name="reason"
              id="reason"
              rows={4}
              value={formData.reason}
              onChange={handleInputChange}
              className={`block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 dark:bg-gray-700 dark:border-gray-600 dark:text-white sm:text-sm ${
                errors.reason ? 'border-red-300 focus:border-red-500 focus:ring-red-500' : ''
              }`}
              placeholder="Please tell us why you want to delete your account (optional but helpful for improving our service)"
              disabled={isLoading}
            />
            {errors.reason && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{errors.reason}</p>
            )}
          </div>
        </div>

        {/* Confirmation Checkboxes */}
        <div className="space-y-4">
          <div className="flex items-start">
            <div className="flex items-center h-5">
              <input
                id="confirmDeletion"
                name="confirmDeletion"
                type="checkbox"
                checked={formData.confirmDeletion}
                onChange={handleInputChange}
                className={`focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-300 rounded ${
                  errors.confirmDeletion ? 'border-red-300' : ''
                }`}
                disabled={isLoading}
              />
            </div>
            <div className="ml-3 text-sm">
              <label htmlFor="confirmDeletion" className="font-medium text-gray-700 dark:text-gray-300">
                I confirm that I want to delete my account
              </label>
              {errors.confirmDeletion && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.confirmDeletion}</p>
              )}
            </div>
          </div>

          <div className="flex items-start">
            <div className="flex items-center h-5">
              <input
                id="acknowledgeConsequences"
                name="acknowledgeConsequences"
                type="checkbox"
                checked={formData.acknowledgeConsequences}
                onChange={handleInputChange}
                className={`focus:ring-indigo-500 h-4 w-4 text-indigo-600 border-gray-300 rounded ${
                  errors.acknowledgeConsequences ? 'border-red-300' : ''
                }`}
                disabled={isLoading}
              />
            </div>
            <div className="ml-3 text-sm">
              <label htmlFor="acknowledgeConsequences" className="font-medium text-gray-700 dark:text-gray-300">
                I understand that this action is permanent and cannot be undone after the 30-day grace period
              </label>
              {errors.acknowledgeConsequences && (
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{errors.acknowledgeConsequences}</p>
              )}
            </div>
          </div>
        </div>

        {/* GDPR/CCPA Notice */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md p-4">
          <h4 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            Your Privacy Rights
          </h4>
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Under GDPR and CCPA regulations, you have the right to request deletion of your personal data. 
            This request will be processed in accordance with applicable privacy laws and our privacy policy.
          </p>
        </div>

        {/* Submit Error */}
        {errors.submit && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-4">
            <p className="text-sm text-red-600 dark:text-red-400">{errors.submit}</p>
          </div>
        )}

        {/* Submit Button */}
        <div className="flex justify-end space-x-3">
          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex justify-center rounded-md border border-transparent bg-red-600 py-2 px-4 text-sm font-medium text-white shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Processing...
              </>
            ) : (
              'Submit Deletion Request'
            )}
          </button>
        </div>
      </form>
    </div>
  )
}