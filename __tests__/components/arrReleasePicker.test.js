/**
 * Picking a release by hand, against a fake API: the search runs and is
 * polled, results keep the service's order with its pick marked, a rejected
 * release says why and asks twice, and expired or failed searches say so.
 * Then the two ways the dialog leads here.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import ArrDialog from '@src/components/Arr/ArrDialog'
import ReleasePicker from '@src/components/Arr/ReleasePicker'

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), warn: jest.fn() } }))
const { toast } = require('react-toastify')

const API = '/api/authenticated/arr'
const SEARCH_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

const release = (id, title, extra = {}) => ({
  id,
  title,
  indexer: 'NZBgeek',
  protocol: 'usenet',
  quality: 'Bluray-1080p',
  sizeBytes: 9.8 * 1024 ** 3,
  ageHours: 72,
  seeders: null,
  leechers: null,
  languages: ['English'],
  customFormats: [],
  customFormatScore: 0,
  releaseGroup: null,
  edition: null,
  coverage: null,
  approved: true,
  temporarilyRejected: false,
  rejections: [],
  grabbed: false,
  ...extra,
})

// In the service's order: a rejected 4K first, then its pick.
const RESULTS = [
  release('0', 'Star.Wars.1977.2160p.UHD.BluRay-NOGRP', {
    approved: false,
    rejections: ['Not wanted in profile'],
    quality: 'Bluray-2160p',
    sizeBytes: 60 * 1024 ** 3,
  }),
  release('1', 'Star.Wars.1977.1080p.BluRay.x264-GROUP', { customFormatScore: 50 }),
  release('2', 'Star.Wars.1977.720p.WEB-DL', { quality: 'WEBDL-720p', sizeBytes: 3 * 1024 ** 3, ageHours: 5 }),
]

const view = (releases, overrides = {}) => ({
  id: SEARCH_ID,
  state: 'done',
  service: 'radarr',
  target: { kind: 'movie' },
  startedAt: '2026-10-12T12:00:00.000Z',
  finishedAt: '2026-10-12T12:00:08.000Z',
  expiresAt: '2026-10-12T12:25:08.000Z',
  releases,
  failure: null,
  ...overrides,
})

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
const rowOf = async (title) => (await screen.findByText(title)).closest('li')
// A title's own text, without the "Radarr’s pick" badge inside the same paragraph.
const ownText = (element) =>
  [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join('')
const titlesInOrder = () => screen.getAllByText(/^Star\.Wars\.1977/).map(ownText)

const movie = { mediaType: 'movie', tmdbId: 11, title: 'Star Wars' }
const START = `POST ${API}/titles/movie/11/releases`
const GRAB = `POST ${API}/releases/${SEARCH_ID}/grab`

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  jest.useRealTimers()
})

test('results keep Radarr’s order, its pick is marked, and a rejected release says why', async () => {
  fakeApi({ [START]: [202, view(RESULTS)] })
  render(<ReleasePicker item={movie} target={null} canGrabRejected />)

  expect(await rowOf(RESULTS[1].title)).toHaveTextContent('Radarr’s pick')
  expect(titlesInOrder()).toEqual(RESULTS.map((result) => result.title))
  expect(within(await rowOf(RESULTS[0].title)).getByText('Not wanted in profile')).toBeInTheDocument()
  expect(within(await rowOf(RESULTS[1].title)).getByText(/Bluray-1080p · 9\.8 GB · 3 d · NZBgeek · Score \+50/)).toBeInTheDocument()
  expect(screen.getByText('3 found in 8 s')).toBeInTheDocument()
  expect(sent(START)).toEqual([{}])
})

test('grabbing an approved release: one click, sent by its id, marked as grabbed', async () => {
  fakeApi({
    [START]: [202, view(RESULTS)],
    [GRAB]: { service: 'radarr', title: RESULTS[1].title, monitored: true },
  })
  const onGrabbed = jest.fn()
  render(<ReleasePicker item={movie} target={null} canGrabRejected onGrabbed={onGrabbed} />)

  const row = await rowOf(RESULTS[1].title)
  await click(within(row).getByRole('button', { name: 'Grab' }))

  expect(await within(row).findByText('Grabbed')).toBeInTheDocument()
  expect(sent(GRAB)).toEqual([{ releaseId: '1' }])
  expect(toast.success).toHaveBeenCalledWith(`Radarr is downloading “${RESULTS[1].title}”.`)
  expect(onGrabbed).toHaveBeenCalledWith({ service: 'radarr', title: RESULTS[1].title, monitored: true })
})

test('a rejected release is grabbed only on a second, deliberate click', async () => {
  fakeApi({ [START]: [202, view(RESULTS)], [GRAB]: { service: 'radarr', title: RESULTS[0].title, monitored: false } })
  render(<ReleasePicker item={movie} target={null} canGrabRejected />)

  const row = await rowOf(RESULTS[0].title)
  await click(within(row).getByRole('button', { name: 'Grab…' }))
  expect(sent(GRAB)).toEqual([])

  await click(within(row).getByRole('button', { name: 'Grab anyway' }))
  expect(await within(row).findByText('Grabbed')).toBeInTheDocument()
  expect(sent(GRAB)).toEqual([{ releaseId: '0' }])
  // Downloading, but the title could not be kept monitored: said, not hidden.
  expect(toast.warn).toHaveBeenCalled()
})

test('rejected releases can be hidden, and the list re-sorted', async () => {
  fakeApi({ [START]: [202, view(RESULTS)] })
  render(<ReleasePicker item={movie} target={null} canGrabRejected />)

  await click(await screen.findByRole('checkbox', { name: 'Hide rejected (1)' }))
  expect(screen.queryByText(RESULTS[0].title)).not.toBeInTheDocument()

  await act(() => fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'newest' } }))
  expect(titlesInOrder()).toEqual([RESULTS[2].title, RESULTS[1].title])
})

test('while Radarr searches, the picker says so and polls until the results arrive', async () => {
  jest.useFakeTimers()
  fakeApi({
    [START]: [202, view([], { state: 'searching', finishedAt: null, expiresAt: null })],
    [`GET ${API}/releases/${SEARCH_ID}`]: view(RESULTS),
  })
  render(<ReleasePicker item={movie} target={null} canGrabRejected />)

  expect(await screen.findByText(/Searching Radarr’s indexers…/)).toBeInTheDocument()
  await act(async () => {
    jest.advanceTimersByTime(2_000)
  })
  expect(await screen.findByText(RESULTS[1].title)).toBeInTheDocument()
  jest.useRealTimers()
})

test('results Radarr no longer has: told to search again, and every grab stops', async () => {
  fakeApi({
    [START]: [202, view(RESULTS)],
    [GRAB]: [410, { error: 'expired', message: 'Radarr no longer has these results. Search again.' }],
  })
  render(<ReleasePicker item={movie} target={null} canGrabRejected />)

  await click(within(await rowOf(RESULTS[1].title)).getByRole('button', { name: 'Grab' }))

  expect(await screen.findByText(/These results have expired/)).toBeInTheDocument()
  for (const button of screen.getAllByRole('button', { name: /^Grab/ })) expect(button).toBeDisabled()
  expect(toast.error).not.toHaveBeenCalled()
})

test('a failed search says why, and Search again starts a new one', async () => {
  let calls = 0
  fakeApi({
    [START]: () =>
      ++calls === 1
        ? view([], { state: 'failed', expiresAt: null, failure: { reason: 'timeout', message: 'Radarr’s indexers took too long to answer. Try again.' } })
        : view(RESULTS),
  })
  render(<ReleasePicker item={movie} target={null} canGrabRejected />)

  expect(await screen.findByRole('alert')).toHaveTextContent('Radarr’s indexers took too long to answer. Try again.')
  await click(screen.getByRole('button', { name: 'Search again' }))
  expect(await screen.findByText(RESULTS[1].title)).toBeInTheDocument()
  expect(sent(START)).toHaveLength(2)
})

test('no results is said plainly', async () => {
  fakeApi({ [START]: [202, view([])] })
  render(<ReleasePicker item={movie} target={null} canGrabRejected />)
  expect(await screen.findByText('No releases found on Radarr’s indexers.')).toBeInTheDocument()
})

test('without the manage capability, a rejected release can’t be grabbed', async () => {
  fakeApi({ [START]: [202, view(RESULTS)] })
  render(<ReleasePicker item={movie} target={null} />)

  const row = await rowOf(RESULTS[0].title)
  expect(within(row).getByText('Managers only')).toBeInTheDocument()
  expect(within(row).queryByRole('button')).not.toBeInTheDocument()
  // Approved ones still can.
  expect(within(await rowOf(RESULTS[1].title)).getByRole('button', { name: 'Grab' })).toBeInTheDocument()
})

describe('from the dialog', () => {
  const radarrOptions = {
    qualityProfiles: [{ id: 4, name: 'HD-1080p' }],
    rootFolders: [{ path: '/processed_movies', accessible: true, freeSpaceBytes: null }],
    defaultQualityProfileId: 4,
  }

  test('“Pick a release myself” adds without searching, then opens the picker', async () => {
    fakeApi({
      [`GET ${API}/titles/movie/11`]: {
        state: 'absent',
        service: 'radarr',
        candidate: { title: 'Star Wars', year: 1977, folder: 'Star Wars', released: true, seasons: [] },
        options: radarrOptions,
        catalog: { inLibrary: false, folderTakenBy: null },
        rootFolderPath: '/processed_movies',
        permissions: { manage: true, manual: true, canAct: true },
      },
      [`POST ${API}/titles/movie/11`]: [201, { service: 'radarr', entry: { id: 900 }, inLibrary: false, next: null, comingSoon: true }],
      [START]: [202, view(RESULTS)],
    })
    const onClose = jest.fn()
    render(<ArrDialog item={movie} onClose={onClose} onChanged={jest.fn()} />)

    await click(await screen.findByRole('radio', { name: /Pick a release myself/ }))
    await click(screen.getByRole('button', { name: 'Add, then pick a release' }))

    expect(await screen.findByText(RESULTS[1].title)).toBeInTheDocument()
    expect(sent(`POST ${API}/titles/movie/11`)[0]).toMatchObject({ search: false })
    expect(screen.getByText(/^Pick a release · Radarr/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    await click(screen.getByRole('button', { name: 'Done' }))
    expect(onClose).toHaveBeenCalled()
  })

  test('a show Sonarr has: choose a season from Sonarr’s list, then search it', async () => {
    const show = { mediaType: 'tv', tmdbId: 1438, title: 'The Wire' }
    fakeApi({
      [`GET ${API}/titles/tv/1438`]: {
        state: 'present',
        service: 'sonarr',
        entry: {
          id: 7,
          title: 'The Wire',
          monitored: true,
          qualityProfileId: 8,
          path: '/processed_tv/The Wire',
          hasFile: false,
          released: true,
          episodeFileCount: 0,
          episodeCount: 3,
          seasons: [1, 2].map((seasonNumber) => ({ seasonNumber, monitored: true, episodeFileCount: 0, episodeCount: 2 })),
        },
        options: { qualityProfiles: [{ id: 8, name: 'Ultra-HD' }], rootFolders: [], defaultQualityProfileId: 8 },
        download: null,
        permissions: { manage: true, manual: true, canAct: true },
      },
      [`GET ${API}/titles/tv/1438/episodes`]: {
        seriesId: 7,
        ready: true,
        episodes: [
          { id: 101, seasonNumber: 1, episodeNumber: 1, title: 'The Target', airDate: '2002-06-02', hasFile: false, monitored: true },
          { id: 201, seasonNumber: 2, episodeNumber: 1, title: 'Ebb Tide', airDate: '2003-06-01', hasFile: false, monitored: true },
        ],
      },
      [`POST ${API}/titles/tv/1438/releases`]: [202, view([release('0', 'The.Wire.S02.1080p.BluRay', { coverage: 'Season 2' })], { service: 'sonarr' })],
    })
    render(<ArrDialog item={show} onClose={jest.fn()} />)

    await click(await screen.findByRole('button', { name: 'Pick a release…' }))
    const season = await screen.findByLabelText('Season')
    expect(season).toHaveValue('1')
    await act(() => fireEvent.change(season, { target: { value: '2' } }))
    expect(within(screen.getByLabelText('Search for')).getByRole('option', { name: /S02E01 · Ebb Tide/ })).toBeInTheDocument()

    await click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('The.Wire.S02.1080p.BluRay')).toBeInTheDocument()
    expect(screen.getByText(/^Season 2 · Bluray-1080p/)).toBeInTheDocument()
    expect(sent(`POST ${API}/titles/tv/1438/releases`)).toEqual([{ seasonNumber: 2 }])
  })
})
