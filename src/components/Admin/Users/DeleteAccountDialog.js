'use client'

import { useId, useState } from 'react'
import Link from 'next/link'
import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react'
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { confirmsDeletion, deletionConfirmationFor } from '@src/utils/deletionConfirmation'

const DELETE_ACCOUNT_URL = '/api/authenticated/admin/delete-account'

const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300'

// What the admin is asked to type, by what the account can be confirmed with
// (src/utils/deletionConfirmation.js): its email, or, for an account that has
// none, its name, or failing that its id. `record` is how the deletion's
// record will name the account.
const CONFIRM_WITH = {
  email: { ask: 'Type the account’s email to confirm', record: 'email' },
  name: { ask: 'This account has no email address. Type its name to confirm', record: 'name' },
  id: { ask: 'This account has no email address and no name. Type its id to confirm', record: 'id' },
}

/**
 * The dialog's body. The parent keys it by the user's id, so opening the
 * dialog for another account starts with an empty confirmation.
 */
function DialogBody({ user, onClose, onDeleted, pending, setPending }) {
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState('')
  // { message, checkRequests }: checkRequests when the deletion began, or may
  // have: the Deletion Requests page is then where to see what happened
  const [failure, setFailure] = useState(null)
  const confirmInputId = useId()
  const confirmHintId = useId()
  const reasonInputId = useId()

  // In messages: the account by its name or email, or as "this account"
  const label = user.name || user.email || ''
  const whose = label ? `${label}’s account` : 'this account'
  const confirmation = deletionConfirmationFor(user)
  const confirmWith = CONFIRM_WITH[confirmation.kind]
  const confirmed = confirmsDeletion(typed, user)

  /**
   * Read the list again. Whether that worked is a separate matter from
   * whether the account was deleted: a refresh that fails must never be
   * reported as a deletion that failed (it once was: "Nothing was deleted",
   * said of an account that was gone).
   */
  const refreshList = async () => {
    try {
      await onDeleted?.()
      return true
    } catch {
      return false
    }
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!confirmed || pending) return
    setPending(true)
    setFailure(null)

    let response
    let body
    try {
      response = await fetch(DELETE_ACCOUNT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, confirmation: typed.trim(), reason: reason.trim() || null }),
      })
      body = await response.json().catch(() => null)
    } catch {
      // No answer at all. The request may never have left, or the deletion
      // may have run and its answer been lost on the way back: this page
      // cannot tell which, so it says where to look
      const message = 'No answer came back from the server, so it isn’t known whether the account was deleted.'
      setFailure({ message, checkRequests: true })
      toast.error(`Deleting ${whose}: ${message}`)
      await refreshList()
      setPending(false)
      return
    }

    if (response.ok && body?.success) {
      toast.success(label ? `Deleted ${whose}.` : 'Deleted the account.')
      if (!(await refreshList())) {
        toast.error('The account was deleted, but the list could not be read again. Reload the page to see it without that account.')
      }
      setPending(false)
      onClose()
      return
    }

    const message = body?.message || `Couldn’t delete the account (${response.status}).`
    // A deletion that began has changed the account
    const began = body?.error === 'DELETION_INCOMPLETE'
    setFailure({ message, checkRequests: began })
    toast.error(`Couldn’t delete ${whose}: ${message}`)
    if (began) await refreshList()
    setPending(false)
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="flex items-start gap-3">
        <span className="shrink-0 rounded-xl bg-rose-500/15 p-2 text-rose-300">
          <ExclamationTriangleIcon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <DialogTitle className="text-lg font-semibold text-white">Delete {whose}?</DialogTitle>
          <Description className="mt-1 text-sm text-rose-200">
            This can’t be undone. The account and its data are removed now.
          </Description>
        </div>
      </div>

      <div className="mt-5 space-y-4 text-sm text-slate-300">
        <div>
          <p className="font-medium text-white">Removed</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>The account and its sign-in: its links to sign-in providers, and every browser and device signed in with it</li>
            <li>Its watch history and resume positions</li>
            <li>Its notifications</li>
            <li>Its private lists and its home-screen rows</li>
          </ul>
        </div>
        <div>
          <p className="font-medium text-white">Kept</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            <li>Lists it shared with other people, which stay without an owner, and titles it added to other people’s lists</li>
            <li>Its Radarr and Sonarr requests, in the activity log</li>
            <li>
              A record of this deletion under Deletion Requests, with the account’s {confirmWith.record} and your name
            </li>
          </ul>
        </div>
        <p className="text-slate-400">
          No email is sent. The same person can sign in again later, which makes a new, empty account.
        </p>
      </div>

      <div className="mt-5">
        <label htmlFor={confirmInputId} className="block text-sm font-medium text-white">
          {confirmWith.ask}
        </label>
        <p id={confirmHintId} className="mt-1 break-all font-mono text-xs text-slate-400">
          {confirmation.value}
        </p>
        <input
          id={confirmInputId}
          type={confirmation.kind === 'email' ? 'email' : 'text'}
          name="confirmation"
          autoFocus
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          disabled={pending}
          aria-describedby={confirmHintId}
          className="mt-2 block w-full rounded-xl border-0 bg-slate-950/60 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/15 placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-rose-400 disabled:opacity-60"
        />
      </div>

      <div className="mt-4">
        <label htmlFor={reasonInputId} className="block text-sm font-medium text-white">
          Reason <span className="font-normal text-slate-400">(optional, kept with the record)</span>
        </label>
        <input
          id={reasonInputId}
          type="text"
          name="reason"
          autoComplete="off"
          maxLength={500}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          disabled={pending}
          className="mt-2 block w-full rounded-xl border-0 bg-slate-950/60 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/15 placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-rose-400 disabled:opacity-60"
        />
      </div>

      {failure && (
        <p role="alert" className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">
          {failure.message}
          {failure.checkRequests && (
            <>
              {' '}
              <Link href="/admin/deletion-requests" className="font-semibold underline underline-offset-2">
                Open Deletion Requests
              </Link>
            </>
          )}
        </p>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className={`rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!confirmed || pending}
          className={`rounded-xl border border-rose-500/40 bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-40 ${FOCUS_RING}`}
        >
          {pending ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </form>
  )
}

/**
 * The Users page's "Delete account": an admin deletes an account that did not
 * ask to be deleted. It says what goes and what stays, and the button stays
 * off until the account's confirmation has been typed: its email, or, for an
 * account that has none (an old sign-in whose provider gave no address), its
 * name, or failing that its id. Focus is trapped and Escape closes (Headless
 * UI Dialog), except while the request is on its way.
 *
 * The route checks everything again (delete-account/route.ts): this dialog
 * only makes the mistake hard to make.
 *
 * @param {{ user: { id: string, name?: string, email?: string }|null, onClose: () => void, onDeleted?: (() => unknown)|null }} props
 *   `user` null keeps the dialog closed. `onDeleted` runs after a deletion, and after one that began and stopped: the list has changed either way.
 */
export default function DeleteAccountDialog({ user, onClose, onDeleted = null }) {
  // Held here, not in the body: while the request is on its way the dialog
  // itself must not close (Escape, a click outside), or the answer would
  // arrive with nothing to show it
  const [pending, setPending] = useState(false)

  if (!user) return null

  return (
    <Dialog open onClose={() => (pending ? undefined : onClose())} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <DialogPanel className="w-full max-w-lg rounded-2xl bg-slate-900 p-6 shadow-2xl ring-1 ring-white/10">
            <DialogBody
              key={user.id}
              user={user}
              onClose={onClose}
              onDeleted={onDeleted}
              pending={pending}
              setPending={setPending}
            />
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  )
}
