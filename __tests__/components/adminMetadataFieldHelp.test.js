/**
 * The movie and show editors store Overview and the TMDB ID in `metadata.*`,
 * which the sync replaces whenever it takes a fresh copy of the metadata,
 * unless `metadata` is locked. They do not lock it on edit (that would freeze
 * every field derived from the metadata); each of those fields says so in its
 * hint instead, and the TMDB ID's hint points to the control that lasts, the
 * processor's tmdb.config.
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
jest.mock('@components/Admin/Media/TmdbConfigButton', () => ({
  __esModule: true,
  default: () => <button type="button">TMDB Config</button>,
}))
jest.mock('@components/Admin/Media/RawRecordButton', () => ({ __esModule: true, default: () => null }))
jest.mock('@components/Admin/Media/DeleteMediaButton', () => ({ __esModule: true, default: () => null }))
jest.mock('@components/Admin/Media/CaptionsEditor', () => ({ __esModule: true, default: () => null }))
jest.mock('@components/Admin/Media/SeasonEditor', () => ({ __esModule: true, default: () => null }))

const MovieEditor = require('@components/Admin/Media/MovieEditor').default
const TVShowEditor = require('@components/Admin/Media/TVShowEditor').default
const { METADATA_FIELD_HELP, tmdbIdHelp } = require('@components/Admin/Media/useFieldLocks')

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

describe('the metadata hints', () => {
  it('say what a metadata refresh does, in plain words, and where the TMDB entry is chosen', () => {
    expect(METADATA_FIELD_HELP).toBe(
      'Comes from the metadata: the next metadata refresh replaces it unless the metadata is locked. This lock locks all metadata.'
    )
    expect(tmdbIdHelp(true)).toBe(
      `${METADATA_FIELD_HELP} To match the title to another TMDB entry, set the ID in TMDB Config, above (the processor's tmdb.config).`
    )
    expect(tmdbIdHelp(false)).toBe(
      `${METADATA_FIELD_HELP} To match the title to another TMDB entry, set the ID in the processor's tmdb.config for the title's folder.`
    )
  })
})

describe.each([
  ['movie', MovieEditor, mockSaveMovie, { videoURL: 'https://server/film.mp4' }],
  ['show', TVShowEditor, mockSaveShow, { seasons: [] }],
])('the %s editor', (_kind, Editor, save, extra) => {
  const record = {
    _id: 'doc-1',
    title: 'Old Title',
    originalTitle: 'Old Title (2001)',
    metadata: { id: 101, overview: 'Stored overview.' },
    lockedFields: { posterURL: true },
    ...extra,
  }

  it('describes Overview and the TMDB ID with the metadata hint, and points the TMDB ID to TMDB Config', () => {
    render(<Editor record={record} />)

    expect(screen.getByRole('button', { name: 'TMDB Config' })).toBeInTheDocument()
    expect(screen.getByLabelText('Overview')).toHaveAccessibleDescription(METADATA_FIELD_HELP)
    expect(screen.getByLabelText('TMDB ID')).toHaveAccessibleDescription(tmdbIdHelp(true))
  })

  it('points the TMDB ID to the processor\'s tmdb.config on a new entry, which has no TMDB Config yet', () => {
    render(<Editor isNew />)

    expect(screen.queryByRole('button', { name: 'TMDB Config' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Overview')).toHaveAccessibleDescription(METADATA_FIELD_HELP)
    expect(screen.getByLabelText('TMDB ID')).toHaveAccessibleDescription(tmdbIdHelp(false))
  })

  it('does not lock the metadata when Overview or the TMDB ID is edited', async () => {
    render(<Editor record={record} />)

    act(() => fireEvent.change(screen.getByLabelText('Overview'), { target: { value: 'A new overview.' } }))
    act(() => fireEvent.change(screen.getByLabelText('TMDB ID'), { target: { value: '202' } }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))
    })

    const payload = save.mock.calls[0][1]
    expect(payload.metadata).toEqual({ id: 202, overview: 'A new overview.' })
    expect(payload.lockedFields).toEqual({ posterURL: true })
  })
})
