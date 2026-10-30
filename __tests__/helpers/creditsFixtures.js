/**
 * Credits sidecars shaped like the demo catalog's, for tests.
 *
 * TEST FIXTURES, NOT RIGHTS RECORDS. They exercise the structure each title
 * needs (exact asset scope, mixed grants, exclusions, historical notices,
 * derived series art, a collage of three posters). Where this file does not
 * know a recorded fact (a source URL, a notice's exact wording), it says so
 * in angle brackets instead of guessing. Real sidecars are written from the
 * verified evidence package, never copied from here.
 */

const CC_BY_3 = 'https://creativecommons.org/licenses/by/3.0/'
const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/'

/** A movie whose backdrop has its own, exactly recorded source. */
const exactBackdropSource = () => ({
  schemaVersion: 1,
  assets: [
    { id: 'film', kind: 'film', path: 'Short Film A.mp4' },
    { id: 'backdrop', kind: 'backdrop', path: 'backdrop.jpg', label: 'Backdrop' },
  ],
  entries: [
    {
      id: 'film-credit',
      assetIds: ['film'],
      kind: 'film',
      work: 'Short Film A',
      author: 'Example Foundation',
      license: 'CC BY 3.0',
      licenseUrl: CC_BY_3,
      sourceUrl: 'https://example.org/<recorded film source>',
      modification: 'Video transcoded for streaming.',
      evidenceId: 'rights-film-a-film',
    },
    {
      id: 'backdrop-credit',
      assetIds: ['backdrop'],
      kind: 'backdrop',
      work: 'Short Film A backdrop',
      author: '<recorded backdrop author>',
      license: 'CC BY 3.0',
      licenseUrl: CC_BY_3,
      sourceUrl: 'https://example.org/<exact recorded backdrop source>',
      modification: 'Cropped to 16:9.',
      evidenceId: 'rights-film-a-backdrop',
    },
  ],
})

/** A movie whose artwork is credited to its artist, apart from the film. */
const artworkByArtist = () => ({
  schemaVersion: 1,
  assets: [
    { id: 'film', kind: 'film', path: 'Short Film B.mkv' },
    { id: 'poster', kind: 'poster', path: 'poster.jpg' },
    { id: 'backdrop', kind: 'backdrop', path: 'backdrop.jpg' },
  ],
  entries: [
    {
      id: 'film-credit',
      assetIds: ['film'],
      kind: 'film',
      work: 'Short Film B',
      author: 'Example Foundation',
      license: 'CC BY 3.0',
      licenseUrl: CC_BY_3,
      evidenceId: 'rights-film-b-film',
    },
    {
      id: 'artwork-credit',
      assetIds: ['poster', 'backdrop'],
      kind: 'artwork',
      work: 'Short Film B artwork',
      author: 'Example Artist',
      license: '<recorded artwork license>',
      evidenceId: 'rights-film-b-artwork',
    },
  ],
})

/** A film and its poster under different licenses, the poster with exclusions. */
const mixedGrants = () => ({
  schemaVersion: 1,
  assets: [
    { id: 'film', kind: 'film', path: 'Short Film C.mp4' },
    { id: 'poster', kind: 'poster', path: 'poster.jpg' },
  ],
  entries: [
    {
      id: 'film-credit',
      assetIds: ['film'],
      kind: 'film',
      work: 'Short Film C',
      author: 'Example Studio',
      license: 'CC BY 3.0',
      licenseUrl: CC_BY_3,
      notices: ['<license and warranty-disclaimer notice, verbatim>'],
      evidenceId: 'rights-film-c-film',
    },
    {
      id: 'poster-credit',
      assetIds: ['poster'],
      kind: 'poster',
      work: 'Short Film C poster',
      author: 'Example Studio',
      license: 'CC BY 4.0',
      licenseUrl: CC_BY_4,
      exclusions: ['<the logos on the poster, as the grant excludes them>'],
      evidenceId: 'rights-film-c-poster',
    },
  ],
})

/**
 * A show: series art cut from one episode's frame, and a collage made of
 * three other titles' posters (three contributing credits).
 */
const seriesShow = () => ({
  schemaVersion: 1,
  assets: [
    {
      id: 'series-art',
      kind: 'backdrop',
      path: 'backdrop.jpg',
      label: 'Series artwork',
      derivedFrom: [
        { libraryPath: 'tv/Animated Series/Season 1/03 - Episode Three.mp4', note: 'Frame from Episode Three, cropped' },
      ],
    },
    {
      id: 'collage',
      kind: 'artwork',
      path: 'collage.jpg',
      label: 'Poster collage',
      derivedFrom: [
        { libraryPath: 'movies/Short Film A/poster.jpg' },
        { libraryPath: 'movies/Short Film B/poster.jpg' },
        { libraryPath: 'movies/Short Film C/poster.jpg' },
      ],
    },
  ],
  entries: [
    {
      id: 'series-art-credit',
      assetIds: ['series-art'],
      kind: 'artwork',
      work: 'Episode Three (frame used as series artwork)',
      author: 'Example Studio',
      license: '<recorded current offer>',
      modification: 'Frame extracted and cropped.',
      evidenceId: 'rights-episode-three-frame',
    },
    { id: 'collage-poster-1', assetIds: ['collage'], kind: 'artwork', work: 'Short Film A poster', license: 'CC BY 3.0', licenseUrl: CC_BY_3 },
    { id: 'collage-poster-2', assetIds: ['collage'], kind: 'artwork', work: 'Short Film B poster', author: 'Example Artist' },
    { id: 'collage-poster-3', assetIds: ['collage'], kind: 'artwork', work: 'Short Film C poster', license: 'CC BY 4.0', licenseUrl: CC_BY_4 },
  ],
})

/**
 * An episode's own file: its video under the recorded current offer, the
 * on-film notice kept beside it, and optional subtitle and audio entries.
 */
const episodeOwn = (number, work) => ({
  schemaVersion: 1,
  assets: [
    { id: 'episode', kind: 'episode', path: `0${number} - ${work}.mp4` },
    { id: 'subtitles-en', kind: 'subtitles', path: `0${number} - ${work}.en.srt` },
    { id: 'score', kind: 'music', label: 'Score' },
  ],
  entries: [
    {
      id: 'episode-credit',
      assetIds: ['episode'],
      kind: 'episode',
      work,
      author: 'Example Studio',
      license: '<recorded current offer>',
      historicalNotices: ['<on-film notice, verbatim>'],
      evidenceId: `rights-series-${number}`,
    },
    { id: 'subtitles-credit', assetIds: ['subtitles-en'], kind: 'subtitles', work: `${work} English subtitles`, author: '<recorded author>' },
    { id: 'score-credit', assetIds: ['score'], kind: 'music', work: `${work} score`, author: '<recorded composer>' },
  ],
})

module.exports = { CC_BY_3, CC_BY_4, exactBackdropSource, artworkByArtist, mixedGrants, seriesShow, episodeOwn }
