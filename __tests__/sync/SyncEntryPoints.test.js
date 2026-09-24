import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'

const mockRefresh = jest.fn()
const mockPush = jest.fn()
const mockMutateLastSync = jest.fn()

jest.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
}))

jest.mock('swr', () => () => ({ data: null, mutate: mockMutateLastSync }))
jest.mock('axios', () => ({ get: jest.fn() }))
jest.mock('next/link', () => function MockLink({ children }) {
  return <>{children}</>
})

jest.mock('@src/utils', () => ({
  buildURL: (path) => path,
  fetcher: jest.fn(),
}))

jest.mock('@src/components/Admin/SyncMediaPopup', () => function MockSyncMediaPopup({
  isOpen,
  setIsOpen,
  autoConnect = false,
}) {
  return (
    <div
      data-testid="sync-media-popup"
      data-open={String(isOpen)}
      data-auto-connect={String(autoConnect)}
    >
      <button type="button" onClick={() => setIsOpen(false)}>Close mock popup</button>
    </div>
  )
})

jest.mock('@src/components/Admin/EnhancedRecentlyWatched', () => () => null)
jest.mock('@src/components/Admin/EnhancedQueueDashboard', () => () => null)
jest.mock('@src/components/Admin/CompactUserManagement', () => () => null)
jest.mock('@src/components/Admin/Stats/EnhancedServerStats', () => () => null)
jest.mock('@src/components/Admin/EnhancedTMDBStatus', () => () => null)
jest.mock('@src/components/Admin/DashboardHeader', () => () => null)
jest.mock('@src/components/Admin/Stats/EnhancedServerProcesses', () => function MockProcesses({ onSyncViewClick }) {
  return <button type="button" onClick={onSyncViewClick}>View Info</button>
})
jest.mock('@src/components/Admin/BaseComponents', () => ({
  MaterialCard: ({ children }) => <div>{children}</div>,
  MaterialCardHeader: () => null,
  MaterialCardContent: ({ children }) => <div>{children}</div>,
  MaterialButton: ({ children }) => <button type="button">{children}</button>,
}))

import SyncButton from '@src/components/Admin/Media/SyncButton'
import AdminOverviewPage from '@src/components/Admin/OverviewPage'

describe('sync popup entry points', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('keeps the media-page sync popup mounted while closed', () => {
    render(<SyncButton />)

    expect(screen.getByTestId('sync-media-popup')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Sync with Fileserver' }))
    expect(screen.getByTestId('sync-media-popup')).toHaveAttribute('data-open', 'true')
  })

  it('opens the dashboard popup in auto-connect mode from View Info and keeps it mounted after close', () => {
    render(
      <AdminOverviewPage
        processedUserData={{ headers: [], data: [] }}
        _lastSyncTime={null}
        organizrURL={null}
      />
    )

    expect(screen.getByTestId('sync-media-popup')).toHaveAttribute('data-open', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'View Info' }))
    expect(screen.getByTestId('sync-media-popup')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('sync-media-popup')).toHaveAttribute('data-auto-connect', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Close mock popup' }))
    expect(screen.getByTestId('sync-media-popup')).toHaveAttribute('data-open', 'false')
  })
})
