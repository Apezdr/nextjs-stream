import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import CpuVendorIcon from '@src/components/Admin/Stats/CpuVendorIcon'

describe('CpuVendorIcon', () => {
  test.each(['Intel', 'AMD', 'Unknown'])('renders an accessible %s processor mark', async (vendor) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => root.render(<CpuVendorIcon vendor={vendor} />))
    expect(container).toHaveTextContent(`${vendor} processor`)
    await act(async () => root.unmount())
    container.remove()
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })
})