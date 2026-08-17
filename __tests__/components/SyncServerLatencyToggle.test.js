import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import SyncServerLatencyToggle from '@src/components/Admin/Settings/SyncServerLatencyToggle'

jest.mock('@src/utils/actions/admin_settings', () => ({
  updateSyncServerLatency: jest.fn(),
}))

describe('SyncServerLatencyToggle', () => {
  let container
  let root
  let previousActEnvironment

  beforeAll(() => {
    previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  test.each([
    [true, 'true', 'translate-x-5', 'false'],
    [false, 'false', 'translate-x-0', 'true'],
  ])('renders a correctly anchored track when enabled=%s', async (enabled, pressed, translation, nextValue) => {
    await act(async () => root.render(<SyncServerLatencyToggle enabled={enabled} />))

    const button = container.querySelector('button[type="submit"]')
    const thumb = button.querySelector('span')
    expect(button).toHaveAttribute('aria-pressed', pressed)
    expect(button).toHaveAccessibleName('Remote sync-server latency checks')
    expect(thumb).toHaveClass('left-0.5', translation)
    expect(container.querySelector('input[name="syncServerLatencyEnabled"]')).toHaveValue(nextValue)
  })
})