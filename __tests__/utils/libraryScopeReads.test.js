/**
 * @jest-environment node
 *
 * Library scopes on the reads that answer one viewer, over an in-memory Media
 * database: a title page's lookup (getFlatRequestedMedia: a title outside the
 * scope is not found, like a missing one, and a show's seasons and episodes
 * follow it), the user's own watch rows (pullPlayback), and the new-content
 * notices (delivered, and read, only when every title they name is in scope).
 */

const { createMemoryMongo } = require('../helpers/memoryMongo')

const mockMongo = createMemoryMongo()
jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve(mockMongo.client) }))
const mockAccessFor = jest.fn()
jest.mock('@src/lib/roles/libraryAccess', () => ({ libraryAccessFor: (...args) => mockAccessFor(...args) }))
const mockInsert = jest.fn(async (docs) => ({ inserted: docs.length, alreadyThere: 0 }))
jest.mock('@src/utils/notifications/notificationDatabase.js', () => ({ insertNotificationsOnce: (...args) => mockInsert(...args) }))
const mockRecipients = jest.fn()
jest.mock('@src/utils/notifications/recipients.js', () => ({ findNewContentRecipients: () => mockRecipients() }))

const { getFlatRequestedMedia } = require('@src/utils/flatDatabaseUtils')
const { watchRowsInScope } = require('@src/utils/watchHistory/scopeRows')
const { noticesInScope, noticeTitles } = require('@src/utils/notifications/scope')
const { MediaNotificationOrchestrator } = require('@src/utils/notifications/MediaNotificationOrchestrator')
const { FULL_LIBRARY } = require('@src/lib/roles/libraryScope')

const col = (name) => mockMongo.collection('Media', name)
const SHOW_IN = '64b7f0c2a1b2c3d4e5f60701'
const SHOW_OUT = '64b7f0c2a1b2c3d4e5f60702'
const SEASON_IN = '64b7f0c2a1b2c3d4e5f60711'
const SEASON_OUT = '64b7f0c2a1b2c3d4e5f60712'

// Movies rated PG or lower, shows TV-Y7 or lower, and one unrated movie picked by hand
const KIDS = {
  id: 'scope-kids',
  scope: {
    movieRatingCap: 'PG',
    tvRatingCap: 'TV-Y7',
    titles: [{ mediaType: 'movie', originalTitle: 'Home Video (2001)', access: 'play' }],
  },
  showIds: [SHOW_IN],
}

beforeEach(() => {
  for (const name of ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes']) col(name).docs.length = 0
  col('FlatMovies').docs.push(
    { _id: 'm-g', title: 'Cartoon', originalTitle: 'Cartoon (1995)', metadata: { rating: 'G' }, videoURL: 'https://f/m-g.mp4', normalizedVideoId: 'nid-g' },
    { _id: 'm-r', title: 'Thriller', originalTitle: 'Thriller (1995)', metadata: { rating: 'R' }, videoURL: 'https://f/m-r.mp4', normalizedVideoId: 'nid-r' },
    { _id: 'm-nr', title: 'Home Video', originalTitle: 'Home Video (2001)', metadata: { rating: 'NR' }, videoURL: 'https://f/m-nr.mp4' },
    { _id: 'm-un', title: 'Unrated', originalTitle: 'Unrated (2001)', metadata: {}, videoURL: 'https://f/m-un.mp4' }
  )
  col('FlatTVShows').docs.push(
    { _id: SHOW_IN, title: 'Puppets', originalTitle: 'Puppets', metadata: { rating: 'TV-Y' } },
    { _id: SHOW_OUT, title: 'Crime', originalTitle: 'Crime', metadata: { rating: 'TV-MA' } }
  )
  col('FlatSeasons').docs.push(
    { _id: SEASON_IN, showId: SHOW_IN, seasonNumber: 1 },
    { _id: SEASON_OUT, showId: SHOW_OUT, seasonNumber: 1 }
  )
  col('FlatEpisodes').docs.push(
    { _id: 'e-in', showId: SHOW_IN, seasonId: SEASON_IN, seasonNumber: 1, episodeNumber: 1, videoURL: 'https://f/e-in.mp4', normalizedVideoId: 'nid-e-in', primaryContainer: 'mp4' },
    { _id: 'e-out', showId: SHOW_OUT, seasonId: SEASON_OUT, seasonNumber: 1, episodeNumber: 1, videoURL: 'https://f/e-out.mp4', normalizedVideoId: 'nid-e-out', primaryContainer: 'mp4' }
  )
  mockAccessFor.mockReset()
  mockInsert.mockClear()
})

describe('a title page’s lookup (getFlatRequestedMedia)', () => {
  const lookup = (access, request) => getFlatRequestedMedia({ access, ...request })

  it('finds a movie under the cap, or picked; not one above it, nor an unrated one nobody picked', async () => {
    expect((await lookup(KIDS, { type: 'movie', title: 'Cartoon (1995)' }))?.originalTitle).toBe('Cartoon (1995)')
    expect((await lookup(KIDS, { type: 'movie', title: 'Home Video (2001)' }))?.originalTitle).toBe('Home Video (2001)')
    expect(await lookup(KIDS, { type: 'movie', title: 'Thriller (1995)' })).toBeNull()
    expect(await lookup(KIDS, { type: 'movie', title: 'Unrated (2001)' })).toBeNull()
    // By id too (the media API), and by the display-title fallback
    expect(await lookup(KIDS, { type: 'movie', id: 'm-r' })).toBeNull()
    expect(await lookup(KIDS, { type: 'movie', title: 'Thriller' })).toBeNull()
  })

  it('a show outside the scope is not found, nor its seasons or episodes', async () => {
    expect((await lookup(KIDS, { type: 'tv', title: 'Puppets', season: 'Season 1', episode: 'Episode 1' }))?.videoURL).toBe(
      'https://f/e-in.mp4'
    )
    expect(await lookup(KIDS, { type: 'tv', title: 'Crime' })).toBeNull()
    expect(await lookup(KIDS, { type: 'tv', title: 'Crime', season: 'Season 1' })).toBeNull()
    expect(await lookup(KIDS, { type: 'tv', title: 'Crime', season: 'Season 1', episode: 'Episode 1' })).toBeNull()
  })

  it('the whole library finds everything', async () => {
    expect((await lookup(FULL_LIBRARY, { type: 'movie', title: 'Thriller (1995)' }))?.originalTitle).toBe('Thriller (1995)')
    expect((await lookup(FULL_LIBRARY, { type: 'tv', title: 'Crime' }))?.originalTitle).toBe('Crime')
  })
})

describe('the user’s own watch rows', () => {
  const rows = [
    { videoId: 'https://f/m-g.mp4', normalizedVideoId: 'nid-g' },
    { videoId: 'https://jit/m-r.m3u8', normalizedVideoId: 'nid-r' },
    { videoId: 'https://f/e-in.mp4', normalizedVideoId: 'nid-e-in' },
    { videoId: 'https://f/e-out.mp4', normalizedVideoId: 'nid-e-out' },
    { videoId: 'https://f/removed.mp4', normalizedVideoId: 'nid-gone' },
  ]

  it('keeps only the rows of titles in scope, and their URLs with them', async () => {
    expect((await watchRowsInScope(rows, KIDS)).map((row) => row.videoId)).toEqual(['https://f/m-g.mp4', 'https://f/e-in.mp4'])
  })

  it('the whole library gets its rows back as they are, with no query', async () => {
    const find = jest.spyOn(col('FlatMovies'), 'find')
    find.mockClear()
    expect(await watchRowsInScope(rows, FULL_LIBRARY)).toBe(rows)
    expect(find).not.toHaveBeenCalled()
  })
})

describe('new-content notices', () => {
  const NEW_CONTENT = 'new_content'
  const single = { type: NEW_CONTENT, title: 'New Movie: Cartoon', data: { movies: [{ originalTitle: 'Cartoon (1995)' }] } }
  const batch = {
    type: NEW_CONTENT,
    title: 'New Movies: Cartoon and 1 other',
    data: { movies: [{ originalTitle: 'Cartoon (1995)' }, { originalTitle: 'Thriller (1995)' }] },
  }
  const episodes = { type: NEW_CONTENT, title: 'New Episode: Puppets', data: { episodes: [{ originalTitle: 'Puppets' }] } }
  const digest = (moreCount) => ({
    type: NEW_CONTENT,
    data: { contentType: 'digest', items: [{ kind: 'movie', originalTitle: 'Cartoon (1995)' }, { kind: 'show', originalTitle: 'Puppets' }], moreCount },
  })
  const system = { type: 'system_alert', title: 'Maintenance' }

  it('names the titles a notice covers by library key, and knows when that list is not all of them', () => {
    expect(noticeTitles(batch)).toEqual({
      titles: [
        { mediaType: 'movie', originalTitle: 'Cartoon (1995)' },
        { mediaType: 'movie', originalTitle: 'Thriller (1995)' },
      ],
      complete: true,
    })
    expect(noticeTitles(digest(3)).complete).toBe(false)
    expect(noticeTitles({ type: NEW_CONTENT, data: {} }).complete).toBe(false)
    expect(noticeTitles(system)).toEqual({ titles: [], complete: true })
  })

  it('a scoped reader gets a notice only when every title it names is in scope; never one cut down', async () => {
    const notices = [single, batch, episodes, digest(0), digest(2), system]
    expect(await noticesInScope(notices, KIDS)).toEqual([single, episodes, digest(0), system])
    expect(await noticesInScope(notices, FULL_LIBRARY)).toBe(notices)
  })

  it('each recipient is delivered the notices their scope holds, worked out once per scope, under the usual ids', async () => {
    const users = ['aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'cccccccccccccccccccccccc'].map((hex, index) => ({
      _id: { toString: () => hex },
      roles: index === 1 ? ['kids'] : [],
    }))
    mockRecipients.mockResolvedValue(users)
    mockAccessFor.mockImplementation(async (user) => (user.roles.length ? KIDS : FULL_LIBRARY))
    const find = jest.spyOn(col('FlatMovies'), 'find')
    find.mockClear()

    const result = await MediaNotificationOrchestrator.deliverNewContentNotices([single, batch], '6710a0b0c1d2e3f405060708')

    const [docs] = mockInsert.mock.calls[0]
    const byUser = (hex) => docs.filter((doc) => doc.userId === hex).map((doc) => doc.title)
    expect(byUser('aaaaaaaaaaaaaaaaaaaaaaaa')).toEqual([single.title, batch.title])
    expect(byUser('cccccccccccccccccccccccc')).toEqual([single.title, batch.title])
    expect(byUser('bbbbbbbbbbbbbbbbbbbbbbbb')).toEqual([single.title])
    expect(docs.every((doc) => !('noticeIndex' in doc))).toBe(true)
    expect(result).toEqual({ recipients: 3, notices: 2, inserted: 5, alreadyThere: 0 })
    // One lookup for the one scope that needed it
    expect(find).toHaveBeenCalledTimes(1)
  })
})
