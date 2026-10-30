/**
 * The menu item's availability (Navigation/useCreditsAvailability): hidden
 * until the server says there are credits, and a failed request after that
 * keeps the last answer rather than hiding the item.
 */

import { render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { useCreditsAvailability, CREDITS_AVAILABILITY_URL } from '@components/Navigation/useCreditsAvailability'

function Probe() {
  return <span>{useCreditsAvailability() ? 'shown' : 'hidden'}</span>
}
const renderProbe = (cache = new Map()) =>
  render(
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0, shouldRetryOnError: false }}>
      <Probe />
    </SWRConfig>
  )
const answer = (status, body) => Promise.resolve({ ok: status < 400, status, json: async () => body })

afterEach(() => {
  delete global.fetch
})

it('is hidden until the server says there are credits, then shown', async () => {
  global.fetch = jest.fn(() => answer(200, { available: true, library: true, titles: 0 }))
  renderProbe()
  expect(screen.getByText('hidden')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByText('shown')).toBeInTheDocument())
  expect(global.fetch).toHaveBeenCalledWith(CREDITS_AVAILABILITY_URL, expect.any(Object))
})

it('stays hidden when there are none', async () => {
  global.fetch = jest.fn(() => answer(200, { available: false, library: false, titles: 0 }))
  renderProbe()
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  expect(screen.getByText('hidden')).toBeInTheDocument()
})

it('keeps showing the item when the next request fails', async () => {
  const cache = new Map()
  global.fetch = jest.fn(() => answer(200, { available: true }))
  const first = renderProbe(cache)
  await waitFor(() => expect(screen.getByText('shown')).toBeInTheDocument())
  first.unmount()

  // The next page's menu asks again, and the server fails
  global.fetch = jest.fn(() => answer(500, { error: 'down' }))
  renderProbe(cache)
  await waitFor(() => expect(global.fetch).toHaveBeenCalled())
  expect(screen.getByText('shown')).toBeInTheDocument()
})
