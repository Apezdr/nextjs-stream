import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import MetricCard from '@src/components/Admin/BaseComponents/MetricCard'

describe('MetricCard status badge', () => {
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

  const render = (props) => act(async () => root.render(
    <MetricCard title="Last Sync" value="2 mins ago" {...props} />
  ))

  test.each(['success', 'info'])('does not badge the calm %s status', async (status) => {
    await render({ status })

    expect(container).not.toHaveTextContent(status)
  })

  test.each([
    ['warning', 'Warning'],
    ['error', 'Error'],
  ])('labels a %s badge with readable text, never the raw token', async (status, label) => {
    await render({ status })

    expect(container).toHaveTextContent(label)
    expect(container).not.toHaveTextContent(status)
  })

  test('shows an explicit badge label even for a calm status', async () => {
    await render({ status: 'success', badgeLabel: 'Up to date' })

    expect(container).toHaveTextContent('Up to date')
  })
})
