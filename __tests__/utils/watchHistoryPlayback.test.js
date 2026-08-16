import {
  buildWatchHistoryAdminEditHref,
  buildWatchHistoryLibraryHref,
  buildWatchHistoryPlaybackHref,
  formatPlaybackPosition,
} from '@src/utils/watchHistoryPlayback'

describe('buildWatchHistoryLibraryHref', () => {
  test('sends a movie to its library page, never the player', () => {
    const href = buildWatchHistoryLibraryHref({
      type: 'movie',
      link: 'The%20Hateful%20Eight',
      playbackTime: 4123.8,
    })
    expect(href).toBe('/list/movie/The%20Hateful%20Eight')
    expect(href).not.toMatch(/\/play(\?|$)/)
    expect(href).not.toMatch(/start=/)
  })

  test('keeps the season and episode segments for an episode', () => {
    expect(buildWatchHistoryLibraryHref({ type: 'tv', link: 'American%20Dad/14/1' }))
      .toBe('/list/tv/American%20Dad/14/1')
  })

  test('is independent of playback position and rejects incomplete items', () => {
    expect(buildWatchHistoryLibraryHref({ type: 'movie', link: 'Example', playbackTime: NaN }))
      .toBe('/list/movie/Example')
    expect(buildWatchHistoryLibraryHref({ type: 'movie' })).toBeNull()
    expect(buildWatchHistoryLibraryHref({ type: 'other', link: 'Example' })).toBeNull()
  })
})

describe('buildWatchHistoryPlaybackHref', () => {
  test('opens a movie player at the recorded whole second', () => {
    expect(buildWatchHistoryPlaybackHref({
      type: 'movie',
      link: 'The%20Hateful%20Eight',
      playbackTime: 4123.8,
    })).toBe('/list/movie/The%20Hateful%20Eight/play?start=4123')
  })

  test('preserves an episode route and appends its playback timestamp', () => {
    expect(buildWatchHistoryPlaybackHref({
      type: 'tv',
      link: 'American%20Dad/14/1',
      playbackTime: 502,
    })).toBe('/list/tv/American%20Dad/14/1/play?start=502')
  })

  test('uses the beginning for an invalid timestamp and rejects incomplete items', () => {
    expect(buildWatchHistoryPlaybackHref({ type: 'movie', link: 'Example', playbackTime: NaN }))
      .toBe('/list/movie/Example/play?start=0')
    expect(buildWatchHistoryPlaybackHref({ type: 'movie', playbackTime: 10 })).toBeNull()
  })
})

describe('buildWatchHistoryAdminEditHref', () => {
  test('links movies to their admin record', () => {
    expect(buildWatchHistoryAdminEditHref({ type: 'movie', _id: 'movie-id' }))
      .toBe('/admin/media/movies/movie-id')
  })

  test('deep-links episodes inside the TV show editor', () => {
    expect(buildWatchHistoryAdminEditHref({
      type: 'tv',
      showId: 'show-id',
      seasonNumber: 14,
      episodeNumber: 1,
    })).toBe('/admin/media/tv/show-id?season=14&episode=1')
  })
})

test.each([
  [0, '00:00'],
  [62.9, '01:02'],
  [3661, '1:01:01'],
  [null, '00:00'],
])('formats playback position %p as %s', (value, expected) => {
  expect(formatPlaybackPosition(value)).toBe(expected)
})