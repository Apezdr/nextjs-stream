/**
 * The Users page's "Delete account": which rows offer it, and the dialog that
 * stands between the click and the deletion. fetch is the only boundary; the
 * dialog is real (Headless UI included).
 *
 * The button that deletes stays off until the account's email has been typed.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import DeleteAccountDialog from '@src/components/Admin/Users/DeleteAccountDialog'
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
// Old sign-ins whose provider gave no address: one with a name, one with nothing
const LINUS = { id: '507f1f77bcf86cd799439033', name: 'Linus Old-Account', email: '', approved: 'true', roles: [], role: 'user' }
const NOBODY = { id: '507f1f77bcf86cd799439044', name: '', email: '', approved: 'false', roles: [], role: 'user' }

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
    expect(JSON.parse(options.body)).toEqual({ userId: ADA.id, confirmation: 'ada.lovelace@example.invalid', reason: 'left the household' })
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

  test('a request with no answer does not claim either way, and points at where to look', async () => {
    // The request may never have left, or the deletion ran and its answer was
    // lost on the way back: the dialog cannot know, and used to say "Nothing
    // was deleted"
    global.fetch = jest.fn(async () => {
      throw new TypeError('Failed to fetch')
    })
    const { onClose, onDeleted } = open()
    type(ADA.email)

    await click(deleteButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No answer came back from the server, so it isn’t known whether the account was deleted.')
    expect(alert).not.toHaveTextContent(/Nothing was deleted/)
    expect(within(alert).getByRole('link', { name: 'Open Deletion Requests' })).toHaveAttribute('href', '/admin/deletion-requests')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.success).not.toHaveBeenCalled()
    // The list is read again: it shows whether the account is still there
    expect(onDeleted).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    expect(deleteButton()).toBeEnabled()
  })

  test('a deletion that worked is reported as one even when the list cannot be read again afterwards', async () => {
    // The refresh failing was once reported as "The request didn’t reach the
    // server. Nothing was deleted", of an account that was already gone
    fakeFetch(200, { success: true, data: { requestId: 'r1', deletionResults: {} } })
    const onDeleted = jest.fn(async () => {
      throw new Error('401')
    })
    const { onClose } = open({ onDeleted })
    type(ADA.email)

    await click(deleteButton())

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Deleted Ada’s account.')
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(toast.error.mock.calls[0][0]).toMatch(/^The account was deleted, but the list could not be read again\./)
    expect(screen.queryByText(/Nothing was deleted|isn’t known/)).not.toBeInTheDocument()
  })

  test('a deletion that stopped is still reported as that when the list cannot be read again', async () => {
    fakeFetch(500, { success: false, error: 'DELETION_INCOMPLETE', message: 'The deletion did not finish. Run it again from Deletion Requests.', requestId: 'r1' })
    const onDeleted = jest.fn(async () => {
      throw new Error('401')
    })
    const { onClose } = open({ onDeleted })
    type(ADA.email)

    await click(deleteButton())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The deletion did not finish.')
    expect(alert).not.toHaveTextContent(/No answer|Nothing was deleted/)
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(deleteButton()).toBeEnabled())
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

describe('the dialog, for an account with no email address', () => {
  // The Users page showed such an account with a blank email, and the dialog
  // asked for an email nobody could type: its button never came on.
  const open = (user) => {
    const onClose = jest.fn()
    render(<DeleteAccountDialog user={user} onClose={onClose} onDeleted={jest.fn()} />)
    return { onClose }
  }
  const box = (label) => screen.getByLabelText(label)

  test('asks for the account’s name, shows it, and comes on only when it is typed', async () => {
    fakeFetch(200, { success: true, data: { requestId: 'r1', deletionResults: {} } })
    const { onClose } = open(LINUS)

    expect(screen.getByRole('dialog', { name: 'Delete Linus Old-Account’s account?' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Type the account’s email to confirm')).not.toBeInTheDocument()
    const nameBox = box('This account has no email address. Type its name to confirm')
    expect(nameBox).toHaveAccessibleDescription('Linus Old-Account')
    expect(nameBox).toHaveAttribute('type', 'text')
    // What its record will name it by
    expect(screen.getByText(/with the account’s name and your name/)).toBeInTheDocument()

    expect(deleteButton()).toBeDisabled()
    fireEvent.change(nameBox, { target: { value: 'Linus' } })
    expect(deleteButton()).toBeDisabled()
    fireEvent.change(nameBox, { target: { value: ' linus old-account ' } })
    expect(deleteButton()).toBeEnabled()

    await click(deleteButton())

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ userId: LINUS.id, confirmation: 'linus old-account', reason: null })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(toast.success).toHaveBeenCalledWith('Deleted Linus Old-Account’s account.')
  })

  test('with no name either, asks for the id shown, and never says "undefined"', async () => {
    fakeFetch(200, { success: true, data: { requestId: 'r2', deletionResults: {} } })
    open(NOBODY)

    const dialog = screen.getByRole('dialog', { name: 'Delete this account?' })
    expect(dialog).not.toHaveTextContent(/undefined|null|’s account\?/)
    const idBox = box('This account has no email address and no name. Type its id to confirm')
    expect(idBox).toHaveAccessibleDescription(NOBODY.id)
    expect(screen.getByText(/with the account’s id and your name/)).toBeInTheDocument()

    expect(deleteButton()).toBeDisabled()
    fireEvent.change(idBox, { target: { value: LINUS.id } })
    expect(deleteButton()).toBeDisabled()
    fireEvent.change(idBox, { target: { value: NOBODY.id } })
    expect(deleteButton()).toBeEnabled()

    await click(deleteButton())

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ userId: NOBODY.id, confirmation: NOBODY.id })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Deleted the account.'))
  })

  test('an account that has an email is still asked for the email, and its name does not confirm it', () => {
    open(ADA)

    type('Ada')
    expect(deleteButton()).toBeDisabled()
    type(ADA.id)
    expect(deleteButton()).toBeDisabled()
    expect(screen.getByText(/with the account’s email and your name/)).toBeInTheDocument()
  })
})

describe('the Users list, with an account that has no email address', () => {
  test('says so in the email column and still offers the delete, which opens the dialog for that account', async () => {
    render(
      <UserListRecords
        title="Users"
        subtitle="Overview of all users"
        data={[ADMIN, ADA, LINUS]}
        updateProcessedData={jest.fn()}
        roleOptions={[]}
        viewerId={ADMIN.id}
      />
    )

    const row = screen.getByText('No email address').closest('tr')
    expect(within(row).getByText('Linus Old-Account')).toBeInTheDocument()

    await click(within(row).getByRole('button', { name: 'Delete account' }))

    expect(screen.getByRole('dialog', { name: 'Delete Linus Old-Account’s account?' })).toBeInTheDocument()
    expect(screen.getByLabelText('This account has no email address. Type its name to confirm')).toBeInTheDocument()
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

    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toMatchObject({ userId: GRACE.id, confirmation: GRACE.email })
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
