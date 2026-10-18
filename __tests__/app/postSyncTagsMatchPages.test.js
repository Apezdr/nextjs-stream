/**
 * @jest-environment node
 *
 * Post-sync cache invalidation names each title by its folder name
 * (`originalTitle`), which is what the media pages tag their caches with: a
 * page's URL carries the folder name, and the page tags with the decoded
 * [title] param. Before, the sync named titles by display title, so its
 * per-title tags never matched a page and only the bucket tags did any work.
 *
 * These cases run the chain end to end: a pass's results go through
 * run/writtenMedia, the changed media through POST /admin/revalidate-media,
 * and each tag the route revalidates is compared with the tags the pages' own
 * code puts on their cache entries, given the params Next hands them for the
 * URLs the app links to (matched and decoded by Next's route matcher, then
 * re-encoded by getDynamicParam, as Next 16 does).
 *
 * The admin creates (flatMediaActions) are held to the same pages, and so are
 * the cached views nested in the movie and episode pages.
 */

const mockRevalidateTag = jest.fn()
const mockCacheTag = jest.fn()
jest.mock('next/cache', () => ({
  revalidateTag: (...args) => mockRevalidateTag(...args),
  revalidatePath: jest.fn(),
  updateTag: jest.fn(),
  cacheTag: (...args) => mockCacheTag(...args),
  cacheLife: jest.fn(),
}))
jest.mock('next/navigation', () => ({ redirect: jest.fn() }))
// The real p-limit is an ES module jest does not transform (sync/core loads it);
// nothing here runs through a pool.
jest.mock('p-limit', () => () => (fn) => fn())

// The pages' views and data: only their cache tags are under test.
jest.mock('@src/components/MediaPages/DynamicPage', () => ({
  SessionGate: () => null,
  MediaNotFound: () => null,
  MovieDetailsView: () => null,
  TVShowView: () => null,
  TVSeasonView: () => null,
  TVEpisodeDetailsView: () => null,
}))
jest.mock('@src/components/MediaPages/details/MoviePageSkeleton', () => ({ __esModule: true, default: () => null }))
jest.mock('@src/components/MediaPages/details/ShowPageSkeleton', () => ({ __esModule: true, default: () => null }))
jest.mock('@src/components/MediaPages/details/SeasonPageSkeleton', () => ({ __esModule: true, default: () => null }))
jest.mock('@src/components/MediaPages/details/EpisodePageSkeleton', () => ({ __esModule: true, default: () => null }))
jest.mock('@src/utils/cache/mediaFetching', () => ({
  getCachedMediaWithRedirect: jest.fn(async () => ({ media: {}, redirectUrl: null, notFoundType: null })),
}))
jest.mock('@src/utils/media/mediaFetcher', () => ({ fetchTrailerMedia: jest.fn() }))
jest.mock('@src/utils/media/metadataBuilder', () => ({ buildMediaMetadata: jest.fn() }))
jest.mock('@src/components/MediaPages/MovieDetailsComponent', () => ({ __esModule: true, default: () => null }))
jest.mock('@src/components/MediaPages/TVEpisodeDetailsComponent', () => ({ __esModule: true, default: () => null }))

// The admin actions' database: the documents a create finds (by collection)
const mockDocs = {}
jest.mock('@src/lib/mongodb', () => ({
  __esModule: true,
  default: Promise.resolve({
    db: () => ({
      collection: (name) => ({
        findOne: async () => mockDocs[name] ?? null,
        insertOne: async () => ({ acknowledged: true }),
        updateOne: async () => ({ matchedCount: 1 }),
        updateMany: async () => ({ matchedCount: 0 }),
      }),
    }),
  }),
}))
jest.mock('mongodb', () => {
  let next = 0
  class ObjectId {
    constructor(value) {
      this.value = value ?? `generated-${(next += 1)}`
    }

    static isValid(value) {
      return Boolean(value)
    }

    toString() {
      return String(this.value)
    }
  }
  return { ObjectId }
})
jest.mock('@src/utils/sync/run/appliedPayloads', () => ({ forgetAppliedPayloads: jest.fn() }))
jest.mock('@src/utils/sync/run/validateWatchHistory', () => ({ validateWatchHistory: jest.fn() }))

// The route's other dependencies play no part in revalidate-media.
jest.mock('@src/utils/routeAuth', () => ({
  // An admin: the actions go ahead
  isAdmin: jest.fn(async () => ({ id: 'admin' })),
  isAdminOrWebhook: jest.fn(async () => true),
}))
jest.mock('@src/utils', () => ({ buildURL: jest.fn() }))
jest.mock('@src/utils/admin_database', () => ({}))
jest.mock('@src/utils/flatDatabaseUtils', () => ({ generateNormalizedVideoId: jest.fn(() => 'normalized') }))
jest.mock('@src/utils/playbackPresence/database', () => ({}))
jest.mock('@src/utils/playbackPresence/attach', () => ({}))
jest.mock('@src/lib/userQueries', () => ({ userQueries: {} }))
jest.mock('@src/utils/admin_utils', () => ({}))
jest.mock('axios', () => ({ __esModule: true, default: {} }))
jest.mock('chalk', () => ({ __esModule: true, default: {} }))
jest.mock('@src/utils/sync_db', () => ({}))
jest.mock('@src/utils/config', () => ({}))
jest.mock('@src/utils/monitor_server_load', () => ({ monitorConfig: {} }))
jest.mock('@src/utils/server_track_processes', () => ({}))
jest.mock('@src/utils/backendAuth', () => ({ getBackendAuthHeaders: jest.fn(async () => ({})) }))
jest.mock('@src/utils/sync/run/syncAllServers', () => ({}))
jest.mock('@src/utils/sync/infrastructure', () => ({}))
jest.mock('@src/utils/sync_verification', () => ({}))
jest.mock('@src/utils/auth_utils', () => ({}))
jest.mock('@src/utils/notifications/NotificationManager.js', () => ({ NotificationManager: {} }))
jest.mock('@src/lib/logger', () => ({
  createLogger: jest.fn(() => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() })),
}))

const { getRouteRegex } = require('next/dist/shared/lib/router/utils/route-regex')
const { getRouteMatcher } = require('next/dist/shared/lib/router/utils/route-matcher')
const { getDynamicParam } = require('next/dist/shared/lib/router/utils/get-dynamic-param')
const { POST } = require('@src/app/api/authenticated/[...admin]/route')
const { createWrittenMedia } = require('@src/utils/sync/run/writtenMedia')
const {
  createMovieAction,
  createTVShowAction,
  saveSeasonAction,
  saveEpisodeAction,
} = require('@src/utils/admin/flatMediaActions')
const MovieDetailsView = require('@src/components/MediaPages/DynamicPage/views/MovieDetailsView').default
const TVEpisodeDetailsView = require('@src/components/MediaPages/DynamicPage/views/TVEpisodeDetailsView').default

const PAGES = {
  movie: {
    route: '/list/movie/[title]',
    Page: require('@src/app/(styled)/list/movie/[title]/page').default,
    // As the app links to them (encodeURIComponent of the folder name)
    url: (folder) => `/list/movie/${encodeURIComponent(folder)}`,
  },
  show: {
    route: '/list/tv/[title]',
    Page: require('@src/app/(styled)/list/tv/[title]/page').default,
    url: (folder) => `/list/tv/${encodeURIComponent(folder)}`,
  },
  season: {
    route: '/list/tv/[title]/[season]',
    Page: require('@src/app/(styled)/list/tv/[title]/[season]/page').default,
    url: (folder, season) => `/list/tv/${encodeURIComponent(folder)}/${season}`,
  },
  episode: {
    route: '/list/tv/[title]/[season]/[episode]',
    Page: require('@src/app/(styled)/list/tv/[title]/[season]/[episode]/page').default,
    url: (folder, season, episode) => `/list/tv/${encodeURIComponent(folder)}/${season}/${episode}`,
  },
}

// Bucket tags: shared by every title, so they do not show whether a title's
// own tag matched.
const BUCKETS = new Set(['media-library', 'movies', 'tv', 'all', 'movie-details', 'tv-details', 'season-details', 'episode-details'])

/** The params Next hands a page for a URL: matched (decoded), then re-encoded. */
function paramsFor(route, pathname) {
  const matched = getRouteMatcher(getRouteRegex(route))(pathname)
  if (!matched) throw new Error(`${pathname} does not match ${route}`)
  return Object.fromEntries(
    Object.keys(matched).map((key) => [key, getDynamicParam(matched, key, 'd', null, []).value])
  )
}

/**
 * The per-title tags a page puts on its cache entry, from the page's own code:
 * <Suspense><SessionGate>{content}</SessionGate></Suspense>, where the content
 * is the cached component that calls cacheTag.
 */
async function pageTitleTags(kind, ...urlArgs) {
  const { route, Page, url } = PAGES[kind]
  const params = paramsFor(route, url(...urlArgs))
  const gate = Page({ params: Promise.resolve(params) }).props.children
  const content = gate.props.children({ session: { user: { id: 'viewer-1', limitedAccess: false } }, params })
  mockCacheTag.mockClear()
  await content.type(content.props)
  return mockCacheTag.mock.calls
    .flat()
    .filter((tag) => !BUCKETS.has(tag) && !tag.startsWith('user-watch-history-'))
}

/** A completed result, as the sync services return them (display title in metadata). */
const completed = (mediaType, entityId, metadata) => ({
  status: 'completed',
  mediaType,
  entityId,
  operation: 'metadata',
  serverId: 'A',
  timestamp: new Date(),
  changes: [],
  errors: [],
  metadata,
})
/** One movie's pass: what MovieSyncService returns for a title it wrote. */
const moviePass = (folder, displayTitle) => [completed('movie', folder, { displayTitle })]
/** One show's pass: the show, its season and one changed episode. */
const showPass = (folder, displayTitle, season, episode) => [
  completed('tvshow', folder, { displayTitle }),
  completed('season', `${folder} S${season}`, { displayTitle, seasonNumber: season }),
  completed('episode', `${folder} S${season}E${episode}`, { displayTitle, seasonNumber: season, episodeNumber: episode }),
]

/** Record the passes as serverPass does, post the changed media, and return what the route revalidated. */
async function revalidatedBy(passes) {
  const written = createWrittenMedia()
  for (const [folder, results] of passes) written.record(results, folder)
  mockRevalidateTag.mockClear()
  const response = await POST(
    new Request('http://127.0.0.1:3000/api/authenticated/admin/revalidate-media', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-ID': 'internal-hook' },
      body: JSON.stringify(written.changedMedia),
    }),
    { params: Promise.resolve({ admin: ['admin', 'revalidate-media'] }) }
  )
  expect(response.status).toBe(200)
  return { changedMedia: written.changedMedia, calls: mockRevalidateTag.mock.calls }
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  console.log.mockRestore()
})

// Folder names that differ from their display titles, and folder names with
// the characters encoding changes: spaces, reserved URL characters, a literal
// percent sign (and one that looks like an escape), non-ASCII letters, emoji.
const FOLDERS = [
  ['Example Film (2001)', 'Example Film'],
  ['Show: Part One & Two? #1 (2019)', 'Show Part One and Two'],
  ['100% Proof + More (2020)', '100 Percent Proof'],
  ['A%20Literal%2FEscape [Cut]', 'A Literal Escape'],
  ['Café Ünïcode — 日本語 🎬 (2018)', 'Cafe Unicode'],
  ["Who's Afraid, Really! (1999)", 'Who Is Afraid'],
]

describe.each(FOLDERS)('the folder %j (display title %j)', (folder, displayTitle) => {
  it('is what a pass records as changed, for the title and for its seasons and episodes', () => {
    const written = createWrittenMedia()
    written.record(moviePass(folder, displayTitle), folder)
    written.record(showPass(folder, displayTitle, 2, 5), folder)

    expect(written.changedMedia).toEqual({
      movies: [folder],
      shows: [folder],
      seasons: [{ title: folder, season: 2 }],
      episodes: [{ title: folder, season: 2, episode: 5 }],
    })
  })

  it('revalidates the very tag the movie page tags its cache with', async () => {
    const pageTags = await pageTitleTags('movie', folder)
    const { calls } = await revalidatedBy([[folder, moviePass(folder, displayTitle)]])

    expect(pageTags).toEqual([`movie-details-${folder}`])
    expect(calls).toContainEqual([pageTags[0], 'max'])
    expect(calls.some(([tag]) => tag.includes(displayTitle) && !tag.includes(folder))).toBe(false)
  })

  it('revalidates the very tags the show, season and episode pages tag their caches with', async () => {
    const pageTags = [
      ...(await pageTitleTags('show', folder)),
      ...(await pageTitleTags('season', folder, 2)),
      ...(await pageTitleTags('episode', folder, 2, 5)),
    ]
    const { calls } = await revalidatedBy([[folder, showPass(folder, displayTitle, 2, 5)]])

    expect(pageTags).toEqual([`tv-show-${folder}`, `season-${folder}-2`, `episode-${folder}-S2E5`])
    for (const tag of pageTags) expect(calls).toContainEqual([tag, 'max'])
  })
})

describe('the tags a post-sync revalidation marks stale', () => {
  // Pinned for the record: the bucket tags are exactly what they were; only
  // the per-title tags changed, from the display title to the folder name.
  it('for one movie', async () => {
    const { calls } = await revalidatedBy([['Example Film (2001)', moviePass('Example Film (2001)', 'Example Film')]])

    expect(calls).toEqual([
      ['movie-details-Example Film (2001)', 'max'],
      ['movie-details', 'max'],
      ['movies', 'max'],
      ['media-library', 'max'],
      ['all', 'max'],
      ['banner', { expire: 0 }],
    ])
  })

  it('for one show', async () => {
    const results = [completed('tvshow', 'Example Show (2019)', { displayTitle: 'Example Show' })]
    const { calls } = await revalidatedBy([['Example Show (2019)', results]])

    expect(calls).toEqual([
      ['tv-show-Example Show (2019)', 'max'],
      ['tv-details', 'max'],
      ['tv', 'max'],
      ['media-library', 'max'],
      ['all', 'max'],
    ])
  })

  it('for one episode (a show\'s pass also records the show and the season it walked)', async () => {
    const { calls } = await revalidatedBy([['Example Show (2019)', showPass('Example Show (2019)', 'Example Show', 1, 2)]])

    expect(calls).toEqual([
      // the show
      ['tv-show-Example Show (2019)', 'max'],
      ['tv-details', 'max'],
      ['tv', 'max'],
      ['media-library', 'max'],
      ['all', 'max'],
      // the season
      ['season-Example Show (2019)-1', 'max'],
      ['season-details', 'max'],
      // the episode
      ['episode-Example Show (2019)-S1E2', 'max'],
      ['episode-details', 'max'],
    ])
  })
})

// ---------------------------------------------------------------- admin creates

/** The per-title tags an admin action revalidated (bucket tags left out). */
async function titleTagsRevalidatedBy(run) {
  mockRevalidateTag.mockClear()
  const result = await run()
  expect(result.status).toBe('success')
  return mockRevalidateTag.mock.calls.map(([tag]) => tag).filter((tag) => !BUCKETS.has(tag) && tag !== 'banner')
}

describe.each(FOLDERS)('an admin create under the folder %j (display title %j)', (folder, displayTitle) => {
  const show = { _id: 'show-1', title: displayTitle, originalTitle: folder }

  beforeEach(() => {
    for (const key of Object.keys(mockDocs)) delete mockDocs[key]
  })

  it('of a movie revalidates the movie page\'s tag', async () => {
    const tags = await titleTagsRevalidatedBy(() =>
      createMovieAction(null, { title: displayTitle, originalTitle: folder, videoURL: 'https://server/film.mp4' })
    )

    expect(tags).toEqual(await pageTitleTags('movie', folder))
  })

  it('of a show revalidates the show page\'s tag', async () => {
    const tags = await titleTagsRevalidatedBy(() => createTVShowAction(null, { title: displayTitle, originalTitle: folder }))

    expect(tags).toEqual(await pageTitleTags('show', folder))
  })

  it('of a season revalidates the season page\'s and the show page\'s tags, by the show\'s folder name', async () => {
    mockDocs.FlatTVShows = show
    const tags = await titleTagsRevalidatedBy(() => saveSeasonAction(null, { showId: 'show-1', seasonNumber: '2' }))

    expect(new Set(tags)).toEqual(
      new Set([...(await pageTitleTags('season', folder, 2)), ...(await pageTitleTags('show', folder))])
    )
  })

  it('of an episode revalidates the episode, season and show pages\' tags, by the show\'s folder name', async () => {
    mockDocs.FlatTVShows = show
    mockDocs.FlatSeasons = { _id: 'season-2', showId: 'show-1', seasonNumber: 2 }
    const tags = await titleTagsRevalidatedBy(() =>
      saveEpisodeAction(null, { showId: 'show-1', seasonNumber: '2', episodeNumber: '5', title: 'Pilot' })
    )

    expect(new Set(tags)).toEqual(
      new Set([
        ...(await pageTitleTags('episode', folder, 2, 5)),
        ...(await pageTitleTags('season', folder, 2)),
        ...(await pageTitleTags('show', folder)),
      ])
    )
  })
})

// ---------------------------------------------------------------- nested views

/** The per-title tags of the cached component a view renders: <Suspense><div><Cached media /></div></Suspense>. */
async function viewTitleTags(View, media) {
  const cached = View({ media }).props.children.props.children
  mockCacheTag.mockClear()
  await cached.type(cached.props)
  return mockCacheTag.mock.calls.flat().filter((tag) => !BUCKETS.has(tag))
}

describe.each(FOLDERS)('the cached views of the folder %j (display title %j)', (folder, displayTitle) => {
  it('tag the movie details as the movie page does', async () => {
    const media = { title: displayTitle, originalTitle: folder }

    expect(await viewTitleTags(MovieDetailsView, media)).toEqual(await pageTitleTags('movie', folder))
  })

  it('tag the episode details as the episode, season and show pages do', async () => {
    // As getFlatRequestedMedia builds an episode: the show's display title and folder name
    const media = { title: 'Pilot', showTitle: displayTitle, originalTitle: folder, seasonNumber: 2, episodeNumber: 5 }

    expect(new Set(await viewTitleTags(TVEpisodeDetailsView, media))).toEqual(
      new Set([
        ...(await pageTitleTags('show', folder)),
        ...(await pageTitleTags('season', folder, 2)),
        ...(await pageTitleTags('episode', folder, 2, 5)),
      ])
    )
  })
})
