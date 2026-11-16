'use client'

import { useEffect, useReducer } from 'react'
import DeletionPageShell, { CARD, SECONDARY_BUTTON } from '@components/DeletionRequest/DeletionPageShell'
import DeletionRequestForm from '@components/DeletionRequest/DeletionRequestForm'
import DeletionStatusCard from '@components/DeletionRequest/DeletionStatusCard'

const DELETE_REQUEST_URL = '/api/authenticated/account/delete-request'

// What happens to a request made here (the form numbers them)
const STEPS = [
  'Your request goes to the admins. Nothing is deleted yet.',
  'An admin deletes the account by hand. There is no set date, and nothing runs on a timer.',
  'Until then your account works as usual, and you can cancel the request on this page.',
]

// What the page knows about the user's request, and what it last did:
//   status  'loading' | 'ready' | 'failed' (the request could not be read)
//   request the open request, or null: the form is offered
//   notice  what just happened, said once ('cancelled')
const initialState = { status: 'loading', request: null, submitting: false, notice: null }

function reducer(state, action) {
  switch (action.type) {
    case 'loading':
      return { ...state, status: 'loading' }
    case 'loaded':
      // What the server holds now: none, once a request is cancelled
      return { ...state, status: 'ready', request: action.request ?? null, submitting: false, notice: action.notice ?? null }
    case 'failed':
      return { ...state, status: 'failed', submitting: false }
    case 'submitting':
      return { ...state, submitting: action.value, notice: null }
    default:
      return state
  }
}

/**
 * The signed-in user's deletion request that is still open, or null. The route
 * answers { success, data: { hasActiveRequest, request } } with their newest
 * request whatever its status: one that was cancelled is no reason to hide
 * the form. Throws when the route can't be read: the page then offers neither
 * the form nor a request it only guessed at.
 */
async function loadOpenRequest() {
  const response = await fetch(DELETE_REQUEST_URL)
  if (!response.ok) {
    throw new Error(`The deletion request could not be read (${response.status})`)
  }
  const { data } = await response.json()
  return data?.hasActiveRequest ? data.request : null
}

/** The route's own error text, or the fallback when it sent none. */
async function errorFrom(response, fallback) {
  const body = await response.json().catch(() => null)
  return new Error(body?.error || fallback)
}

function LoadingCard() {
  return (
    <div className={CARD} role="status" aria-label="Loading your deletion request">
      <div className="animate-pulse space-y-4">
        <div className="h-5 w-48 rounded bg-white/10" />
        <div className="h-4 w-full rounded bg-white/10" />
        <div className="h-4 w-5/6 rounded bg-white/10" />
        <div className="h-4 w-2/3 rounded bg-white/10" />
      </div>
    </div>
  )
}

export default function AccountDeletionPage({ user }) {
  const [{ status, request, submitting, notice }, dispatch] = useReducer(reducer, initialState)

  useEffect(() => {
    let current = true
    loadOpenRequest()
      .then((loaded) => current && dispatch({ type: 'loaded', request: loaded }))
      .catch(() => current && dispatch({ type: 'failed' }))
    return () => {
      current = false
    }
  }, [])

  const reload = async (after = null) => {
    try {
      dispatch({ type: 'loaded', request: await loadOpenRequest(), notice: after })
    } catch {
      dispatch({ type: 'failed' })
    }
  }

  const handleRetry = () => {
    dispatch({ type: 'loading' })
    reload()
  }

  const handleSubmitRequest = async ({ reason }) => {
    dispatch({ type: 'submitting', value: true })
    const response = await fetch(DELETE_REQUEST_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    if (!response.ok) {
      dispatch({ type: 'submitting', value: false })
      // The form shows it
      throw await errorFrom(response, 'The request could not be sent. Try again.')
    }
    // Read it back as the card shows it
    await reload()
  }

  const handleCancelRequest = async (requestId) => {
    // The route reads the id from the query string
    const query = new URLSearchParams({ requestId })
    const response = await fetch(`${DELETE_REQUEST_URL}?${query}`, { method: 'DELETE' })
    if (!response.ok) {
      // The card shows it
      throw await errorFrom(response, 'The request could not be cancelled. Try again.')
    }
    await reload('cancelled')
  }

  return (
    <DeletionPageShell
      backHref="/list"
      backLabel="Back to library"
      title="Delete your account"
      lead={
        <>
          <p>Ask for your account, and what is stored with it, to be removed for good.</p>
          <p className="mt-3 text-sm text-slate-400">
            Signed in as <span className="font-medium text-slate-200">{user.name || user.email}</span>
            {user.name && user.email && <span className="break-all"> ({user.email})</span>}
          </p>
        </>
      }
    >
      {notice === 'cancelled' && (
        <p role="status" className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
          The request was cancelled. Your account stays as it is.
        </p>
      )}

      {status === 'loading' && <LoadingCard />}

      {status === 'failed' && (
        <div className={CARD} role="alert">
          <h2 className="text-lg font-semibold text-white">This page couldn’t load</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
            Whether you already have a deletion request could not be checked, so nothing can be sent from here yet.
          </p>
          <button type="button" onClick={handleRetry} className={`mt-5 ${SECONDARY_BUTTON}`}>
            Try again
          </button>
        </div>
      )}

      {status === 'ready' && request && <DeletionStatusCard request={request} onCancel={handleCancelRequest} />}

      {status === 'ready' && !request && (
        <DeletionRequestForm onSubmit={handleSubmitRequest} isLoading={submitting} steps={STEPS} />
      )}
    </DeletionPageShell>
  )
}
