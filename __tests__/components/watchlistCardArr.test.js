/**
 * A watchlist card's Radarr/Sonarr dialog survives what it changes. Adding a
 * title used to reload the whole list, which swaps every card for the
 * skeleton: the card unmounted and took the dialog with it, just as the
 * release picker was due to open. The card now patches its one item (Coming
 * Soon) in place and never asks for a reload.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import WatchlistCard from '@src/components/Watchlist/WatchlistCard'

jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), warn: jest.fn() } }))
jest.mock('@src/contexts/NavigationContext', () => ({
  useNavigation: () => ({ navigate: jest.fn(), isNavigating: false, targetUrl: null }),
}))

const API = '/api/authenticated/arr'
const SEARCH_ID = '0f8fad5b-d9cb-469f-a165-70867728950e'

function fakeApi(routes) {
  global.fetch = jest.fn(async (url, options = {}) => {
    const key = `${options.method ?? 'GET'} ${new URL(url, 'http://localhost').pathname}`
    if (!(key in routes)) throw new Error(`unexpected request ${key}`)
    const [status, body] = Array.isArray(routes[key]) ? routes[key] : [200, routes[key]]
    return { ok: status < 400, status, json: async () => body }
  })
}

const click = (element) => act(() => fireEvent.click(element))

const item = {
  id: 'w1',
  tmdbId: 23437,
  mediaType: 'movie',
  title: 'A Nightmare on Elm Street',
  posterURL: '/sorry-image-not-available.jpg',
  isAvailable: false,
  comingSoon: false,
  dateAdded: '2026-10-01T00:00:00.000Z',
}

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

test('adding with “Pick a release myself” keeps the dialog open and patches the item, without a reload', async () => {
  fakeApi({
    [`GET ${API}/titles/movie/23437`]: {
      state: 'absent',
      service: 'radarr',
      candidate: { title: 'A Nightmare on Elm Street', year: 2010, folder: 'A Nightmare on Elm Street', released: true, seasons: [] },
      options: {
        qualityProfiles: [{ id: 4, name: 'HD-1080p' }],
        rootFolders: [{ path: '/processed_movies', accessible: true, freeSpaceBytes: null }],
        defaultQualityProfileId: 4,
      },
      catalog: { inLibrary: false, folderTakenBy: null },
      rootFolderPath: '/processed_movies',
    },
    [`POST ${API}/titles/movie/23437`]: [201, { service: 'radarr', entry: { id: 900 }, inLibrary: false, next: null, comingSoon: true }],
    [`POST ${API}/titles/movie/23437/releases`]: [
      202,
      {
        id: SEARCH_ID,
        state: 'done',
        service: 'radarr',
        target: { kind: 'movie' },
        startedAt: '2026-10-13T12:00:00.000Z',
        finishedAt: '2026-10-13T12:00:05.000Z',
        expiresAt: '2026-10-13T12:25:05.000Z',
        releases: [],
        failure: null,
      },
    ],
  })
  const onRefresh = jest.fn()
  const onItemUpdated = jest.fn()
  const onArrChanged = jest.fn()
  render(
    <WatchlistCard
      item={item}
      viewMode="grid"
      user={{ id: 'u1', role: 'admin' }}
      onSelect={jest.fn()}
      onRefresh={onRefresh}
      onItemUpdated={onItemUpdated}
      onArrChanged={onArrChanged}
      arrStatus={{ state: 'absent' }}
      arrServices={{ radarr: 'ok', sonarr: 'ok' }}
    />
  )

  await click(screen.getAllByRole('button', { name: /More actions/ })[0])
  await click(screen.getByRole('button', { name: 'Send to Radarr…' }))
  await click(await screen.findByRole('radio', { name: /Pick a release myself/ }))
  await click(screen.getByRole('button', { name: 'Add, then pick a release' }))

  // Still open, now on the picker: the search ran and answered.
  expect(await screen.findByText('No releases found on Radarr’s indexers.')).toBeInTheDocument()
  expect(onItemUpdated).toHaveBeenCalledWith('w1', { comingSoon: true })
  expect(onArrChanged).toHaveBeenCalled()
  expect(onRefresh).not.toHaveBeenCalled()
})
