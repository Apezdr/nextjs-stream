'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircleIcon } from '@heroicons/react/24/outline'
import DeletionPageShell, { CARD, TEXT_LINK } from '@components/DeletionRequest/DeletionPageShell'
import DeletionRequestForm from '@components/DeletionRequest/DeletionRequestForm'

// What happens to a request made here (the form numbers them). The page sends
// no email and cannot tell whose address was typed: it must not say otherwise.
const STEPS = [
  'The request goes to the admins. Nothing is deleted automatically, and there is no set date.',
  'This form can’t confirm that the address is yours, and no email is sent. An admin checks the request before deleting anything.',
  'If the address has an account here, that account is told in the app, and whoever is signed in to it can cancel the request.',
]

/**
 * The public form: ask for an account to be deleted by its email address,
 * without signing in (POST /api/public/delete-request). The answer is the
 * same whether or not the address has an account, and so is this page's.
 */
export default function PublicDeleteAccountPage() {
  const [submitting, setSubmitting] = useState(false)
  const [submittedEmail, setSubmittedEmail] = useState(null)

  const handleSubmitRequest = async ({ email, reason }) => {
    setSubmitting(true)
    try {
      const response = await fetch('/api/public/delete-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, reason }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        // The form shows it
        throw new Error(body?.error || 'The request could not be sent. Try again.')
      }
      setSubmittedEmail(email)
    } finally {
      setSubmitting(false)
    }
  }

  if (submittedEmail) {
    return (
      <DeletionPageShell backHref="/" backLabel="Back to home" title="Request received">
        <section className={CARD} role="status">
          <div className="flex items-start gap-4">
            <span className="shrink-0 rounded-xl bg-emerald-400/15 p-2.5 text-emerald-300">
              <CheckCircleIcon className="h-6 w-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 space-y-3 text-sm leading-relaxed text-slate-300">
              <p className="text-base text-white">
                If an account uses <span className="break-all font-medium">{submittedEmail}</span>, its deletion
                request is now with the admins.
              </p>
              <p>
                No email is sent, and this page can’t say whether that address has an account: that would tell
                anyone who asks.
              </p>
              <p>
                An admin checks the request and deletes the account by hand; there is no set date. If you can
                still sign in, the request shows on{' '}
                <Link href="/account/delete" className={TEXT_LINK}>
                  your account’s deletion page
                </Link>
                , where you can cancel it.
              </p>
            </div>
          </div>
        </section>
        <p className="text-sm">
          <Link href="/privacy" className={TEXT_LINK}>
            Privacy policy
          </Link>
        </p>
      </DeletionPageShell>
    )
  }

  return (
    <DeletionPageShell
      backHref="/"
      backLabel="Back to home"
      title="Request account deletion"
      lead={
        <>
          <p>Ask for an account, and what is stored with it, to be removed for good, without signing in.</p>
          <p className="mt-3 text-sm text-slate-400">
            Can you still sign in?{' '}
            <Link href="/account/delete" className={TEXT_LINK}>
              Delete your account from inside the app
            </Link>{' '}
            instead: the request is tied to you, and you can see it and cancel it.
          </p>
        </>
      }
    >
      <DeletionRequestForm onSubmit={handleSubmitRequest} isLoading={submitting} showEmailField steps={STEPS} />
    </DeletionPageShell>
  )
}
