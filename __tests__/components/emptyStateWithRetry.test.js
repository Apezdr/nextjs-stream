/**
 * An empty rail polls for its first item. It used to run its own ETag copy,
 * keep polling after content arrived (its useSWR ran unconditionally), and
 * hand HorizontalScroll a count of 1 from its one-item probe, so a rail that
 * filled in later showed a single page. It now uses the shared fetcher, stops
 * polling, and refreshes the route so the server render supplies the count.
 */

import { render, screen, act } from '@testing-library/react'
import { SWRConfig } from 'swr'

const mockRefresh = jest.fn()
jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

jest.mock('@src/components/MediaScroll/HorizontalScroll', () => ({
  __esModule: true,
  default: ({ numberOfItems, listType }) => (
    <div data-testid="rail" data-items={numberOfItems} data-type={listType} />
  ),
}))

const EmptyStateWithRetry = require('@src/components/MediaScroll/EmptyStateWithRetry').default

const page = (items) => ({
  status: 200,
  ok: true,
  headers: { get: () => null },
  json: async () => ({ currentItems: items, previousItem: null, nextItem: null }),
})

const renderRail = () =>
  render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <EmptyStateWithRetry message="Nothing here yet" listType="recentlyWatched" sort="id" sortOrder="desc" />
    </SWRConfig>
  )

beforeEach(() => {
  mockRefresh.mockClear()
  global.fetch = jest.fn()
})

afterEach(() => {
  jest.useRealTimers()
})

it('keeps showing the empty state while the list is empty', async () => {
  fetch.mockResolvedValue(page([]))
  renderRail()

  expect(await screen.findByText('Nothing here yet')).toBeInTheDocument()
  expect(fetch.mock.calls[0][0]).toBe(
    '/api/authenticated/horizontal-list?type=recentlyWatched&sort=id&sortOrder=desc&page=0&limit=1'
  )
  expect(mockRefresh).not.toHaveBeenCalled()
})

it('shows the rail, refreshes the route once and stops polling when content appears', async () => {
  jest.useFakeTimers()
  fetch.mockResolvedValue(page([{ id: 'm1' }]))
  renderRail()

  await act(async () => {
    await jest.advanceTimersByTimeAsync(0)
  })
  expect(screen.getByTestId('rail')).toHaveAttribute('data-items', '1')
  expect(mockRefresh).toHaveBeenCalledTimes(1)
  expect(fetch).toHaveBeenCalledTimes(1)

  // Two poll intervals later: no further probes
  await act(async () => {
    await jest.advanceTimersByTimeAsync(61000)
  })
  expect(fetch).toHaveBeenCalledTimes(1)
  expect(mockRefresh).toHaveBeenCalledTimes(1)
})
