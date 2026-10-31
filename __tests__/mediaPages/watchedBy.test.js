/**
 * "Watched by N people" on the movie and episode info pages: plain text for
 * everyone, and for an admin a button that opens the list of who watched.
 * The pages are cached for every viewer, so the admin check is the client's.
 */

import { render, screen, within, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'

let mockSession = null
jest.mock('@src/lib/auth-client', () => ({
  authClient: { useSession: () => ({ data: mockSession, isPending: false }) },
}))

// The dialog is lazy in the app; here it renders in place
jest.mock('next/dynamic', () => () => {
  const Dialog = (props) => {
    const WatchedByDialog = require('@components/MediaPages/details/WatchedByDialog').default
    return <WatchedByDialog {...props} />
  }
  return Dialog
})

const WatchedByButton = require('@components/MediaPages/details/WatchedByButton').default

const props = {
  count: 3,
  normalizedVideoId: 'abc123',
  mediaId: 'mid:0123456789abcdef',
  durationMs: 600_000,
  title: 'Some Show · S01E01 · Pilot',
}

const renderButton = (overrides = {}) =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <WatchedByButton {...props} {...overrides} />
    </SWRConfig>
  )

beforeEach(() => {
  mockSession = null
  global.fetch = jest.fn()
})

test('a viewer who is not an admin sees the count as text, with nothing to open', () => {
  mockSession = { user: { id: 'u1', role: 'user' } }
  renderButton()

  expect(screen.getByText(/Watched by/).parentElement).toHaveTextContent('Watched by 3 people')
  expect(screen.queryByRole('button')).toBeNull()
})

test('one viewer reads "1 person"', () => {
  renderButton({ count: 1 })
  expect(screen.getByText(/Watched by/).parentElement).toHaveTextContent('Watched by 1 person')
})

test('an admin opens the list: newest first, with how far each got', async () => {
  mockSession = { user: { id: 'a1', role: 'admin' } }
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      viewers: [
        { userId: 'u1', name: 'Ada Lovelace', image: null, playbackTime: 590, lastUpdated: '2026-10-29T21:14:00.000Z', deviceType: 'tv' },
        { userId: 'u2', name: 'Grace Hopper', image: 'https://lh3.example.com/a.png', playbackTime: 150, lastUpdated: '2026-10-28T10:00:00.000Z', deviceType: 'desktop' },
        { userId: 'u3', name: null, image: null, playbackTime: 30, lastUpdated: null, deviceType: null },
      ],
    }),
  })
  renderButton()

  fireEvent.click(screen.getByRole('button', { name: 'Watched by 3 people' }))

  const dialog = await screen.findByRole('dialog')
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/authenticated/admin/watched-by?normalizedVideoId=abc123&mediaId=mid%3A0123456789abcdef',
    expect.objectContaining({ credentials: 'include' })
  )
  expect(await within(dialog).findByText('Ada Lovelace')).toBeInTheDocument()
  expect(within(dialog).getByRole('heading', { name: 'Watched by 3 people' })).toBeInTheDocument()
  expect(within(dialog).getByText('Some Show · S01E01 · Pilot')).toBeInTheDocument()

  const rows = within(dialog).getAllByRole('listitem')
  expect(rows).toHaveLength(3)
  expect(rows[0]).toHaveTextContent('Finished') // 590 of 600 s is past 95%
  expect(rows[0]).toHaveTextContent('TV')
  expect(rows[1]).toHaveTextContent('25%')
  expect(rows[2]).toHaveTextContent('Unknown user')
})

test('an admin sees the failure when the list cannot load', async () => {
  mockSession = { user: { id: 'a1', role: 'admin' } }
  global.fetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
  renderButton()

  fireEvent.click(screen.getByRole('button', { name: 'Watched by 3 people' }))

  expect(await screen.findByText(/Could not load the viewers/)).toBeInTheDocument()
})
