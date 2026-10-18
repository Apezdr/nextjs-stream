/**
 * The movie and show editors lock the display title when the admin changes it.
 *
 * The sync rewrites a title that is not locked on its next pass (`manualFields`
 * only records who set a value), so an unlocked title edit was undone within
 * one sync. The editors now turn the title's lock on as soon as the title
 * differs from the stored one, where the admin sees it; the admin can turn it
 * off again, and the save sends what the form shows.
 */

import { act, fireEvent, render, screen } from '@testing-library/react'

const mockSaveMovie = jest.fn(async () => ({ status: 'success' }))
const mockSaveShow = jest.fn(async () => ({ status: 'success' }))

jest.mock('@src/utils/admin/flatMediaActions', () => ({
  createMovieAction: jest.fn(async () => ({ status: 'success' })),
  saveMovieAction: (...args) => mockSaveMovie(...args),
  createTVShowAction: jest.fn(async () => ({ status: 'success' })),
  saveTVShowAction: (...args) => mockSaveShow(...args),
  saveSeasonAction: jest.fn(async () => ({ status: 'success' })),
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
jest.mock('@components/Admin/Media/SeasonEditor', () => ({ __esModule: true, default: () => null }))

const MovieEditor = require('@components/Admin/Media/MovieEditor').default
const TVShowEditor = require('@components/Admin/Media/TVShowEditor').default

const EDITORS = [
  ['movie', MovieEditor, mockSaveMovie, { videoURL: 'https://server/film.mp4' }],
  ['show', TVShowEditor, mockSaveShow, { seasons: [] }],
]

const titleInput = () => screen.getByLabelText('Title (display)')
const titleLock = () => screen.getByRole('button', { name: /^(Lock|Unlock) Title \(display\)$/ })
const posterInput = () => screen.getByLabelText('Poster URL')
const type = (input, value) => act(() => fireEvent.change(input, { target: { value } }))
const click = (element) => act(() => fireEvent.click(element))
async function submit(save) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
  })
  expect(save).toHaveBeenCalledTimes(1)
  return save.mock.calls[0][1]
}

// The editors dispatch their save outside a transition, which React reports
// (the save still runs). Every other console error is let through.
const consoleError = console.error
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args) => {
    if (String(args[0]).includes('useActionState was called outside of a transition')) return
    consoleError(...args)
  })
})
afterAll(() => {
  console.error.mockRestore()
})
beforeEach(() => {
  mockSaveMovie.mockClear()
  mockSaveShow.mockClear()
})

describe.each(EDITORS)('the %s editor', (_kind, Editor, save, extra) => {
  const record = (over = {}) => ({
    _id: 'doc-1',
    title: 'Old Title',
    originalTitle: 'Old Title (2001)',
    posterURL: 'https://server/poster.jpg',
    lockedFields: { posterURL: true },
    ...extra,
    ...over,
  })

  it('turns the title\'s lock on when the admin changes the title, and saves it locked', async () => {
    render(<Editor record={record()} />)
    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')

    type(titleInput(), 'New Title')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'true')
    expect(titleLock()).toHaveAccessibleName('Unlock Title (display)')
    const payload = await submit(save)
    expect(payload.title).toBe('New Title')
    expect(payload.lockedFields).toEqual({ posterURL: true, title: true })
  })

  it('respects the admin turning the lock off again, through later edits', async () => {
    render(<Editor record={record()} />)

    type(titleInput(), 'New Title')
    click(titleLock())
    type(titleInput(), 'Newer Title')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')
    const payload = await submit(save)
    expect(payload.title).toBe('Newer Title')
    expect(payload.lockedFields).toEqual({ posterURL: true })
  })

  it('leaves the title\'s lock alone when the title is not changed', async () => {
    render(<Editor record={record()} />)

    type(posterInput(), 'https://server/other-poster.jpg')

    const payload = await submit(save)
    expect(payload.title).toBe('Old Title')
    expect(payload.lockedFields).toEqual({ posterURL: true })
  })

  it('puts the stored lock back when the title is typed back, or only padded', async () => {
    render(<Editor record={record()} />)

    type(titleInput(), 'New Title')
    type(titleInput(), ' Old Title ')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')
    expect((await submit(save)).lockedFields).toEqual({ posterURL: true })
  })

  it('never locks an empty title: clearing the field puts the stored lock back', async () => {
    render(<Editor record={record()} />)

    type(titleInput(), '')
    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')

    type(titleInput(), 'New Title')
    expect(titleLock()).toHaveAttribute('aria-pressed', 'true')
    type(titleInput(), '   ')
    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')

    // (The save refuses the empty title; the form still sends its locks as shown.)
    expect((await submit(save)).lockedFields).toEqual({ posterURL: true })
  })

  it('locks the title typed into a new entry as well (nothing is stored yet)', () => {
    render(<Editor isNew />)

    type(titleInput(), 'New Title')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps a title that was already locked locked, whatever the edits', async () => {
    render(<Editor record={record({ lockedFields: { title: true } })} />)

    type(titleInput(), 'New Title')
    type(titleInput(), 'Old Title')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'true')
    expect((await submit(save)).lockedFields).toEqual({ title: true })
  })
})
