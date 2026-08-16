import { renderToStaticMarkup } from 'react-dom/server'

jest.mock('@vidstack/react', () => ({
  Title: () => <span>Player title</span>,
  ChapterTitle: () => null,
  useChapterTitle: () => null,
  useMediaPlayer: () => ({ currentTime: 0 }),
  useMediaState: () => true,
}))

import { VideoMetadata } from '@components/MediaPlayer/title'

describe('media player content-rating compatibility', () => {
  test('renders a legacy movie rating through the official player block', () => {
    const html = renderToStaticMarkup(
      <VideoMetadata mediaMetadata={{ rating: 'PG-13', title: 'Example' }} />
    )

    expect(html).toContain('data-content-rating="PG-13"')
    expect(html).toContain('data-content-rating-panel="PG-13"')
    expect(html).toContain(
      'aria-label="MPA content rating PG-13: Parents strongly cautioned"'
    )
  })

  test('renders one official block when both the normalized object and legacy string are present', () => {
    const html = renderToStaticMarkup(
      <VideoMetadata
        mediaMetadata={{
          rating: 'PG-13',
          contentRating: {
            contentRating: 'PG-13',
            country: 'US',
            system: 'MPA',
            mediaType: 'movie',
            descriptors: [],
            reason: null,
            source: 'TMDB',
          },
          title: 'Example',
        }}
      />
    )

    expect(html.match(/data-content-rating-panel="PG-13"/g)).toHaveLength(1)
    expect(html).not.toContain('aria-label="Rated PG-13"')
  })

  test('replaces the top-right movie badge with the official block at a bounded width', () => {
    const html = renderToStaticMarkup(
      <VideoMetadata
        mediaMetadata={{
          mediaType: 'movie',
          contentRating: {
            contentRating: 'R',
            country: 'US',
            system: 'MPA',
            mediaType: 'movie',
            descriptors: ['Strong Language'],
            reason: null,
            source: 'TMDB',
          },
          title: 'Example',
        }}
      />
    )

    expect(html).toContain('data-player-rating-panel="true"')
    expect(html).toContain('w-56')
    expect(html).toContain('xl:w-64')
    expect(html).toContain('media-rating')
    expect(html).toContain('data-rating-template="R"')
    expect(html).not.toContain('aria-label="Rated R. Show rating details"')
  })

  test('keeps TV ratings compact without rendering an MPA block', () => {
    const html = renderToStaticMarkup(
      <VideoMetadata
        mediaMetadata={{
          mediaType: 'tv',
          contentRating: {
            contentRating: 'TV-MA',
            country: 'US',
            system: 'TV Parental Guidelines',
            mediaType: 'tv',
            descriptors: [],
            reason: null,
            source: 'TMDB',
          },
          title: 'Example',
        }}
      />
    )

    expect(html).toContain('aria-label="Rated TV-MA"')
    expect(html).not.toContain('data-player-rating-panel')
    expect(html).not.toContain('data-content-rating-panel')
  })

  test('falls back to a valid legacy string when the new object is malformed', () => {
    const html = renderToStaticMarkup(
      <VideoMetadata
        mediaMetadata={{
          rating: 'R',
          contentRating: { contentRating: '<script>', mediaType: 'movie' },
          title: 'Example',
        }}
      />
    )

    expect(html.match(/data-content-rating-panel="R"/g)).toHaveLength(1)
    expect(html).not.toContain('aria-label="Rated R"')
  })

  test('does not crash or render a badge for an unknown legacy value', () => {
    expect(() => renderToStaticMarkup(
      <VideoMetadata mediaMetadata={{ rating: '<script>', title: 'Example' }} />
    )).not.toThrow()

    const html = renderToStaticMarkup(
      <VideoMetadata mediaMetadata={{ rating: '<script>', title: 'Example' }} />
    )
    expect(html).not.toContain('data-content-rating')
    expect(html).not.toContain('&lt;script&gt;')
  })
})
