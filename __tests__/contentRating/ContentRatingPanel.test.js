import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import ContentRatingPanel from '@components/ContentRatingPanel'
import { MOVIE_CONTENT_RATINGS } from '@src/utils/contentRating'

function renderPanel(rating) {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(
    <ContentRatingPanel rating={rating} />
  )
  return container
}

const obsessionRating = {
  contentRating: 'R',
  country: 'US',
  system: 'MPA',
  mediaType: 'movie',
  descriptors: [],
  reason: null,
  source: 'TMDB',
  provider: 'tmdb',
  certificateId: '55720',
  enrichments: [{
    provider: 'wikidata',
    source: 'Wikidata',
    fields: ['contentRating', 'certificateId'],
    sourceId: 'Q136163067',
    ratingSourceId: 'Q18665344',
    statementId: 'Q136163067$statement-guid',
    externalIds: { tmdb: '1339713', imdb: 'tt37287335' },
    certificateProperty: 'P2676',
    referenceUrl: 'https://www.filmratings.com/example.pdf',
    retrievedAt: '2026-08-16T00:00:00.000Z',
  }],
}

const officialMpaAssetPaths = {
  G: '/assets/content-ratings/mpa/g.svg',
  PG: '/assets/content-ratings/mpa/pg.svg',
  'PG-13': '/assets/content-ratings/mpa/pg-13.svg',
  R: '/assets/content-ratings/mpa/r.svg',
  'NC-17': '/assets/content-ratings/mpa/nc-17.svg',
}

describe('ContentRatingPanel', () => {
  test('renders the full Obsession panel even when descriptors are unavailable', () => {
    const container = renderPanel(obsessionRating)
    const panel = container.querySelector('[data-content-rating-panel="R"]')

    expect(panel).not.toBeNull()
    expect(panel).toHaveAccessibleName('MPA content rating R: Restricted')
    expect(panel.textContent).toContain('Restricted')
    expect(panel.textContent).toContain('Specific content information was not provided.')
    expect(panel.textContent).toContain('Certificate 55720')
    expect(panel.textContent).toContain('Corroborated by Wikidata')
    expect(panel.textContent).toContain('Under 17 requires an accompanying parent or adult guardian.')
    expect(panel.querySelector('[data-rating-template="R"]').getAttribute('href')).toBe('/assets/content-ratings/mpa/r.svg')
    expect(panel.querySelector('[data-rating-descriptor-mask]').getAttribute('fill')).toBe('#fff')
    expect([...panel.querySelectorAll('[data-descriptor-line]')].map((item) => item.textContent).join(' ')).toBe(
      'SPECIFIC CONTENT INFORMATION NOT PROVIDED'
    )
  })

  test('renders normalized descriptors as guidance instead of an empty state', () => {
    const container = renderPanel({
      ...obsessionRating,
      descriptors: ['Strong Language', 'Violence'],
      enrichments: [{
        provider: 'wikidata',
        source: 'Wikidata',
        fields: ['contentRating', 'descriptors'],
      }],
    })

    expect([...container.querySelectorAll('[data-descriptor-line]')].map((item) => item.textContent)).toEqual([
      'Strong Language',
      'Violence',
    ].map((value) => value.toUpperCase()))
    expect(container.querySelector('[data-rating-descriptor-mask]').getAttribute('fill')).toBe('#fff')
    expect(container.textContent).toContain('Descriptors from Wikidata')
  })

  test('wraps Arial Bold descriptor lines within the PG-13 template field', () => {
    const container = renderPanel({
      ...obsessionRating,
      contentRating: 'PG-13',
      descriptors: ['Violence', 'Brief Strong Language', 'Suggestive Material'],
    })

    expect([...container.querySelectorAll('[data-descriptor-line]')].map((item) => item.textContent)).toEqual([
      'VIOLENCE',
      'BRIEF STRONG',
      'LANGUAGE',
      'SUGGESTIVE MATERIAL',
    ])
  })

  test.each(MOVIE_CONTENT_RATINGS)('renders complete fixed guidance for %s', (contentRating) => {
    const container = renderPanel({
      contentRating,
      mediaType: 'movie',
      descriptors: [],
      provider: 'tmdb',
      source: 'TMDB',
    })

    expect(container.querySelector('[data-content-rating-panel]')).not.toBeNull()
    expect(container.querySelector('[data-rating-definition]')?.textContent).not.toBe('')
  })

  test.each(Object.entries(officialMpaAssetPaths))('maps %s to the local official template', (contentRating, assetPath) => {
    const container = renderPanel({
      contentRating,
      mediaType: 'movie',
      descriptors: [],
      provider: 'tmdb',
      source: 'TMDB',
    })

    expect(container.querySelector(`[data-rating-template="${contentRating}"]`).getAttribute('href')).toBe(assetPath)
  })

  test.each(Object.values(officialMpaAssetPaths))('keeps %s monochrome without a rasterizing filter', (assetPath) => {
    const source = readFileSync(`${process.cwd()}/public${assetPath}`, 'utf8')
    const fills = [...source.matchAll(/fill="([^"]+)"/g)].map((match) => match[1])

    expect(new Set(fills)).toEqual(new Set(['#000000', '#FFFFFF']))
  })

  test.each(Object.entries(officialMpaAssetPaths))('keeps the %s registration circle inside its padded viewBox', (contentRating, assetPath) => {
    const container = renderPanel({
      contentRating,
      mediaType: 'movie',
      descriptors: [],
      provider: 'tmdb',
      source: 'TMDB',
    })
    const panel = container.querySelector('[data-content-rating-panel]')
    const [, , width] = panel.getAttribute('viewBox').split(' ').map(Number)
    const halo = panel.querySelector('[data-rating-registration-halo]')
    const source = readFileSync(`${process.cwd()}/public${assetPath}`, 'utf8')
    const sourceWidth = Number(source.match(/viewBox="0 0 ([\d.]+)/)?.[1])

    expect(sourceWidth).toBeCloseTo(width)
    expect(width - (Number(halo.getAttribute('cx')) + Number(halo.getAttribute('r')))).toBeGreaterThanOrEqual(0.6)
  })

  test('preserves the official G classification panel instead of treating it as a descriptor placeholder', () => {
    const container = renderPanel({
      contentRating: 'G',
      mediaType: 'movie',
      descriptors: [],
      provider: 'tmdb',
      source: 'TMDB',
    })

    expect(container.querySelector('[data-rating-descriptor-mask]')).toBeNull()
    expect(container.querySelector('[data-rating-descriptors]')).toBeNull()
  })

  test('treats NR as an absence of classification instead of saying Rated NR', () => {
    const container = renderPanel('NR')

    expect(container.textContent).toContain('Not rated')
    expect(container.textContent).toContain('This title has not received an MPA classification.')
    expect(container.textContent).not.toContain('Rated NR')
  })

  test('does not expose raw provider identifiers, statement data, or reference URLs', () => {
    const container = renderPanel(obsessionRating)

    expect(container.textContent).not.toMatch(/Q\d+/)
    expect(container.textContent).not.toContain('tt37287335')
    expect(container.textContent).not.toContain('P2676')
    expect(container.textContent).not.toContain('statement-guid')
    expect(container.querySelector('a')).toBeNull()
    expect(container.innerHTML).not.toContain('filmratings.com')
  })

  test('rejects zero-width Unicode format controls before rendering descriptors', () => {
    const container = renderPanel({
      contentRating: 'R',
      mediaType: 'movie',
      descriptors: ['Safe\u200bText', 'Violence'],
      provider: 'tmdb',
      source: 'TMDB',
    })

    expect([...container.querySelectorAll('[data-descriptor-line]')].map((item) => item.textContent)).toEqual([
      'Violence',
    ].map((value) => value.toUpperCase()))
  })

  test.each([null, undefined, '', 'TV-MA', 'INVALID', { contentRating: 'PG-13', mediaType: 'tv' }])(
    'renders no panel for absent or non-movie value %p',
    (rating) => {
      expect(renderPanel(rating).childElementCount).toBe(0)
    }
  )

  test('renders a bounded responsive SVG without HTML layout or foreignObject', () => {
    const container = renderPanel({
      contentRating: 'PG-13',
      mediaType: 'movie',
      descriptors: Array.from({ length: 8 }, (_, index) => `${index} ${'x'.repeat(157)}`),
      provider: 'tmdb',
      source: 'TMDB',
    })
    const panel = container.querySelector('[data-content-rating-panel]')
    const [, , width, height] = panel.getAttribute('viewBox').split(' ').map(Number)

    expect(container.innerHTML.length).toBeLessThan(16 * 1024)
    expect(panel.tagName.toLowerCase()).toBe('svg')
    expect(panel.getAttribute('class')).toContain('max-w-sm')
    expect(width).toBeCloseTo(117.2641602)
    expect(height).toBeCloseTo(40.8917084)
    expect(panel.querySelector('[data-rating-template="PG-13"]').getAttribute('href')).toBe('/assets/content-ratings/mpa/pg-13.svg')
    expect(panel.querySelectorAll('image')).toHaveLength(1)
    expect(panel.querySelector('[data-rating-descriptor-mask]').getAttribute('fill')).toBe('#fff')
    expect(panel.querySelector('[data-rating-descriptors]').getAttribute('font-family')).toBe('Arial, Helvetica, sans-serif')
    expect(panel.querySelector('[data-rating-descriptors]').getAttribute('font-weight')).toBe('700')
    expect([...panel.querySelectorAll('[data-descriptor-line]')].at(-1).textContent).toBe('MORE DESCRIPTORS')
    expect(panel.querySelector('[data-rating-template]').hasAttribute('filter')).toBe(false)
    expect(panel.querySelector('[data-rating-registration-halo]').getAttribute('fill')).toBe('#fff')
    expect(panel.querySelector('[data-rating-template-filter]')).toBeNull()
    expect(panel.querySelector('foreignObject')).toBeNull()
    expect(panel.querySelector('script,style,a')).toBeNull()
    expect(container.querySelector('section,div,p,ul,li')).toBeNull()
  })
})