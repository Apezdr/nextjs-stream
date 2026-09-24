import React from 'react'
import { render, screen, waitFor } from '@testing-library/react'

jest.mock('@headlessui/react', () => {
  const Dialog = function MockDialog({ children }) {
    return <div role="dialog">{children}</div>
  }
  Dialog.Panel = function MockDialogPanel({ children }) {
    return <div>{children}</div>
  }
  Dialog.Title = function MockDialogTitle({ children }) {
    return <h3>{children}</h3>
  }

  return {
    Dialog,
    Transition: {
      Root: ({ children, show }) => show ? <>{children}</> : null,
      Child: ({ children }) => <>{children}</>,
    },
  }
})

jest.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    span: ({ children, className }) => <span className={className}>{children}</span>,
  },
}))

jest.mock('@src/utils', () => ({
  classNames: (...values) => values.filter(Boolean).join(' '),
}))

import SyncMediaPopup from '@src/components/Admin/SyncMediaPopup'

class MockEventSource {
  static instances = []

  constructor(url) {
    this.url = url
    this.close = jest.fn()
    MockEventSource.instances.push(this)
  }
}

const activeStatus = {
  active: true,
  forced: true,
  startTime: '2026-08-16T10:00:00.000Z',
  streamUrl: '/api/authenticated/admin/sync-stream',
  snapshot: {
    totals: { processed: 12, errors: 0 },
    servers: {
      server1: {
        id: 'server1',
        status: 'syncing',
        currentEntity: 'Obsession',
        currentOperation: 'metadata',
        processed: 12,
        total: 40,
        errorCount: 0,
        errors: [],
      },
    },
  },
}

describe('SyncMediaPopup View Info lifecycle', () => {
  beforeEach(() => {
    MockEventSource.instances = []
    global.EventSource = MockEventSource
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => activeStatus,
    }))
  })

  afterEach(() => {
    delete global.EventSource
    delete global.fetch
  })

  it('shows the running request, closes its stream, and fetches fresh status on reopen', async () => {
    const props = {
      setIsOpen: jest.fn(),
      updateProcessedData: jest.fn(),
      setLastSync: jest.fn(),
    }
    const { rerender } = render(
      <SyncMediaPopup {...props} isOpen={false} autoConnect={false} />
    )

    rerender(<SyncMediaPopup {...props} isOpen autoConnect />)

    expect(await screen.findByText('Obsession')).toBeInTheDocument()
    expect(screen.getByText('metadata')).toBeInTheDocument()
    expect(screen.getByText('Forced refresh')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(MockEventSource.instances).toHaveLength(1)

    rerender(<SyncMediaPopup {...props} isOpen={false} autoConnect={false} />)

    await waitFor(() => {
      expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1)
    })

    rerender(<SyncMediaPopup {...props} isOpen autoConnect />)

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2)
      expect(MockEventSource.instances).toHaveLength(2)
    })
    expect(await screen.findByText('Obsession')).toBeInTheDocument()
  })
})
