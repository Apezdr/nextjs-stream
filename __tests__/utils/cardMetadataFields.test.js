/**
 * @jest-environment node
 *
 * Row cards out of /api/authenticated/horizontal-list carry only the TMDB
 * metadata fields some client reads from a row item. Each field below names
 * its reader; a field with no reader left should leave both lists.
 */
const { CARD_METADATA_FIELDS, trimCardMetadata } = require('@src/utils/cardMetadataFields')

const READERS = {
  // InfoSection.jsx (tmdbId for the watchlist and Radarr/Sonarr buttons);
  // PopupCard popupHelpers.js getApiEndpoint for unavailable titles
  id: 'web',
  // nextjs-stream-tv-mobile list mappers: item.tmdbId ?? metadata.tmdbId ?? metadata.tmdb_id
  tmdbId: 'tv app',
  tmdb_id: 'tv app',
  // Card.js: the "coming" date of an unavailable title
  release_date: 'web',
  first_air_date: 'web',
  // WatchProgress/progress.js durationMsFrom: the progress bar's duration fallback
  runtime: 'web',
  // PopupCard hooks/useMediaAssets.js: the popup logo's last fallback
  logo_path: 'web',
}

it('lists exactly the fields that have a named reader', () => {
  expect([...CARD_METADATA_FIELDS].sort()).toEqual(Object.keys(READERS).sort())
})

it('keeps only the listed fields and drops everything else', () => {
  const item = {
    id: 'abc',
    title: 'A Show',
    metadata: {
      id: 1399,
      first_air_date: '2011-04-17',
      runtime: 60,
      logo_path: '/logo.png',
      cast: [{ name: 'Someone' }],
      recurring_cast: [{ name: 'Someone else' }],
      seasons: [{ season_number: 1 }],
      overview: 'Long text',
    },
  }

  const trimmed = trimCardMetadata(item)

  expect(trimmed.metadata).toEqual({ id: 1399, first_air_date: '2011-04-17', runtime: 60, logo_path: '/logo.png' })
  expect(trimmed.title).toBe('A Show')
  // The builders' objects may be cached; the trim never mutates them
  expect(item.metadata.cast).toHaveLength(1)
})

it('leaves items without a metadata object untouched', () => {
  expect(trimCardMetadata(null)).toBeNull()
  const noMetadata = { id: 'x' }
  expect(trimCardMetadata(noMetadata)).toBe(noMetadata)
  const nullMetadata = { id: 'y', metadata: null }
  expect(trimCardMetadata(nullMetadata)).toBe(nullMetadata)
})

it('keeps an empty metadata object for a title with none of the listed fields', () => {
  expect(trimCardMetadata({ id: 'z', metadata: { cast: [] } }).metadata).toEqual({})
})
