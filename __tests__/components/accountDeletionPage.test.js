/**
 * The account page where a user asks for their own account to be deleted,
 * against the answers its route really gives:
 *
 *   GET    { success, data: { hasActiveRequest, request: { id, status, requestedAt, scheduledDeletionAt, canCancel } } }
 *   POST   { reason }
 *   DELETE ?requestId=…&reason=…
 *
 * The page used to read `data.request` (one level too high) and a card keyed
 * on `_id` and statuses no request has, so a pending request was never shown,
 * and its cancel sent the id in a body the route does not read.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AccountDeletionPage from '@src/app/(styled)/account/delete/AccountDeletionPage'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }))

const URL_REQUEST = '/api/authenticated/account/delete-request'
const USER = { id: '507f1f77bcf86cd799439011', name: 'Ada', email: 'ada@example.invalid' }

const pendingRequest = {
  id: '64b7f0c2a1b2c3d4e5f60001',
  status: 'pending',
  requestType: 'authenticated',
  requestedAt: '2026-11-10T12:00:00.000Z',
  scheduledDeletionAt: '2026-12-10T12:00:00.000Z',
  reason: 'moving away',
  canCancel: true,
}

/** The route: `state.request` is what it holds for the user; calls other than GET are collected. */
function fakeRoute(state) {
  const calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    if (method === 'GET') {
      const request = state.request
      const active = Boolean(request) && ['pending', 'pending_verification'].includes(request.status)
      return { ok: true, status: 200, json: async () => ({ success: true, data: { hasActiveRequest: active, request: request || null } }) }
    }
    calls.push({ method, url, body: options.body ? JSON.parse(options.body) : undefined })
    if (method === 'POST') state.request = { ...pendingRequest, reason: JSON.parse(options.body).reason }
    if (method === 'DELETE') state.request = { ...state.request, status: 'cancelled', canCancel: false }
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
  })
  return calls
}

const click = (element) => act(async () => fireEvent.click(element))

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())

test('a pending request is shown, with when it was made and when the grace period ends', async () => {
  fakeRoute({ request: pendingRequest })
  render(<AccountDeletionPage user={USER} />)

  expect(await screen.findByText('Deletion Scheduled')).toBeInTheDocument()
  expect(screen.getByText('e5f60001')).toBeInTheDocument()
  expect(screen.getByText('moving away')).toBeInTheDocument()
  expect(screen.getByText('Grace Period Active')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel Deletion Request' })).toBeInTheDocument()
  // The form to ask again is not offered while one is open
  expect(screen.queryByLabelText(/I confirm that I want to delete my account/)).not.toBeInTheDocument()
})

test('with no request, or one that was cancelled, the form is offered', async () => {
  fakeRoute({ request: null })
  const { unmount } = render(<AccountDeletionPage user={USER} />)
  expect(await screen.findByLabelText(/I confirm that I want to delete my account/)).toBeInTheDocument()
  unmount()

  fakeRoute({ request: { ...pendingRequest, status: 'cancelled', canCancel: false } })
  render(<AccountDeletionPage user={USER} />)
  expect(await screen.findByLabelText(/I confirm that I want to delete my account/)).toBeInTheDocument()
  expect(screen.queryByText('Request Cancelled')).not.toBeInTheDocument()
})

test('submitting the form posts the reason and then shows the request the server holds', async () => {
  const calls = fakeRoute({ request: null })
  render(<AccountDeletionPage user={USER} />)

  fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: 'moving away' } })
  await click(screen.getByLabelText(/I confirm that I want to delete my account/))
  await click(screen.getByLabelText(/I understand/))
  await click(screen.getByRole('button', { name: 'Submit Deletion Request' }))

  await waitFor(() => expect(calls).toEqual([{ method: 'POST', url: URL_REQUEST, body: { reason: 'moving away' } }]))
  expect(await screen.findByText('Deletion Scheduled')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel Deletion Request' })).toBeInTheDocument()
})

test('cancelling sends the request’s id and the reason in the query string, and the form comes back', async () => {
  const calls = fakeRoute({ request: pendingRequest })
  render(<AccountDeletionPage user={USER} />)

  await click(await screen.findByRole('button', { name: 'Cancel Deletion Request' }))
  fireEvent.change(screen.getByLabelText(/Reason for cancellation/), { target: { value: ' staying after all ' } })
  await click(screen.getByRole('button', { name: 'Cancel Request' }))

  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].method).toBe('DELETE')
  expect(calls[0].body).toBeUndefined()
  const sent = new URL(calls[0].url, 'http://localhost')
  expect(sent.pathname).toBe(URL_REQUEST)
  expect(Object.fromEntries(sent.searchParams)).toEqual({ requestId: pendingRequest.id, reason: 'staying after all' })
  expect(await screen.findByLabelText(/I confirm that I want to delete my account/)).toBeInTheDocument()
  expect(screen.queryByText('Deletion Scheduled')).not.toBeInTheDocument()
})
