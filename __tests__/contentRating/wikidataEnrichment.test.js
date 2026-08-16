import {
  CONTENT_RATING_ENRICHERS,
  CONTENT_RATING_PROVIDERS,
  normalizeContentRating,
  resolveContentRating,
} from '@src/utils/contentRating'
import { wikidataContentRatingEnricher } from '@src/utils/contentRatingWikidataEnricher'
import { tmdbContentRatingProvider } from '@src/utils/contentRatingTmdbProvider'

const movieReleaseDates = (descriptors = []) => ({
  results: [{
    iso_3166_1: 'US',
    release_dates: [{
      certification: 'R',
      type: 3,
      release_date: '2026-03-25T00:00:00.000Z',
      descriptors,
    }],
  }],
})

const wikidataBlock = (overrides = {}) => ({
  schema: 1,
  entityId: 'Q136163067',
  tmdbMovieId: '1339713',
  imdbId: 'tt37287335',
  contentRating: 'R',
  ratingEntityId: 'Q18665344',
  descriptors: [],
  certificateId: '55720',
  certificateProperty: 'P2676',
  statementId: 'Q136163067$statement-guid',
  referenceUrl: 'https://www.filmratings.com/Content/Downloads/cara_rating_bulletin.pdf',
  referencePublisherId: 'Q676222',
  referencePublicationDate: '2026-03-25',
  retrievedAt: '2026-08-16T00:00:00.000Z',
  ...overrides,
})

const movie = (block = wikidataBlock(), tmdbDescriptors = []) => ({
  tmdbId: 1339713,
  imdbId: 'tt37287335',
  metadata: {
    id: 1339713,
    imdb_id: 'tt37287335',
    release_dates: movieReleaseDates(tmdbDescriptors),
    contentRatingEnrichments: { wikidata: block },
  },
})

describe('Wikidata content-rating enrichment', () => {
  test('uses a separate immutable enricher registry without changing provider order', () => {
    expect(Object.isFrozen(CONTENT_RATING_ENRICHERS)).toBe(true)
    expect(CONTENT_RATING_ENRICHERS).toEqual([wikidataContentRatingEnricher])
    expect(CONTENT_RATING_PROVIDERS).toEqual([tmdbContentRatingProvider])
  })

  test('keeps TMDB as classification provider and adds compatible certificate evidence', () => {
    expect(resolveContentRating(movie(), 'movie')).toEqual({
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
        referenceUrl: 'https://www.filmratings.com/Content/Downloads/cara_rating_bulletin.pdf',
        referencePublisherId: 'Q676222',
        referencePublicationDate: '2026-03-25',
        retrievedAt: '2026-08-16T00:00:00.000Z',
      }],
    })
  })

  test('fills an empty descriptor field atomically but never replaces TMDB descriptors', () => {
    const enriched = resolveContentRating(movie(wikidataBlock({
      descriptors: ['Strong Language', 'Violence'],
      certificateId: undefined,
      certificateProperty: undefined,
    })), 'movie')
    expect(enriched.descriptors).toEqual(['Strong Language', 'Violence'])
    expect(enriched.enrichments[0].fields).toEqual(['contentRating', 'descriptors'])

    const tmdbFirst = resolveContentRating(movie(wikidataBlock({
      descriptors: ['Strong Language'],
    }), ['Violence']), 'movie')
    expect(tmdbFirst.descriptors).toEqual(['Violence'])
    expect(tmdbFirst.enrichments[0].fields).toEqual(['contentRating', 'certificateId'])
  })

  test('rejects code, TMDB identity, IMDb identity, and television conflicts atomically', () => {
    const base = resolveContentRating(movie(null), 'movie')
    expect(resolveContentRating(movie(wikidataBlock({
      contentRating: 'PG-13',
      ratingEntityId: 'Q18665339',
    })), 'movie')).toEqual(base)
    expect(resolveContentRating(movie(wikidataBlock({ tmdbMovieId: '999' })), 'movie')).toEqual(base)
    expect(resolveContentRating(movie(wikidataBlock({ imdbId: 'tt0000000' })), 'movie')).toEqual(base)

    expect(resolveContentRating({
      metadata: {
        id: 123,
        content_ratings: { results: [{ iso_3166_1: 'US', rating: 'TV-MA' }] },
        contentRatingEnrichments: { wikidata: wikidataBlock({ tmdbMovieId: '123' }) },
      },
    }, 'tv')).toEqual({
      contentRating: 'TV-MA',
      country: 'US',
      system: 'TV Parental Guidelines',
      mediaType: 'tv',
      descriptors: [],
      reason: null,
      source: 'TMDB',
      provider: 'tmdb',
    })
  })

  test('manual override and suppression remain final', () => {
    expect(resolveContentRating({
      ...movie(),
      contentRatingOverride: {
        contentRating: 'PG-13',
        mediaType: 'movie',
        provider: 'manual',
        source: 'Manual',
      },
    }, 'movie')).toEqual({
      contentRating: 'PG-13',
      country: 'US',
      system: 'MPA',
      mediaType: 'movie',
      descriptors: [],
      reason: null,
      source: 'Manual',
      provider: 'manual',
    })
    expect(resolveContentRating({ ...movie(), contentRatingOverride: null }, 'movie')).toBeNull()
  })

  test('normalization round-trips bounded evidence and drops hostile optional fields', () => {
    const enriched = resolveContentRating(movie(wikidataBlock({
      descriptors: ['Strong Language', '\u061cHidden direction'],
    })), 'movie')
    expect(enriched.descriptors).toEqual(['Strong Language'])
    expect(normalizeContentRating(enriched, 'movie')).toEqual(enriched)

    const hostile = normalizeContentRating({
      contentRating: 'R',
      mediaType: 'movie',
      provider: 'tmdb',
      source: 'TMDB',
      certificateId: '<script>',
      enrichments: [{
        provider: 'wikidata',
        source: 'Wikidata',
        fields: ['contentRating', 'unknown'],
        referenceUrl: 'javascript:alert(1)',
      }],
    })
    expect(hostile).not.toHaveProperty('certificateId')
    expect(hostile.enrichments[0]).toEqual({
      provider: 'wikidata',
      source: 'Wikidata',
      fields: ['contentRating'],
    })

    const emptyEvidence = normalizeContentRating({
      contentRating: 'R',
      mediaType: 'movie',
      provider: 'tmdb',
      source: 'TMDB',
      enrichments: [{
        provider: 'wikidata',
        source: 'Wikidata',
        fields: ['unknown'],
      }],
    })
    expect(emptyEvidence).not.toHaveProperty('enrichments')
  })

  test('malformed or throwing enrichment payloads remain nonfatal', () => {
    const media = movie()
    Object.defineProperty(media.metadata.contentRatingEnrichments, 'wikidata', {
      get() {
        throw new Error('hostile getter')
      },
    })

    expect(() => resolveContentRating(media, 'movie')).not.toThrow()
    expect(resolveContentRating(media, 'movie')?.contentRating).toBe('R')
    expect(resolveContentRating(media, 'movie')).not.toHaveProperty('enrichments')
  })
})
