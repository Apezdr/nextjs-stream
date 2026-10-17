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
jest.mock('@src/utils/notifications/NotificationManager.js', () => ({
  NotificationManager: { createNotification: jest.fn(async () => ({})), getNotificationsByContentHash: jest.fn(async () => []) },
}))

const { MediaAdditionAnalyzer } = require('@src/utils/notifications/analyzers/MediaAdditionAnalyzer')
const { NewContentNotificationGenerator } = require('@src/utils/notifications/generators/NewContentNotificationGenerator')
const { MediaNotificationOrchestrator } = require('@src/utils/notifications/MediaNotificationOrchestrator')
const { NotificationManager } = require('@src/utils/notifications/NotificationManager.js')
const { userQueries } = require('@src/lib/userQueries')

const ARRIVED = new Date('2026-10-17T10:00:00.000Z')
const movie = (n) => ({ id: `m${n}`, title: `Movie ${n}`, originalTitle: `Movie ${n} (2020)`, createdAt: ARRIVED })
const episode = (show, season, number) => ({
  id: `${show}-${season}-${number}`,
  showTitle: `Show ${show}`,
  originalTitle: `Show ${show} (2019)`,
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
    expect(sent[0].data.shows).toHaveLength(6)
    expect(sent[0].contentHash).toEqual(expect.any(String))
  })

  it('keeps a first sync of a whole library to one notice', () => {
    const movies = Array.from({ length: 400 }, (_, i) => movie(i))
    const episodes = Array.from({ length: 200 }, (_, i) => episode(`S${i}`, 1, 1))

    const sent = notices({ movies, episodes })

    expect(sent).toHaveLength(1)
    expect(sent[0].data).toMatchObject({ movieCount: 400, episodeCount: 200, showCount: 200 })
    expect(sent[0].data.movies).toHaveLength(10)
    expect(sent[0].data.shows).toHaveLength(10)
  })
})

describe('MediaNotificationOrchestrator.announceNewContent', () => {
  it('delivers each notice once to every user', async () => {
    userQueries.find.mockResolvedValue([{ _id: { toString: () => 'u1' } }, { _id: { toString: () => 'u2' } }])
    jest.spyOn(console, 'log').mockImplementation(() => {})

    const result = await MediaNotificationOrchestrator.announceNewContent(
      { movies: [movie(1)], episodes: [] },
      { generationOptions: OPTIONS, deliveryOptions: { targetAllUsers: true, checkDuplicates: true } }
    )

    expect(result.summary).toMatchObject({ totalGenerated: 1, totalDelivered: 1, totalErrors: 0 })
    expect(NotificationManager.createNotification).toHaveBeenCalledTimes(2)
    expect(NotificationManager.createNotification.mock.calls[0][1]).toMatchObject({
      subtype: 'new_movie',
      actionUrl: `/list/movies/${encodeURIComponent('Movie 1 (2020)')}`,
    })
  })
})
