/**
 * The Users page's "Delete account": which rows offer it, and the dialog that
 * stands between the click and the deletion. fetch is the only boundary; the
 * dialog is real (Headless UI included).
 *
 * The button that deletes stays off until the account's email has been typed.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import DeleteAccountDialog, { confirmsEmail } from '@src/components/Admin/Users/DeleteAccountDialog'
import UserListRecords from '@src/components/Admin/Users/UserListRecords'
import { canDeleteAccount } from '@src/lib/roles/rules'

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
const { toast } = require('react-toastify')
jest.mock('@src/utils/actions/admin_users', () => ({ updateUserApprovedFlag: jest.fn() }))
jest.mock('@src/utils/actions/roles', () => ({ setUserRolesAction: jest.fn() }))
jest.mock('@components/ViewAs/viewAsClient', () => ({ startViewAs: jest.fn() }))

const ADA = { id: '507f1f77bcf86cd799439011', name: 'Ada', email: 'Ada.Lovelace@example.invalid', approved: 'true', roles: [], role: 'user' }
const GRACE = { id: '507f1f77bcf86cd799439022', name: 'Grace', email: 'grace@example.invalid', approved: 'true', roles: [], role: 'user' }
const ADMIN = { id: '507f1f77bcf86cd7994390ad', name: 'Root', email: 'root@example.invalid', approved: 'true', roles: [], role: 'admin' }
const OTHER_ADMIN = { id: '507f1f77bcf86cd7994390ae', name: 'Wheel', email: 'wheel@example.invalid', approved: 'true', roles: [], role: 'admin' }

const URL_DELETE = '/api/authenticated/admin/delete-account'

/** fetch answers with a status and a body, or waits for `release()` first. */
function fakeFetch(status, body) {
  let release
  const held = new Promise((resolve) => {
    release = resolve
  })
  global.fetch = jest.fn(async () => ({ ok: status < 400, status, json: async () => body }))
  return {
    hold() {
      global.fetch = jest.fn(async () => {
        await held
        return { ok: status < 400, status, json: async () => body }
      })
    },
    release: () => release(),
  }
}

const emailBox = () => screen.getByLabelText('Type the account’s email to confirm')
// The dialog's own button: the rows behind it have one of the same name
const deleteButton = () => within(screen.getByRole('dialog')).getByRole('button', { name: /^Delet/ })
const type = (value) => fireEvent.change(emailBox(), { target: { value } })
const click = (element) => act(async () => fireEvent.click(element))

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => jest.clearAllMocks())

describe('confirmsEmail', () => {
  test('only the account’s own email confirms, whatever its case or the spaces around it', () => {
    expect(confirmsEmail('Ada.Lovelace@example.invalid', ADA.email)).toBe(true)
    expect(confirmsEmail('  ada.lovelace@EXAMPLE.invalid ', ADA.email)).toBe(true)

    expect(confirmsEmail('', ADA.email)).toBe(false)
    expect(confirmsEmail('ada.lovelace@example.invali', ADA.email)).toBe(false)
    expect(confirmsEmail('ada.lovelace@example.invalid.', ADA.email)).toBe(false)
    expect(confirmsEmail(GRACE.email, ADA.email)).toBe(false)
    expect(confirmsEmail(undefined, ADA.email)).toBe(false)
  })

  test('an account with no email can never be confirmed', () => {
    expect(confirmsEmail('', '')).toBe(false)
    expect(confirmsEmail('', undefined)).toBe(false)
    expect(confirmsEmail('undefined', undefined)).toBe(false)
  })
})

describe('canDeleteAccount', () => {
  test('anyone but the viewer and admins', () => {
    expect(canDeleteAccount(ADMIN.id, ADA)).toBe(true)
    expect(canDeleteAccount(ADMIN.id, ADMIN)).toBe(false)
    expect(canDeleteAccount(ADMIN.id, OTHER_ADMIN)).toBe(false)
    expect(canDeleteAccount(ADMIN.id, { ...ADA, id: undefined })).toBe(false)
    expect(canDeleteAccount(ADMIN.id, null)).toBe(false)
    // A viewer the page could not name is offered nothing for their own row either way: the route decides
    expect(canDeleteAccount(undefined, ADA)).toBe(true)
  })
})

describe('the dialog', () => {
  const open = (props = {}) => {
    const onClose = jest.fn()
    const onDeleted = jest.fn()
    render(<DeleteAccountDialog user={ADA} onClose={onClose} onDeleted={onDeleted} {...props} />)
    return { onClose, onDeleted }
  }

  test('stays closed without a user', () => {
    render(<DeleteAccountDialog user={null} onClose={jest.fn()} />)

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  test('says whose account, that it cannot be undone, and what goes and stays', () => {
    open()

    const dialog = screen.getByRole('dialog', { name: 'Delete Ada’s account?' })
    expect(within(dialog).getByText(/This can’t be undone/)).toBeInTheDocument()
    expect(within(dialog).getByText(/watch history and resume positions/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Lists it shared with other people/)).toBeInTheDocument()
    expect(within(dialog).getByText(/No email is sent/)).toBeInTheDocument()
    // The email to type is shown, and the box is described by it
    expect(emailBox()).toHaveAccessibleDescription(ADA.email)
  })

  test('the delete button is off until the account’s email is typed, and off again when it no longer matches', () => {
    open()

    expect(deleteButton()).toBeDisabled()

    type('ada')
    expect(deleteButton()).toBeDisabled()
    type(GRACE.email)
    expect(deleteButton()).toBeDisabled()
    type('ada.lovelace@example.invali')
    expect(deleteButton()).toBeDisabled()

    type('ada.lovelace@example.invalid')
    expect(deleteButton()).toBeEnabled()

    type('ada.lovelace@example.invalid2')
    expect(deleteButton()).toBeDisabled()
  })

  test('submitting the form before the email matches sends nothing', async () => {
    fakeFetch(200, { success: true })
    open()
    type('ada')

    await act(async () => fireEvent.submit(emailBox().closest('form')))

    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('deleting sends the user’s id and the typed email, then tells the admin and refreshes the list', async () => {
    fakeFetch(200, { success: true, data: { requestId: 'r1', deletionResults: {} } })
    const { onClose, onDeleted } = open()
    type(' ada.lovelace@example.invalid ')
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: ' left the household ' } })

    await click(deleteButton())

    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, options] = global.fetch.mock.calls[0]
    expect(url).toBe(URL_DELETE)
    expect(options.method).toBe('POST')
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' })
    expect(JSON.parse(options.body)).toEqual({ userId: ADA.id, email: 'ada.lovelace@example.invalid', reason: 'left the household' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(toast.success).toHaveBeenCalledWith('Deleted Ada’s account.')
    expect(toast.error).not.toHaveBeenCalled()
  })

  test('while the request is on its way the button says so, nothing can be sent twice, and Escape does not close', async () => {
    const api = fakeFetch(200, { success: true, data: {} })
    api.hold()
    const { onClose } = open()
    type(ADA.email)

    await click(deleteButton())

    expect(deleteButton()).toHaveTextContent('Deleting…')
    expect(deleteButton()).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    await click(deleteButton())
    expect(global.fetch).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    await act(async () => api.release())
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
  })

  test('a refusal is shown in the dialog and as a toast, and the dialog stays open', async () => {
    fakeFetch(403, { success: false, error: 'TARGET_IS_ADMIN', message: 'An admin’s account can’t be deleted here.' })
    const { onClose, onDeleted } = open()
    type(ADA.email)

    await click(deleteButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('An admin’s account can’t be deleted here.')
    expect(toast.error).toHaveBeenCalledWith('Couldn’t delete Ada’s account: An admin’s account can’t be deleted here.')
    expect(toast.success).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
    // Ready to try again
    expect(deleteButton()).toBeEnabled()
  })

  test('a deletion that began and stopped points at Deletion Requests and refreshes the list', async () => {
    fakeFetch(500, {
      success: false,
      error: 'DELETION_INCOMPLETE',
      message: 'The deletion did not finish. Run it again from Deletion Requests.',
      requestId: 'r1',
    })
    const { onClose, onDeleted } = open()
    type(ADA.email)

    await click(deleteButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The deletion did not finish.')
    expect(within(alert).getByRole('link', { name: 'Open Deletion Requests' })).toHaveAttribute('href', '/admin/deletion-requests')
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
  })

  test('a request that never reached the server says nothing was deleted', async () => {
    global.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { onClose } = open()
    type(ADA.email)

    await click(deleteButton())

    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was deleted')
    expect(toast.error).toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
  })

  test('Escape closes it when nothing is on its way', async () => {
    fakeFetch(200, { success: true })
    const { onClose } = open()
    type(ADA.email)

    await act(async () => fireEvent.keyDown(document.activeElement || document.body, { key: 'Escape', code: 'Escape' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  test('Cancel closes without sending anything', async () => {
    fakeFetch(200, { success: true })
    const { onClose } = open()
    type(ADA.email)

    await click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('the Users list', () => {
  const renderList = (updateProcessedData = jest.fn()) => {
    render(
      <UserListRecords
        title="Users"
        subtitle="Overview of all users"
        data={[ADMIN, OTHER_ADMIN, ADA, GRACE]}
        updateProcessedData={updateProcessedData}
        roleOptions={[]}
        viewerId={ADMIN.id}
      />
    )
    return updateProcessedData
  }
  const rowOf = (email) => screen.getByText(email).closest('tr')

  test('offers "Delete account" for other people’s accounts, never the viewer’s own or an admin’s', () => {
    renderList()

    expect(within(rowOf(ADA.email)).getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
    expect(within(rowOf(GRACE.email)).getByRole('button', { name: 'Delete account' })).toBeInTheDocument()
    expect(within(rowOf(ADMIN.email)).queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()
    expect(within(rowOf(OTHER_ADMIN.email)).queryByRole('button', { name: 'Delete account' })).not.toBeInTheDocument()
  })

  test('the row’s button opens the dialog for that account, and nothing is sent by opening it', async () => {
    fakeFetch(200, { success: true, data: {} })
    const updateProcessedData = renderList()

    await click(within(rowOf(GRACE.email)).getByRole('button', { name: 'Delete account' }))

    expect(screen.getByRole('dialog', { name: 'Delete Grace’s account?' })).toBeInTheDocument()
    expect(deleteButton()).toBeDisabled()
    expect(global.fetch).not.toHaveBeenCalled()

    type(GRACE.email)
    await click(deleteButton())

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ userId: GRACE.id, email: GRACE.email })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(updateProcessedData).toHaveBeenCalledTimes(1)
  })

  test('opening it for one account and then another starts with an empty confirmation', async () => {
    renderList()

    await click(within(rowOf(ADA.email)).getByRole('button', { name: 'Delete account' }))
    type(ADA.email)
    expect(deleteButton()).toBeEnabled()
    await click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await click(within(rowOf(GRACE.email)).getByRole('button', { name: 'Delete account' }))

    expect(emailBox()).toHaveValue('')
    expect(deleteButton()).toBeDisabled()
  })
})
