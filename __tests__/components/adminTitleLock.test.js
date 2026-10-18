/**
 * The movie, show and episode editors lock the title when the admin changes it.
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
const mockSaveEpisode = jest.fn(async () => ({ status: 'success' }))

jest.mock('@src/utils/admin/flatMediaActions', () => ({
  createMovieAction: jest.fn(async () => ({ status: 'success' })),
  saveMovieAction: (...args) => mockSaveMovie(...args),
  createTVShowAction: jest.fn(async () => ({ status: 'success' })),
  saveTVShowAction: (...args) => mockSaveShow(...args),
  saveSeasonAction: jest.fn(async () => ({ status: 'success' })),
  saveEpisodeAction: (...args) => mockSaveEpisode(...args),
  deleteEpisodeAction: jest.fn(async () => ({ status: 'success' })),
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
const EpisodeEditor = require('@components/Admin/Media/EpisodeEditor').default
const { TITLE_LOCK_HELP } = require('@components/Admin/Media/useFieldLocks')

// Each editor, with the names its form uses. `other` is a field that is not
// locked on edit, stored locked in the record below.
const EDITORS = [
  {
    kind: 'movie',
    save: mockSaveMovie,
    editRecord: (record) => <MovieEditor record={record} />,
    newEntry: () => <MovieEditor isNew />,
    extra: { videoURL: 'https://server/film.mp4' },
    titleLabel: 'Title (display)',
    saveLabel: 'Save Changes',
    other: { key: 'posterURL', label: 'Poster URL' },
  },
  {
    kind: 'show',
    save: mockSaveShow,
    editRecord: (record) => <TVShowEditor record={record} />,
    newEntry: () => <TVShowEditor isNew />,
    extra: { seasons: [] },
    titleLabel: 'Title (display)',
    saveLabel: 'Save Changes',
    other: { key: 'posterURL', label: 'Poster URL' },
  },
  {
    kind: 'episode',
    save: mockSaveEpisode,
    editRecord: (record) => <EpisodeEditor showId="show-1" seasonNumber={1} episode={record} defaultOpen />,
    newEntry: () => <EpisodeEditor showId="show-1" seasonNumber={1} isNew defaultEpisodeNumber={3} defaultOpen />,
    extra: { episodeNumber: 2, seasonNumber: 1 },
    titleLabel: 'Title',
    saveLabel: 'Save episode',
    other: { key: 'thumbnail', label: 'Thumbnail URL' },
  },
]

const type = (input, value) => act(() => fireEvent.change(input, { target: { value } }))
const click = (element) => act(() => fireEvent.click(element))

beforeAll(() => {
  // The episode editor scrolls itself into view when it opens as the target
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  mockSaveMovie.mockClear()
  mockSaveShow.mockClear()
  mockSaveEpisode.mockClear()
})

describe.each(EDITORS)('the $kind editor', ({ save, editRecord, newEntry, extra, titleLabel, saveLabel, other }) => {
  const record = (over = {}) => ({
    _id: 'doc-1',
    title: 'Old Title',
    originalTitle: 'Old Title (2001)',
    [other.key]: 'https://server/image.jpg',
    lockedFields: { [other.key]: true },
    ...extra,
    ...over,
  })
  const titleInput = () => screen.getByLabelText(titleLabel)
  const titleLock = () => screen.getByRole('button', { name: new RegExp(`^(Lock|Unlock) ${titleLabel.replace(/[()]/g, '\\$&')}$`) })
  const otherInput = () => screen.getByLabelText(other.label)
  async function submit() {
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: saveLabel }))
    })
    expect(save).toHaveBeenCalledTimes(1)
    return save.mock.calls[0][1]
  }

  it('turns the title\'s lock on when the admin changes the title, and saves it locked', async () => {
    render(editRecord(record()))
    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')

    type(titleInput(), 'New Title')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'true')
    expect(titleLock()).toHaveAccessibleName(`Unlock ${titleLabel}`)
    const payload = await submit()
    expect(payload.title).toBe('New Title')
    expect(payload.lockedFields).toEqual({ [other.key]: true, title: true })
  })

  it('respects the admin turning the lock off again, through later edits', async () => {
    render(editRecord(record()))

    type(titleInput(), 'New Title')
    click(titleLock())
    type(titleInput(), 'Newer Title')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')
    const payload = await submit()
    expect(payload.title).toBe('Newer Title')
    expect(payload.lockedFields).toEqual({ [other.key]: true })
  })

  it('leaves the title\'s lock alone when the title is not changed', async () => {
    render(editRecord(record()))

    type(otherInput(), 'https://server/other-image.jpg')

    const payload = await submit()
    expect(payload.title).toBe('Old Title')
    expect(payload.lockedFields).toEqual({ [other.key]: true })
  })

  it('puts the stored lock back when the title is typed back, or only padded', async () => {
    render(editRecord(record()))

    type(titleInput(), 'New Title')
    type(titleInput(), ' Old Title ')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')
    expect((await submit()).lockedFields).toEqual({ [other.key]: true })
  })

  it('never locks an empty title: clearing the field puts the stored lock back', async () => {
    render(editRecord(record()))

    type(titleInput(), '')
    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')

    type(titleInput(), 'New Title')
    expect(titleLock()).toHaveAttribute('aria-pressed', 'true')
    type(titleInput(), '   ')
    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')

    // (The save refuses to clear the stored title; the form still sends its locks as shown.)
    expect((await submit()).lockedFields).toEqual({ [other.key]: true })
  })

  it('sends an untitled record\'s empty title as it is, unlocked, so it stays saveable', async () => {
    render(editRecord(record({ title: undefined })))

    type(titleInput(), '   ')
    expect(titleLock()).toHaveAttribute('aria-pressed', 'false')
    type(otherInput(), 'https://server/other-image.jpg')

    const payload = await submit()
    expect(payload.title.trim()).toBe('')
    expect(payload.lockedFields).toEqual({ [other.key]: true })
  })

  it('locks the title typed into a new entry as well (nothing is stored yet)', () => {
    render(newEntry())

    type(titleInput(), 'New Title')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'true')
  })

  it('describes the title input with its hint', () => {
    render(editRecord(record()))

    expect(titleInput()).toHaveAccessibleDescription(TITLE_LOCK_HELP)
  })

  it('announces politely when the title locks itself, and clears it when the admin takes over', () => {
    render(editRecord(record()))
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toBeEmptyDOMElement()

    type(titleInput(), 'New Title')
    expect(status).toHaveTextContent(`${titleLabel} locked, so the sync keeps your change.`)
    type(titleInput(), 'Newer Title')
    expect(status).toHaveTextContent(`${titleLabel} locked, so the sync keeps your change.`)

    click(titleLock())
    expect(status).toBeEmptyDOMElement()
  })

  it('announces nothing when the title is typed back, or was locked already', () => {
    const { unmount } = render(editRecord(record()))
    type(titleInput(), 'New Title')
    type(titleInput(), 'Old Title')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    unmount()

    render(editRecord(record({ lockedFields: { title: true } })))
    type(titleInput(), 'New Title')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('keeps a title that was already locked locked, whatever the edits', async () => {
    render(editRecord(record({ lockedFields: { title: true } })))

    type(titleInput(), 'New Title')
    type(titleInput(), 'Old Title')

    expect(titleLock()).toHaveAttribute('aria-pressed', 'true')
    expect((await submit()).lockedFields).toEqual({ title: true })
  })
})
