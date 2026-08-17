import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MinimalizedServerProcesses } from '@src/components/Admin/Stats/ServerProcesses'

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn((key) => key.includes('sync-status')
    ? { data: { active: true, startTime: '2026-08-08T00:00:00.000Z' } }
    : { data: [] }),
}))
jest.mock('@src/utils', () => ({ buildURL: (value) => value, fetcher: jest.fn() }))
jest.mock('@src/app/loading', () => ({ __esModule: true, default: () => <div>Loading</div> }))

test('shows Media Sync when sync-status is active without server processes', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  await act(async () => root.render(<MinimalizedServerProcesses />))
  expect(container).toHaveTextContent('Media Sync')
  expect(container).toHaveTextContent('Running')
  expect(container).not.toHaveTextContent('No active processes')
  await act(async () => root.unmount())
  container.remove()
  globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})