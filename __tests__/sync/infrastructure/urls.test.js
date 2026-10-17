/**
 * @jest-environment node
 *
 * The sync's one URL function (infrastructure/fileSystem/urls) against the
 * functions it replaces, over the paths a processor payload carries.
 *
 * Every row names the caller, the path, the server and the URL the sync
 * writes (or, for "fetch", the URL a metadata or blurhash fetch requests).
 * The old functions, with each caller's own handling of the prefix, must give
 * that URL, and so must the new one: what the sync stores does not change.
 *
 *   movie video  MovieContentStrategy: urls.mp4, each urls.sources url and
 *                urls.chapters. Strips the server's prefix, then
 *                UrlBuilder.createFullUrl adds it back.
 *   movie asset  MovieAssetStrategy: poster, backdrop, logo and their
 *                blurhash files. UrlBuilder.createFullUrl with no prefix.
 *   tv           The show, season and episode services: createFullUrl in
 *                sync/utils.js, i.e. url_utils' createFullURL(path, false).
 *   fetch        fetchMetadataMultiServer's own URL: url_utils'
 *                stripPrefixPath, then createFullURL with the prefix.
 */

// Two servers on the same host, one behind a prefix, and one whose baseURL has
// a port and a path. prefixPath is what FILE_SERVER_PREFIX_PATH gives, and the
// processor's PREFIX_PATH puts the same prefix on every path it publishes.
const mockServerList = [
  { id: 'plain', baseURL: 'https://files.example', prefixPath: '' },
  { id: 'prefixed', baseURL: 'https://files.example', prefixPath: '/media' },
  { id: 'ported', baseURL: 'http://192.168.1.20:8080/library', prefixPath: '' },
]

jest.mock('@src/utils/config', () => {
  const { createMultiServerURLHandler } = jest.requireActual('@src/utils/url_utils')
  return { multiServerHandler: createMultiServerURLHandler(mockServerList) }
})

const { UrlBuilder } = require('@src/utils/sync/infrastructure/fileSystem/UrlBuilder')
const { createFullUrl: tvCreateFullUrl } = require('@src/utils/sync/utils')
const { multiServerHandler } = require('@src/utils/config')
const { fileServerUrl, prefixedPath, captionUrls } = require('@src/utils/sync/infrastructure/fileSystem/urls')

/** The pass's server config (run/serverPass toServerConfig) for one of the servers above. */
const server = (id) => {
  const { baseURL, prefixPath } = mockServerList.find((s) => s.id === id)
  return { id, priority: 1, baseUrl: baseURL, prefix: prefixPath, enabled: true, timeout: 30000 }
}

// ---------------------------------------------------------------- the old callers

const old = {
  'movie video': (path, config) => {
    let relativePath = path
    if (config.prefix && relativePath.startsWith(config.prefix)) {
      relativePath = relativePath.substring(config.prefix.length)
    }
    return UrlBuilder.createFullUrl(relativePath, config)
  },
  'movie asset': (path, config) => UrlBuilder.createFullUrl(path, { ...config, prefix: '' }),
  tv: (path, config) => tvCreateFullUrl(path, config),
  fetch: (path, config) => {
    const handler = multiServerHandler.getHandler(config.id)
    return handler.createFullURL(handler.stripPrefixPath(path))
  },
}

// Each caller now hands the payload's path to fileServerUrl as it is.
const current = {
  'movie video': (path, config) => fileServerUrl(path, config),
  'movie asset': (path, config) => fileServerUrl(path, config),
  tv: (path, config) => fileServerUrl(path, config),
  fetch: (path, config) => fileServerUrl(path, config),
}

// UrlBuilder keeps a cache keyed on the server id and the path alone; the rows
// reuse both with other configs.
beforeEach(() => UrlBuilder.clearCache())

// ---------------------------------------------------------------- payload paths

const MOVIE = encodeURIComponent('Some Movie (2020)') // Some%20Movie%20(2020)
const ODD_MOVIE = encodeURIComponent('Café & Co: Part #2 (2001)') // Caf%C3%A9%20%26%20Co%3A%20Part%20%232%20(2001)
const QUESTION_MOVIE = encodeURIComponent("Who's There, Then? (1999) +1") // Who's%20There%2C%20Then%3F%20(1999)%20%2B1
const SHOW = encodeURIComponent('Some Show (2019)')
const ODD_SHOW = encodeURIComponent('Café & Co: Part #2 (2001)')
const SEASON = encodeURIComponent('Season 1')

/** The paths of one movie, under prefix `p`, as the processor publishes them. */
const moviePaths = (p, folder) => ({
  'movie video': [
    `${p}/movies/${folder}/${folder}.mkv`,
    `${p}/movies/${folder}/${folder}.mp4`,
    `${p}/movies/${folder}/chapters/${encodeURIComponent(`${decodeURIComponent(folder)}_chapters.vtt`)}`,
  ],
  'movie asset': [
    `${p}/movies/${folder}/poster.jpg?hash=1700000000000`,
    `${p}/movies/${folder}/backdrop.jpg?hash=1700000000001`,
    `${p}/movies/${folder}/logo.png?hash=1700000000002`,
    `${p}/movies/${folder}/poster.jpg.blurhash`,
    `${p}/movies/${folder}/backdrop.jpg.blurhash`,
  ],
  fetch: [`${p}/movies/${folder}/${encodeURIComponent('metadata.json')}`, `${p}/movies/${folder}/poster.jpg.blurhash`],
})

/** The paths of one show, under prefix `p`. */
const showPaths = (p, folder) => {
  const season = `${p}/tv/${folder}/${SEASON}`
  const episode = encodeURIComponent(`${decodeURIComponent(folder)} - S01E01.mkv`)
  return {
    tv: [
      `${season}/${episode}`,
      `${season}/${encodeURIComponent('01 - Thumbnail.jpg')}?hash=1700000000003`,
      `${season}/${encodeURIComponent('01 - Thumbnail.jpg')}.blurhash`,
      `${season}/chapters/${encodeURIComponent(`${decodeURIComponent(folder)} - S1E01_chapters.vtt`)}`,
      `${season}/season_poster.jpg?hash=1700000000004`,
      `${season}/season_poster.jpg.blurhash`,
      `${p}/tv/${folder}/show_poster.jpg?hash=1700000000005`,
      `${p}/tv/${folder}/show_backdrop.jpg?hash=1700000000006`,
      `${p}/tv/${folder}/show_logo.png?hash=1700000000007`,
      `${p}/tv/${folder}/show_poster.jpg.blurhash`,
    ],
    fetch: [
      `${p}/tv/${folder}/metadata.json`,
      `${season}/${encodeURIComponent('01_metadata.json')}?hash=1700000000008`,
    ],
  }
}

/** Rows: [caller, server id, path, the URL]. */
function rowsFor(serverId, base, p) {
  const rows = []
  for (const paths of [moviePaths(p, MOVIE), moviePaths(p, ODD_MOVIE), moviePaths(p, QUESTION_MOVIE), showPaths(p, SHOW), showPaths(p, ODD_SHOW)]) {
    for (const [caller, list] of Object.entries(paths)) {
      for (const path of list) rows.push([caller, serverId, path, `${base}${path}`])
    }
  }
  return rows
}

const PAYLOAD_ROWS = [
  ...rowsFor('plain', 'https://files.example', ''),
  ...rowsFor('prefixed', 'https://files.example', '/media'),
  ...rowsFor('ported', 'http://192.168.1.20:8080/library', ''),
]

describe('the URL of every path a payload carries is the one the old functions wrote', () => {
  it('covers movies and episodes, with and without the prefix, on three servers', () => {
    expect(PAYLOAD_ROWS).toHaveLength(3 * (3 * 10 + 2 * 12))
  })

  it.each(PAYLOAD_ROWS)('%s on %s: %s', (caller, serverId, path, url) => {
    const config = server(serverId)
    expect(old[caller](path, config)).toBe(url)
    expect(current[caller](path, config)).toBe(url)
  })

  // A few rows spelled out, so the expected bytes can be read without the helpers.
  it.each([
    ['movie video', 'prefixed', '/media/movies/Some%20Movie%20(2020)/Some%20Movie%20(2020).mkv', 'https://files.example/media/movies/Some%20Movie%20(2020)/Some%20Movie%20(2020).mkv'],
    ['movie asset', 'prefixed', '/media/movies/Caf%C3%A9%20%26%20Co%3A%20Part%20%232%20(2001)/poster.jpg?hash=17', 'https://files.example/media/movies/Caf%C3%A9%20%26%20Co%3A%20Part%20%232%20(2001)/poster.jpg?hash=17'],
    ['tv', 'plain', "/tv/Who's%20There%2C%20Then%3F/Season%201/Who's%20There%2C%20Then%3F%20-%20S01E01.mkv", "https://files.example/tv/Who's%20There%2C%20Then%3F/Season%201/Who's%20There%2C%20Then%3F%20-%20S01E01.mkv"],
    ['tv', 'prefixed', '/media/tv/Some%20Show%20(2019)/Season%201/01%20-%20Thumbnail.jpg?hash=1', 'https://files.example/media/tv/Some%20Show%20(2019)/Season%201/01%20-%20Thumbnail.jpg?hash=1'],
    ['tv', 'ported', '/tv/Some%20Show%20(2019)/show_logo.png?hash=2', 'http://192.168.1.20:8080/library/tv/Some%20Show%20(2019)/show_logo.png?hash=2'],
    ['fetch', 'prefixed', '/media/movies/Some%20Movie%20(2020)/metadata.json', 'https://files.example/media/movies/Some%20Movie%20(2020)/metadata.json'],
  ])('%s on %s: %s', (caller, serverId, path, url) => {
    const config = server(serverId)
    expect(old[caller](path, config)).toBe(url)
    expect(current[caller](path, config)).toBe(url)
  })
})

describe('absolute URLs', () => {
  it.each([
    ['movie video', 'prefixed', 'https://jit.example/stream/abc/master.m3u8'],
    ['movie asset', 'plain', 'https://image.example/t/p/original/poster.jpg'],
    ['movie asset', 'prefixed', 'http://files.example/media/movies/Some%20Movie%20(2020)/poster.jpg?hash=1'],
  ])('%s on %s keeps %s as it is', (caller, serverId, url) => {
    const config = server(serverId)
    expect(old[caller](url, config)).toBe(url)
    expect(current[caller](url, config)).toBe(url)
  })

  // The TV services hand the blurhash fetch the full URL they built.
  it.each([
    ['plain', '/tv/Some%20Show%20(2019)/show_poster.jpg.blurhash'],
    ['prefixed', '/media/tv/Some%20Show%20(2019)/Season%201/season_poster.jpg.blurhash'],
    ['ported', '/tv/Some%20Show%20(2019)/Season%201/01%20-%20Thumbnail.jpg.blurhash'],
  ])('a fetch on %s requests the full URL a TV service built for %s', (serverId, path) => {
    const config = server(serverId)
    const builtByOld = old.tv(path, config)
    const builtByNew = current.tv(path, config)
    expect(builtByNew).toBe(builtByOld)
    expect(old.fetch(builtByOld, config)).toBe(builtByOld)
    expect(current.fetch(builtByNew, config)).toBe(builtByOld)
  })
})

describe('a movie video path the sync puts together itself (no urls.mp4, a video in fileNames)', () => {
  // `/movies/<originalTitle>/<file>`, unencoded, without the prefix: the old
  // code added the prefix, so prefixedPath does.
  it.each([
    ['plain', 'Some Movie (2020)', 'Some Movie (2020).mkv', 'https://files.example/movies/Some Movie (2020)/Some Movie (2020).mkv'],
    ['prefixed', 'Some Movie (2020)', 'Some Movie (2020).mkv', 'https://files.example/media/movies/Some Movie (2020)/Some Movie (2020).mkv'],
    ['prefixed', 'Café & Co: Part #2 (2001)', 'Café.mp4', 'https://files.example/media/movies/Café & Co: Part #2 (2001)/Café.mp4'],
    ['ported', 'Some Movie (2020)', 'Some Movie (2020).avi', 'http://192.168.1.20:8080/library/movies/Some Movie (2020)/Some Movie (2020).avi'],
  ])('on %s: %s / %s', (serverId, title, file, url) => {
    const config = server(serverId)
    const path = `/movies/${title}/${file}`
    expect(UrlBuilder.createFullUrl(path, config)).toBe(url)
    expect(fileServerUrl(prefixedPath(path, config), config)).toBe(url)
  })

  it.each([
    ['media', '/media'],
    ['media/', '/media'],
    ['/media/', '/media'],
    ['/', ''],
  ])('a prefix configured as %j is written as %j, as UrlBuilder did', (prefix, written) => {
    const config = { ...server('plain'), prefix }
    const url = `https://files.example${written}/movies/A/A.mkv`
    expect(UrlBuilder.createFullUrl('/movies/A/A.mkv', config)).toBe(url)
    expect(fileServerUrl(prefixedPath('/movies/A/A.mkv', config), config)).toBe(url)
  })
})

describe('caption URLs', () => {
  const subtitles = (p) => ({
    English: { srcLang: 'en', url: `${p}/movies/${MOVIE}/${encodeURIComponent('Some Movie (2020).en.srt')}`, lastModified: '2024-05-01T00:00:00.000Z' },
    'Spanish (Auto)': { srcLang: 'es', url: `${p}/movies/${MOVIE}/${encodeURIComponent('Some Movie (2020).es.auto.srt')}`, autoGenerated: true, lastModified: '2024-05-02T00:00:00.000Z' },
    // A pending auto-caption: an absolute track URL on the processor, no file yet
    'French (Auto)': { srcLang: 'fr', url: 'https://node.example/api/captions/track/abc123.vtt', autoGenerated: true, pending: true },
    'German (Auto)': { srcLang: 'de', url: 'https://node.example/api/captions/track/def456.vtt', autoGenerated: true, pending: true, lastModified: null },
    // Nothing to write for these
    Italian: { srcLang: 'it', url: '' },
    Broken: null,
  })

  it.each([
    ['plain', ''],
    ['prefixed', '/media'],
    ['ported', ''],
  ])('on %s, for movies and episodes alike, are the ones UrlBuilder.processCaptionURLs wrote', (serverId, p) => {
    const config = server(serverId)
    const expected = UrlBuilder.processCaptionURLs(subtitles(p), config)
    expect(captionUrls(subtitles(p), config)).toEqual(expected)
    expect(JSON.stringify(captionUrls(subtitles(p), config))).toBe(JSON.stringify(expected))
    expect(expected.English.url).toBe(`${config.baseUrl}${p}/movies/${MOVIE}/Some%20Movie%20(2020).en.srt`)
    expect(expected['French (Auto)']).toEqual({
      srcLang: 'fr',
      url: 'https://node.example/api/captions/track/abc123.vtt',
      sourceServerId: serverId,
      autoGenerated: true,
      pending: true,
    })
    expect(Object.keys(expected)).toEqual(['English', 'Spanish (Auto)', 'French (Auto)', 'German (Auto)'])
  })

  it('is null when there is nothing to write, as before', () => {
    const config = server('prefixed')
    for (const input of [null, undefined, {}, { English: { srcLang: 'en' } }]) {
      expect(UrlBuilder.processCaptionURLs(input, config)).toBeNull()
      expect(captionUrls(input, config)).toBeNull()
    }
  })
})

// ---------------------------------------------------------------- outside the payload's shapes

// Inputs a payload does not carry, where the old movie and TV functions gave
// different answers. One function cannot give both; these rows say which it
// gives. A deployment whose payloads did carry them would already have had
// one of the two kinds of URL wrong.
describe('where the old functions disagreed with each other', () => {
  it('a baseURL ending in "/": the movie functions dropped the slash, the TV one kept it; the new one drops it', () => {
    const config = { ...server('plain'), baseUrl: 'https://files.example/' }
    const path = '/tv/Some%20Show%20(2019)/show_poster.jpg?hash=1'
    expect(old['movie asset'](path, config)).toBe('https://files.example/tv/Some%20Show%20(2019)/show_poster.jpg?hash=1')
    // (the TV function read the baseURL from config.js, which has no such server)
    const tvHandler = jest.requireActual('@src/utils/url_utils').createURLHandler({ baseURL: 'https://files.example/', prefixPath: '' })
    expect(tvHandler.createFullURL(path, false)).toBe('https://files.example//tv/Some%20Show%20(2019)/show_poster.jpg?hash=1')
    expect(fileServerUrl(path, config)).toBe('https://files.example/tv/Some%20Show%20(2019)/show_poster.jpg?hash=1')
  })

  it('a path starting with "//": the TV function collapsed the slashes, the movie ones kept them; the new one collapses them', () => {
    const config = server('plain')
    expect(old.tv('//tv/A/a.jpg', config)).toBe('https://files.example/tv/A/a.jpg')
    expect(old['movie asset']('//tv/A/a.jpg', config)).toBe('https://files.example//tv/A/a.jpg')
    expect(fileServerUrl('//tv/A/a.jpg', config)).toBe('https://files.example/tv/A/a.jpg')
  })

  it('an absolute URL: the TV function put the baseURL in front of it, the movie ones kept it; the new one keeps it', () => {
    const config = server('plain')
    const url = 'https://image.example/poster.jpg'
    expect(old.tv(url, config)).toBe('https://files.example/https://image.example/poster.jpg')
    expect(old['movie asset'](url, config)).toBe(url)
    expect(fileServerUrl(url, config)).toBe(url)
  })

  it('an empty path: the TV function wrote the bare baseURL, the movie ones threw; the new one throws', () => {
    const config = server('plain')
    expect(old.tv('', config)).toBe('https://files.example/')
    expect(() => old['movie asset']('', config)).toThrow('Path and server config are required')
    expect(() => fileServerUrl('', config)).toThrow('A file server path is required')
    expect(() => fileServerUrl(undefined, config)).toThrow('A file server path is required')
  })

  it('a path without the configured prefix: the movie video and the fetch added the prefix, the TV and movie asset ones did not; the new one does not', () => {
    const config = server('prefixed')
    const path = '/movies/Some%20Movie%20(2020)/Some%20Movie%20(2020).mkv'
    expect(old['movie video'](path, config)).toBe(`https://files.example/media${path}`)
    expect(old.fetch(path, config)).toBe(`https://files.example/media${path}`)
    expect(old.tv(path, config)).toBe(`https://files.example${path}`)
    // UrlBuilder's cache, keyed on the server id and the path, would hand the
    // asset the movie video's URL here: which one came first decided it.
    expect(old['movie asset'](path, config)).toBe(`https://files.example/media${path}`)
    UrlBuilder.clearCache()
    expect(old['movie asset'](path, config)).toBe(`https://files.example${path}`)
    expect(fileServerUrl(path, config)).toBe(`https://files.example${path}`)
  })
})
