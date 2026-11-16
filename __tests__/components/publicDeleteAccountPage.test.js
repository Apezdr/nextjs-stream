/**
 * /privacy/delete-account: the public form that asks for an account to be
 * deleted by its email address, for someone who cannot sign in.
 *
 * The app sends no email and cannot tell whose address was typed, and its
 * route answers the same whether or not the address has an account
 * (__tests__/app/publicDeleteRequestRoute.test.js). The page must not say
 * otherwise: it used to tell people to check their inbox for a link that was
 * never sent, and to wait out a 30-day grace period that nothing ran.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import PublicDeleteAccountPage from '@src/app/(styled)/privacy/delete-account/page'

const URL_REQUEST = '/api/public/delete-request'
const RECEIVED = { success: true, message: 'If an account uses that email address, its deletion request is now with the admins. No email is sent.' }

function fakeRoute(answer = { status: 200, body: RECEIVED }) {
  const calls = []
  global.fetch = jest.fn(async (url, options = {}) => {
    calls.push({ method: options.method, url, body: JSON.parse(options.body) })
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body }
  })
  return calls
}

const click = (element) => act(async () => fireEvent.click(element))
const fillEmail = (value) => fireEvent.change(screen.getByLabelText('The account’s email address'), { target: { value } })
const tick = () => click(screen.getByLabelText(/I understand that the account/))
const submit = () => click(screen.getByRole('button', { name: 'Request deletion' }))

const FALSE_PROMISES = /check your (email|inbox)|verification (link|email)|we(’|')ve sent|grace period|days remaining|scheduled/i

afterEach(() => jest.restoreAllMocks())

test('the form says what really happens: an admin checks the request, and no email is sent', () => {
  fakeRoute()
  const { container } = render(<PublicDeleteAccountPage />)

  expect(screen.getByRole('heading', { level: 1, name: 'Request account deletion' })).toHaveClass('text-white')
  expect(screen.getByText(/This form can’t confirm that the address is yours, and no email is sent\./)).toBeInTheDocument()
  expect(screen.getByText(/Nothing is deleted automatically, and there is no set date\./)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Delete your account from inside the app' })).toHaveAttribute('href', '/account/delete')
  expect(document.body).not.toHaveTextContent(FALSE_PROMISES)
  expect(container.innerHTML).not.toMatch(/dark:/)
})

test('an address is required, and must look like one; nothing is sent until the box is ticked', async () => {
  const calls = fakeRoute()
  render(<PublicDeleteAccountPage />)

  await submit()
  expect(screen.getByText('Enter the account’s email address.')).toBeInTheDocument()
  expect(screen.getByText('Tick the box to confirm.')).toBeInTheDocument()

  fillEmail('not-an-address')
  await tick()
  await submit()
  expect(screen.getByText('That doesn’t look like an email address.')).toBeInTheDocument()

  expect(calls).toEqual([])
})

test('a request is posted with the address and the reason, and the answer promises only what is true', async () => {
  const calls = fakeRoute()
  render(<PublicDeleteAccountPage />)

  fillEmail(' ada@example.invalid ')
  fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'locked out' } })
  await tick()
  await submit()

  await waitFor(() =>
    expect(calls).toEqual([{ method: 'POST', url: URL_REQUEST, body: { email: 'ada@example.invalid', reason: 'locked out' } }])
  )
  expect(await screen.findByRole('heading', { level: 1, name: 'Request received' })).toBeInTheDocument()
  const received = screen.getByRole('status')
  // "If": the page does not know whether the address has an account, and says so
  expect(received).toHaveTextContent('If an account uses ada@example.invalid, its deletion request is now with the admins.')
  expect(received).toHaveTextContent('No email is sent, and this page can’t say whether that address has an account')
  expect(received).toHaveTextContent('there is no set date')
  expect(document.body).not.toHaveTextContent(FALSE_PROMISES)
  // The form is gone: one request per visit
  expect(screen.queryByRole('button', { name: 'Request deletion' })).not.toBeInTheDocument()
})

test('a refusal (too many requests) is shown beside the button and the form stays', async () => {
  fakeRoute({ status: 429, body: { error: 'Too many deletion requests from this address. Try again later.', retryAfter: 1800 } })
  render(<PublicDeleteAccountPage />)

  fillEmail('ada@example.invalid')
  await tick()
  await submit()

  expect(await screen.findByRole('alert')).toHaveTextContent('Too many deletion requests from this address. Try again later.')
  expect(screen.getByRole('button', { name: 'Request deletion' })).not.toBeDisabled()
  expect(screen.queryByRole('heading', { name: 'Request received' })).not.toBeInTheDocument()
})
