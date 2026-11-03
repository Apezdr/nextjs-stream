/**
 * The Roles admin page, composed from the registered capabilities: each
 * brings its own settings editor (arr.request's quality profiles per
 * service), and what is saved is exactly what was set.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import RolesAdmin from '@src/components/Admin/Roles/RolesAdmin'
import UserRolesPicker from '@src/components/Admin/Users/UserRolesPicker'
import { summarize } from '@src/lib/roles/capability'
import { CAPABILITIES } from '@src/lib/roles/registry'

const mockSaveRole = jest.fn()
const mockDeleteRole = jest.fn()
const mockSetUserRoles = jest.fn()
const mockSearchTitles = jest.fn()
jest.mock('@src/utils/actions/roles', () => ({
  saveRoleAction: (...args) => mockSaveRole(...args),
  deleteRoleAction: (...args) => mockDeleteRole(...args),
  setUserRolesAction: (...args) => mockSetUserRoles(...args),
  searchScopeTitlesAction: (...args) => mockSearchTitles(...args),
}))
const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mockRefresh }) }))
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
const { toast } = require('react-toastify')

const capabilities = CAPABILITIES.map(summarize)
const editorData = {
  'arr.request': {
    radarr: {
      profiles: [
        { id: 4, name: 'HD-1080p' },
        { id: 5, name: 'Ultra-HD - 1080p' },
      ],
    },
    sonarr: { unavailable: 'Sonarr isn’t set up on this server.' },
  },
}

const click = (element) => act(() => fireEvent.click(element))

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => jest.clearAllMocks())

test('a new role takes each capability’s own settings, and saves exactly those', async () => {
  mockSaveRole.mockImplementation(async (draft) => ({ ok: true, role: { ...draft, id: 'r1' } }))
  render(<RolesAdmin roles={[]} holders={{}} capabilities={capabilities} editorData={editorData} />)

  await click(screen.getByRole('button', { name: 'New role' }))
  fireEvent.change(screen.getByPlaceholderText('e.g. HD requester'), { target: { value: 'HD requester' } })
  await click(screen.getByRole('checkbox', { name: /Request titles/ }))

  const radarr = screen.getByRole('group', { name: /Radarr/ })
  await click(within(radarr).getByRole('radio', { name: 'Only these' }))
  await click(within(radarr).getByRole('checkbox', { name: 'HD-1080p' }))
  // Sonarr can't list its profiles, so only "none" or "any" are offered.
  const sonarr = screen.getByRole('group', { name: /Sonarr/ })
  expect(within(sonarr).getByRole('radio', { name: 'Only these' })).toBeDisabled()
  expect(within(sonarr).getByText('Sonarr isn’t set up on this server.')).toBeInTheDocument()
  await click(screen.getByRole('checkbox', { name: /Pick releases by hand/ }))

  await click(screen.getByRole('button', { name: 'Save role' }))

  await waitFor(() => expect(mockSaveRole).toHaveBeenCalled())
  expect(mockSaveRole.mock.calls[0][0]).toEqual({
    id: null,
    name: 'HD requester',
    description: '',
    grants: { 'arr.request': { radarr: [4], sonarr: [], manual: true, anyTitle: false } },
    scope: null,
  })
  // The list describes it through the capability's own describer.
  expect(await screen.findByText(/Radarr: HD-1080p · picks releases by hand/)).toBeInTheDocument()
  expect(mockRefresh).toHaveBeenCalled()
})

test('a refusal is shown in the editor, which stays open', async () => {
  mockSaveRole.mockResolvedValue({ ok: false, error: 'A role with that name already exists.' })
  render(<RolesAdmin roles={[]} holders={{}} capabilities={capabilities} editorData={editorData} />)

  await click(screen.getByRole('button', { name: 'New role' }))
  fireEvent.change(screen.getByPlaceholderText('e.g. HD requester'), { target: { value: 'Managers' } })
  await click(screen.getByRole('checkbox', { name: /Manage Radarr and Sonarr titles/ }))
  await click(screen.getByRole('button', { name: 'Save role' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('A role with that name already exists.')
  expect(mockSaveRole.mock.calls[0][0].grants).toEqual({ 'arr.manage': {} })
})

test('the Users page picker saves a user’s roles, and puts them back if refused', async () => {
  const roleOptions = [
    { id: 'r1', name: 'HD requester' },
    { id: 'r2', name: 'Media manager' },
  ]
  mockSetUserRoles.mockResolvedValueOnce({ ok: true, roles: ['r1'] })
  render(<UserRolesPicker userId="u1" userName="Robin" value={[]} roleOptions={roleOptions} />)

  await click(screen.getByRole('button', { name: 'Roles for Robin' }))
  await click(await screen.findByRole('option', { name: 'HD requester' }))
  await waitFor(() => expect(mockSetUserRoles).toHaveBeenCalledWith({ userID: 'u1', roleIds: ['r1'] }))
  expect(screen.getByRole('button', { name: 'Roles for Robin' })).toHaveTextContent('HD requester')

  mockSetUserRoles.mockResolvedValueOnce({ ok: false, error: 'One of those roles no longer exists.' })
  await click(await screen.findByRole('option', { name: 'Media manager' }))
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('One of those roles no longer exists.'))
  expect(screen.getByRole('button', { name: 'Roles for Robin' })).toHaveTextContent(/^HD requester$/)
})

test('a role can limit the library: rating caps and titles picked from a search, saved by their library key', async () => {
  mockSaveRole.mockImplementation(async (draft) => ({ ok: true, role: { ...draft, id: 'r2' } }))
  mockSearchTitles.mockResolvedValue({
    ok: true,
    titles: [{ mediaType: 'movie', originalTitle: 'Home Video (2001)', title: 'Home Video', year: '2001', rating: null }],
  })
  render(<RolesAdmin roles={[]} holders={{}} capabilities={capabilities} editorData={editorData} />)

  await click(screen.getByRole('button', { name: 'New role' }))
  fireEvent.change(screen.getByPlaceholderText('e.g. HD requester'), { target: { value: 'Kids' } })
  await click(screen.getByRole('checkbox', { name: /Limit the library/ }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Movies rated' }), { target: { value: 'PG' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Find a title to pick' }), { target: { value: 'home' } })
  await click(screen.getByRole('button', { name: 'Search' }))
  await click(await screen.findByRole('button', { name: 'Pick' }))
  expect(screen.getByRole('button', { name: 'Picked' })).toBeDisabled()

  await click(screen.getByRole('button', { name: 'Save role' }))

  await waitFor(() => expect(mockSaveRole).toHaveBeenCalled())
  expect(mockSearchTitles).toHaveBeenCalledWith('home')
  expect(mockSaveRole.mock.calls[0][0]).toEqual({
    id: null,
    name: 'Kids',
    description: '',
    grants: {},
    scope: {
      movieRatingCap: 'PG',
      tvRatingCap: null,
      titles: [{ mediaType: 'movie', originalTitle: 'Home Video (2001)', access: 'play' }],
    },
  })
  // The card says what its holders see
  expect(await screen.findByText(/movies up to PG · 1 picked title/)).toBeInTheDocument()
})
