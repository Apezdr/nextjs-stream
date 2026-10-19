/**
 * The admin Logs page (src/components/Admin/Logs/LogsAdministration.js and
 * useProcessorLog.js): the newest page of a processor's log through the admin
 * proxy, older pages above it, live lines below it from the last cursor, and
 * filters that start over. It replaced a log-viewer package that fetched the
 * processor directly and showed an empty box whatever went wrong.
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: [{ id: 'default', displayName: 'Default' }], error: undefined }),
}))

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

const page = (fields) => ({
  entries: [],
  older: null,
  newer: null,
  reset: false,
  truncated: false,
  scannedFrom: null,
  categories: ['main', 'tmdb'],
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
    expect(screen.getByText('Start of the log')).toBeInTheDocument()
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
          params.get('category') === 'tmdb'
            ? page({ entries: [entry(7, { category: 'tmdb', level: 'error', meta: { status: 404 } })] })
            : page({ entries: [entry(1), entry(2, { category: 'tmdb' })] })
        ),
    })

    render(<LogsAdministration />)
    await waitFor(() => expect(messages()).toEqual(['message 1', 'message 2']))

    fireEvent.click(screen.getByRole('button', { name: 'tmdb' }))

    await waitFor(() => expect(messages()).toEqual(['message 7']))
    expect(urls.at(-1)).toBe('/api/authenticated/admin/logs?server=default&limit=500&category=tmdb')
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveValue('tmdb')

    fireEvent.click(screen.getByRole('button', { name: 'Show fields' }))
    expect(screen.getByText(/"status": 404/)).toBeInTheDocument()
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
})
