/**
 * The catalog join on the processor's identity report
 * (src/utils/admin/identityReportEnrich.js): unmanaged folders arrive as bare
 * paths; the catalog knows each one's TMDB id, which is what lets the page
 * pair "Radarr has no file for 464737" with "the folder pinned to 464737".
 */

import { enrichIdentityReport, splitLibraryPath } from '@src/utils/admin/identityReportEnrich'

describe('splitLibraryPath', () => {
  it('reads the media type off the library root', () => {
    expect(splitLibraryPath('movies/The End?')).toEqual({ mediaType: 'movie', folder: 'The End?' })
    expect(splitLibraryPath('tv/Higurashi - When They Cry')).toEqual({ mediaType: 'tv', folder: 'Higurashi - When They Cry' })
  })

  it('rejects anything that is not under movies/ or tv/', () => {
    expect(splitLibraryPath('music/Album')).toBeNull()
    expect(splitLibraryPath('movies/')).toBeNull()
    expect(splitLibraryPath('The End?')).toBeNull()
    expect(splitLibraryPath(undefined)).toBeNull()
  })
})

describe('enrichIdentityReport', () => {
  const report = {
    totals: { unmanaged: 3 },
    unmanaged: { items: ['movies/The End?', 'movies/Big Buck Bunny', 'tv/Local Show'], total: 3, truncated: 0 },
  }

  it('attaches the catalog id, title and admin id per folder, keyed by path', async () => {
    const lookup = jest.fn(async ({ movies, tv }) => {
      expect(movies).toEqual(['The End?', 'Big Buck Bunny'])
      expect(tv).toEqual(['Local Show'])
      return [
        { mediaType: 'movie', originalTitle: 'The End?', tmdbId: 464737, title: 'The End?', id: '6a4fa5575bd6dc41316ddacd' },
        { mediaType: 'tv', originalTitle: 'Local Show', tmdbId: null, title: 'Local Show', id: 'abc' },
      ]
    })

    const out = await enrichIdentityReport(report, lookup)

    expect(out.unmanaged.catalog).toEqual({
      'movies/The End?': { tmdbId: 464737, title: 'The End?', id: '6a4fa5575bd6dc41316ddacd' },
      'tv/Local Show': { tmdbId: null, title: 'Local Show', id: 'abc' },
    })
    // The processor's own lists are untouched.
    expect(out.unmanaged.items).toEqual(report.unmanaged.items)
    expect(out.totals).toBe(report.totals)
  })

  it('does not confuse a movie and a show that share a folder name', async () => {
    const twin = { unmanaged: { items: ['movies/Kingdom', 'tv/Kingdom'], total: 2, truncated: 0 } }
    const out = await enrichIdentityReport(twin, async () => [
      { mediaType: 'movie', originalTitle: 'Kingdom', tmdbId: 1, title: 'Kingdom (film)', id: 'm' },
      { mediaType: 'tv', originalTitle: 'Kingdom', tmdbId: 2, title: 'Kingdom (series)', id: 't' },
    ])
    expect(out.unmanaged.catalog['movies/Kingdom'].tmdbId).toBe(1)
    expect(out.unmanaged.catalog['tv/Kingdom'].tmdbId).toBe(2)
  })

  it('returns the report unchanged when there is nothing to look up or the lookup fails', async () => {
    const lookup = jest.fn()
    expect(await enrichIdentityReport({ enabled: false }, lookup)).toEqual({ enabled: false })
    expect(await enrichIdentityReport({ unmanaged: { items: [] } }, lookup)).toEqual({ unmanaged: { items: [] } })
    expect(lookup).not.toHaveBeenCalled()

    const failing = jest.fn(async () => { throw new Error('mongo down') })
    const out = await enrichIdentityReport(report, failing)
    expect(out).toBe(report)
  })
})
