/**
 * @jest-environment node
 *
 * The notices for the titles a sync run added (run/newContent selects them):
 * movies five to a notice, episodes one notice per show, and one digest
 * instead when that comes to more notices than the run may send — a first
 * sync into an empty library, or a newly added server, must not send hundreds.
 */

jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))
jest.mock('@src/lib/userQueries', () => ({ userQueries: { find: jest.fn() } }))
jest.mock('@src/utils/notifications/notificationDatabase.js', () => ({ insertNotificationsOnce: jest.fn() }))

const { MediaAdditionAnalyzer } = require('@src/utils/notifications/analyzers/MediaAdditionAnalyzer')
const {
  NewContentNotificationGenerator,
  DIGEST_ITEM_LIMIT,
} = require('@src/utils/notifications/generators/NewContentNotificationGenerator')
const {
  MediaNotificationOrchestrator,
  newContentNotificationId,
} = require('@src/utils/notifications/MediaNotificationOrchestrator')
const { insertNotificationsOnce } = require('@src/utils/notifications/notificationDatabase.js')
const { NEW_CONTENT_RECIPIENTS_FILTER } = require('@src/utils/notifications/recipients')
const { userQueries } = require('@src/lib/userQueries')

const ARRIVED = new Date('2026-10-17T10:00:00.000Z')
const movie = (n) => ({
  id: `m${n}`,
  title: `Movie ${n}`,
  originalTitle: `Movie ${n} (2020)`,
  posterURL: n % 2 === 0 ? `https://files.example/movie-${n}.jpg` : null,
  createdAt: ARRIVED,
})
const episode = (show, season, number) => ({
  id: `${show}-${season}-${number}`,
  showTitle: `Show ${show}`,
  originalTitle: `Show ${show} (2019)`,
  showPosterURL: `https://files.example/show-${show}.jpg`,
  seasonNumber: season,
  episodeNumber: number,
  title: `Episode ${number}`,
  createdAt: ARRIVED,
})
const OPTIONS = { batchSimilarContent: true, maxMoviesPerNotification: 5, maxNotifications: 5, includeMetadata: true }

describe('MediaAdditionAnalyzer.analyzeNewContent', () => {
  it('groups episodes by the show’s folder name and finds each show’s latest episode', () => {
    const analysis = MediaAdditionAnalyzer.analyzeNewContent({
      movies: [movie(1)],
      episodes: [episode('A', 2, 1), episode('A', 1, 9), episode('B', 1, 3)],
    })

    expect(analysis.shouldNotify).toBe(true)
    expect(analysis.summary).toEqual({ totalNewMovies: 1, totalNewEpisodes: 3, totalAffectedShows: 2 })
    const showA = analysis.showsWithNewEpisodes.get('Show A (2019)')
    expect(showA.episodes.map((e) => `S${e.seasonNumber}E${e.episodeNumber}`)).toEqual(['S1E9', 'S2E1'])
    expect(showA).toMatchObject({ totalNewEpisodes: 2, latestSeason: 2, latestEpisode: 1 })
  })

  it('has nothing to notify about when nothing was added', () => {
    expect(MediaAdditionAnalyzer.analyzeNewContent({ movies: [], episodes: [] }).shouldNotify).toBe(false)
  })
})

describe('NewContentNotificationGenerator.generateNotifications', () => {
  const notices = (content) =>
    NewContentNotificationGenerator.generateNotifications(MediaAdditionAnalyzer.analyzeNewContent(content), OPTIONS)

  it('sends one notice for a single new episode, linking to it by the show’s folder name', () => {
    const [notice] = notices({ episodes: [episode('A', 1, 4)] })

    expect(notice).toMatchObject({
      subtype: 'new_episodes',
      title: 'New Episode: Show A',
      message: 'S1E4 - Episode 4 is now available.',
      actionUrl: `/list/tv/${encodeURIComponent('Show A (2019)')}/1/4`,
    })
  })

  it('sends movies five to a notice and one notice per show, up to the run’s limit', () => {
    const sent = notices({
      movies: [1, 2, 3, 4, 5, 6, 7].map(movie),
      episodes: [episode('A', 1, 1), episode('A', 1, 2), episode('B', 1, 1)],
    })

    expect(sent.map((n) => n.subtype)).toEqual(['new_movies_batch', 'new_movies_batch', 'new_episodes', 'new_episodes'])
    expect(sent[0].data.count + sent[1].data.count).toBe(7)
  })

  it('sends one digest instead when the run added more than that', () => {
    const shows = ['A', 'B', 'C', 'D', 'E', 'F']
    const sent = notices({
      movies: [1, 2, 3].map(movie),
      episodes: shows.flatMap((show) => [episode(show, 1, 1), episode(show, 1, 2)]),
    })

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: 'new_content',
      subtype: 'new_content_digest',
      message: '3 new movies and 12 new episodes of 6 shows have been added to your library.',
      actionUrl: '/list',
      data: { contentType: 'digest', movieCount: 3, episodeCount: 12, showCount: 6 },
    })
    expect(sent[0].data.items).toHaveLength(9)
    expect(sent[0].data.moreCount).toBe(0)
    expect(sent[0].contentHash).toEqual(expect.any(String))
  })

  it('lists its titles in the documented shape: movies, then shows, each by title, linking to their pages', () => {
    const [digest] = notices({
      movies: [movie(2), movie(1), movie(3)],
      episodes: ['B', 'A', 'C', 'D', 'E', 'F'].flatMap((show) => [episode(show, 1, 1), episode(show, 1, 2)]),
    })

    expect(digest.data.items.slice(0, 4)).toEqual([
      {
        kind: 'movie',
        title: 'Movie 1',
        originalTitle: 'Movie 1 (2020)',
        href: `/list/movie/${encodeURIComponent('Movie 1 (2020)')}`,
        posterURL: null,
      },
      {
        kind: 'movie',
        title: 'Movie 2',
        originalTitle: 'Movie 2 (2020)',
        href: `/list/movie/${encodeURIComponent('Movie 2 (2020)')}`,
        posterURL: 'https://files.example/movie-2.jpg',
      },
      expect.objectContaining({ kind: 'movie', title: 'Movie 3' }),
      {
        kind: 'show',
        title: 'Show A',
        originalTitle: 'Show A (2019)',
        href: `/list/tv/${encodeURIComponent('Show A (2019)')}`,
        posterURL: 'https://files.example/show-A.jpg',
        newEpisodes: 2,
      },
    ])
    expect(digest.data.items.slice(3).map((item) => item.title)).toEqual(['Show A', 'Show B', 'Show C', 'Show D', 'Show E', 'Show F'])
    // Only what the page needs travels with it
    expect(Object.keys(digest.data).sort()).toEqual(['contentType', 'episodeCount', 'items', 'moreCount', 'movieCount', 'showCount'])
  })

  it('keeps a first sync of a whole library to one notice', () => {
    const movies = Array.from({ length: 400 }, (_, i) => movie(i))
    const episodes = Array.from({ length: 200 }, (_, i) => episode(`S${i}`, 1, 1))

    const sent = notices({ movies, episodes })

    expect(sent).toHaveLength(1)
    expect(sent[0].data).toMatchObject({ movieCount: 400, episodeCount: 200, showCount: 200 })
    // A bounded list, and a count of the rest
    expect(sent[0].data.items).toHaveLength(DIGEST_ITEM_LIMIT)
    expect(DIGEST_ITEM_LIMIT).toBe(24)
    expect(sent[0].data.moreCount).toBe(600 - 24)
  })
})

describe('MediaNotificationOrchestrator new-content delivery', () => {
  const DELIVERY = '6710a0b0c1d2e3f405060708'
  const recipients = [{ _id: { toString: () => 'aaaaaaaaaaaaaaaaaaaaaaaa' } }, { _id: { toString: () => 'bbbbbbbbbbbbbbbbbbbbbbbb' } }]

  beforeEach(() => {
    userQueries.find.mockReset().mockResolvedValue(recipients)
    insertNotificationsOnce.mockReset().mockImplementation(async (docs) => ({ inserted: docs.length, alreadyThere: 0 }))
  })

  it('composes nothing when there is nothing to announce', () => {
    expect(MediaNotificationOrchestrator.composeNewContentNotices({ movies: [], episodes: [] }, OPTIONS)).toEqual([])
  })

  it('sends to approved accounts without limited access, chosen in one place', async () => {
    await MediaNotificationOrchestrator.deliverNewContentNotices([{ title: 'n' }], DELIVERY)

    expect(userQueries.find).toHaveBeenCalledWith({ approved: true, limitedAccess: { $ne: true } }, { _id: 1 })
    expect(NEW_CONTENT_RECIPIENTS_FILTER).toEqual({ approved: true, limitedAccess: { $ne: true } })
  })

  it('gives every notice one notification per recipient, under ids the same on every attempt', async () => {
    const notices = MediaNotificationOrchestrator.composeNewContentNotices({ movies: [movie(1)], episodes: [episode('A', 1, 1)] }, OPTIONS)

    const first = await MediaNotificationOrchestrator.deliverNewContentNotices(notices, DELIVERY)
    const second = await MediaNotificationOrchestrator.deliverNewContentNotices(notices, DELIVERY)

    expect(first).toEqual({ recipients: 2, notices: 2, inserted: 4, alreadyThere: 0 })
    const [docs1] = insertNotificationsOnce.mock.calls[0]
    const [docs2] = insertNotificationsOnce.mock.calls[1]
    expect(docs1.map((d) => d._id.toHexString())).toEqual(docs2.map((d) => d._id.toHexString()))
    expect(new Set(docs1.map((d) => d._id.toHexString())).size).toBe(4)
    // The delivery's timestamp leads, so ids still sort by when they were queued
    expect(docs1.every((d) => d._id.toHexString().startsWith(DELIVERY.slice(0, 8)))).toBe(true)
    expect(docs1.map((d) => d.userId)).toEqual([
      'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb', 'aaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbbbbbbbbbb',
    ])
    expect(second.recipients).toBe(2)
  })

  it('uses other ids for another queued delivery', () => {
    const a = newContentNotificationId(DELIVERY, 0, 'aaaaaaaaaaaaaaaaaaaaaaaa')
    expect(newContentNotificationId(DELIVERY, 0, 'aaaaaaaaaaaaaaaaaaaaaaaa').equals(a)).toBe(true)
    expect(newContentNotificationId('6710a0b0c1d2e3f405060709', 0, 'aaaaaaaaaaaaaaaaaaaaaaaa').equals(a)).toBe(false)
    expect(newContentNotificationId(DELIVERY, 1, 'aaaaaaaaaaaaaaaaaaaaaaaa').equals(a)).toBe(false)
  })

  it('throws when the notifications could not be written, so the queued delivery is tried again', async () => {
    insertNotificationsOnce.mockRejectedValue(new Error('not primary'))

    await expect(MediaNotificationOrchestrator.deliverNewContentNotices([{ title: 'n' }], DELIVERY)).rejects.toThrow('not primary')
  })

  it('links a movie notice to the movie page and a batch to the movie list', () => {
    const [single] = MediaNotificationOrchestrator.composeNewContentNotices({ movies: [movie(1)], episodes: [] }, OPTIONS)
    const [batch] = MediaNotificationOrchestrator.composeNewContentNotices({ movies: [movie(1), movie(2)], episodes: [] }, OPTIONS)

    expect(single.actionUrl).toBe(`/list/movie/${encodeURIComponent('Movie 1 (2020)')}`)
    expect(batch.actionUrl).toBe('/list/movie')
  })
})
