/**
 * The admin Logs page (src/components/Admin/Logs/LogsAdministration.js and
 * useProcessorLog.js): the newest page of a processor's log through the admin
 * proxy, older pages above it, live lines below it from the last cursor, and
 * filters that start over. It replaced a log-viewer package that fetched the
 * processor directly and showed an empty box whatever went wrong.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

// Headless UI's anchored menus measure themselves; jsdom has no ResizeObserver.
global.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const mockToast = { success: jest.fn(), error: jest.fn() }
jest.mock('react-toastify', () => ({ toast: mockToast }))

// The server list, or the selected server's alerts (AlertsPanel), by key.
let mockAlerts = { processorId: 'proc-1', active: [], recent: [] }
jest.mock('swr', () => ({
  __esModule: true,
  default: (key) =>
    String(key).includes('/admin/alerts')
      ? { data: mockAlerts, error: undefined, isLoading: false }
      : { data: [{ id: 'default', displayName: 'Default' }], error: undefined },
}))

let mockSearchParams = new URLSearchParams()
jest.mock('next/navigation', () => ({ useSearchParams: () => mockSearchParams }))

jest.mock('@src/utils', () => ({ buildURL: (url) => url }))

const LogsAdministration = require('@components/Admin/Logs/LogsAdministration').default

const entry = (n, fields = {}) => ({
  id: `2026-10-19.22:${n * 100}`,
  time: `2026-10-19T21:00:0${n}.000Z`,
  level: 'info',
  category: 'main',
  message: `message ${n}`,
  meta: null,
  ...fields,
})

const AREAS = [
  { id: 'scan', label: 'Library scan' },
  { id: 'metadata', label: 'Metadata & images' },
  { id: 'system', label: 'System' },
  { id: 'other', label: 'Other' },
]

const page = (fields) => ({
  entries: [],
  older: null,
  newer: null,
  reset: false,
  truncated: false,
  scannedFrom: null,
  facets: {
    total: 420,
    levels: { error: 3, warn: 17, info: 400 },
    categories: [
      { name: 'movie-scanner', area: 'scan', count: 390 },
      { name: 'main', area: 'system', count: 25 },
      { name: 'tmdb', area: 'metadata', count: 5 },
    ],
  },
  span: { from: '2026-10-19T21:00:00.000Z', to: '2026-10-19T22:00:00.000Z' },
  areas: AREAS,
  ...fields,
})

function json(body, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: async () => body })
}

/** Answers keyed on the request's cursor (or "newest"), plus every URL asked for. */
function serveLogs(answers) {
  const urls = []
  global.fetch = jest.fn((url) => {
    urls.push(url)
    const params = new URL(url, 'http://app.example').searchParams
    const key = params.has('before') ? `before ${params.get('before')}` : params.has('after') ? `after ${params.get('after')}` : 'newest'
    const answer = answers[key] ?? answers.newest
    return typeof answer === 'function' ? answer(params) : json(answer)
  })
  return urls
}

const messages = () => within(screen.getByRole('log')).queryAllByText(/^message \d+$/).map((node) => node.textContent)

afterEach(() => {
  jest.useRealTimers()
  mockAlerts = { processorId: 'proc-1', active: [], recent: [] }
  mockSearchParams = new URLSearchParams()
})

describe('LogsAdministration', () => {
  it('shows the newest page, then older lines above it', async () => {
    const urls = serveLogs({
      newest: page({ entries: [entry(3), entry(4)], older: '2026-10-19.22:300', newer: '2026-10-19.22:500' }),
      'before 2026-10-19.22:300': page({ entries: [entry(1), entry(2)], older: null }),
    })

    render(<LogsAdministration />)

    await waitFor(() => expect(messages()).toEqual(['message 3', 'message 4']))
    expect(urls[0]).toBe('/api/authenticated/admin/logs?server=default&limit=500')

    fireEvent.click(screen.getByRole('button', { name: 'Load older lines' }))

    await waitFor(() => expect(messages()).toEqual(['message 1', 'message 2', 'message 3', 'message 4']))
    expect(screen.getByText('Start of the range')).toBeInTheDocument()
  })

  it('adds new lines from the last cursor while live, and stops asking when paused', async () => {
    jest.useFakeTimers()
    const urls = serveLogs({
      newest: page({ entries: [entry(1)], newer: '2026-10-19.22:200' }),
      'after 2026-10-19.22:200': page({ entries: [entry(2)], newer: '2026-10-19.22:300' }),
      'after 2026-10-19.22:300': page({ entries: [], newer: '2026-10-19.22:300' }),
    })

    render(<LogsAdministration />)
    await waitFor(() => expect(messages()).toEqual(['message 1']))

    await act(() => jest.advanceTimersByTimeAsync(5000))
    expect(messages()).toEqual(['message 1', 'message 2'])

    await act(() => jest.advanceTimersByTimeAsync(5000))
    expect(urls.at(-1)).toContain('after=2026-10-19.22%3A300')
    expect(messages()).toEqual(['message 1', 'message 2'])

    fireEvent.click(screen.getByRole('checkbox', { name: 'Live' }))
    const asked = urls.length
    await act(() => jest.advanceTimersByTimeAsync(15000))
    expect(urls).toHaveLength(asked)
    expect(screen.getByText('Live updates paused')).toBeInTheDocument()
  })

  it('starts over on a category clicked in a row, and shows the fields of a line on request', async () => {
    const urls = serveLogs({
      newest: (params) =>
        json(
          params.get('only') === 'tmdb'
            ? page({ entries: [entry(7, { category: 'tmdb', level: 'error', meta: { status: 404 } })] })
            : page({ entries: [entry(1), entry(2, { category: 'tmdb' })] })
        ),
    })

    render(<LogsAdministration />)
    await waitFor(() => expect(messages()).toEqual(['message 1', 'message 2']))

    fireEvent.click(screen.getByRole('button', { name: 'tmdb' }))

    await waitFor(() => expect(messages()).toEqual(['message 7']))
    expect(urls.at(-1)).toBe('/api/authenticated/admin/logs?server=default&limit=500&only=tmdb')
    expect(screen.getByRole('button', { name: /Only tmdb/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show fields' }))
    expect(screen.getByText(/"status": 404/)).toBeInTheDocument()
  })

  it('hides an area from the Sources picker, which lists only what logged, with counts', async () => {
    const urls = serveLogs({ newest: page({ entries: [entry(1)] }) })

    render(<LogsAdministration />)
    await waitFor(() => expect(messages()).toEqual(['message 1']))

    fireEvent.click(screen.getByRole('button', { name: 'All sources' }))
    expect(screen.getByText('390')).toBeInTheDocument()
    expect(screen.queryByText('Other')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Library scan' }))

    await waitFor(() => expect(urls.at(-1)).toBe('/api/authenticated/admin/logs?server=default&limit=500&hide=area%3Ascan'))
    expect(screen.getByRole('button', { name: /Hiding Library scan/ })).toBeInTheDocument()
  })

  it('counts lines per level and limits the time range', async () => {
    const urls = serveLogs({ newest: page({ entries: [entry(1)] }) })

    render(<LogsAdministration />)
    await waitFor(() => expect(messages()).toEqual(['message 1']))

    expect(screen.getByRole('option', { name: 'Warnings and errors (20)' })).toBeInTheDocument()
    expect(screen.getByText(/^Log covers /)).toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Time' }), { target: { value: '1h' } })
    await waitFor(() => expect(urls.at(-1)).toMatch(/&from=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A[\d.]+Z$/))
    expect(screen.getByRole('checkbox', { name: 'Live' })).toBeEnabled()

    fireEvent.change(screen.getByRole('combobox', { name: 'Time' }), { target: { value: 'custom' } })
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2026-10-19T17:00' } })
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-10-19T17:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    const from = encodeURIComponent(new Date('2026-10-19T17:00').toISOString())
    const to = encodeURIComponent(new Date('2026-10-19T17:30').toISOString())
    await waitFor(() => expect(urls.at(-1)).toBe(`/api/authenticated/admin/logs?server=default&limit=500&from=${from}&to=${to}`))
    // A range that ends in the past gets no new lines.
    expect(screen.getByRole('checkbox', { name: 'Live' })).toBeDisabled()
  })

  it('copies the shown lines as text, and keeps trace IDs out of the fields', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    serveLogs({
      newest: page({ entries: [entry(1, { level: 'warn', meta: { trace_id: 'abc123', span_id: 'def', trace_flags: 1 } })] }),
    })

    render(<LogsAdministration />)
    await waitFor(() => expect(messages()).toEqual(['message 1']))
    expect(screen.queryByRole('button', { name: 'Show fields' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^trace$/i }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('abc123'))

    fireEvent.click(screen.getByRole('button', { name: 'Export' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as text' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expect.stringMatching(/WARN {2}\[main\] message 1\n$/)))
    expect(mockToast.success).toHaveBeenLastCalledWith('Copied 1 line as text')
  })

  it('searches on submit, not on every keystroke', async () => {
    const urls = serveLogs({ newest: page({ entries: [entry(1)] }) })

    render(<LogsAdministration />)
    await waitFor(() => expect(messages()).toEqual(['message 1']))

    const search = screen.getByRole('searchbox', { name: 'Search' })
    fireEvent.change(search, { target: { value: ' Timed Out ' } })
    expect(urls).toHaveLength(1)

    fireEvent.submit(search)
    await waitFor(() => expect(urls.at(-1)).toBe('/api/authenticated/admin/logs?server=default&limit=500&q=Timed+Out'))
  })

  it('says why the log could not load instead of showing an empty box', async () => {
    serveLogs({ newest: () => json({ error: 'The media processor refused the request (403): Admin privileges required' }, 502) })

    render(<LogsAdministration />)

    expect(
      await screen.findByText("Couldn't load the log: The media processor refused the request (403): Admin privileges required")
    ).toBeInTheDocument()
  })

  it('opens on the server and search a notification links to', async () => {
    mockSearchParams = new URLSearchParams({ server: 'default', q: '2bd18557f897' })
    const urls = serveLogs({ newest: page({ entries: [entry(1)] }) })

    render(<LogsAdministration />)

    await waitFor(() => expect(urls[0]).toBe('/api/authenticated/admin/logs?server=default&limit=500&q=2bd18557f897'))
    expect(screen.getByRole('searchbox', { name: 'Search' })).toHaveValue('2bd18557f897')
  })

  it("shows the server's firing alerts above the log, and their lines on request", async () => {
    mockAlerts = {
      processorId: 'proc-1',
      active: [
        { key: 'recurring:aaa', severity: 'warning', state: 'firing', title: 'session-cache: "Memory pressure" 20 times', fp: 'aaaaaaaaaaaa', firedAt: '2026-10-19T21:00:00.000Z' },
        { key: 'heartbeat:library-scan', severity: 'critical', state: 'firing', title: 'No library scan has finished in 31 minutes', fp: null, firedAt: '2026-10-19T21:10:00.000Z' },
      ],
      recent: [],
    }
    const urls = serveLogs({ newest: page({ entries: [entry(1)] }) })

    render(<LogsAdministration />)
    await waitFor(() => expect(messages()).toEqual(['message 1']))

    const panel = screen.getByRole('region', { name: 'Log alerts' })
    expect(within(panel).getByText('2 active alerts')).toBeInTheDocument()
    // Critical first.
    expect(within(panel).getAllByRole('listitem')[0]).toHaveTextContent('No library scan has finished')

    fireEvent.click(within(panel).getByRole('button', { name: 'Show lines' }))
    await waitFor(() => expect(urls.at(-1)).toBe('/api/authenticated/admin/logs?server=default&limit=500&q=aaaaaaaaaaaa'))
  })
})
