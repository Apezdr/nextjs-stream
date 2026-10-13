/**
 * The admin Radarr/Sonarr dialog against a fake API: what it shows for each
 * state the routes answer, and exactly what it sends. fetch is the only
 * boundary; the dialog itself is real (Headless UI included).
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import ArrDialog from '@src/components/Arr/ArrDialog'

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() } }))
const { toast } = require('react-toastify')

const API = '/api/authenticated/arr/titles'

const radarrOptions = {
  qualityProfiles: [
    { id: 1, name: 'Any' },
    { id: 4, name: 'HD-1080p' },
    { id: 5, name: 'Ultra-HD - 1080p' },
  ],
  rootFolders: [{ path: '/processed_movies', accessible: true, freeSpaceBytes: 2.5 * 1024 ** 4 }],
  defaultQualityProfileId: 4,
}
const sonarrOptions = {
  qualityProfiles: [{ id: 8, name: 'Ultra-HD - 1080p - with Upgrades' }],
  rootFolders: [{ path: '/processed_tv', accessible: true, freeSpaceBytes: null }],
  defaultQualityProfileId: 8,
}
const absentMovie = {
  state: 'absent',
  service: 'radarr',
  candidate: { title: 'Star Wars', year: 1977, folder: 'Star Wars', released: true, seasons: [] },
  options: radarrOptions,
  catalog: { inLibrary: false, folderTakenBy: null },
  rootFolderPath: '/processed_movies',
}
const absentShow = {
  state: 'absent',
  service: 'sonarr',
  candidate: {
    title: 'The Wire',
    year: 2002,
    folder: 'The Wire',
    released: true,
    seasons: [0, 1, 2].map((seasonNumber) => ({
      seasonNumber,
      monitored: seasonNumber > 0,
      episodeFileCount: null,
      episodeCount: null,
    })),
  },
  options: sonarrOptions,
  catalog: { inLibrary: false, folderTakenBy: null },
  rootFolderPath: '/processed_tv',
}
const movie = { mediaType: 'movie', tmdbId: 11, title: 'Star Wars' }
const show = { mediaType: 'tv', tmdbId: 1438, title: 'The Wire' }

/** fetch answers by "METHOD path": a body, a [status, body] pair, or a function of the request options. */
function fakeApi(routes) {
  global.fetch = jest.fn(async (url, options = {}) => {
    const key = `${options.method ?? 'GET'} ${new URL(url, 'http://localhost').pathname}`
    if (!(key in routes)) throw new Error(`unexpected request ${key}`)
    const answer = routes[key]
    const [status, body] = Array.isArray(answer) ? answer : [200, answer]
    const resolved = typeof body === 'function' ? body(options) : body
    return { ok: status < 400, status, json: async () => resolved }
  })
}

const sent = (key) =>
  global.fetch.mock.calls
    .filter(([url, options = {}]) => `${options.method ?? 'GET'} ${new URL(url, 'http://localhost').pathname}` === key)
    .map(([, options]) => JSON.parse(options.body))

const click = (element) => act(() => fireEvent.click(element))

beforeAll(() => {
  // Headless UI's Dialog watches its panel's size.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  try {
    window.localStorage.clear()
  } catch {
    // Opaque-origin jsdom: the dialog's own try/catch covers it too.
  }
})

test('a movie Radarr lacks: the form starts on the library’s usual profile and Radarr’s folder, and sends exactly that', async () => {
  fakeApi({
    [`GET ${API}/movie/11`]: absentMovie,
    [`POST ${API}/movie/11`]: [201, { service: 'radarr', entry: { id: 900 }, inLibrary: false, next: null, comingSoon: true }],
  })
  const onClose = jest.fn()
  const onChanged = jest.fn()
  render(<ArrDialog item={movie} onClose={onClose} onChanged={onChanged} />)

  expect(await screen.findByLabelText('Quality profile')).toHaveValue('4')
  expect(screen.getByLabelText('Folder')).toHaveValue('Star Wars')
  expect(screen.getByText(/2\.5 TB free/)).toBeInTheDocument()
  expect(screen.getByText('Everyone with this on a watchlist will see it as Coming Soon.')).toBeInTheDocument()
  // The display title travels along, for Sonarr's sake on shows.
  expect(global.fetch.mock.calls[0][0]).toBe(`${API}/movie/11?title=Star%20Wars`)

  await click(screen.getByRole('button', { name: 'Add to Radarr' }))

  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(sent(`POST ${API}/movie/11`)).toEqual([
    { qualityProfileId: 4, rootFolderPath: '/processed_movies', folder: 'Star Wars', search: true, minimumAvailability: 'released' },
  ])
  expect(onChanged).toHaveBeenCalled()
  expect(toast.success).toHaveBeenCalledWith('Added to Radarr. Searching now.')
})

test('a folder another title lives in blocks the add until the name changes', async () => {
  fakeApi({
    [`GET ${API}/movie/11`]: { ...absentMovie, catalog: { inLibrary: false, folderTakenBy: { title: 'Star Wars (Holiday Special)' } } },
  })
  render(<ArrDialog item={movie} onClose={jest.fn()} />)

  const add = await screen.findByRole('button', { name: 'Add to Radarr' })
  expect(add).toBeDisabled()
  expect(screen.getByText(/already lives in this folder.*“Star Wars \(1977\)”/)).toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'Star Wars (1977)' } })
  expect(add).toBeEnabled()

  fireEvent.change(screen.getByLabelText('Folder'), { target: { value: 'Star Wars?' } })
  expect(add).toBeDisabled()
  expect(screen.getByText(/can’t contain/)).toBeInTheDocument()
})

test('a refusal from the server is shown in the form, which stays open', async () => {
  fakeApi({
    [`GET ${API}/movie/11`]: absentMovie,
    [`POST ${API}/movie/11`]: [409, { error: 'folder_taken', message: '“X” already lives in the folder “Star Wars”. Choose a different folder name.' }],
  })
  const onClose = jest.fn()
  render(<ArrDialog item={movie} onClose={onClose} />)

  await click(await screen.findByRole('button', { name: 'Add to Radarr' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Choose a different folder name.')
  expect(onClose).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Add to Radarr' })).toBeEnabled()
})

test('a show by seasons: only the chosen seasons are sent', async () => {
  fakeApi({
    [`GET ${API}/tv/1438`]: absentShow,
    [`POST ${API}/tv/1438`]: [201, { service: 'sonarr', entry: { id: 7 }, inLibrary: false, next: null, comingSoon: true }],
  })
  const onClose = jest.fn()
  render(<ArrDialog item={show} onClose={onClose} />)

  await click(await screen.findByRole('radio', { name: /Choose seasons/ }))
  const add = screen.getByRole('button', { name: 'Add to Sonarr' })
  expect(add).toBeDisabled()
  // Specials come last.
  const seasonNames = screen.getAllByRole('checkbox').map((box) => box.closest('label').textContent)
  expect(seasonNames.slice(0, 3)).toEqual(['Season 1', 'Season 2', 'Specials'])

  await click(screen.getByRole('checkbox', { name: 'Season 2' }))
  await click(add)

  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(sent(`POST ${API}/tv/1438`)).toEqual([
    { qualityProfileId: 8, rootFolderPath: '/processed_tv', folder: 'The Wire', search: true, scope: { type: 'seasons', seasons: [2] } },
  ])
})

test('a show by episodes: added first, then picked from Sonarr’s list and searched', async () => {
  fakeApi({
    [`GET ${API}/tv/1438`]: absentShow,
    [`POST ${API}/tv/1438`]: [201, { service: 'sonarr', entry: { id: 7 }, inLibrary: false, next: 'choose_episodes', comingSoon: true }],
    [`GET ${API}/tv/1438/episodes`]: {
      seriesId: 7,
      ready: true,
      episodes: [
        { id: 201, seasonNumber: 1, episodeNumber: 1, title: 'The Target', airDate: '2002-06-02', hasFile: false, monitored: false },
        { id: 202, seasonNumber: 1, episodeNumber: 2, title: 'The Detail', airDate: '2002-06-09', hasFile: false, monitored: false },
      ],
    },
    [`POST ${API}/tv/1438/search`]: [202, { service: 'sonarr', episodes: 1 }],
  })
  const onClose = jest.fn()
  render(<ArrDialog item={show} onClose={onClose} />)

  await click(await screen.findByRole('radio', { name: /Choose episodes/ }))
  // Searching waits for the pick, so the option is not offered.
  expect(screen.queryByRole('checkbox', { name: /Search now/ })).not.toBeInTheDocument()
  await click(screen.getByRole('button', { name: 'Add, then pick episodes' }))

  await click(await screen.findByRole('checkbox', { name: /The Target/ }))
  await click(screen.getByRole('button', { name: 'Get 1 episode' }))

  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(sent(`POST ${API}/tv/1438`)[0]).toMatchObject({ search: false, scope: { type: 'episodes' } })
  expect(sent(`POST ${API}/tv/1438/search`)).toEqual([{ scope: { type: 'episodes', episodeIds: [201] } }])
  expect(toast.success).toHaveBeenCalledWith('Sonarr is searching for 1 episode now.')
})

test('the episode picker waits while Sonarr is still refreshing a just-added show', async () => {
  fakeApi({
    [`GET ${API}/tv/1438`]: { ...absentShow, state: 'present', entry: { id: 7, title: 'The Wire', monitored: true, qualityProfileId: 8, path: '/processed_tv/The Wire', hasFile: false, released: true, episodeFileCount: 0, episodeCount: 0, seasons: [] }, download: null },
    [`GET ${API}/tv/1438/episodes`]: { seriesId: 7, ready: false, episodes: [] },
  })
  render(<ArrDialog item={show} onClose={jest.fn()} />)

  await click(await screen.findByRole('radio', { name: /Choose episodes/ }))

  expect(await screen.findByText('Sonarr is still loading this show’s episodes…')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /episode/ })).not.toBeInTheDocument()
})

test('a movie Radarr has: where it stands, a profile change, and a search', async () => {
  fakeApi({
    [`GET ${API}/movie/11`]: {
      state: 'present',
      service: 'radarr',
      entry: { id: 186, title: 'Star Wars', monitored: true, qualityProfileId: 4, path: '/processed_movies/Star Wars', hasFile: false, released: true, episodeFileCount: null, episodeCount: null, seasons: [] },
      options: radarrOptions,
      download: { progress: 42, timeLeftSeconds: 1500, records: 1 },
    },
    [`PATCH ${API}/movie/11`]: { service: 'radarr', entry: { id: 186, qualityProfileId: 5 } },
    [`POST ${API}/movie/11/search`]: [202, { service: 'radarr', episodes: null }],
  })
  const onClose = jest.fn()
  const onChanged = jest.fn()
  render(<ArrDialog item={movie} onClose={onClose} onChanged={onChanged} />)

  expect(await screen.findByText('Downloading: 42%, about 25 min left.')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument()

  fireEvent.change(screen.getByLabelText('Quality profile'), { target: { value: '5' } })
  await click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument())
  expect(sent(`PATCH ${API}/movie/11`)).toEqual([{ qualityProfileId: 5 }])

  await click(screen.getByRole('button', { name: 'Search now' }))
  await waitFor(() => expect(onClose).toHaveBeenCalled())
  expect(sent(`POST ${API}/movie/11/search`)).toEqual([{ scope: { type: 'all' } }])
  expect(onChanged).toHaveBeenCalledTimes(2)
})

test('a service that isn’t set up, or doesn’t answer, says so plainly; the latter can be retried', async () => {
  fakeApi({ [`GET ${API}/movie/11`]: { state: 'not_configured', service: 'radarr', missing: ['RADARR_URL', 'RADARR_API_KEY'] } })
  const { unmount } = render(<ArrDialog item={movie} onClose={jest.fn()} />)
  expect(
    await screen.findByText('Radarr isn’t set up on this server. Set RADARR_URL and RADARR_API_KEY in the app’s environment.')
  ).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  unmount()

  let calls = 0
  fakeApi({
    [`GET ${API}/movie/11`]: () =>
      ++calls === 1 ? { state: 'unreachable', service: 'radarr', reason: 'timeout', httpStatus: null } : absentMovie,
  })
  render(<ArrDialog item={movie} onClose={jest.fn()} />)
  expect(await screen.findByText('Couldn’t reach Radarr: it timed out.')).toBeInTheDocument()

  await click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByRole('button', { name: 'Add to Radarr' })).toBeInTheDocument()
})
