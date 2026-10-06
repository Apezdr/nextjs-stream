/**
 * @jest-environment node
 *
 * The who-has-what map every ownership decision in the sync is ranked on. A
 * server is listed for a field only when its payload has a value there.
 */

const { collectFieldAvailability } = require('@src/utils/sync/fieldAvailability')

const collect = (payloadByServer) => {
  const map = {}
  for (const [serverId, payload] of Object.entries(payloadByServer)) {
    collectFieldAvailability(payload, '', serverId, map)
  }
  return map
}

describe('collectFieldAvailability', () => {
  it('lists a server for every leaf it has a value for, by its full path', () => {
    const map = collect({
      A: { urls: { mp4: '/movies/Film/film.mkv', poster: '/movies/Film/poster.jpg' }, hdr: 'HDR10' },
    })
    expect(map).toEqual({ 'urls.mp4': ['A'], 'urls.poster': ['A'], hdr: ['A'] })
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an empty string', ''],
  ])('does not list a server for a key published as %s', (_name, empty) => {
    const map = collect({
      A: { poster: '/tv/Show/poster.jpg', logo: empty, metadata: empty },
      B: { poster: '/tv/Show/poster.jpg', logo: '/tv/Show/logo.png', metadata: '/tv/Show/metadata.json' },
    })
    expect(map.poster).toEqual(['A', 'B'])
    expect(map.logo).toEqual(['B'])
    expect(map.metadata).toEqual(['B'])
  })

  it('leaves out a field no server has a value for', () => {
    const map = collect({ A: { logo: null, backdrop: '' }, B: { logo: null } })
    expect(map).toEqual({})
  })

  it('keeps false and 0, which are values', () => {
    const map = collect({ A: { urls: { jitEligible: false }, episodeNumber: 0 } })
    expect(map).toEqual({ 'urls.jitEligible': ['A'], episodeNumber: ['A'] })
  })

  it('walks nested objects with the literal keys the server sent', () => {
    const map = collect({
      A: { seasons: { 'Season 01': { episodes: { S01E01: { videoURL: '/a.mkv', thumbnail: null } } } } },
    })
    expect(map).toEqual({ 'seasons.Season 01.episodes.S01E01.videoURL': ['A'] })
  })

  it('names array entries by codec for tracks, and by name, id or position otherwise', () => {
    const map = collect({
      A: {
        additional_metadata: { video: [{ codec: 'hevc', bitrate: 1 }], audio: [{ channels: 6 }] },
        sources: [{ url: '/a.mkv', container: null }],
        cast: [{ name: 'Someone', role: 'Lead' }],
        fileNames: ['a.mkv'],
      },
    })
    expect(Object.keys(map).sort()).toEqual([
      'additional_metadata.audio.0.channels',
      'additional_metadata.video.hevc.bitrate',
      'additional_metadata.video.hevc.codec',
      'cast.Someone.name',
      'cast.Someone.role',
      'sources.0.url',
    ])
  })

  it('lists a server once, however many times it is collected', () => {
    const map = {}
    collectFieldAvailability({ poster: '/p.jpg' }, '', 'A', map)
    collectFieldAvailability({ poster: '/p.jpg' }, '', 'A', map)
    expect(map.poster).toEqual(['A'])
  })
})
