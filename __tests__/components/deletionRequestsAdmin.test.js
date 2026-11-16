/**
 * The admin Deletion Requests page against the answers its route really gives
 * ({ success, data: { requests, ... } }, the statuses the deletion writes).
 *
 * The page used to read `data.requests`, one level too high, and always showed
 * "No deletion requests found"; its buttons were keyed on statuses no request
 * ever has. fetch is the only boundary.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import DeletionRequestsAdmin from '@src/components/Admin/DeletionRequests/DeletionRequestsAdmin'

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
const { toast } = require('react-toastify')

const URL_REQUESTS = '/api/authenticated/admin/deletion-requests'

const userRequest = {
  _id: 'r-user',
  userId: 'u1',
  email: 'ada@example.invalid',
  requestType: 'authenticated',
  status: 'pending',
  reason: 'moving away',
  requestedAt: '2026-11-10T12:00:00.000Z',
  scheduledDeletionAt: '2026-12-10T12:00:00.000Z',
  canCancel: true,
  canExecute: true,
  gracePeriodOver: false,
}
const adminDeletion = {
  _id: 'r-admin',
  userId: 'u2',
  email: 'grace@example.invalid',
  requestType: 'admin',
  status: 'completed',
  reason: 'left the household',
  requestedAt: '2026-11-15T09:00:00.000Z',
  scheduledDeletionAt: '2026-11-15T09:00:00.000Z',
  startedAt: '2026-11-15T09:00:00.000Z',
  completedAt: '2026-11-15T09:00:01.000Z',
  deletionResults: { session: 2, WatchHistory: 41, Notifications: 0, user: 1, keptSharedPlaylists: ['p1'] },
  canCancel: false,
  canExecute: false,
  gracePeriodOver: true,
}
const stoppedDeletion = {
  _id: 'r-stopped',
  userId: 'u3',
  email: 'linus@example.invalid',
  requestType: 'admin',
  status: 'processing',
  requestedAt: '2026-11-16T08:00:00.000Z',
  scheduledDeletionAt: '2026-11-16T08:00:00.000Z',
  startedAt: '2026-11-16T08:00:00.000Z',
  lastError: { step: 'lists', message: 'connection reset', at: '2026-11-16T08:00:01.000Z' },
  progress: { signOut: '2026-11-16T08:00:00.500Z', activity: '2026-11-16T08:00:00.800Z' },
  deletionResults: { session: 1, WatchHistory: 7 },
  canCancel: false,
  canExecute: true,
  gracePeriodOver: true,
}

const auditOf = {
  'r-admin': [
    { id: 'a1', action: 'admin_request_created', performedAt: '2026-11-15T09:00:00.000Z', performedBy: { id: 'adm', name: 'Root', email: 'root@example.invalid' }, details: {} },
    { id: 'a2', action: 'deletion_started', performedAt: '2026-11-15T09:00:00.100Z', performedBy: { id: 'adm', name: 'Root', email: 'root@example.invalid' }, details: {} },
    { id: 'a3', action: 'deletion_completed', performedAt: '2026-11-15T09:00:01.000Z', performedBy: { id: 'adm', name: 'Root', email: 'root@example.invalid' }, details: {} },
  ],
  'r-stopped': [
    { id: 'b1', action: 'deletion_failed', performedAt: '2026-11-16T08:00:01.000Z', performedBy: { id: 'adm', name: 'Root', email: 'root@example.invalid' }, details: { step: 'lists', error: 'connection reset' } },
  ],
}

/** The route, as far as the page uses it. `posts` collects what the page sent; `answers` overrides an action's answer. */
function fakeRoute(requests, answers = {}) {
  const posts = []
  global.fetch = jest.fn(async (url, options = {}) => {
    if (!options.method || options.method === 'GET') {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { requests, pagination: { total: requests.length }, filters: {} } }) }
    }
    const body = JSON.parse(options.body)
    posts.push(body)
    if (body.action === 'get-audit-logs') {
      return { ok: true, status: 200, json: async () => ({ success: true, data: { requestId: body.requestId, auditLogs: auditOf[body.requestId] || [] } }) }
    }
    const [status, answer] = answers[body.action] || [200, { success: true }]
    return { ok: status < 400, status, json: async () => answer }
  })
  return posts
}

const click = (element) => act(async () => fireEvent.click(element))
const rowOf = (email) => screen.getByText(email).closest('li')
const openDetails = async (email) => {
  await click(within(rowOf(email)).getByRole('button', { name: /Details/ }))
  return rowOf(email)
}
const actions = (posts) => posts.filter((post) => post.action !== 'get-audit-logs')

beforeEach(() => jest.clearAllMocks())

test('lists the requests the route sends, each with who asked and where it stands', async () => {
  fakeRoute([stoppedDeletion, adminDeletion, userRequest])
  render(<DeletionRequestsAdmin />)

  expect(await screen.findByText('ada@example.invalid')).toBeInTheDocument()
  expect(global.fetch).toHaveBeenCalledWith(`${URL_REQUESTS}?limit=100`)
  expect(screen.queryByText('No deletion requests found.')).not.toBeInTheDocument()

  expect(within(rowOf('ada@example.invalid')).getByText('Pending')).toBeInTheDocument()
  expect(within(rowOf('ada@example.invalid')).getByText('Requested by the user')).toBeInTheDocument()
  expect(within(rowOf('grace@example.invalid')).getByText('Completed')).toBeInTheDocument()
  expect(within(rowOf('grace@example.invalid')).getByText('Deleted by an admin')).toBeInTheDocument()
  expect(within(rowOf('linus@example.invalid')).getByText('Started, not finished')).toBeInTheDocument()

  // The tabs count the statuses requests really have
  expect(screen.getByRole('button', { name: 'All (3)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Pending (1)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Started, not finished (1)' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Completed (1)' })).toBeInTheDocument()
})

test('an admin’s deletion shows what was removed and an audit log that names the admin', async () => {
  const posts = fakeRoute([adminDeletion])
  render(<DeletionRequestsAdmin />)
  await screen.findByText('grace@example.invalid')

  const row = await openDetails('grace@example.invalid')

  expect(within(row).getByText(/session: 2 · WatchHistory: 41 · user: 1/)).toBeInTheDocument()
  expect(within(row).getByText(/1 list shared with/)).toBeInTheDocument()
  expect(within(row).getByText('left the household')).toBeInTheDocument()
  expect(await within(row).findByText('Started by an admin')).toBeInTheDocument()
  expect(within(row).getAllByText(/by Root/)).toHaveLength(3)
  expect(posts).toContainEqual({ action: 'get-audit-logs', requestId: 'r-admin' })
  // Finished: nothing to run or cancel
  expect(within(row).queryByRole('button', { name: /Run again|Delete this account now|Cancel Request/ })).not.toBeInTheDocument()
  expect(within(row).getByText('Nothing more to do.')).toBeInTheDocument()
})

test('a deletion that stopped says where, and "Run again" executes the same request', async () => {
  const posts = fakeRoute([stoppedDeletion])
  render(<DeletionRequestsAdmin />)
  await screen.findByText('linus@example.invalid')

  const row = await openDetails('linus@example.invalid')

  const alert = within(row).getByRole('alert')
  expect(alert).toHaveTextContent('This deletion started and stopped while removing its lists.')
  expect(alert).toHaveTextContent('connection reset')
  expect(within(row).getByText(/session: 1 · WatchHistory: 7/)).toBeInTheDocument()
  expect(within(row).queryByRole('button', { name: 'Cancel Request' })).not.toBeInTheDocument()

  await click(within(row).getByRole('button', { name: 'Run again' }))
  // Nothing is sent until it is confirmed
  expect(actions(posts)).toEqual([])
  await click(within(rowOf('linus@example.invalid')).getByRole('button', { name: 'Confirm Deletion' }))

  expect(actions(posts)).toEqual([{ action: 'execute', requestId: 'r-stopped', reason: null }])
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The account was deleted.'))
  // ...and the list is read again
  await waitFor(() => expect(global.fetch.mock.calls.filter(([, options]) => !options).length).toBe(2))
})

test('a user’s request within its grace period can be executed, and the page says what that ends', async () => {
  const posts = fakeRoute([userRequest])
  render(<DeletionRequestsAdmin />)
  await screen.findByText('ada@example.invalid')
  const row = await openDetails('ada@example.invalid')

  await click(within(row).getByRole('button', { name: 'Delete this account now' }))

  expect(within(rowOf('ada@example.invalid')).getByText(/It can’t be undone\..*to change their mind: deleting now ends that early\./)).toBeInTheDocument()
  expect(actions(posts)).toEqual([])
})

test('cancelling a request sends its id and the reason typed', async () => {
  const posts = fakeRoute([userRequest])
  render(<DeletionRequestsAdmin />)
  await screen.findByText('ada@example.invalid')
  const row = await openDetails('ada@example.invalid')

  await click(within(row).getByRole('button', { name: 'Cancel Request' }))
  fireEvent.change(within(rowOf('ada@example.invalid')).getByLabelText('Reason for cancelling (optional)'), { target: { value: 'asked to stay' } })
  await click(within(rowOf('ada@example.invalid')).getByRole('button', { name: 'Confirm Cancellation' }))

  expect(actions(posts)).toEqual([{ action: 'cancel', requestId: 'r-user', reason: 'asked to stay' }])
  await waitFor(() => expect(toast.success).toHaveBeenCalledWith('The request was cancelled.'))
})

test('a refusal from the route is shown as it was given, and the list stays', async () => {
  fakeRoute([stoppedDeletion], {
    execute: [500, { error: 'The deletion started but did not finish. Run the request again to complete it.', code: 'DELETION_INCOMPLETE' }],
  })
  render(<DeletionRequestsAdmin />)
  await screen.findByText('linus@example.invalid')
  const row = await openDetails('linus@example.invalid')

  await click(within(row).getByRole('button', { name: 'Run again' }))
  await click(within(rowOf('linus@example.invalid')).getByRole('button', { name: 'Confirm Deletion' }))

  await waitFor(() =>
    expect(toast.error).toHaveBeenCalledWith('The deletion started but did not finish. Run the request again to complete it.')
  )
  expect(toast.success).not.toHaveBeenCalled()
  expect(screen.getByText('linus@example.invalid')).toBeInTheDocument()
})

test('no requests at all says so', async () => {
  fakeRoute([])
  render(<DeletionRequestsAdmin />)

  expect(await screen.findByText('No deletion requests found.')).toBeInTheDocument()
})

test('a list that cannot be loaded offers to try again', async () => {
  global.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'Failed to get deletion requests' }) }))
  render(<DeletionRequestsAdmin />)

  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to fetch deletion requests')

  fakeRoute([userRequest])
  await click(screen.getByRole('button', { name: 'Try again' }))

  expect(await screen.findByText('ada@example.invalid')).toBeInTheDocument()
})
