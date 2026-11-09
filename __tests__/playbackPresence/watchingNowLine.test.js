/**
 * The media pages' "watching now" line (plans/media-activity-presence.md,
 * "A user's own sessions"): the viewer's own live sessions on the page's
 * title, show or season, asked for from the client and kept current.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import WatchingNowLine from '@components/WatchingNow/WatchingNowLine'
import { fetchPresence, presenceUrl } from '@components/WatchingNow/useWatchingNow'
import { deviceName, episodeNoun } from '@components/WatchingNow/wording'

// A whole second, so the line's once-a-second clock reads exactly this
const CLIENT_NOW = Date.parse('2026-11-09T20:00:00.000Z')
// The server's clock runs five minutes ahead of this browser's
const SERVER_NOW = CLIENT_NOW + 5 * 60_000

const TV = { type: 'tv', label: 'TV', platform: 'Android' }
const CHROME = { type: 'desktop', label: 'Chrome · Desktop', platform: 'Windows' }

function session(overrides = {}) {
  return {
    id: 'row-1',
    sessionId: 'tv-session',
    mediaId: 'mid:film',
    normalizedVideoId: 'nid-film',
    mediaType: 'movie',
    showId: null,
    seasonNumber: null,
    episodeNumber: null,
    state: 'playing',
    // 10 s before the server's now: 41:02 then, 41:12 now
    position: 2462,
    positionAt: new Date(SERVER_NOW - 10_000).toISOString(),
    device: TV,
    lastHeartbeat: new Date(SERVER_NOW - 10_000).toISOString(),
    staleAfter: new Date(SERVER_NOW + 50_000).toISOString(),
    ...overrides,
  }
}

function answer(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body }
}

function renderLine(props) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, focusThrottleInterval: 0 }}>
      <WatchingNowLine {...props} />
    </SWRConfig>
  )
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(CLIENT_NOW)
  global.fetch = jest.fn(async () => answer({ sessions: [], asOf: new Date(SERVER_NOW).toISOString() }))
})

afterEach(() => {
  jest.restoreAllMocks()
  delete global.fetch
})

function serve(sessions) {
  global.fetch.mockImplementation(async () => answer({ sessions, asOf: new Date(SERVER_NOW).toISOString() }))
}

describe('on a movie or an episode page', () => {
  it('says what is playing where, with the position now by the server’s clock', async () => {
    serve([session()])
    renderLine({ mediaId: 'mid:film', normalizedVideoId: 'nid-film' })

    const line = await screen.findByRole('list', { name: 'Watching now' })
    // By this browser's clock, five minutes behind, it would read 41:02: the
    // position was written in what this browser takes for the future
    expect(line).toHaveTextContent('Playing on TV · 41:12')
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/authenticated/presence?mediaId=mid%3Afilm&normalizedVideoId=nid-film',
      expect.objectContaining({ cache: 'no-store', credentials: 'include' })
    )
  })

  it('a paused session stays where it stopped', async () => {
    serve([session({ state: 'paused', position: 723, device: CHROME })])
    renderLine({ mediaId: 'mid:film' })
    expect(await screen.findByRole('list', { name: 'Watching now' })).toHaveTextContent('Paused on Chrome · Desktop · 12:03')
  })

  it('one line per device, playing first as the server ranked them, and at most three', async () => {
    serve([
      session(),
      session({ id: 'row-2', state: 'paused', position: 60, device: CHROME }),
      session({ id: 'row-3', state: 'paused', position: 0, device: { type: 'cast', label: 'Cast', platform: 'Cast' } }),
      session({ id: 'row-4', state: 'paused', device: { type: null, label: 'Unknown', platform: '' } }),
    ])
    renderLine({ mediaId: 'mid:film' })

    const line = await screen.findByRole('list', { name: 'Watching now' })
    const items = line.querySelectorAll('li')
    expect([...items].map((li) => li.textContent)).toEqual([
      'Playing on TV · 41:12',
      'Paused on Chrome · Desktop · 1:00',
      // No position yet: no clock
      'Paused on a Cast device',
      'and 1 more',
    ])
  })

  it('shows nothing when nothing is live', async () => {
    renderLine({ mediaId: 'mid:film' })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('list', { name: 'Watching now' })).toBeNull()
  })

  it('shows nothing when the read failed', async () => {
    global.fetch.mockImplementation(async () => answer({ error: 'Failed to read live sessions' }, 500))
    renderLine({ mediaId: 'mid:film' })
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.queryByRole('list', { name: 'Watching now' })).toBeNull()
  })

  it('a later failed read hides the earlier answer, rather than keep saying "Playing"', async () => {
    serve([session()])
    renderLine({ mediaId: 'mid:film' })
    await screen.findByRole('list', { name: 'Watching now' })

    global.fetch.mockImplementation(async () => answer({ error: 'Failed to read live sessions' }, 500))
    // Coming back to the tab asks again (SWR throttles that by the clock)
    Date.now.mockReturnValue(CLIENT_NOW + 1000)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Watching now' })).toBeNull())
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('asks nothing when the page names no title', () => {
    renderLine({})
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('on a show or a season page', () => {
  const show = { originalTitle: 'The Show (2019)', showTitle: 'The Show' }
  const episode = { showId: '64b000000000000000000001', mediaType: 'tv', seasonNumber: 2, episodeNumber: 7, mediaId: 'mid:s02e07' }

  it('a show page names the episode and links to it', async () => {
    serve([session(episode)])
    renderLine({ showId: episode.showId, show })

    const line = await screen.findByRole('list', { name: 'Watching now' })
    expect(line).toHaveTextContent('Playing S2 · E7 on TV · 41:12')
    expect(screen.getByRole('link', { name: 'S2 · E7' })).toHaveAttribute('href', '/list/tv/The%20Show%20(2019)/2/7')
    expect(global.fetch.mock.calls[0][0]).toBe('/api/authenticated/presence?showId=64b000000000000000000001')
  })

  it('a season page names it by number', async () => {
    serve([session({ ...episode, state: 'paused' })])
    renderLine({ showId: episode.showId, seasonNumber: 2, show })

    expect(await screen.findByRole('list', { name: 'Watching now' })).toHaveTextContent('Paused Episode 7 on TV · 41:02')
    expect(screen.getByRole('link', { name: 'Episode 7' })).toHaveAttribute('href', '/list/tv/The%20Show%20(2019)/2/7')
    expect(global.fetch.mock.calls[0][0]).toBe('/api/authenticated/presence?showId=64b000000000000000000001&season=2')
  })

  it('Specials are season 0', async () => {
    serve([session({ ...episode, seasonNumber: 0, episodeNumber: 3 })])
    renderLine({ showId: episode.showId, show })
    expect(await screen.findByRole('link', { name: 'Specials · E3' })).toHaveAttribute('href', '/list/tv/The%20Show%20(2019)/0/3')
  })
})

describe('the parts', () => {
  it('names the device after "on"', () => {
    expect(deviceName(TV)).toBe('TV')
    expect(deviceName(CHROME)).toBe('Chrome · Desktop')
    expect(deviceName({ type: 'cast', label: 'Cast' })).toBe('a Cast device')
    expect(deviceName({ type: null, label: 'Unknown' })).toBe('another device')
    expect(deviceName(null)).toBe('another device')
  })

  it('names the episode only on a show or a season page, and only when the catalog placed it', () => {
    const placed = { seasonNumber: 2, episodeNumber: 7 }
    expect(episodeNoun(placed, 'title')).toBeNull()
    expect(episodeNoun(placed, 'show')).toBe('S2 · E7')
    expect(episodeNoun(placed, 'season')).toBe('Episode 7')
    expect(episodeNoun({ seasonNumber: null, episodeNumber: 7 }, 'show')).toBeNull()
    expect(episodeNoun({ seasonNumber: 2, episodeNumber: null }, 'season')).toBeNull()
  })

  it('builds the endpoint’s URL from what the page names', () => {
    expect(presenceUrl({ mediaId: 'mid:a', normalizedVideoId: 'n1' })).toBe('/api/authenticated/presence?mediaId=mid%3Aa&normalizedVideoId=n1')
    expect(presenceUrl({ normalizedVideoId: 'n1' })).toBe('/api/authenticated/presence?normalizedVideoId=n1')
    expect(presenceUrl({ showId: 'abc', seasonNumber: 0 })).toBe('/api/authenticated/presence?showId=abc&season=0')
    // A show filter is never mixed with a title filter (the endpoint refuses it)
    expect(presenceUrl({ showId: 'abc', mediaId: 'mid:a' })).toBe('/api/authenticated/presence?showId=abc')
    expect(presenceUrl({})).toBeNull()
  })

  it('a refusal is an answer that stops the polling; any other failure is an error', async () => {
    global.fetch.mockResolvedValueOnce(answer({ error: 'Unauthorized' }, 401))
    await expect(fetchPresence('/x')).resolves.toEqual({ sessions: [], offsetMs: 0, refused: true })
    global.fetch.mockResolvedValueOnce(answer({}, 502))
    await expect(fetchPresence('/x')).rejects.toThrow('502')
  })

  it('measures the server’s clock against this one', async () => {
    serve([])
    await expect(fetchPresence('/x')).resolves.toEqual({ sessions: [], offsetMs: 5 * 60_000, refused: false })
  })
})
