'use client'
import { useState } from 'react'
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { authClient } from '@src/lib/auth-client'

export default function DeviceLinkModal({ isOpen, onClose }) {
  const [userCode, setUserCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [denied, setDenied] = useState(false)
  const [error, setError] = useState(null)

  const handleApprove = async () => {
    if (!userCode.trim()) {
      setError('Please enter the code shown on your TV.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const { error: err } = await authClient.device.approve({ userCode: userCode.trim() })
      if (err) throw new Error(err.error_description ?? 'Failed to approve device')
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleDeny = async () => {
    setLoading(true)
    setError(null)
    try {
      await authClient.device.deny({ userCode: userCode.trim() })
      setDenied(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    // Reset state when closing
    setUserCode('')
    setLoading(false)
    setSuccess(false)
    setDenied(false)
    setError(null)
    onClose()
  }

  return (
    <Dialog open={isOpen} onClose={handleClose} className="relative z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        aria-hidden="true"
      />

      {/* Dialog Panel */}
      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <DialogPanel className="w-full max-w-sm transform rounded-lg bg-white p-6 shadow-xl transition-all">
            {/* Header with close button */}
            <div className="flex items-center justify-between mb-4">
              <DialogTitle className="text-lg font-semibold text-gray-900">
                Link your TV device
              </DialogTitle>
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600 focus:outline-none"
              >
                <XMarkIcon className="h-6 w-6" />
              </button>
            </div>

            {/* Success state */}
            {success && (
              <div className="text-center py-4">
                <div className="text-5xl mb-3 text-green-600">✓</div>
                <h3 className="text-lg font-semibold text-green-600 mb-2">Device Approved!</h3>
                <p className="text-gray-600 text-sm mb-4">
                  Your TV has been linked to your account.
                </p>
                <button
                  onClick={handleClose}
                  className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
                >
                  Done
                </button>
              </div>
            )}

            {/* Denied state */}
            {denied && (
              <div className="text-center py-4">
                <div className="text-5xl mb-3 text-red-600">✕</div>
                <h3 className="text-lg font-semibold text-red-600 mb-2">Request Denied</h3>
                <p className="text-gray-600 text-sm mb-4">
                  The device request was denied.
                </p>
                <button
                  onClick={handleClose}
                  className="w-full px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 font-medium"
                >
                  Close
                </button>
              </div>
            )}

            {/* Input form (default state) */}
            {!success && !denied && (
              <div className="space-y-4">
                <p className="text-gray-600 text-sm">
                  Enter the device code shown on your TV
                </p>

                {/* Code input */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Device Code
                  </label>
                  <input
                    type="text"
                    value={userCode}
                    onChange={(e) => setUserCode(e.target.value.toUpperCase())}
                    placeholder="ABCDEFGH"
                    maxLength={9}
                    className="text-gray-900 w-full px-4 py-2 text-center text-2xl font-mono tracking-widest border-2 border-gray-300 rounded-lg focus:border-blue-500 focus:outline-none"
                  />
                </div>

                {/* Error message */}
                {error && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-red-700 text-sm">{error}</p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    onClick={handleApprove}
                    disabled={loading || !userCode.trim()}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition"
                  >
                    {loading ? 'Approving…' : 'Approve'}
                  </button>
                  <button
                    onClick={handleDeny}
                    disabled={loading}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition"
                  >
                    Deny
                  </button>
                </div>

                {/* Close button */}
                <button
                  onClick={handleClose}
                  className="w-full px-4 py-2 text-gray-600 hover:text-gray-900 font-medium"
                >
                  Cancel
                </button>
              </div>
            )}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  )
}
