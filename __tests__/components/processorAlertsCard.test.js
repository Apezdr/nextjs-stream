/**
 * The admin dashboard's log alerts card (src/components/Admin/ProcessorAlertsCard.js):
 * one row per server with its status from that processor's own alerts.
 */

import { render, screen, within } from '@testing-library/react'

const mockSwr = jest.fn()
jest.mock('swr', () => ({ __esModule: true, default: (...args) => mockSwr(...args) }))
jest.mock('@src/utils', () => ({
  buildURL: (url) => url,
  classNames: (...args) => args.flat().filter(Boolean).join(' '),
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const { AlertsNotShared } = require('@components/Admin/Logs/useProcessorAlerts')
const ProcessorAlertsCard = require('@components/Admin/ProcessorAlertsCard').default

const SERVERS = [
  { id: 'default', displayName: 'Tower' },
  { id: 'server2', displayName: "Brother's" },
  { id: 'server3' },
]

function respond(byServer) {
  mockSwr.mockImplementation((key) => {
    const url = String(key)
    if (url.endsWith('/admin/servers')) return { data: SERVERS }
    const id = new URL(url, 'http://x').searchParams.get('server')
    return byServer[id] ?? { data: undefined }
  })
}

const row = (name) => screen.getByText(name).closest('li')

describe('ProcessorAlertsCard', () => {
  it('shows each server as critical, not shared, or healthy, with its top alerts and a logs link', () => {
    respond({
      default: {
        data: {
          active: [
            { key: 'w', severity: 'warning', title: 'Memory pressure 20 times', muted: false },
            { key: 'c', severity: 'critical', title: 'No library scan has finished in 31 minutes', muted: false },
          ],
        },
      },
      server2: { error: new AlertsNotShared('refused') },
      server3: { data: { active: [{ key: 'm', severity: 'critical', title: 'muted one', muted: true }] } },
    })

    render(<ProcessorAlertsCard />)

    const tower = row('Tower')
    expect(within(tower).getByText('1 critical, 1 warning')).toBeInTheDocument()
    expect(within(tower).getAllByRole('listitem')[0]).toHaveTextContent('No library scan has finished')
    expect(within(tower).getByRole('link', { name: 'Open logs' })).toHaveAttribute('href', '/admin/logs?server=default')

    const brother = row("Brother's")
    expect(within(brother).getByText('Not shared')).toBeInTheDocument()
    expect(within(brother).queryByRole('link')).not.toBeInTheDocument()

    // A muted alert doesn't make a server unhealthy.
    expect(within(row('Server 3')).getByText('Healthy')).toBeInTheDocument()
  })
})
