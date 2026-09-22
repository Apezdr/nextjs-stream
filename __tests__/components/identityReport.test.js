/**
 * The identity-provider report page (src/components/Admin/Identity/IdentityReport.js)
 * has four states the processor can put it in. Each must say what to do next.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const mockUseSWR = jest.fn()
jest.mock('swr', () => ({ __esModule: true, default: (...args) => mockUseSWR(...args) }))

const mockToast = { success: jest.fn(), error: jest.fn() }
jest.mock('react-toastify', () => ({ toast: mockToast }))

jest.mock('@src/utils', () => ({
  buildURL: (url) => url,
  fetcher: jest.fn(),
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

const IdentityReport = require('@components/Admin/Identity/IdentityReport').default

const idle = { data: undefined, error: undefined, isLoading: false, mutate: jest.fn() }

function swrStates({ report, status = idle }) {
  mockUseSWR.mockImplementation((key) => (String(key).includes('/report') ? report : status))
}

beforeEach(() => {
  mockUseSWR.mockReset()
  mockToast.success.mockClear()
  mockToast.error.mockClear()
})

describe('IdentityReport', () => {
  it('says how to enable providers when the processor has none configured', () => {
    swrStates({ report: { ...idle, data: { enabled: false } } })
    render(<IdentityReport />)
    expect(screen.getByText(/isn.t connected to Radarr or Sonarr yet/i)).toBeInTheDocument()
    expect(screen.getByText('RADARR_API_KEY')).toBeInTheDocument()
  })

  it('offers a manual run when no reconcile has happened yet', async () => {
    const mutate = jest.fn()
    swrStates({ report: { ...idle, mutate, data: { enabled: true, pending: true } } })
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ totals: { claimed: 5, write: 1, conflict: 2 } }),
    })

    render(<IdentityReport />)
    // A freshly booted processor is initializing, not broken: say so, keep polling,
    // and keep the manual run as the impatient path.
    expect(screen.getByRole('status')).toHaveTextContent(/initializing/i)
    expect(screen.getByText(/cataloging the library/i)).toBeInTheDocument()
    expect(screen.getByText(/checks every 10 seconds/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /check with .* now/i }))

    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith(expect.stringMatching(/5 claims.*1 written.*2 conflicts/)))
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/identity\/reconcile$/)
    expect(global.fetch.mock.calls[0][1]).toEqual({ method: 'POST' })
    expect(mutate).toHaveBeenCalled()
  })

  it('shows a conflict with both ids, who pinned it, and a link into the media list', () => {
    swrStates({
      report: {
        ...idle,
        data: {
          at: '2026-09-22T12:00:00.000Z',
          reason: 'tick',
          durationMs: 812,
          totals: { claimed: 10, write: 1, stamp: 8, keep: 0, conflict: 1, providerOnly: 0, nested: 0, unmanaged: 2 },
          written: { items: [], total: 0, truncated: 0 },
          conflicts: {
            items: [
              {
                libraryRelativePath: 'movies/The Professor',
                storedId: 9327,
                storedSource: null,
                providerId: 467956,
                source: 'radarr',
                title: 'The Professor',
                year: 2019,
              },
            ],
            total: 1,
            truncated: 0,
          },
          providerOnly: { items: [], total: 0, truncated: 0 },
          unmanaged: { items: ['movies/Home Video', 'tv/Local Show'], total: 2, truncated: 0 },
          providerConflicts: { items: [], total: 0, truncated: 0 },
          errors: { items: [], total: 0, truncated: 0 },
        },
      },
    })

    render(<IdentityReport />)

    const folder = screen.getByRole('link', { name: 'The Professor' })
    expect(folder).toHaveAttribute('href', '/admin/media/movies?q=The%20Professor')
    expect(screen.getByRole('link', { name: '9327' })).toHaveAttribute('href', 'https://www.themoviedb.org/movie/9327')
    expect(screen.getByRole('link', { name: 'The Professor (2019)' })).toHaveAttribute(
      'href',
      'https://www.themoviedb.org/movie/467956'
    )
    expect(screen.getByText(/pinned before tracking began/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Local Show' })).toHaveAttribute('href', '/admin/media/tv?q=Local%20Show')
  })

  // Radarr spells "The End?" as "The End!" (illegal-character replacement); the
  // post-processed file landed under the real title, so Radarr thinks the
  // movie is missing while the library has it. Both lists must say so.
  const renamedReport = (catalog) => ({
    at: '2026-09-22T12:00:00.000Z',
    totals: { claimed: 1 },
    written: { items: [], total: 0, truncated: 0 },
    conflicts: { items: [], total: 0, truncated: 0 },
    providerOnly: {
      items: [
        { libraryRelativePath: 'movies/The End!', tmdbId: 464737, source: 'radarr', hasFile: false, providerPath: '/processed_movies/The End!' },
        { libraryRelativePath: 'movies/Cargo', tmdbId: 34069, source: 'radarr', hasFile: false, providerPath: '/processed_movies/Cargo' },
      ],
      total: 2,
      truncated: 0,
    },
    unmanaged: { items: ['movies/Big Buck Bunny', 'movies/The End?'], total: 2, truncated: 0, ...(catalog ? { catalog } : {}) },
    providerConflicts: { items: [], total: 0, truncated: 0 },
    errors: { items: [], total: 0, truncated: 0 },
  })

  it('names an arr row that has no file as LOST when a folder on disk carries the same TMDB id', () => {
    swrStates({
      report: {
        ...idle,
        data: renamedReport({
          'movies/The End?': { tmdbId: 464737, title: 'The End?', id: '6a4fa5575bd6dc41316ddacd' },
          'movies/Big Buck Bunny': { tmdbId: null, title: 'Big Buck Bunny', id: 'bbb' },
        }),
      },
    })

    render(<IdentityReport />)

    expect(screen.getByText(/Radarr lost track of it/i)).toHaveTextContent(/on disk as The End\?, same TMDB id/)
    expect(screen.getByText(/may download the file again/i)).toBeInTheDocument()
    const links = screen.getAllByRole('link', { name: 'The End?' })
    expect(links[0]).toHaveAttribute('href', '/admin/media/movies?q=The%20End%3F')
    expect(screen.getByText(/Radarr knows it as The End! \(same TMDB id\)/)).toBeInTheDocument()
    // An ordinary queued download is left alone.
    expect(screen.getAllByText(/Not downloaded yet — Radarr is watching for it/)).toHaveLength(1)
  })

  it('reads the manager’s own availability when the processor forwards it', () => {
    const data = renamedReport(null)
    data.providerOnly = {
      items: [
        { libraryRelativePath: 'movies/Announced', tmdbId: 1, source: 'radarr', hasFile: false, providerPath: '/p/Announced', released: false, arrStatus: 'announced', monitored: true },
        { libraryRelativePath: 'movies/Out Now', tmdbId: 2, source: 'radarr', hasFile: false, providerPath: '/p/Out Now', released: true, arrStatus: 'released', monitored: true },
        { libraryRelativePath: 'movies/Parked', tmdbId: 3, source: 'radarr', hasFile: false, providerPath: '/p/Parked', released: true, arrStatus: 'released', monitored: false },
        { libraryRelativePath: 'tv/Old Build', tmdbId: 4, source: 'sonarr', hasFile: false, providerPath: '/t/Old Build' },
      ],
      total: 4,
      truncated: 0,
    }
    data.unmanaged = { items: [], total: 0, truncated: 0 }
    swrStates({ report: { ...idle, data } })

    render(<IdentityReport />)

    expect(screen.getByText(/Not released yet — Radarr will download it when it is/)).toHaveAttribute('title', 'Radarr status: announced')
    expect(screen.getByText(/Released, not downloaded yet — Radarr is looking for it/)).toBeInTheDocument()
    expect(screen.getByText(/Not monitored in Radarr, so it will not be downloaded/)).toBeInTheDocument()
    // A row without the fields keeps the generic line and no tooltip.
    expect(screen.getByText(/Not downloaded yet — Sonarr is watching for it/)).not.toHaveAttribute('title')
  })

  it('lists a managed title with no TMDB id as its own case, with links to chase the mapping', () => {
    // Sonarr manages The Wayfinders but has no TMDB id for it (TVDB→TMDB mapping
    // missing upstream), and TMDB's own lookup found none. It is not unmanaged,
    // and its local pin came from the name search, so it deserves the same
    // "check this" treatment with a different explanation.
    const data = renamedReport(null)
    data.providerOnly = {
      items: [
        { libraryRelativePath: 'tv/Never Mapped', tmdbId: null, source: 'sonarr', hasFile: false, providerPath: '/t/Never Mapped', externalIds: { tvdb: 999, imdb: 'tt0000001' } },
      ],
      total: 1,
      truncated: 0,
    }
    data.unmanaged = { items: ['movies/Big Buck Bunny'], total: 1, truncated: 0 }
    data.totals = { claimed: 2, managedUnidentified: 1 }
    data.managedUnidentified = {
      items: [
        {
          libraryRelativePath: 'tv/The Wayfinders',
          source: 'sonarr',
          title: 'The Wayfinders',
          year: 2025,
          externalIds: { tvdb: 470313, imdb: 'tt29712397' },
          hasFile: true,
          providerPath: '/processed_tv/The Wayfinders',
          localPin: { tmdbId: 123456, source: 'auto' },
        },
      ],
      total: 1,
      truncated: 0,
    }
    swrStates({
      report: { ...idle, data },
      status: { ...idle, data: { providers: [{ name: 'sonarr', lastFetch: { at: '2026-09-22T05:21:00.028Z', claims: 225, unidentified: 1 } }] } },
    })

    render(<IdentityReport />)

    expect(screen.getByText('Managed, but no TMDB id')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'The Wayfinders' })).toHaveAttribute('href', '/admin/media/tv?q=The%20Wayfinders')
    expect(screen.getByRole('link', { name: 'TVDB 470313' })).toHaveAttribute('href', 'https://www.thetvdb.com/dereferrer/series/470313')
    expect(screen.getByRole('link', { name: 'IMDb tt29712397' })).toHaveAttribute('href', 'https://www.imdb.com/title/tt29712397/')
    expect(screen.getByRole('link', { name: '123456' })).toHaveAttribute('href', 'https://www.themoviedb.org/tv/123456')
    expect(screen.getByText(/Neither Sonarr nor TMDB can confirm this match/)).toBeInTheDocument()
    // It counts toward the headline, and the unmanaged wording stays for the hand-added folder.
    expect(screen.getByText(/1 item needs attention/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Big Buck Bunny' })).toBeInTheDocument()
    // A provider-only row without a TMDB id shows the other ids instead of a dash.
    expect(screen.getByRole('link', { name: 'TVDB 999' })).toHaveAttribute('href', 'https://www.thetvdb.com/dereferrer/series/999')
    // The managers panel says how many titles lack an id.
    expect(screen.getByText(/knows 225 titles, 1 without a TMDB id/)).toBeInTheDocument()
  })

  it('falls back to a spelling match when the catalog has no id for the folder', () => {
    swrStates({ report: { ...idle, data: renamedReport(null) } })

    render(<IdentityReport />)

    expect(screen.getByText(/probably renamed/i)).toHaveTextContent(/on disk as The End\?$/)
    expect(screen.queryByText(/same TMDB id/)).not.toBeInTheDocument()
    expect(screen.getByText(/Radarr knows it as The End!/)).toBeInTheDocument()
  })

  it('says "and N more" when the processor capped a list', () => {
    swrStates({
      report: {
        ...idle,
        data: {
          at: '2026-09-22T12:00:00.000Z',
          totals: { claimed: 0 },
          written: { items: [], total: 0, truncated: 0 },
          conflicts: { items: [], total: 0, truncated: 0 },
          providerOnly: { items: [], total: 0, truncated: 0 },
          unmanaged: { items: ['movies/A'], total: 235, truncated: 234 },
          providerConflicts: { items: [], total: 0, truncated: 0 },
          errors: { items: [], total: 0, truncated: 0 },
        },
      },
    })
    render(<IdentityReport />)
    expect(screen.getByText('1 of 235, and 234 more')).toBeInTheDocument()
  })

  it('names a processor build that predates the endpoints instead of showing "HTTP 404"', () => {
    swrStates({ report: { ...idle, error: new Error('HTTP 404: Not Found') } })
    render(<IdentityReport />)
    expect(screen.getByText(/needs an update before this page can work/i)).toBeInTheDocument()
    expect(screen.getByText(/predates the identity-provider release/i)).toBeInTheDocument()
    expect(screen.queryByText(/HTTP 404/)).not.toBeInTheDocument()
  })

  it('treats an unreachable processor as a restart in progress and offers a retry', () => {
    const mutate = jest.fn()
    swrStates({ report: { ...idle, mutate, error: new Error('Server error (502): Bad Gateway') } })
    render(<IdentityReport />)
    expect(screen.getByText(/is not answering/i)).toBeInTheDocument()
    expect(screen.getByText(/starting up or mid-restart/i)).toBeInTheDocument()
    expect(screen.getByText('Server error (502): Bad Gateway')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(mutate).toHaveBeenCalled()
  })
})

describe('a stale report', () => {
  const { reportAgeMs, formatAge, STALE_AFTER_MS } = require('@components/Admin/Identity/IdentityReport')
  const NOW = Date.parse('2026-09-22T05:30:00.000Z')
  const baseReport = {
    reason: 'scan-tick',
    durationMs: 444,
    totals: { claimed: 1 },
    written: { items: [], total: 0, truncated: 0 },
    conflicts: { items: [], total: 0, truncated: 0 },
    providerOnly: { items: [], total: 0, truncated: 0 },
    unmanaged: { items: [], total: 0, truncated: 0 },
    providerConflicts: { items: [], total: 0, truncated: 0 },
    errors: { items: [], total: 0, truncated: 0 },
  }

  let nowSpy
  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW)
    global.fetch = jest.fn()
  })
  afterEach(() => nowSpy.mockRestore())

  it('measures age off the report timestamp and formats it for a person', () => {
    expect(reportAgeMs({ at: '2026-09-22T05:21:00.000Z' }, NOW)).toBe(9 * 60_000)
    expect(reportAgeMs({ at: 'not a date' }, NOW)).toBeNull()
    expect(reportAgeMs({}, NOW)).toBeNull()
    expect(formatAge(20_000)).toBe('just now')
    expect(formatAge(9 * 60_000)).toBe('9 min ago')
    expect(formatAge(125 * 60_000)).toBe('2 h 5 min ago')
    expect(STALE_AFTER_MS).toBe(5 * 60_000)
  })

  it('shows the age, says the report is stale, and refreshes from the arrs on its own once', async () => {
    // The processor tick that would rebuild this report is nine minutes into an
    // artwork sweep; an admin who just fixed a path in Radarr sees a report
    // that predates the fix. The page must say so and go get a fresh one.
    const fresh = { ...baseReport, at: '2026-09-22T05:30:00.000Z', reason: 'manual' }
    global.fetch.mockResolvedValue({ ok: true, json: async () => fresh })
    const mutate = jest.fn()
    swrStates({ report: { ...idle, mutate, data: { ...baseReport, at: '2026-09-22T05:21:00.000Z' } } })

    render(<IdentityReport />)

    expect(screen.getByTestId('report-age')).toHaveTextContent('(9 min ago)')
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    expect(global.fetch.mock.calls[0][0]).toMatch(/\/identity\/reconcile$/)
    await waitFor(() => expect(mutate).toHaveBeenCalledWith(fresh, { revalidate: false }))
    // Quiet on success: no toast for an automatic refresh, just the banner.
    expect(mockToast.success).not.toHaveBeenCalled()
  })

  it('leaves a fresh report alone', () => {
    swrStates({ report: { ...idle, data: { ...baseReport, at: '2026-09-22T05:28:30.000Z' } } })
    render(<IdentityReport />)
    expect(screen.getByTestId('report-age')).toHaveTextContent('(1 min ago)')
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('does not loop when the refreshed report is still stale', async () => {
    const stillStale = { ...baseReport, at: '2026-09-22T05:21:00.000Z' }
    global.fetch.mockResolvedValue({ ok: true, json: async () => stillStale })
    swrStates({ report: { ...idle, data: stillStale } })

    const { rerender } = render(<IdentityReport />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1))
    rerender(<IdentityReport />)
    rerender(<IdentityReport />)
    expect(global.fetch).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('status')).toHaveTextContent(/9 min ago/)
  })
})

describe('a processor that keeps the report fresh itself', () => {
  // Newer processors run their own reconcile job and publish checkedAt (last
  // look), at (last change) and staleAfterMs (their threshold). The page must
  // trust those and stop triggering reconciles from a page view.
  const { selfRefreshing, staleThresholdMs, reportAgeMs } = require('@components/Admin/Identity/IdentityReport')
  const NOW = Date.parse('2026-09-22T05:30:00.000Z')
  const fresh = {
    at: '2026-09-22T05:21:00.000Z',
    checkedAt: '2026-09-22T05:29:30.000Z',
    checkedReason: 'identity-tick',
    unchanged: true,
    staleAfterMs: 180_000,
    reason: 'scan-tick',
    durationMs: 444,
    totals: { claimed: 1 },
    perType: { movie: { onDisk: 834, claimed: 878, covered: true }, tv: { onDisk: 223, claimed: 225, covered: true } },
    written: { items: [], total: 0, truncated: 0 },
    conflicts: { items: [], total: 0, truncated: 0 },
    providerOnly: { items: [], total: 0, truncated: 0 },
    unmanaged: { items: [], total: 0, truncated: 0 },
    providerConflicts: { items: [], total: 0, truncated: 0 },
    errors: { items: [], total: 0, truncated: 0 },
  }

  let nowSpy
  beforeEach(() => {
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW)
    global.fetch = jest.fn()
  })
  afterEach(() => nowSpy.mockRestore())

  it('reads age from checkedAt and the threshold from staleAfterMs', () => {
    expect(selfRefreshing(fresh)).toBe(true)
    expect(selfRefreshing({ at: fresh.at })).toBe(false)
    expect(staleThresholdMs(fresh)).toBe(180_000)
    expect(staleThresholdMs({ at: fresh.at })).toBe(5 * 60_000)
    expect(reportAgeMs(fresh, NOW)).toBe(30_000)
    expect(reportAgeMs({ at: fresh.at }, NOW)).toBe(9 * 60_000)
  })

  it('shows a recent check with an older last change, and never refreshes on its own', () => {
    swrStates({ report: { ...idle, data: fresh } })
    render(<IdentityReport />)
    const age = screen.getByTestId('report-age')
    expect(age).toHaveTextContent('(just now)')
    expect(age).toHaveTextContent(/by the regular check/)
    expect(age).toHaveTextContent(/nothing has changed since/)
    expect(global.fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('says the regular check may have stopped, instead of reconciling from the page, when checkedAt is old', () => {
    swrStates({ report: { ...idle, data: { ...fresh, checkedAt: '2026-09-22T05:20:00.000Z' } } })
    const { rerender } = render(<IdentityReport />)
    rerender(<IdentityReport />)
    expect(screen.getByTestId('report-age')).toHaveTextContent('(10 min ago)')
    expect(screen.getByRole('status')).toHaveTextContent(/regular check may have stopped/i)
    expect(screen.getByRole('status')).toHaveTextContent(/normally checks every 60 seconds/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('names a media type whose manager did not answer, and keeps it out of "unmanaged"', () => {
    swrStates({
      report: {
        ...idle,
        data: { ...fresh, perType: { ...fresh.perType, movie: { onDisk: 834, claimed: 0, covered: false } } },
      },
    })
    render(<IdentityReport />)
    expect(screen.getByText(/movies were not checked this pass because their manager did not answer/i)).toBeInTheDocument()
  })

  it('reads a webhook-driven check as a notification from that manager', () => {
    swrStates({ report: { ...idle, data: { ...fresh, checkedReason: 'radarr-webhook', unchanged: false } } })
    render(<IdentityReport />)
    expect(screen.getByTestId('report-age')).toHaveTextContent(/after Radarr sent a notification/)
    expect(screen.getByTestId('report-age')).toHaveTextContent(/took 444 ms/)
  })
})

describe('polling while the processor is not ready', () => {
  const { swrOptions } = require('@components/Admin/Identity/IdentityReport')

  it('polls every 10 s while initializing and every minute once a report exists', () => {
    expect(swrOptions.refreshInterval({ enabled: true, pending: true })).toBe(10_000)
    expect(swrOptions.refreshInterval({ totals: {} })).toBe(60_000)
    expect(swrOptions.refreshInterval(undefined)).toBe(60_000)
  })

  it('keeps retrying an unreachable processor every 15 s, forever', () => {
    jest.useFakeTimers()
    try {
      const revalidate = jest.fn()
      swrOptions.onErrorRetry(new Error('Server error (502): Bad Gateway'), 'k', {}, revalidate, { retryCount: 7 })
      expect(revalidate).not.toHaveBeenCalled()
      jest.advanceTimersByTime(15_000)
      expect(revalidate).toHaveBeenCalledWith({ retryCount: 7 })
    } finally {
      jest.useRealTimers()
    }
  })

  it('never retries a processor build that lacks the endpoints', () => {
    jest.useFakeTimers()
    try {
      const revalidate = jest.fn()
      swrOptions.onErrorRetry(new Error('HTTP 404: Not Found'), 'k', {}, revalidate, { retryCount: 0 })
      jest.advanceTimersByTime(60_000)
      expect(revalidate).not.toHaveBeenCalled()
    } finally {
      jest.useRealTimers()
    }
  })
})
