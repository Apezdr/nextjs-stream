/**
 * @jest-environment node
 *
 * GET /api/authenticated/changes: one cheap poll that tells a client which
 * list requests are worth repeating. Each kind of write must move exactly the
 * stamps of the lists it changes, and nothing else, or clients either miss a
 * change or refetch for nothing.
 */
jest.mock('next/server', () => ({ after: (callback) => callback() }))
const mockAuth = jest.fn(async () => ({ id: 'u1' }))
jest.mock('@src/utils/routeAuth', () => ({ isAuthenticatedAndApproved: (...args) => mockAuth(...args) }))

const { GET } = require('@src/app/api/authenticated/changes/route')
const { REVISION, bumpRevision, homeRowsRevision, watchHistoryRevision } = require('@src/utils/changes/revisions')

async function changes(userId = 'u1') {
  mockAuth.mockResolvedValueOnce({ id: userId })
  const response = await GET(new Request('https://cinema.example/api/authenticated/changes'))
  expect(response.status).toBe(200)
  return response.json()
}

// Every stamp, flattened to "route.key" names
const flatten = (body) => ({
  ...Object.fromEntries(Object.entries(body['horizontal-list']).map(([type, value]) => [`horizontal-list.${type}`, value])),
  'watchlist-content': body['watchlist-content'],
  banner: body.banner,
  'home-rows': body['home-rows'],
})

async function movedBy(write, userId = 'u1') {
  const before = flatten(await changes(userId))
  write()
  const after = flatten(await changes(userId))
  return Object.keys(before).filter((key) => before[key] !== after[key]).sort()
}

it('answers with a stamp per list, uncached, for approved users only', async () => {
  const body = await changes()
  expect(Object.keys(body['horizontal-list']).sort()).toEqual(
    ['all', 'movie', 'playlist', 'recentlyAdded', 'recentlyWatched', 'recommendations', 'tv']
  )

  mockAuth.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
  const denied = await GET(new Request('https://cinema.example/api/authenticated/changes'))
  expect(denied.status).toBe(401)
})

it('sends no-store, so no cache between client and server answers a poll', async () => {
  mockAuth.mockResolvedValueOnce({ id: 'u1' })
  const response = await GET(new Request('https://cinema.example/api/authenticated/changes'))
  expect(response.headers.get('Cache-Control')).toBe('no-store')
})

it('a library change moves every list that shows the library, not the home rows', async () => {
  expect(await movedBy(() => bumpRevision(REVISION.LIBRARY))).toEqual([
    'banner',
    'horizontal-list.all',
    'horizontal-list.movie',
    'horizontal-list.playlist',
    'horizontal-list.recentlyAdded',
    'horizontal-list.recentlyWatched',
    'horizontal-list.recommendations',
    'horizontal-list.tv',
    'watchlist-content',
  ])
})

it('a playlist write moves the playlist rows and the home rows only', async () => {
  expect(await movedBy(() => bumpRevision(REVISION.PLAYLISTS))).toEqual([
    'home-rows',
    'horizontal-list.playlist',
    'watchlist-content',
  ])
})

it("my playback moves my Watch History (and recommendations), never someone else's", async () => {
  expect(await movedBy(() => bumpRevision(watchHistoryRevision('u1')))).toEqual([
    'horizontal-list.recentlyWatched',
    'horizontal-list.recommendations',
  ])
  expect(await movedBy(() => bumpRevision(watchHistoryRevision('u2')), 'u1')).toEqual([])
})

it('a home-rows edit moves only that person\'s home-rows stamp', async () => {
  expect(await movedBy(() => bumpRevision(homeRowsRevision('u1')))).toEqual(['home-rows'])
  expect(await movedBy(() => bumpRevision(homeRowsRevision('u2')), 'u1')).toEqual([])
})
