import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import SyncMediaPopup from '@src/components/Admin/SyncMediaPopup'
import useSWR from 'swr'

jest.mock('swr', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    // Simulate the dashboard already having a cached sync-status response.
    data: [],
  })),
}))

jest.mock('@headlessui/react', () => {
  const ReactModule = require('react')
  const Fragment = ({ children }) => ReactModule.createElement(ReactModule.Fragment, null, children)
  const Dialog = ({ children }) => ReactModule.createElement('div', null, children)
  Dialog.Panel = Fragment
  Dialog.Title = ({ children }) => ReactModule.createElement('h2', null, children)
  const Transition = {
    Root: ({ show, children }) => show ? ReactModule.createElement(Fragment, null, children) : null,
    Child: Fragment,
  }
  return { Dialog, Transition }
})

jest.mock('framer-motion', () => {
  const ReactModule = require('react')
  return {
    AnimatePresence: ({ children }) => ReactModule.createElement(ReactModule.Fragment, null, children),
    motion: {
      span: ({ children, ...props }) => ReactModule.createElement('span', props, children),
    },
  }
})

const eventSources = []

class MockEventSource {
  constructor(url) {
    this.url = url
    this.close = jest.fn()
    eventSources.push(this)
  }
}

describe('SyncMediaPopup active-sync joining', () => {
  let container
  let root
  let previousActEnvironment
  let originalEventSource
  let originalFetch
  let authoritativeStatus

  beforeAll(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    originalEventSource = globalThis.EventSource
    originalFetch = globalThis.fetch
  })

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
    globalThis.EventSource = originalEventSource
    globalThis.fetch = originalFetch
  })

  beforeEach(() => {
    authoritativeStatus = null
    useSWR.mockImplementation((key) => ({
      data: typeof key === 'string' && key.includes('sync-status')
        ? authoritativeStatus
        : [],
    }))
    eventSources.length = 0
    globalThis.EventSource = MockEventSource
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    jest.restoreAllMocks()
  })

  function renderPopup() {
    return root.render(
      <SyncMediaPopup
        isOpen
        autoConnect
        setIsOpen={jest.fn()}
        updateProcessedData={jest.fn()}
        setLastSync={jest.fn()}
      />
    )
  }

  test('uses a fresh status request and subscribes even when SWR already has cached data', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active: true,
        startTime: '2026-08-07T22:00:00.000Z',
        streamUrl: '/api/authenticated/admin/sync-stream',
        snapshot: {
          servers: { default: { id: 'default', status: 'syncing', processed: 3, total: 10 } },
          totals: { processed: 3, errors: 0 },
        },
      }),
    })

    await act(async () => {
      renderPopup()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/api/authenticated/admin/sync-status',
      expect.objectContaining({ cache: 'no-store', signal: expect.any(AbortSignal) })
    )
    expect(eventSources).toHaveLength(1)
    expect(eventSources[0].url).toBe('/api/authenticated/admin/sync-stream')
    expect(container).not.toHaveTextContent('Connecting to active sync...')

    await act(async () => {
      eventSources[0].onmessage({
        data: JSON.stringify({
          entityId: '__sync_complete__',
          data: { summary: { missingMedia: {}, missingMp4: {}, duration: 1 } },
        }),
      })
      await Promise.resolve()
    })

    expect(container).toHaveTextContent('Done')
    expect(container).not.toHaveTextContent('Syncing...')
    expect(Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Done'))
      .toBeEnabled()
  })

  test('leaves the connecting state when the sync finishes before the join', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ active: false, streamUrl: null }),
    })

    await act(async () => {
      renderPopup()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(eventSources).toHaveLength(0)
    expect(container).not.toHaveTextContent('Connecting to active sync...')
    expect(container).toHaveTextContent('The sync finished before this window connected')
  })

  test('fails closed when the server becomes idle but the stream misses completion', async () => {
    const startTime = '2026-08-08T05:12:03.000Z'
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active: true,
        startTime,
        streamUrl: '/api/authenticated/admin/sync-stream',
        snapshot: null,
      }),
    })

    await act(async () => {
      renderPopup()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container).toHaveTextContent('Syncing...')

    authoritativeStatus = {
      observedAt: '2026-08-08T05:12:06.000Z',
      active: false,
      lastCompletedAt: '2026-08-08T05:12:05.796Z',
    }
    await act(async () => {
      renderPopup()
      await Promise.resolve()
    })
    expect(container).toHaveTextContent('Syncing...')

    authoritativeStatus = {
      ...authoritativeStatus,
      observedAt: '2026-08-08T05:12:09.000Z',
    }
    await act(async () => {
      renderPopup()
      await Promise.resolve()
    })

    expect(eventSources[0].close).toHaveBeenCalled()
    expect(container).not.toHaveTextContent('Syncing...')
    expect(container).toHaveTextContent('No sync is currently running')
    expect(container).not.toHaveTextContent('Duration')
    expect(container).not.toHaveTextContent('Missing Media')

    await act(async () => {
      eventSources[0].onmessage({
        data: JSON.stringify({
          entityId: '__sync_complete__',
          data: { summary: { missingMedia: {}, missingMp4: {}, duration: 1 } },
        }),
      })
      await Promise.resolve()
    })
    expect(container).not.toHaveTextContent('Done')
  })
})