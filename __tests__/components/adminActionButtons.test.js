/**
 * The delete button (movies and shows, in the editors and the media tables)
 * and the TMDB Config dialog follow the editors' save pattern: the action is
 * dispatched in a transition, so its pending state shows ("Deleting…",
 * "Saving…"), and its error is announced by the shared ActionError region.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'

const mockActions = {}
const action = (name) => (...args) => mockActions[name](...args)
jest.mock('@src/utils/admin/flatMediaActions', () => ({
  deleteMovieAction: action('deleteMovieAction'),
  deleteTVShowAction: action('deleteTVShowAction'),
}))
jest.mock('@src/utils/admin/tmdbConfigActions', () => ({
  getTmdbConfigAction: action('getTmdbConfigAction'),
  saveTmdbConfigAction: action('saveTmdbConfigAction'),
}))
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: mockPush }) }))
jest.mock('@src/utils', () => ({ buildURL: (path) => path }))
// The dialog as a plain container: its focus trap and portal are not under test
jest.mock('@headlessui/react', () => ({
  Dialog: ({ open, children }) => (open ? <div role="dialog">{children}</div> : null),
  DialogBackdrop: () => null,
  DialogPanel: ({ children }) => <div>{children}</div>,
  DialogTitle: ({ children }) => <h2>{children}</h2>,
}))
jest.mock('@components/Admin/Media/TmdbImagePicker', () => ({ __esModule: true, default: () => null }))

const DeleteMediaButton = require('@components/Admin/Media/DeleteMediaButton').default
const TmdbConfigButton = require('@components/Admin/Media/TmdbConfigButton').default

/** A promise the test settles, standing in for a server action in flight. */
function inFlight() {
  let settle
  const promise = new Promise((resolve) => {
    settle = resolve
  })
  return { promise, settle: (result) => act(async () => settle(result)) }
}
const click = (element) => act(async () => fireEvent.click(element))

let consoleErrors
beforeEach(() => {
  for (const name of Object.keys(mockActions)) delete mockActions[name]
  mockPush.mockClear()
  consoleErrors = []
  jest.spyOn(console, 'error').mockImplementation((...args) => consoleErrors.push(String(args[0])))
})
afterEach(() => {
  console.error.mockRestore()
  // React warns when an action is dispatched outside a transition
  expect(consoleErrors.filter((m) => m.includes('outside of a transition'))).toEqual([])
})

describe.each([
  ['movie', 'button', 'deleteMovieAction', () => screen.getByRole('button', { name: 'Delete' })],
  ['tv', 'icon', 'deleteTVShowAction', () => screen.getByRole('button', { name: 'Delete Old Title' })],
])('the %s delete button (%s variant)', (type, variant, del, openButton) => {
  it('has its error region from the first render, empty and out of the layout', () => {
    render(<DeleteMediaButton type={type} id="doc-1" label="Old Title" variant={variant} />)

    const region = screen.getByRole('alert')
    expect(region).toBeEmptyDOMElement()
    expect(region).toHaveClass('absolute')
  })

  it('says "Deleting…" while the delete runs, and announces its error in the same region', async () => {
    const delete1 = inFlight()
    mockActions[del] = jest.fn(() => delete1.promise)
    render(<DeleteMediaButton type={type} id="doc-1" label="Old Title" variant={variant} />)
    const region = screen.getByRole('alert')

    await click(openButton())
    await click(screen.getByRole('button', { name: 'Confirm' }))

    expect(mockActions[del]).toHaveBeenCalledWith({ status: 'idle' }, { id: 'doc-1' })
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await delete1.settle({ status: 'error', message: 'Not found.' })

    expect(screen.getByRole('button', { name: 'Confirm' })).toBeEnabled()
    expect(screen.getByRole('alert')).toBe(region)
    expect(region).toHaveTextContent('Not found.')
    expect(region).toHaveClass('text-xs', 'text-red-600')

    // Leaving the confirm step hides the error, as it always did
    await click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('alert')).toBe(region)
    expect(region).toBeEmptyDOMElement()
  })

  it('goes where it is told once the delete succeeds', async () => {
    mockActions[del] = jest.fn(async () => ({ status: 'success', deleted: true }))
    render(<DeleteMediaButton type={type} id="doc-1" label="Old Title" variant={variant} redirectTo="/admin/media" />)

    await click(openButton())
    await click(screen.getByRole('button', { name: 'Confirm' }))

    expect(mockPush).toHaveBeenCalledWith('/admin/media')
    expect(screen.getByRole('alert')).toBeEmptyDOMElement()
  })
})

describe('the TMDB Config dialog', () => {
  async function openDialog() {
    mockActions.getTmdbConfigAction = jest.fn(async () => ({
      status: 'success',
      config: { tmdb_id: '101', update_metadata: true },
      configPath: '/media/Old Title (2001)/tmdb.config',
    }))
    render(<TmdbConfigButton type="movie" originalTitle="Old Title (2001)" />)
    await click(screen.getByRole('button', { name: 'TMDB Config' }))
    return within(screen.getByRole('dialog'))
  }

  it('says "Saving…" while the save runs, and announces its error in a region the form had from its first render', async () => {
    const save1 = inFlight()
    mockActions.saveTmdbConfigAction = jest.fn(() => save1.promise)
    const dialog = await openDialog()
    const region = dialog.getByRole('alert')
    expect(region).toBeEmptyDOMElement()
    expect(region).toHaveClass('absolute')

    await click(dialog.getByRole('button', { name: 'Save config' }))

    expect(mockActions.saveTmdbConfigAction).toHaveBeenCalledTimes(1)
    expect(mockActions.saveTmdbConfigAction.mock.calls[0][1]).toMatchObject({
      mediaType: 'movie',
      originalTitle: 'Old Title (2001)',
      config: expect.objectContaining({ tmdb_id: '101' }),
    })
    expect(dialog.getByRole('button', { name: 'Saving…' })).toBeDisabled()

    await save1.settle({ status: 'error', message: 'The file server rejected the config.' })

    expect(dialog.getByRole('button', { name: 'Save config' })).toBeEnabled()
    expect(dialog.getByRole('alert')).toBe(region)
    expect(region).toHaveTextContent('The file server rejected the config.')
  })

  it('shows a successful save\'s message, with the error region empty', async () => {
    mockActions.saveTmdbConfigAction = jest.fn(async () => ({ status: 'success', message: 'Saved tmdb.config.' }))
    const dialog = await openDialog()

    await click(dialog.getByRole('button', { name: 'Save config' }))

    expect(dialog.getByText('Saved tmdb.config.')).toBeInTheDocument()
    expect(dialog.getByRole('alert')).toBeEmptyDOMElement()
  })
})
