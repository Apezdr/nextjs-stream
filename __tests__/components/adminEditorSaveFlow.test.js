/**
 * The media editors' save (and delete) flow.
 *
 * - The editors dispatched their useActionState action outside a transition:
 *   React warned, and the pending flag ("Saving…") was not reliable. They now
 *   dispatch inside startTransition, so the button says "Saving…" (and is
 *   disabled) for as long as the action runs.
 * - The error was a plain span, not announced. It is now a live region
 *   (ActionError, role="alert"), in the form from the first render, that
 *   announces each error once: renders that leave the action's state alone do
 *   not touch its text, and a new error replaces the text node even when the
 *   words are the same.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react'

const mockActions = {}
const action = (name) => (...args) => mockActions[name](...args)
jest.mock('@src/utils/admin/flatMediaActions', () => ({
  createMovieAction: action('createMovieAction'),
  saveMovieAction: action('saveMovieAction'),
  createTVShowAction: action('createTVShowAction'),
  saveTVShowAction: action('saveTVShowAction'),
  saveSeasonAction: action('saveSeasonAction'),
  deleteSeasonAction: action('deleteSeasonAction'),
  saveEpisodeAction: action('saveEpisodeAction'),
  deleteEpisodeAction: action('deleteEpisodeAction'),
}))
jest.mock('next/navigation', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
jest.mock('@src/utils', () => ({ classNames: (...args) => args.flat().filter(Boolean).join(' ') }))
// Neighbours with their own data paths; not what these cases are about.
jest.mock('@components/Admin/Media/TmdbConfigButton', () => ({ __esModule: true, default: () => null }))
jest.mock('@components/Admin/Media/RawRecordButton', () => ({ __esModule: true, default: () => null }))
jest.mock('@components/Admin/Media/DeleteMediaButton', () => ({ __esModule: true, default: () => null }))
jest.mock('@components/Admin/Media/CaptionsEditor', () => ({ __esModule: true, default: () => null }))

const MovieEditor = require('@components/Admin/Media/MovieEditor').default
const TVShowEditor = require('@components/Admin/Media/TVShowEditor').default
const SeasonEditor = require('@components/Admin/Media/SeasonEditor').default
const EpisodeEditor = require('@components/Admin/Media/EpisodeEditor').default

const EDITORS = [
  {
    kind: 'movie',
    save: 'saveMovieAction',
    element: () => (
      <MovieEditor record={{ _id: 'movie-1', title: 'Old Title', originalTitle: 'Old Title (2001)', videoURL: 'https://server/film.mp4' }} />
    ),
    saveLabel: 'Save Changes',
    field: 'Poster URL',
  },
  {
    kind: 'show',
    save: 'saveTVShowAction',
    element: () => <TVShowEditor record={{ _id: 'show-1', title: 'Old Title', originalTitle: 'Old Title (2001)', seasons: [] }} />,
    saveLabel: 'Save Changes',
    field: 'Poster URL',
  },
  {
    kind: 'season',
    save: 'saveSeasonAction',
    element: () => <SeasonEditor showId="show-1" season={{ _id: 'season-1', seasonNumber: 1, episodes: [] }} defaultOpen />,
    saveLabel: 'Save season',
    field: 'Season Poster URL',
  },
  {
    kind: 'episode',
    save: 'saveEpisodeAction',
    element: () => (
      <EpisodeEditor showId="show-1" seasonNumber={1} episode={{ _id: 'episode-1', episodeNumber: 2, title: 'Old Title' }} defaultOpen />
    ),
    saveLabel: 'Save episode',
    field: 'Thumbnail URL',
  },
]

/** A promise the test settles, standing in for a server action in flight. */
function inFlight() {
  let settle
  const promise = new Promise((resolve) => {
    settle = resolve
  })
  return { promise, settle: (result) => act(async () => settle(result)) }
}

const click = (element) => act(async () => fireEvent.click(element))
const type = (input, value) => act(() => fireEvent.change(input, { target: { value } }))

let consoleErrors
beforeAll(() => {
  // The season and episode editors scroll themselves into view when they open as the target
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  for (const name of Object.keys(mockActions)) delete mockActions[name]
  consoleErrors = []
  jest.spyOn(console, 'error').mockImplementation((...args) => consoleErrors.push(String(args[0])))
})
afterEach(() => {
  console.error.mockRestore()
  // React warns when an action is dispatched outside a transition
  expect(consoleErrors.filter((m) => m.includes('outside of a transition'))).toEqual([])
})

describe.each(EDITORS)('the $kind editor', ({ save, element, saveLabel, field }) => {
  const saveButton = () => screen.getByRole('button', { name: saveLabel })
  const saveLiveRegion = () => within(saveButton().closest('form')).getAllByRole('alert')[0]

  it('says "Saving…" and disables the button while the save runs, and not after', async () => {
    const save1 = inFlight()
    mockActions[save] = jest.fn(() => save1.promise)
    render(element())

    await click(saveButton())

    expect(mockActions[save]).toHaveBeenCalledTimes(1)
    const pending = screen.getByRole('button', { name: 'Saving…' })
    expect(pending).toBeDisabled()

    await save1.settle({ status: 'success', message: 'Saved.' })

    expect(screen.queryByRole('button', { name: 'Saving…' })).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()
  })

  it('announces the error once, in a live region that was there, empty, before it', async () => {
    render(element())
    const region = saveLiveRegion()
    expect(region).toBeEmptyDOMElement()

    // A failed save: the region it was rendered with now holds the message
    mockActions[save] = jest.fn(async () => ({ status: 'error', message: 'Title is required.' }))
    await click(saveButton())
    expect(region).toHaveTextContent('Title is required.')
    expect(saveLiveRegion()).toBe(region)
    const announced = region.firstChild

    // Typing re-renders the form; the message is not touched, so not re-announced
    type(screen.getByLabelText(field), 'https://server/other.jpg')
    expect(region.firstChild).toBe(announced)

    // The same error again is a new error: its text is replaced, so it is read again
    mockActions[save] = jest.fn(async () => ({ status: 'error', message: 'Title is required.' }))
    await click(saveButton())
    expect(region).toHaveTextContent('Title is required.')
    expect(region.firstChild).not.toBe(announced)

    // A save that works empties the region
    mockActions[save] = jest.fn(async () => ({ status: 'success', message: 'Saved.' }))
    await click(saveButton())
    expect(region).toBeEmptyDOMElement()
  })
})

describe.each([
  ['season', 'deleteSeasonAction', EDITORS[2].element, 'Delete season (and episodes)', 1],
  ['episode', 'deleteEpisodeAction', EDITORS[3].element, 'Delete', 1],
])('the %s editor\'s delete', (_kind, del, element, deleteLabel, regionIndex) => {
  it('says "Deleting…" while it runs, and announces its error', async () => {
    const delete1 = inFlight()
    mockActions[del] = jest.fn(() => delete1.promise)
    render(element())
    const deleteButton = screen.getByRole('button', { name: deleteLabel })
    const region = within(deleteButton.closest('form')).getAllByRole('alert')[regionIndex]
    expect(region).toBeEmptyDOMElement()

    await click(deleteButton)
    expect(screen.getByRole('button', { name: 'Deleting…' })).toBeDisabled()

    await delete1.settle({ status: 'error', message: 'Season not found.' })
    expect(screen.getByRole('button', { name: deleteLabel })).toBeEnabled()
    expect(region).toHaveTextContent('Season not found.')
  })
})

describe('the show editor\'s "add season" control', () => {
  it('says "Adding…" while it runs, and announces its error', async () => {
    const add = inFlight()
    mockActions.saveSeasonAction = jest.fn(() => add.promise)
    // A show with a season renders the season's own editor too; this one has none
    render(EDITORS[1].element())
    const addButton = screen.getByRole('button', { name: 'Add season' })
    const region = within(addButton.closest('form')).getByRole('alert')
    expect(region).toBeEmptyDOMElement()

    await click(addButton)
    expect(screen.getByRole('button', { name: 'Adding…' })).toBeDisabled()

    await add.settle({ status: 'error', message: 'Season 1 already exists for this show.' })
    expect(region).toHaveTextContent('Season 1 already exists for this show.')
  })
})
