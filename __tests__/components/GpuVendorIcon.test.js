import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import GpuVendorIcon from '@src/components/Admin/Stats/GpuVendorIcon'

describe('GpuVendorIcon', () => {
  test.each(['NVIDIA', 'AMD', 'Intel', 'Unknown'])('renders an accessible %s vendor mark', async (vendor) => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const previousActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    await act(async () => root.render(<GpuVendorIcon vendor={vendor} />))
    expect(container).toHaveTextContent(`${vendor} graphics`)
    await act(async () => root.unmount())
    container.remove()
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
  })
})