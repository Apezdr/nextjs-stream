/**
 * The admin "Media Processing Queues" panel (EnhancedQueueDashboard). It owns
 * its polling, so the overview page around it no longer re-renders on every
 * queue update, and each card reports its own service's state.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

const mockUseSWR = jest.fn()
jest.mock('swr', () => ({ __esModule: true, default: (...args) => mockUseSWR(...args) }))

jest.mock('@src/utils', () => ({
  classNames: (...args) => args.flat().filter(Boolean).join(' '),
}))

const mockToastError = jest.fn()
jest.mock('react-toastify', () => ({ toast: { error: (...args) => mockToastError(...args) } }))

const EnhancedQueueDashboard = require('@components/Admin/EnhancedQueueDashboard').default
const {
  ACTIVE_REFRESH_MS,
  IDLE_REFRESH_MS,
  MEDIA_QUEUES_URL,
  describeUnreachable,
  formatTimeLeft,
  itemMeta,
  refreshIntervalFor,
  refreshUrlFor,
  withQueue,
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

  test('a refresh swaps one card and leaves the others untouched', () => {
    const current = { queues: [sabnzbd, radarr, sonarr] }
    const fresh = { ...sonarr, reason: 'timeout', httpStatus: null }
    const next = withQueue(current, fresh)
    expect(next.queues).toEqual([sabnzbd, radarr, fresh])
    expect(next.queues[0]).toBe(sabnzbd)
    expect(withQueue(undefined, fresh)).toBeUndefined()
    expect(refreshUrlFor('radarr')).toBe(`${MEDIA_QUEUES_URL}?refresh=radarr`)
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

describe('refresh button', () => {
  const originalFetch = global.fetch
  let mutate

  beforeEach(() => {
    mutate = jest.fn(async () => {})
    global.fetch = jest.fn()
    mockToastError.mockReset()
  })

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('asks for that one queue again and swaps only its card', async () => {
    const fresh = { ...sabnzbd, health: 'active', inProgress: 1 }
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ queues: [fresh] }) })
    renderWith({ data: { queues: [sabnzbd, radarr] }, error: undefined, mutate })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh SABnzbd' }))

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1))
    expect(global.fetch).toHaveBeenCalledWith(`${MEDIA_QUEUES_URL}?refresh=sabnzbd`)
    const [update, options] = mutate.mock.calls[0]
    expect(options).toEqual({ revalidate: false })
    const next = update({ queues: [sabnzbd, radarr] })
    expect(next.queues).toEqual([fresh, radarr])
    expect(next.queues[1]).toBe(radarr)
  })

  test('shows it is working, and ignores repeat clicks until the answer lands', async () => {
    let respond
    global.fetch.mockImplementation(() => new Promise((resolve) => (respond = resolve)))
    renderWith({ data: { queues: [radarr] }, error: undefined, mutate })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Radarr' }))
    const busy = await screen.findByRole('button', { name: 'Refreshing Radarr' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(busy)
    expect(global.fetch).toHaveBeenCalledTimes(1)

    await act(async () => respond({ ok: true, json: async () => ({ queues: [radarr] }) }))
    expect(await screen.findByRole('button', { name: 'Refresh Radarr' })).toHaveAttribute('aria-disabled', 'false')
  })

  test('a failed refresh says so and leaves the card as it was', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 502 })
    renderWith({ data: { queues: [sonarr] }, error: undefined, mutate })

    fireEvent.click(screen.getByRole('button', { name: 'Refresh Sonarr' }))

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith("Couldn't refresh Sonarr (HTTP 502)."))
    expect(mutate).not.toHaveBeenCalled()
    expect(screen.getByText("Can't reach Sonarr")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Refresh Sonarr' })).toHaveAttribute('aria-disabled', 'false')
  })
})
