/**
 * @jest-environment node
 *
 * Credits as shown (CREDITS_SIDECAR.md, sections 4 and 7): entries carry
 * the assets they name from their own file, and an episode inherits its
 * show's entries unless it suppresses or replaces one by id.
 */

const { resolveTitleCredits, resolveEpisodeCredits } = require('@src/utils/credits/resolve')
const fixtures = require('../../helpers/creditsFixtures')

const ids = (resolved) => resolved.entries.map((entry) => `${entry.scope}:${entry.id}`)

describe('a movie or a show', () => {
  it('names each entry\'s assets in place of their ids, and keeps the entry\'s fields', () => {
    const resolved = resolveTitleCredits(fixtures.mixedGrants())
    expect(resolved.schemaVersion).toBe(1)
    expect(resolved.entries[1]).toEqual({
      id: 'poster-credit',
      scope: 'title',
      assets: [{ id: 'poster', kind: 'poster', path: 'poster.jpg' }],
      kind: 'poster',
      work: 'Short Film C poster',
      author: 'Example Studio',
      license: 'CC BY 4.0',
      licenseUrl: fixtures.CC_BY_4,
      exclusions: ['<the logos on the poster, as the grant excludes them>'],
      evidenceId: 'rights-film-c-poster',
    })
    expect(resolved.entries[0]).not.toHaveProperty('assetIds')
  })

  it('keeps the three contributing credits of a collage, in order', () => {
    const resolved = resolveTitleCredits(fixtures.seriesShow())
    expect(resolved.entries.filter((entry) => entry.assets[0].id === 'collage').map((entry) => entry.work)).toEqual([
      'Short Film A poster',
      'Short Film B poster',
      'Short Film C poster',
    ])
  })

  it('shows nothing for no credits, and nothing for a stored document that is not valid', () => {
    expect(resolveTitleCredits(undefined)).toBeNull()
    expect(resolveTitleCredits(null)).toBeNull()
    const broken = fixtures.mixedGrants()
    broken.entries[0].licenseUrl = 'javascript:alert(1)'
    expect(resolveTitleCredits(broken)).toBeNull()
    expect(resolveTitleCredits({ schemaVersion: 1, assets: [], entries: [] })).toBeNull()
  })
})

describe('an episode', () => {
  const show = fixtures.seriesShow
  const own = () => fixtures.episodeOwn(1, 'Episode One')

  it('inherits every show entry when its own file says nothing about them', () => {
    expect(ids(resolveEpisodeCredits(show(), own()))).toEqual([
      'show:series-art-credit',
      'show:collage-poster-1',
      'show:collage-poster-2',
      'show:collage-poster-3',
      'episode:episode-credit',
      'episode:subtitles-credit',
      'episode:score-credit',
    ])
  })

  it('inherits the show\'s entries with no file of its own, and has its own with no show credits', () => {
    expect(ids(resolveEpisodeCredits(show(), undefined))).toHaveLength(4)
    expect(ids(resolveEpisodeCredits(undefined, own()))).toEqual([
      'episode:episode-credit',
      'episode:subtitles-credit',
      'episode:score-credit',
    ])
    expect(resolveEpisodeCredits(undefined, undefined)).toBeNull()
  })

  it('keeps series art derived from another episode credited as that episode\'s art', () => {
    const art = resolveEpisodeCredits(show(), own()).entries[0]
    expect(art.work).toBe('Episode Three (frame used as series artwork)')
    expect(art.assets[0].derivedFrom).toEqual([
      { libraryPath: 'tv/Animated Series/Season 1/03 - Episode Three.mp4', note: 'Frame from Episode Three, cropped' },
    ])
  })

  it('hides only the inherited entries it suppresses', () => {
    const episode = { ...own(), suppress: ['collage-poster-2'] }
    expect(ids(resolveEpisodeCredits(show(), episode))).not.toContain('show:collage-poster-2')
    expect(ids(resolveEpisodeCredits(show(), episode))).toContain('show:collage-poster-1')
  })

  it('puts a replacing entry where the first entry it replaces was', () => {
    const episode = own()
    episode.entries.push({
      id: 'collage-for-this-episode',
      assetIds: ['episode'],
      work: 'Replacement',
      replaces: ['collage-poster-1', 'collage-poster-3'],
    })
    expect(ids(resolveEpisodeCredits(show(), episode))).toEqual([
      'show:series-art-credit',
      'episode:collage-for-this-episode',
      'show:collage-poster-2',
      'episode:episode-credit',
      'episode:subtitles-credit',
      'episode:score-credit',
    ])
  })

  it('keeps both entries when an episode entry has an inherited id but replaces nothing', () => {
    const episode = own()
    episode.entries[0].id = 'series-art-credit'
    const resolved = ids(resolveEpisodeCredits(show(), episode))
    expect(resolved).toContain('show:series-art-credit')
    expect(resolved).toContain('episode:series-art-credit')
  })

  it('resolves each entry\'s assets in the file it came from', () => {
    const episode = own()
    // The episode names an asset with the show's id: the inherited entry keeps the show's.
    episode.assets.push({ id: 'series-art', kind: 'thumbnail', path: '01 - Thumbnail.jpg' })
    const art = resolveEpisodeCredits(show(), episode).entries[0]
    expect(art.assets[0]).toMatchObject({ kind: 'backdrop', path: 'backdrop.jpg' })
  })

  it('keeps the episode\'s historical notice verbatim', () => {
    const entry = resolveEpisodeCredits(show(), own()).entries.find((e) => e.id === 'episode-credit')
    expect(entry.historicalNotices).toEqual(['<on-film notice, verbatim>'])
  })

  it('ignores an episode file that is not valid, and keeps the show\'s', () => {
    const episode = own()
    episode.entries[0].assetIds = ['missing']
    expect(ids(resolveEpisodeCredits(show(), episode))).toHaveLength(4)
  })
})
