'use client'

import { useState } from 'react'
import { ClockIcon } from '@heroicons/react/24/outline'
import { CARD, SECONDARY_BUTTON } from './DeletionPageShell'

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })

/** A date as the card shows it, or null for one that isn't a date. */
function longDate(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : dateFormat.format(date)
}

/**
 * The signed-in user's deletion request while it waits, and the way to cancel
 * it. The request is as GET /api/authenticated/account/delete-request sends
 * it: { id, status, requestType, requestedAt, scheduledDeletionAt, reason, canCancel }.
 *
 * A request with a scheduledDeletionAt is carried out by the server itself on
 * that date (src/lib/scheduledDeletions.ts), and the card says which. One
 * without (made on the public form) waits for an admin, and the card names no
 * date: a date here must be one something acts on.
 *
 * @param {{ request: Object|null, onCancel: (requestId: string) => Promise<unknown> }} props
 *   `onCancel` throws when the request can't be cancelled; its message is shown here.
 */
export default function DeletionStatusCard({ request, onCancel }) {
  const [cancelling, setCancelling] = useState(false)
  const [error, setError] = useState(null)

  if (!request) {
    return null
  }

  const requested = longDate(request.requestedAt)
  const deletesOn = request.scheduledDeletionAt ? longDate(request.scheduledDeletionAt) : null
  // Made with the account's email on the public form: perhaps not by its owner
  const byEmail = request.requestType === 'public'

  const handleCancel = async () => {
    setCancelling(true)
    setError(null)
    try {
      await onCancel(request.id)
    } catch (cancelError) {
      setError(cancelError?.message || 'The request could not be cancelled. Try again.')
      setCancelling(false)
    }
  }

  return (
    <section aria-labelledby="deletion-request-heading" className={CARD}>
      <div className="flex items-start gap-4">
        <span className="shrink-0 rounded-xl bg-amber-400/15 p-2.5 text-amber-300">
          <ClockIcon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 id="deletion-request-heading" className="text-lg font-semibold text-white">
            Deletion requested
          </h2>
          {deletesOn ? (
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              Your account will be deleted on <strong className="font-semibold text-white">{deletesOn}</strong>,
              automatically, unless you cancel the request first. An admin may delete it sooner. Until then it
              works as usual.
            </p>
          ) : (
            <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
              Your request is with the admins, who delete accounts by hand. There is no set date. Until one of
              them deletes the account it works as usual, and you can cancel the request here.
            </p>
          )}
        </div>
      </div>

      {byEmail && (
        <p className="mt-5 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm leading-relaxed text-amber-100">
          This request was made with your email address on the public form, not from your account. If it wasn’t
          you, cancel it.
        </p>
      )}

      <dl className="mt-6 grid gap-x-8 gap-y-4 border-t border-white/10 pt-6 text-sm sm:grid-cols-2">
        {requested && (
          <div>
            <dt className="text-slate-400">Requested</dt>
            <dd className="mt-1 text-white">{requested}</dd>
          </div>
        )}
        {deletesOn && (
          <div>
            <dt className="text-slate-400">Deletion date</dt>
            <dd className="mt-1 text-white">{deletesOn}</dd>
          </div>
        )}
        <div>
          <dt className="text-slate-400">Reference</dt>
          <dd className="mt-1 font-mono text-white">{String(request.id).slice(-8)}</dd>
        </div>
        {request.reason && (
          <div className="sm:col-span-2">
            <dt className="text-slate-400">Reason</dt>
            <dd className="mt-1 whitespace-pre-wrap break-words text-white">{request.reason}</dd>
          </div>
        )}
      </dl>

      {error && (
        <p role="alert" className="mt-6 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {request.canCancel && (
        <div className="mt-6">
          <button type="button" onClick={handleCancel} disabled={cancelling} className={SECONDARY_BUTTON}>
            {cancelling ? 'Cancelling…' : 'Cancel the request and keep my account'}
          </button>
        </div>
      )}
    </section>
  )
}
