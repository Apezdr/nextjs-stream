/**
 * The account page where a user asks for their own account to be deleted,
 * against the answers its route really gives:
 *
 *   GET    { success, data: { hasActiveRequest, request: { id, status, requestType, requestedAt, scheduledDeletionAt, reason, canCancel } } }
 *   POST   { reason }
 *   DELETE ?requestId=…
 *
 * The page used to read `data.request` (one level too high) and a card keyed
 * on `_id` and statuses no request has, so a pending request was never shown.
 *
 * A request made here is carried out by the server on its scheduledDeletionAt
 * (src/lib/scheduledDeletions.ts), and the page names that date. A request
 * with no date (one made on the public form) waits for an admin, and the page
 * names none: a date on this page must be one something acts on.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import AccountDeletionPage from '@src/app/(styled)/account/delete/AccountDeletionPage'

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

/**
 * The route: `state.request` is what it holds for the user; calls other than
 * GET are collected. `state.fail` makes a method answer with that status.
 */
function fakeRoute(state) {
  const calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    const method = options.method || 'GET'
    const failure = state.fail?.[method]
    if (failure) {
      return { ok: false, status: failure.status, json: async () => ({ error: failure.error }) }
    }
    if (method === 'GET') {
      const request = state.request
      const active = Boolean(request) && request.status === 'pending'
      return { ok: true, status: 200, json: async () => ({ success: true, data: { hasActiveRequest: active, request: request || null } }) }
    }
    calls.push({ method, url, body: options.body ? JSON.parse(options.body) : undefined })
    if (method === 'POST') state.request = { ...pendingRequest, reason: JSON.parse(options.body).reason || null }
    if (method === 'DELETE') state.request = { ...state.request, status: 'cancelled', canCancel: false }
    return { ok: true, status: 200, json: async () => ({ success: true, data: {} }) }
  })
  return calls
}

const click = (element) => act(async () => fireEvent.click(element))
const confirmation = () => screen.getByLabelText(/I understand that the account/)
const submit = () => screen.getByRole('button', { name: 'Request deletion' })

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => jest.restoreAllMocks())

test('a waiting request is shown with when it was made and the date the account is deleted', async () => {
  fakeRoute({ request: pendingRequest })
  render(<AccountDeletionPage user={USER} />)

  expect(await screen.findByRole('heading', { name: 'Deletion requested' })).toBeInTheDocument()
  // The date the server acts on, as the route sent it
  expect(screen.getByText(/Your account will be deleted on/)).toHaveTextContent(
    'Your account will be deleted on December 10, 2026, automatically, unless you cancel the request first. An admin may delete it sooner.'
  )
  expect(screen.getByText('Deletion date').nextSibling).toHaveTextContent('December 10, 2026')
  expect(screen.getByText('November 10, 2026')).toBeInTheDocument()
  expect(screen.getByText('e5f60001')).toBeInTheDocument()
  expect(screen.getByText('moving away')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel the request and keep my account' })).toBeInTheDocument()
  expect(screen.queryByText(/There is no set date/)).not.toBeInTheDocument()
  // The form to ask again is not offered while one is open
  expect(screen.queryByRole('button', { name: 'Request deletion' })).not.toBeInTheDocument()
  // Made from the account: no warning that someone else may have asked
  expect(screen.queryByText(/public form/)).not.toBeInTheDocument()
})

test('a request made with the account’s email on the public form says so, names no date, and can be cancelled', async () => {
  // It waits for an admin: nothing carries it out on a date, so none is shown
  const calls = fakeRoute({ request: { ...pendingRequest, requestType: 'public', scheduledDeletionAt: null, reason: null } })
  render(<AccountDeletionPage user={USER} />)

  expect(await screen.findByText(/made with your email address on the public form, not from your account\. If it wasn’t\s+you, cancel it\./)).toBeInTheDocument()
  expect(screen.getByText(/who delete accounts by hand\. There is no set date\./)).toBeInTheDocument()
  expect(screen.queryByText('Deletion date')).not.toBeInTheDocument()
  expect(screen.queryByText(/Your account will be deleted on/)).not.toBeInTheDocument()

  await click(screen.getByRole('button', { name: 'Cancel the request and keep my account' }))

  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].method).toBe('DELETE')
})

test('with no request, or one that was cancelled, the form is offered and says what a deletion does', async () => {
  fakeRoute({ request: null })
  const { unmount } = render(<AccountDeletionPage user={USER} />)

  expect(await screen.findByRole('heading', { name: 'What happens next' })).toBeInTheDocument()
  expect(
    screen.getByText('Your account is deleted automatically 30 days after you ask. This page will show the date. An admin may delete it sooner.')
  ).toBeInTheDocument()
  expect(screen.getByText('Until it is deleted your account works as usual, and you can cancel the request on this page.')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Removed for good' })).toBeInTheDocument()
  expect(screen.getByText('Your watch history and resume positions')).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: 'Kept' })).toBeInTheDocument()
  expect(screen.getByText('A record of this deletion request, with your email address')).toBeInTheDocument()
  expect(screen.getByText(/Signed in as/)).toHaveTextContent('Signed in as Ada (ada@example.invalid)')
  // This page is for a signed-in account: it asks for no email address
  expect(screen.queryByLabelText(/email address/)).not.toBeInTheDocument()
  unmount()

  fakeRoute({ request: { ...pendingRequest, status: 'cancelled', canCancel: false } })
  render(<AccountDeletionPage user={USER} />)
  expect(await screen.findByRole('button', { name: 'Request deletion' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Deletion requested' })).not.toBeInTheDocument()
})

test('nothing is sent until the confirmation is ticked; the reason is optional', async () => {
  const calls = fakeRoute({ request: null })
  render(<AccountDeletionPage user={USER} />)

  await click(await screen.findByRole('button', { name: 'Request deletion' }))

  expect(screen.getByRole('alert')).toHaveTextContent('Tick the box to confirm.')
  expect(calls).toEqual([])

  await click(confirmation())
  await click(submit())

  // No reason typed: the request goes all the same
  await waitFor(() => expect(calls).toEqual([{ method: 'POST', url: URL_REQUEST, body: { reason: '' } }]))
  expect(await screen.findByRole('heading', { name: 'Deletion requested' })).toBeInTheDocument()
})

test('submitting the form posts the reason and then shows the request the server holds', async () => {
  const calls = fakeRoute({ request: null })
  render(<AccountDeletionPage user={USER} />)

  fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: ' moving away ' } })
  await click(confirmation())
  await click(submit())

  await waitFor(() => expect(calls).toEqual([{ method: 'POST', url: URL_REQUEST, body: { reason: 'moving away' } }]))
  expect(await screen.findByRole('heading', { name: 'Deletion requested' })).toBeInTheDocument()
  expect(screen.getByText('moving away')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel the request and keep my account' })).toBeInTheDocument()
})

test('a request the route refuses is said once, beside the button, and the form stays', async () => {
  const state = { request: null }
  fakeRoute(state)
  render(<AccountDeletionPage user={USER} />)
  await screen.findByRole('button', { name: 'Request deletion' })
  state.fail = { POST: { status: 409, error: 'A deletion request is already pending for your account' } }

  await click(confirmation())
  await click(submit())

  const alerts = await screen.findAllByRole('alert')
  expect(alerts).toHaveLength(1)
  expect(alerts[0]).toHaveTextContent('A deletion request is already pending for your account')
  expect(submit()).not.toBeDisabled()
})

test('cancelling sends the request’s id in the query string, says it is cancelled, and the form comes back', async () => {
  const calls = fakeRoute({ request: pendingRequest })
  render(<AccountDeletionPage user={USER} />)

  await click(await screen.findByRole('button', { name: 'Cancel the request and keep my account' }))

  await waitFor(() => expect(calls).toHaveLength(1))
  expect(calls[0].method).toBe('DELETE')
  expect(calls[0].body).toBeUndefined()
  const sent = new URL(calls[0].url, 'http://localhost')
  expect(sent.pathname).toBe(URL_REQUEST)
  expect(Object.fromEntries(sent.searchParams)).toEqual({ requestId: pendingRequest.id })
  expect(await screen.findByRole('status')).toHaveTextContent('The request was cancelled. Your account stays as it is.')
  expect(screen.getByRole('button', { name: 'Request deletion' })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Deletion requested' })).not.toBeInTheDocument()
})

test('a cancel the route refuses is said on the card, and the request stays on screen', async () => {
  const state = { request: pendingRequest }
  fakeRoute(state)
  render(<AccountDeletionPage user={USER} />)
  const cancel = await screen.findByRole('button', { name: 'Cancel the request and keep my account' })
  state.fail = { DELETE: { status: 400, error: 'This deletion request cannot be cancelled' } }

  await click(cancel)

  expect(await screen.findByRole('alert')).toHaveTextContent('This deletion request cannot be cancelled')
  expect(screen.getByRole('heading', { name: 'Deletion requested' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Cancel the request and keep my account' })).not.toBeDisabled()
})

test('when the request cannot be read, neither the form nor a request is shown, and it can be tried again', async () => {
  const state = { request: pendingRequest, fail: { GET: { status: 500, error: 'Failed to get deletion request status' } } }
  fakeRoute(state)
  render(<AccountDeletionPage user={USER} />)

  expect(await screen.findByRole('alert')).toHaveTextContent('This page couldn’t load')
  expect(screen.queryByRole('button', { name: 'Request deletion' })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: 'Deletion requested' })).not.toBeInTheDocument()

  state.fail = null
  await click(screen.getByRole('button', { name: 'Try again' }))

  expect(await screen.findByRole('heading', { name: 'Deletion requested' })).toBeInTheDocument()
})

test('the pages’ colours do not follow the device’s theme: the app is dark either way', async () => {
  // A `dark:` variant applies only on a device set to dark (Tailwind's
  // default). The old page was written with them, and on a device set to
  // light its title was dark grey on the dark page.
  fakeRoute({ request: null })
  const { container, unmount } = render(<AccountDeletionPage user={USER} />)
  await screen.findByRole('button', { name: 'Request deletion' })
  expect(container.innerHTML).not.toMatch(/dark:/)
  expect(screen.getByRole('heading', { level: 1, name: 'Delete your account' })).toHaveClass('text-white')
  unmount()

  fakeRoute({ request: pendingRequest })
  const second = render(<AccountDeletionPage user={USER} />)
  await screen.findByRole('heading', { name: 'Deletion requested' })
  expect(second.container.innerHTML).not.toMatch(/dark:/)
})
