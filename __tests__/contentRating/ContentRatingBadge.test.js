import { renderToStaticMarkup } from 'react-dom/server'
import ContentRatingBadge from '@components/ContentRatingBadge'

function renderBadge(props) {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(<ContentRatingBadge {...props} />)
  return container
}

describe('ContentRatingBadge', () => {
  test('renders accessible movie and television badges', () => {
    const movie = renderBadge({ rating: 'PG-13', mediaType: 'movie' })
    const tv = renderBadge({ rating: 'TV-MA', mediaType: 'tv' })

    expect(movie.querySelector('[role="img"]')).toHaveAccessibleName('Rated PG-13')
    expect(movie.textContent).toContain('PG-13')
    expect(tv.querySelector('[role="img"]')).toHaveAccessibleName('Rated TV-MA')
    expect(tv.textContent).toContain('TV-MA')
  })

  test.each([null, undefined, '', 'INVALID', { contentRating: 'PG-13', mediaType: 'tv' }])(
    'renders no badge for absent or malformed value %p',
    (rating) => {
      expect(renderBadge({ rating }).childElementCount).toBe(0)
    }
  )

  test('keeps the legacy string-only player contract usable', () => {
    const container = renderBadge({ rating: 'R', mediaType: 'movie', variant: 'player' })

    expect(container.querySelector('[role="img"]')).toHaveAccessibleName('Rated R')
    expect(container.textContent).toBe('R')
  })

  test('renders provider-neutral normalized metadata without provider-specific UI logic', () => {
    const container = renderBadge({
      rating: {
        contentRating: 'PG-13',
        country: 'US',
        system: 'MPA',
        mediaType: 'movie',
        descriptors: ['Violence'],
        reason: null,
        source: 'LICENSED',
        provider: 'licensed-provider',
      },
    })

    expect(container.querySelector('[data-content-rating="PG-13"]')).not.toBeNull()
    expect(container.textContent).toContain('Violence')
    expect(container.textContent).not.toContain('licensed-provider')
  })

  test('renders no information control when descriptors and reason are absent', () => {
    const container = renderBadge({
      rating: {
        contentRating: 'PG',
        country: 'US',
        system: 'MPA',
        mediaType: 'movie',
        descriptors: [],
        reason: null,
        source: 'TMDB',
      },
    })

    expect(container.querySelector('details')).toBeNull()
    expect(container.querySelector('summary')).toBeNull()
    expect(container.querySelector('[role="img"]')).toHaveAccessibleName('Rated PG')
  })

  test('uses a native keyboard- and touch-operable disclosure when details exist', () => {
    const container = renderBadge({
      rating: {
        contentRating: 'PG-13',
        country: 'US',
        system: 'MPA',
        mediaType: 'movie',
        descriptors: ['Violence', 'Strong Language'],
        reason: null,
        source: 'TMDB',
      },
    })
    const details = container.querySelector('details')
    const summary = container.querySelector('summary')

    expect(details).not.toBeNull()
    expect(summary).toHaveAccessibleName('Rated PG-13. Show rating details')
    expect(summary.className).toContain('min-h-11')
    expect(summary.className).toContain('min-w-11')
    expect(container.textContent).toContain('Violence')
    expect(container.textContent).toContain('Strong Language')

    document.body.append(container)
    summary.focus()
    summary.click()
    expect(details.open).toBe(true)
    expect(document.activeElement).toBe(summary)
  })

  test('does not trust or render an unverified official reason', () => {
    const container = renderBadge({
      rating: {
        contentRating: 'PG-13',
        mediaType: 'movie',
        descriptors: ['Violence'],
        reason: '<script>unverified</script>',
      },
    })

    expect(container.textContent).not.toContain('unverified')
    expect(container.querySelector('script')).toBeNull()
  })
})
