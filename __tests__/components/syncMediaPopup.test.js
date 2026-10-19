/**
 * The admin's manual sync popup against a fake sync route and event stream:
 * what it says before the sync, the report it shows when the sync it started
 * completes (per server counts, the skipped ones explained, failures, the
 * titles not in the library and those with no video file yet), and that only
 * the completion of its own sync operation (the route's operationId) ends its
 * wait: never a webhook tick's, live or replayed.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import SyncMediaPopup from '@src/components/Admin/SyncMediaPopup'

const START = '2026-10-19T12:00:00.000Z'
const at = (seconds) => new Date(Date.parse(START) + seconds * 1000).toISOString()
/** The operation the popup's POST starts, and a webhook tick's. */
const OP = 'op-admin'
const TICK = 'op-tick'

/** The EventSources the popup opens; a case pushes events through them. */
let streams = []
class FakeEventSource {
  constructor(url) {
    this.url = url
    this.closed = false
    streams.push(this)
  }
  close() {
    this.closed = true
  }
}

const send = async (payload) => {
  const stream = streams[streams.length - 1]
  await act(async () => {
    stream.onmessage({ data: JSON.stringify(payload) })
  })
}

const summary = (overrides = {}) => ({
  syncRunId: 'run-1',
  missingMedia: { default: { movies: [], tv: [] } },
  noVideo: { default: { movies: [], tv: [] } },
  titleCounts: { default: { checked: 1086, updated: 3, unchanged: 1083, failed: 0, failures: [] } },
  errors: [],
  duration: 9.85,
  ...overrides,
})

const completion = (data, { operationId = OP, replayed = false, outcome = 'completed', timestamp = at(10), error } = {}) => ({
  type: 'complete',
  entityId: '__sync_complete__',
  serverId: 'server-all',
  timestamp,
  ...(replayed ? { replayed: true } : {}),
  data: { summary: data, operationId, outcome, ...(error ? { error } : {}) },
})

const warmup = (operationId = OP, { replayed = false } = {}) => ({
  type: 'started',
  entityId: '__sync_warmup__',
  serverId: 'server-all',
  timestamp: at(1),
  ...(replayed ? { replayed: true } : {}),
  data: { operationId },
})

const serverEvents = async (serverId = 'default', operationId = OP) => {
  await send(warmup(operationId))
  await send({ type: 'started', entityId: '__server_start__', serverId, timestamp: at(1), data: { total: 1086 } })
  await send({ type: 'complete', entityId: '__server_complete__', serverId, timestamp: at(9) })
}

const updateProcessedData = jest.fn()
const setLastSync = jest.fn()

function renderPopup() {
  return render(
    <SyncMediaPopup isOpen setIsOpen={jest.fn()} updateProcessedData={updateProcessedData} setLastSync={setLastSync} />
  )
}

async function startSync({ force = false } = {}) {
  renderPopup()
  if (force) fireEvent.click(screen.getByRole('checkbox', { name: /force refresh/i }))
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
  })
  await waitFor(() => expect(streams).toHaveLength(1))
}

/** The route's answers: the POST and sync-status. */
let postAnswer
let statusAnswer
beforeEach(() => {
  streams = []
  updateProcessedData.mockClear()
  setLastSync.mockClear()
  postAnswer = { started: true, operationId: OP, startTime: START, streamUrl: '/api/authenticated/admin/sync-stream' }
  statusAnswer = { active: false, operationId: null, startTime: null, streamUrl: null, snapshot: null }
  global.EventSource = FakeEventSource
  global.fetch = jest.fn(async (url, options = {}) => {
    if (url === '/api/authenticated/admin/sync' && options.method === 'POST') return { json: async () => postAnswer }
    if (url === '/api/authenticated/admin/sync-status') return { json: async () => statusAnswer }
    throw new Error(`unexpected fetch ${url}`)
  })
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  delete global.EventSource
  jest.restoreAllMocks()
})

describe('before the sync', () => {
  it('says what a sync does and how long it takes', () => {
    renderPopup()
    expect(
      screen.getByText(
        'Checks every title on each file server and updates anything that changed. This usually takes about 10 seconds.'
      )
    ).toBeInTheDocument()
  })

  it('says a forced sync passes every title in full, ignoring the sync gates', () => {
    renderPopup()
    const option = screen.getByRole('checkbox', { name: /force refresh/i })
    expect(option.closest('label')).toHaveTextContent(
      "Passes every title in full, ignoring each server's sync gates (the check that skips a title when nothing on the server changed)."
    )
    expect(option.closest('label')).not.toHaveTextContent(/hash/i)
  })
})

describe('the report of the sync the popup started', () => {
  it('counts each server’s titles, with thousands separators, and explains the unchanged ones', async () => {
    await startSync()
    await serverEvents()
    await send(completion(summary()))

    expect(screen.getByRole('heading', { name: 'default', level: 4 })).toBeInTheDocument()
    expect(screen.getByText('Done', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText(/1,086 titles checked: 3 updated, 1,083 unchanged,/)).toBeInTheDocument()
    expect(screen.getByText('0 failed')).toBeInTheDocument()
    expect(
      screen.getByText('Unchanged titles were skipped: nothing on the server changed since the last sync.')
    ).toBeInTheDocument()
    expect(screen.queryByText(/synced/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()
    expect(updateProcessedData).toHaveBeenCalledTimes(1)
  })

  it('says unchanged titles were checked in full after a forced sync', async () => {
    await startSync({ force: true })
    expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({ forceSync: true })
    await serverEvents()
    await send(completion(summary()))

    expect(screen.getByText('Unchanged titles were checked in full and needed no update.')).toBeInTheDocument()
  })

  it('lists each failed title with its error, truncated, and says the server finished with failures', async () => {
    const error = `episode metadata fetch failed: ${'x'.repeat(300)}`
    await startSync()
    await serverEvents()
    await send(
      completion(
        summary({
          titleCounts: {
            default: {
              checked: 2,
              updated: 0,
              unchanged: 1,
              failed: 1,
              failures: [{ kind: 'tv', title: 'Broken Show (2019)', error }],
            },
          },
        })
      )
    )

    expect(screen.getByText('Done, with failures', { selector: 'span' })).toBeInTheDocument()
    expect(screen.getByText('1 failed')).toHaveClass('text-red-700')
    const failed = screen.getByRole('heading', { name: 'Failed titles', level: 5 })
    const item = within(failed.parentElement).getByRole('listitem')
    expect(item).toHaveTextContent('Broken Show (2019):')
    expect(item.textContent.length).toBeLessThan(200)
    expect(item.textContent.endsWith('…')).toBe(true)
  })

  it('shows the titles a server has that are not in the library as a problem the next sync retries', async () => {
    await startSync()
    await serverEvents()
    await send(
      completion(
        summary({
          missingMedia: {
            default: { movies: ['Lost Write (2020)'], tv: [{ showTitle: 'Lost Show (2018)', seasons: [] }] },
          },
        })
      )
    )

    const heading = screen.getByRole('heading', { name: 'On default but not in the library', level: 4 })
    const section = heading.closest('section')
    expect(section).toHaveClass('bg-red-50')
    expect(within(section).getByText('The sync could not save these titles. The next sync retries these.')).toBeInTheDocument()
    expect(within(section).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Lost Write (2020)',
      'Lost Show (2018)',
    ])
  })

  it('shows the titles with no video file yet, with their reasons, as information', async () => {
    await startSync()
    await serverEvents()
    await send(
      completion(
        summary({
          noVideo: {
            default: {
              movies: [
                { title: 'Not Yet (2024)', reason: 'no video file' },
                { title: 'Old Rip (1999)', reason: 'unsupported format (.avi)' },
              ],
              tv: [
                { title: 'Some Show (2010)', season: 'Season 2', reason: 'no video file' },
                { title: 'Empty Show (2011)', season: null, reason: 'no video file' },
              ],
            },
          },
        })
      )
    )

    const heading = screen.getByRole('heading', { name: 'No video file yet on default', level: 4 })
    const section = heading.closest('section')
    expect(section).toHaveClass('bg-gray-50')
    expect(
      within(section).getByText(
        'These folders have artwork and metadata but no playable video. They stay out of the library’s lists and search until a video arrives.'.replace('’', "'")
      )
    ).toBeInTheDocument()
    expect(within(section).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Not Yet (2024): no video file',
      'Old Rip (1999): unsupported format (.avi)',
      'Some Show (2010), Season 2: no video file',
      'Empty Show (2011): no video file',
    ])
    expect(screen.queryByText(/mp4/i)).not.toBeInTheDocument()
  })
})

describe('the titles that can’t play yet', () => {
  const cantPlay = {
    default: {
      movies: [{ title: 'Old Rip (1999)', reason: 'unsupported format (.avi)' }],
      tv: [
        {
          title: 'Old Show (1995)',
          season: 1,
          episodes: [
            { episode: 1, reason: 'unsupported format (.avi)' },
            { episode: 3, reason: 'unsupported format (.avi)' },
          ],
        },
      ],
      count: 98,
    },
  }
  const noVideo = {
    default: {
      movies: [{ title: 'Not Yet (2024)', reason: 'no video file' }],
      tv: [
        { title: 'Some Show (2010)', season: 'Season 2', reason: 'no video file' },
        { title: 'Some Show (2010)', season: null, reason: 'no video file' },
      ],
    },
  }

  it('are listed by server, as information, movies and then episodes by season', async () => {
    await startSync()
    await serverEvents()
    await send(completion(summary({ cantPlay, noVideo })))

    const heading = screen.getByRole('heading', { name: "Can't play yet on default", level: 4 })
    const section = heading.closest('section')
    expect(section).toHaveAttribute('id', 'sync-cant-play-default')
    expect(section).toHaveClass('bg-gray-50')
    expect(
      within(section).getByText(
        "These titles have a video the player can't play and the transcoder doesn't serve yet, so they're hidden from the library. Each one says why."
      )
    ).toBeInTheDocument()
    expect(within(section).getByText('Old Rip (1999)').closest('li')).toHaveTextContent('Old Rip (1999): unsupported format (.avi)')
    const season = within(section).getByText('Old Show (1995), Season 1').closest('li')
    expect(within(season).getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Episode 1: unsupported format (.avi)',
      'Episode 3: unsupported format (.avi)',
    ])
  })

  it('are counted on the server card, as a link to the section; so are the titles with no video file yet', async () => {
    await startSync()
    await serverEvents()
    await send(completion(summary({ cantPlay, noVideo })))

    const cantPlayLink = screen.getByRole('link', { name: "98 can't play yet" })
    expect(cantPlayLink).toHaveAttribute('href', '#sync-cant-play-default')
    expect(document.getElementById('sync-cant-play-default')).not.toBeNull()
    // Two titles: a movie, and a show listed for itself and one season
    const noVideoLink = screen.getByRole('link', { name: '2 with no video file yet' })
    expect(noVideoLink).toHaveAttribute('href', '#sync-no-video-default')
    expect(document.getElementById('sync-no-video-default')).toHaveTextContent('No video file yet on default')

    const scrollIntoView = jest.fn()
    document.getElementById('sync-cant-play-default').scrollIntoView = scrollIntoView
    fireEvent.click(cantPlayLink)
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
  })

  it('shows no link when a server has nothing in either section', async () => {
    await startSync()
    await serverEvents()
    await send(completion(summary()))

    expect(screen.queryByRole('link', { name: /can't play yet|no video file yet/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /Can't play yet/ })).not.toBeInTheDocument()
  })
})

describe('a completion that is not the sync the popup started', () => {
  const webhookTick = summary({
    titleCounts: { default: { checked: 2, updated: 1, unchanged: 1, failed: 0, failures: [] } },
    noVideo: { default: { movies: [{ title: 'Only In The Tick (2001)', reason: 'no video file' }], tv: [] } },
  })

  it('follows its own operation: the stream is asked for it by id', async () => {
    await startSync()
    expect(streams[0].url).toBe(`/api/authenticated/admin/sync-stream?operationId=${OP}`)
    // (Finished, so no transition is left pending: React entangles them)
    await send(completion(summary()))
  })

  it('is ignored when the stream replays an earlier webhook tick’s warm-up, progress and completion', async () => {
    await startSync()
    await send(warmup(TICK, { replayed: true }))
    await send({ type: 'started', entityId: '__server_start__', serverId: 'tick-server', replayed: true, data: { total: 2 } })
    await send(completion(webhookTick, { operationId: TICK, replayed: true }))

    expect(screen.getByRole('button', { name: 'Syncing...' })).toBeInTheDocument()
    expect(screen.queryByText('tick-server')).not.toBeInTheDocument()
    expect(updateProcessedData).not.toHaveBeenCalled()

    await serverEvents()
    await send(completion(summary()))

    expect(screen.getByText(/1,086 titles checked/)).toBeInTheDocument()
    expect(screen.queryByText(/2 titles checked/)).not.toBeInTheDocument()
    expect(screen.queryByText('Only In The Tick (2001): no video file')).not.toBeInTheDocument()
    expect(updateProcessedData).toHaveBeenCalledTimes(1)
  })

  it('is ignored when a webhook tick’s completion arrives live, whatever its time', async () => {
    await startSync()
    await send(completion(webhookTick, { operationId: TICK, timestamp: at(30) }))

    expect(screen.getByRole('button', { name: 'Syncing...' })).toBeInTheDocument()
    expect(streams[0].closed).toBe(false)

    await send(completion(summary()))
    expect(screen.getByText(/1,086 titles checked/)).toBeInTheDocument()
    expect(streams[0].closed).toBe(true)
  })

  it('leaves the shown report alone when another completion arrives after it', async () => {
    await startSync()
    await serverEvents()
    await send(completion(summary()))
    expect(streams[0].closed).toBe(true)
    await send(completion(webhookTick, { operationId: OP, timestamp: at(30) }))

    expect(screen.getByText(/1,086 titles checked/)).toBeInTheDocument()
    expect(screen.queryByText(/2 titles checked/)).not.toBeInTheDocument()
  })

  it('cannot end the wait of a sync that never ran: its own completion says another sync is still finishing', async () => {
    await startSync()
    // The orchestration lock is still held by the last run's cleanup: the
    // run ends at once with an id-stamped completion of its own
    await send(completion({ skipped: true, reason: 'orchestration_in_progress' }, { outcome: 'busy' }))

    expect(screen.getByText('Another sync is still finishing; try again in a moment.', { selector: 'p:not([role="status"])' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sync' })).toBeInTheDocument()
    expect(streams[0].closed).toBe(true)
    // The next tick's completion reaches nothing
    await send(completion(webhookTick, { operationId: TICK }))
    expect(screen.queryByText(/2 titles checked/)).not.toBeInTheDocument()
    expect(updateProcessedData).not.toHaveBeenCalled()
  })

  it('cannot end the wait of a sync that threw: its own completion says it failed', async () => {
    await startSync()
    await send(completion(null, { outcome: 'failed', error: 'sync pool unavailable' }))

    expect(screen.getByText('Sync encountered an error: sync pool unavailable', { selector: 'p:not([role="status"])' })).toBeInTheDocument()
    expect(streams[0].closed).toBe(true)
    await send(completion(webhookTick, { operationId: TICK }))
    expect(screen.queryByText(/2 titles checked/)).not.toBeInTheDocument()
  })

  it('takes the joined sync’s replayed completion when it ended before sync-status answered', async () => {
    // The POST joins a running sync, which ends before sync-status answers
    postAnswer = { alreadyRunning: true, operationId: 'op-running', startTime: START, streamUrl: '/api/authenticated/admin/sync-stream' }
    statusAnswer = { active: false, operationId: null, startTime: null, streamUrl: null, snapshot: null }
    await startSync()
    expect(streams[0].url).toBe('/api/authenticated/admin/sync-stream?operationId=op-running')

    // A later tick's completion, then the joined sync's, replayed
    await send(completion(webhookTick, { operationId: TICK }))
    expect(screen.getByRole('button', { name: 'Syncing...' })).toBeInTheDocument()
    await send(completion(summary(), { operationId: 'op-running', replayed: true }))

    expect(screen.getByText(/1,086 titles checked/)).toBeInTheDocument()
    expect(screen.queryByText(/2 titles checked/)).not.toBeInTheDocument()
  })
})

describe('for assistive technology', () => {
  it('says in a polite live region when the report replaces "Syncing..."', async () => {
    renderPopup()
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync' }))
    })
    await waitFor(() => expect(streams).toHaveLength(1))
    expect(status).toHaveTextContent('Syncing…')

    await serverEvents()
    await send(completion(summary()))
    expect(status).toHaveTextContent('Sync finished. The report is below.')
  })

  it('moves focus to the section a card’s link jumps to', async () => {
    await startSync()
    await serverEvents()
    await send(
      completion(
        summary({ missingMedia: { default: { movies: ['Lost Write (2020)'], tv: [] } } })
      )
    )

    const link = screen.getByRole('link', { name: '1 not in the library' })
    expect(link).toHaveAttribute('href', '#sync-not-in-library-default')
    const section = document.getElementById('sync-not-in-library-default')
    expect(section).toHaveAttribute('tabindex', '-1')
    fireEvent.click(link)
    expect(section).toHaveFocus()
  })

  it('says whether the live error list is open, and hides the arrow from screen readers', async () => {
    await startSync()
    await send(warmup())
    await send({ type: 'started', entityId: '__server_start__', serverId: 'default', data: { total: 2 } })
    await send({ type: 'error', entityId: 'Broken (2001)', serverId: 'default', mediaType: 'movie', error: 'metadata fetch failed' })

    const toggle = screen.getByRole('button', { name: '1 error' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle.querySelector('[aria-hidden="true"]')).toHaveTextContent('▼')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(toggle.getAttribute('aria-controls'))).toHaveTextContent('metadata fetch failed')

    // (Finished, so no transition is left pending)
    await send(completion(summary()))
  })
})
