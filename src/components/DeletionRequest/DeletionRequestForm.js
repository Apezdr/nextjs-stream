'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { MinusIcon, XMarkIcon } from '@heroicons/react/20/solid'
import { CARD, FIELD, FOCUS_RING, TEXT_LINK } from './DeletionPageShell'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** What the routes accept (500 characters). */
const MAX_REASON_LENGTH = 500

// What a deletion removes and what it leaves, as src/utils/accountDeletion.js
// does it (DELETION_STEPS). Change the two together.
const REMOVED = [
  'The account and its sign-in: the link to your Google or Discord account, and every browser, TV and phone signed in with it',
  'Your watch history and resume positions',
  'Your notifications',
  'Your private lists and your home-screen rows',
]

const KEPT = [
  'Lists you shared with other people, which stay without an owner, and titles you added to other people’s lists',
  'Requests you made for new titles, in the admins’ activity log',
  'A record of this deletion request, with your email address',
]

function Outcome({ heading, items, icon: Icon, iconClass }) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-white">{heading}</h3>
      <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-slate-300">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5">
            <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function FieldError({ id, children }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-2 text-sm text-rose-300">
      {children}
    </p>
  )
}

/**
 * The form both deletion pages use: what happens next, what a deletion
 * removes and keeps, an optional reason, and one confirmation. The public
 * page also asks for the account's email address (`showEmailField`).
 *
 * `onSubmit({ email, reason })` throws when the request fails; its message is
 * shown above the button.
 *
 * @param {{ onSubmit: (data: { email: string, reason: string }) => Promise<unknown>, isLoading?: boolean, showEmailField?: boolean, steps: string[] }} props
 *   `steps`: what happens after the request is sent, in order, each one a different sentence.
 */
export default function DeletionRequestForm({ onSubmit, isLoading = false, showEmailField = false, steps }) {
  const [email, setEmail] = useState('')
  const [reason, setReason] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [errors, setErrors] = useState({})
  const emailId = useId()
  const emailErrorId = useId()
  const reasonId = useId()
  const nextHeadingId = useId()
  const doesHeadingId = useId()
  const understoodId = useId()
  const understoodErrorId = useId()

  const clearError = (name) => setErrors((current) => (current[name] ? { ...current, [name]: null } : current))

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (isLoading) return

    const found = {}
    if (showEmailField && !email.trim()) found.email = 'Enter the account’s email address.'
    else if (showEmailField && !EMAIL.test(email.trim())) found.email = 'That doesn’t look like an email address.'
    if (!understood) found.understood = 'Tick the box to confirm.'
    setErrors(found)
    if (Object.keys(found).length > 0) return

    try {
      await onSubmit({ email: email.trim(), reason: reason.trim() })
    } catch (error) {
      setErrors({ submit: error?.message || 'The request could not be sent. Try again.' })
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={CARD}>
      <section aria-labelledby={nextHeadingId}>
        <h2 id={nextHeadingId} className="text-lg font-semibold text-white">
          What happens next
        </h2>
        <ol className="mt-4 space-y-3 text-sm leading-relaxed text-slate-300">
          {steps.map((step, index) => (
            <li key={step} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-semibold text-white"
              >
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby={doesHeadingId} className="mt-8 border-t border-white/10 pt-8">
        <h2 id={doesHeadingId} className="text-lg font-semibold text-white">
          What deleting the account does
        </h2>
        <div className="mt-4 grid gap-6 sm:grid-cols-2">
          <Outcome heading="Removed for good" items={REMOVED} icon={XMarkIcon} iconClass="text-rose-300" />
          <Outcome heading="Kept" items={KEPT} icon={MinusIcon} iconClass="text-slate-400" />
        </div>
        <p className="mt-5 text-sm leading-relaxed text-slate-400">
          It can’t be undone. Signing in again later with the same Google or Discord account starts a new, empty
          account.
        </p>
      </section>

      <div className="mt-8 space-y-6 border-t border-white/10 pt-8">
        {showEmailField && (
          <div>
            <label htmlFor={emailId} className="block text-sm font-medium text-white">
              The account’s email address
            </label>
            <input
              id={emailId}
              type="email"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value)
                clearError('email')
              }}
              disabled={isLoading}
              aria-invalid={errors.email ? 'true' : undefined}
              aria-describedby={errors.email ? emailErrorId : undefined}
              className={`mt-2 ${FIELD}`}
            />
            <FieldError id={emailErrorId}>{errors.email}</FieldError>
          </div>
        )}

        <div>
          <label htmlFor={reasonId} className="block text-sm font-medium text-white">
            Reason <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <textarea
            id={reasonId}
            name="reason"
            rows={3}
            maxLength={MAX_REASON_LENGTH}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            disabled={isLoading}
            className={`mt-2 ${FIELD}`}
          />
        </div>

        <div>
          <div className="flex items-start gap-3">
            <input
              id={understoodId}
              name="understood"
              type="checkbox"
              checked={understood}
              onChange={(event) => {
                setUnderstood(event.target.checked)
                clearError('understood')
              }}
              disabled={isLoading}
              aria-invalid={errors.understood ? 'true' : undefined}
              aria-describedby={errors.understood ? understoodErrorId : undefined}
              className="mt-0.5 h-4 w-4 rounded border-white/30 bg-slate-950/60 text-rose-500 focus:ring-2 focus:ring-rose-400 focus:ring-offset-2 focus:ring-offset-slate-900"
            />
            <label htmlFor={understoodId} className="text-sm leading-relaxed text-slate-200">
              I understand that the account and the data listed above will be removed for good, and that this
              can’t be undone.
            </label>
          </div>
          <FieldError id={understoodErrorId}>{errors.understood}</FieldError>
        </div>

        {errors.submit && (
          <p role="alert" className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {errors.submit}
          </p>
        )}

        <div className="flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/privacy" className={`text-sm ${TEXT_LINK}`}>
            Privacy policy
          </Link>
          <button
            type="submit"
            disabled={isLoading}
            className={`inline-flex items-center justify-center rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
          >
            {isLoading ? 'Sending…' : 'Request deletion'}
          </button>
        </div>
      </div>
    </form>
  )
}
