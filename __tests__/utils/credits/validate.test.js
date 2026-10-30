/**
 * @jest-environment node
 *
 * The credits validator (CREDITS_SIDECAR.md, section 3): the catalog's
 * shapes pass whole, and a file that breaks any rule is rejected whole, with
 * the reason the sync records. Nothing is repaired or truncated.
 */

const { validateCreditsText, validateCreditsDocument, isPublicHttpUrl } = require('@src/utils/credits/validate')
const fixtures = require('../../helpers/creditsFixtures')

const minimal = () => ({
  schemaVersion: 1,
  assets: [{ id: 'film', kind: 'film', path: 'Film.mp4' }],
  entries: [{ id: 'film-credit', assetIds: ['film'], work: 'Film' }],
})
const rejected = (document, scope = 'title') => {
  const result = validateCreditsDocument(document, scope)
  expect(result.ok).toBe(false)
  return result
}

describe('the catalog shapes', () => {
  it.each([
    ['an exactly sourced backdrop', fixtures.exactBackdropSource(), 'title'],
    ['artwork credited to its artist', fixtures.artworkByArtist(), 'title'],
    ['a film and a poster under different licenses, with exclusions', fixtures.mixedGrants(), 'title'],
    ['series art derived from an episode, and a three-poster collage', fixtures.seriesShow(), 'title'],
    ['an episode with historical notices, subtitles and music', fixtures.episodeOwn(1, 'Episode One'), 'episode'],
  ])('%s is valid and kept exactly as written', (_name, document, scope) => {
    const result = validateCreditsText(JSON.stringify(document), scope)
    expect(result).toEqual({ ok: true, document })
  })

  it('keeps every notice, exclusion and historical notice, in authored order', () => {
    const document = fixtures.mixedGrants()
    document.entries[0].notices = ['first', 'second', 'third']
    document.entries[1].exclusions = ['logo A', 'logo B']
    const result = validateCreditsDocument(document, 'title')
    expect(result.ok && result.document.entries[0].notices).toEqual(['first', 'second', 'third'])
    expect(result.ok && result.document.entries[1].exclusions).toEqual(['logo A', 'logo B'])
  })

  it('needs no field that was never supplied', () => {
    expect(validateCreditsDocument(minimal(), 'title').ok).toBe(true)
  })
})

describe('the file', () => {
  it('ignores a leading byte-order mark', () => {
    expect(validateCreditsText(`\uFEFF${JSON.stringify(minimal())}`, 'title').ok).toBe(true)
  })

  it('rejects text that is not JSON', () => {
    expect(validateCreditsText('{"schemaVersion": 1,', 'title')).toMatchObject({ ok: false, reason: 'invalid-json' })
  })

  it.each([[2], ['1'], [undefined]])('calls schemaVersion %p unsupported, not invalid', (schemaVersion) => {
    expect(rejected({ ...minimal(), schemaVersion })).toMatchObject({ reason: 'unsupported-version' })
  })

  it('rejects a document that is not an object', () => {
    expect(rejected([minimal()])).toMatchObject({ reason: 'schema' })
  })
})

describe('the structure', () => {
  it('rejects an unknown key, so a misspelt field never drops a notice silently', () => {
    const document = minimal()
    document.entries[0].licenceUrl = 'https://example.org/license'
    expect(rejected(document).errors).toEqual(['entries[0].licenceUrl: is not a known field'])
  })

  it('rejects a missing required field', () => {
    const { entries, ...rest } = minimal()
    expect(rejected(rest).errors).toEqual(['(root): entries is required'])
  })

  it('rejects an unknown asset kind', () => {
    const document = minimal()
    document.assets[0].kind = 'movie'
    expect(rejected(document).errors[0]).toMatch(/^assets\[0\]\.kind: must be one of film, episode/)
  })

  it('rejects text over its limit instead of truncating it', () => {
    const document = minimal()
    document.entries[0].work = 'x'.repeat(501)
    expect(rejected(document).errors).toEqual(['entries[0].work: is 501 characters, over the limit of 500'])
  })

  it('rejects an empty string', () => {
    const document = minimal()
    document.entries[0].author = ''
    expect(rejected(document).errors).toEqual(['entries[0].author: must not be empty'])
  })

  it('rejects an id with characters outside the pattern', () => {
    const document = minimal()
    document.assets[0].id = 'film credit'
    document.entries[0].assetIds = ['film credit']
    expect(rejected(document).errors[0]).toMatch(/^assets\[0\]\.id: has characters/)
  })

  it('rejects an entry with no asset', () => {
    const document = minimal()
    document.entries[0].assetIds = []
    expect(rejected(document).errors).toEqual(['entries[0].assetIds: must have at least 1 item(s)'])
  })
})

describe('the rules beyond the schema', () => {
  it('rejects two assets or two entries with one id', () => {
    const document = minimal()
    document.assets.push({ id: 'film', kind: 'poster' })
    document.entries.push({ id: 'film-credit', assetIds: ['film'], work: 'Again' })
    expect(rejected(document).errors).toEqual([
      'assets[1].id: "film" is used by another asset',
      'entries[1].id: "film-credit" is used by another entry',
    ])
  })

  it('rejects a reference to an asset the file does not have, and a reference made twice', () => {
    const document = minimal()
    document.entries[0].assetIds = ['film', 'film', 'poster']
    expect(rejected(document).errors).toEqual([
      'entries[0].assetIds[1]: "film" is listed twice',
      'entries[0].assetIds[2]: "poster" is not an asset of this file',
    ])
  })

  it('rejects an entry that credits nothing', () => {
    const document = minimal()
    document.entries[0] = { id: 'empty', assetIds: ['film'], evidenceId: 'rights-x', modification: 'Transcoded.' }
    expect(rejected(document).errors[0]).toMatch(/^entries\[0\]: needs at least one of work, author/)
  })

  it.each([
    ['javascript:alert(1)'],
    ['data:text/html,hi'],
    ['ftp://example.org/x'],
    ['//example.org/x'],
    ['https://user:secret@example.org/x'],
    ['not a url'],
  ])('rejects the link %p', (url) => {
    const document = minimal()
    document.entries[0].licenseUrl = url
    expect(rejected(document).errors).toEqual([
      'entries[0].licenseUrl: must be an absolute http: or https: URL without a user name or password',
    ])
  })

  it.each([
    ['/var/media/movies/Film/Film.mp4'],
    ['C:/media/Film.mp4'],
    ['C:\\media\\Film.mp4'],
    ['../Other/poster.jpg'],
    ['art/./poster.jpg'],
    ['art//poster.jpg'],
    ['https://example.org/poster.jpg'],
    ['javascript:alert(1)'],
  ])('rejects the asset path %p', (path) => {
    const document = minimal()
    document.assets[0].path = path
    expect(rejected(document).errors).toHaveLength(1)
  })

  it('accepts a colon later in a file name', () => {
    const document = minimal()
    document.assets[0].path = 'Film: The Sequel.mp4'
    expect(validateCreditsDocument(document, 'title').ok).toBe(true)
  })

  it('rejects a derived-from path outside movies/ and tv/', () => {
    const document = minimal()
    document.assets[0].derivedFrom = [{ libraryPath: 'music/score.flac' }]
    expect(rejected(document).errors).toEqual(['assets[0].derivedFrom[0].libraryPath: must begin with movies/ or tv/'])
  })

  it('rejects a control character, and keeps tabs and line breaks', () => {
    const document = minimal()
    document.entries[0].attributionText = 'Line one\nLine\ttwo\r\n'
    expect(validateCreditsDocument(document, 'title').ok).toBe(true)
    document.entries[0].attributionText = 'Bell\u0007'
    expect(rejected(document).errors).toEqual(['entries[0].attributionText: contains a control character'])
  })

  it('allows suppress and replaces in an episode file only', () => {
    const document = minimal()
    document.suppress = ['series-art-credit']
    document.entries[0].replaces = ['film-credit-old']
    expect(validateCreditsDocument(document, 'episode').ok).toBe(true)
    expect(rejected(document, 'title').errors).toEqual([
      "entries[0].replaces: only an episode's credits file may replace inherited entries",
      "suppress: only an episode's credits file may suppress inherited entries",
    ])
  })
})

describe('isPublicHttpUrl', () => {
  it('takes http and https only', () => {
    expect(isPublicHttpUrl('https://creativecommons.org/licenses/by/4.0/')).toBe(true)
    expect(isPublicHttpUrl('http://example.org')).toBe(true)
    expect(isPublicHttpUrl('mailto:someone@example.org')).toBe(false)
    expect(isPublicHttpUrl(undefined)).toBe(false)
  })
})
