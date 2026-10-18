/**
 * @jest-environment node
 *
 * The who-has-what map every ownership decision in the sync is ranked on. A
 * server is listed for a field only when its payload has a value there.
 */

const { collectFieldAvailability, buildFieldAvailability } = require('@src/utils/sync/run/availability')

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

describe('buildFieldAvailability', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  // A title's payload: a poster on every title, a logo on every other one,
  // and a season of episodes on every show.
  const movie = (name, i) => ({
    urls: { mp4: `/movies/${name}/film.mp4`, logo: i % 2 ? `/movies/${name}/logo.png` : null },
    hdr: i % 3 ? '' : 'HDR10',
    additional_metadata: { video: [{ codec: 'hevc', bitrate: 1000 + i }], audio: [{ channels: 6 }] },
  })
  const show = (name, i) => ({
    poster: `/tv/${name}/poster.jpg`,
    logo: i % 2 ? `/tv/${name}/logo.png` : '',
    seasons: {
      'Season 01': {
        episodes: {
          S01E01: { videoURL: `/tv/${name}/S01E01.mkv`, thumbnail: i % 2 ? null : `/tv/${name}/S01E01.jpg` },
        },
      },
    },
  })
  const library = (make, prefix, from, count) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, k) => {
        const name = `${prefix} ${from + k}`
        return [name, make(name, from + k)]
      })
    )

  it('maps each media type to its titles, keyed by folder name, listing every server with a value', async () => {
    const result = await buildFieldAvailability({
      A: {
        movies: { 'Film (2001)': { urls: { mp4: '/movies/Film (2001)/film.mp4', logo: null }, hdr: 'HDR10' } },
        tv: { Show: { poster: '/tv/Show/poster.jpg', logo: '' } },
      },
      B: {
        movies: { 'Film (2001)': { urls: { mp4: '/movies/Film (2001)/film.mp4', logo: '/movies/Film (2001)/logo.png' } } },
      },
      C: { tv: { Show: { poster: '/tv/Show/poster.jpg', logo: '/tv/Show/logo.png' }, Empty: { poster: null } } },
      D: {},
    })

    expect(result).toEqual({
      movies: { 'Film (2001)': { 'urls.mp4': ['A', 'B'], 'urls.logo': ['B'], hdr: ['A'] } },
      // A title every server published empty still gets its (empty) map
      tv: { Show: { poster: ['A', 'C'], logo: ['C'] }, Empty: {} },
    })
  })

  it('yields to the event loop after every 50 titles, counted across servers and media types', async () => {
    const events = []
    const realSetImmediate = global.setImmediate
    jest.spyOn(global, 'setImmediate').mockImplementation((callback, ...args) => {
      events.push('yield')
      return realSetImmediate(callback, ...args)
    })
    // Each title has one leaf, read once while it is collected
    const titles = (prefix, count) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, k) => [
          `${prefix} ${k}`,
          {
            get poster() {
              events.push('title')
              return `/${prefix}/${k}/poster.jpg`
            },
          },
        ])
      )

    // 30 + 40 titles on A, 50 on B: 120 titles in all
    const result = await buildFieldAvailability({
      A: { movies: titles('A movie', 30), tv: titles('A show', 40) },
      B: { movies: titles('B movie', 50) },
    })

    const yieldAfter = events.reduce((at, event, index) => {
      if (event === 'yield') at.push(events.slice(0, index).filter((e) => e === 'title').length)
      return at
    }, [])
    expect(yieldAfter).toEqual([50, 100])
    expect(events.filter((e) => e === 'title')).toHaveLength(120)
    expect(Object.keys(result.movies)).toHaveLength(80)
    expect(Object.keys(result.tv)).toHaveLength(40)
  })

  it('gives the same map as collecting each title by hand, server by server', async () => {
    const fileServers = {
      A: { movies: library(movie, 'Movie', 0, 60), tv: library(show, 'Show', 0, 30) },
      // Overlaps A on 20 movies and 10 shows, and has some of its own
      B: { movies: library(movie, 'Movie', 40, 45), tv: library(show, 'Show', 20, 25) },
      C: { tv: library(show, 'Show', 5, 10) },
    }

    const expected = { movies: {}, tv: {} }
    for (const [serverId, fileServer] of Object.entries(fileServers)) {
      for (const mediaType of ['movies', 'tv']) {
        for (const [title, payload] of Object.entries(fileServer[mediaType] || {})) {
          expected[mediaType][title] ??= {}
          collectFieldAvailability(payload, '', serverId, expected[mediaType][title])
        }
      }
    }

    const result = await buildFieldAvailability(fileServers)
    expect(result).toEqual(expected)
    // The comparison is not vacuous: overlapping titles list several servers
    expect(result.movies['Movie 45']['urls.mp4']).toEqual(['A', 'B'])
    expect(result.tv['Show 7']['seasons.Season 01.episodes.S01E01.videoURL']).toEqual(['A', 'C'])
    expect(result.tv['Show 22'].poster).toEqual(['A', 'B'])
  })
})
