/**
 * The admin "Media Processing Queues" panel (EnhancedQueueDashboard). It owns
 * its polling, so the overview page around it no longer re-renders on every
 * queue update, and each card reports its own service's state.
 */

import { render, screen, within } from '@testing-library/react'

const mockUseSWR = jest.fn()
jest.mock('swr', () => ({ __esModule: true, default: (...args) => mockUseSWR(...args) }))

jest.mock('@src/utils', () => ({
  classNames: (...args) => args.flat().filter(Boolean).join(' '),
}))

const EnhancedQueueDashboard = require('@components/Admin/EnhancedQueueDashboard').default
const {
  ACTIVE_REFRESH_MS,
  IDLE_REFRESH_MS,
  MEDIA_QUEUES_URL,
  describeUnreachable,
  formatTimeLeft,
  itemMeta,
  refreshIntervalFor,
} = require('@components/Admin/mediaQueueDisplay')

const GIB = 1024 ** 3

const radarr = {
  service: 'radarr',
  state: 'ok',
  health: 'warning',
  inProgress: 3,
  itemsTotal: 4,
  items: [
    {
      id: '4',
      title: 'The.Two.Towers.2002.EXTENDED.2160p.Remux',
      status: 'Downloading',
      tone: 'warning',
      progress: 100,
      sizeBytes: 108.7 * GIB,
      timeLeftSeconds: 0,
      detail: 'Corrupt RAR file',
    },
    {
      id: '1',
      title: 'In.the.Lost.Lands.2025.1080p.Remux',
      status: 'Downloading',
      tone: 'active',
      progress: 42.5,
      sizeBytes: 21.6 * GIB,
      timeLeftSeconds: 725,
      detail: null,
    },
  ],
  counts: [
    { label: 'In queue', value: 4, unit: 'count', tone: 'neutral' },
    { label: 'Need attention', value: 1, unit: 'count', tone: 'warning' },
  ],
  notices: [],
}

const sonarr = { service: 'sonarr', state: 'unreachable', reason: 'unauthorized', httpStatus: 401 }

const sabnzbd = {
  service: 'sabnzbd',
  state: 'ok',
  health: 'idle',
  inProgress: 0,
  itemsTotal: 0,
  items: [],
  counts: [{ label: 'In queue', value: 0, unit: 'count', tone: 'neutral' }],
  notices: [{ tone: 'warning', message: 'SABnzbd is reporting 3 warnings.' }],
}

const tdarrNotConfigured = { service: 'tdarr', state: 'not_configured', missing: ['TDARR_URL'] }

function renderWith(swrState) {
  mockUseSWR.mockReturnValue(swrState)
  return render(<EnhancedQueueDashboard />)
}

beforeEach(() => mockUseSWR.mockReset())

test('polls the one media-queues route with an adaptive interval', () => {
  renderWith({ data: undefined, error: undefined })
  const [url, , options] = mockUseSWR.mock.calls[0]
  expect(url).toBe(MEDIA_QUEUES_URL)
  expect(options.refreshInterval).toBe(refreshIntervalFor)
})

test('shows a placeholder per service while the first answer is on its way', () => {
  renderWith({ data: undefined, error: undefined })
  const status = screen.getByRole('status')
  expect(status).toHaveAttribute('aria-busy', 'true')
  expect(within(status).getByText('Loading media queues…')).toBeInTheDocument()
})

test('renders each configured queue from the normalized shape', () => {
  renderWith({ data: { queues: [sabnzbd, radarr, sonarr, tdarrNotConfigured] }, error: undefined })

  // Radarr: health, counts, items (problem first), progress, what is left
  expect(screen.getByRole('heading', { name: 'Radarr' })).toBeInTheDocument()
  expect(screen.getByText('Needs attention')).toBeInTheDocument()
  expect(screen.getByText('Need attention')).toBeInTheDocument()
  expect(screen.getByText('Corrupt RAR file')).toBeInTheDocument()
  expect(screen.getByText('42% · 21.6 GiB · 12m 05s left')).toBeInTheDocument()
  expect(screen.getByRole('progressbar', { name: 'In.the.Lost.Lands.2025.1080p.Remux progress' })).toHaveAttribute(
    'aria-valuenow',
    '42'
  )
  expect(screen.getByText('+2 more')).toBeInTheDocument()

  // SABnzbd: idle, its own empty text, its warnings
  expect(screen.getByText('Nothing downloading')).toBeInTheDocument()
  expect(screen.getByText('SABnzbd is reporting 3 warnings.')).toBeInTheDocument()

  // Sonarr: unreachable, with the reason and the setting to check
  expect(screen.getByText("Can't reach Sonarr")).toBeInTheDocument()
  expect(screen.getByText('Rejected the API key (HTTP 401).')).toBeInTheDocument()
  expect(screen.getByText('Check SONARR_API_KEY.')).toBeInTheDocument()

  // Tdarr: not configured, so no card, just the variable to set
  expect(screen.queryByRole('heading', { name: 'Tdarr' })).not.toBeInTheDocument()
  expect(screen.getByText(/Not configured:/)).toHaveTextContent('Not configured: Tdarr (set TDARR_URL)')
  expect(screen.getByText('Live')).toBeInTheDocument()
})

test('a failed first load says so instead of showing empty queues', () => {
  renderWith({ data: undefined, error: new Error('HTTP 500') })
  expect(screen.getByText("Couldn't load the queues (HTTP 500). Retrying automatically.")).toBeInTheDocument()
  expect(screen.getByText('Reconnecting')).toBeInTheDocument()
})

test('a failed refresh keeps the last answer on screen and says it is stale', () => {
  renderWith({ data: { queues: [radarr] }, error: new Error('HTTP 502') })
  expect(screen.getByText("Couldn't refresh (HTTP 502); showing the last update.")).toBeInTheDocument()
  expect(screen.getByText('Corrupt RAR file')).toBeInTheDocument()
})

test('with nothing configured it says so', () => {
  renderWith({ data: { queues: [tdarrNotConfigured] }, error: undefined })
  expect(screen.getByText('No queue integrations are configured.')).toBeInTheDocument()
})

describe('display rules', () => {
  test('poll fast only while something is moving', () => {
    expect(refreshIntervalFor({ queues: [radarr, sonarr] })).toBe(ACTIVE_REFRESH_MS)
    expect(refreshIntervalFor({ queues: [sabnzbd, sonarr, tdarrNotConfigured] })).toBe(IDLE_REFRESH_MS)
    expect(refreshIntervalFor(undefined)).toBe(IDLE_REFRESH_MS)
  })

  test('time left', () => {
    expect(formatTimeLeft(0)).toBeNull()
    expect(formatTimeLeft(null)).toBeNull()
    expect(formatTimeLeft(38)).toBe('38s')
    expect(formatTimeLeft(249)).toBe('4m 09s')
    expect(formatTimeLeft(3_900)).toBe('1h 05m')
    expect(formatTimeLeft(183_600)).toBe('2d 3h')
  })

  test('item meta leaves out what an item lacks', () => {
    expect(itemMeta({ progress: null, sizeBytes: null, timeLeftSeconds: null })).toBe('')
    expect(itemMeta({ progress: 99.9, sizeBytes: null, timeLeftSeconds: 0 })).toBe('99%')
  })

  test('unreachable reasons name the setting to check', () => {
    expect(describeUnreachable({ service: 'tdarr', reason: 'refused', httpStatus: null })).toEqual({
      message: 'Refused the connection.',
      hint: 'Is it running? Check TDARR_URL.',
    })
    expect(describeUnreachable({ service: 'radarr', reason: 'http_error', httpStatus: 503 })).toEqual({
      message: 'Answered with an error (HTTP 503).',
      hint: null,
    })
    expect(describeUnreachable({ service: 'sabnzbd', reason: 'timeout', httpStatus: null })).toEqual({
      message: 'Did not answer in time.',
      hint: null,
    })
  })
})
