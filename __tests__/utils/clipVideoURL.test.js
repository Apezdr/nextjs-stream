/**
 * generateClipVideoURL: the processor clip URL for a title.
 *
 * The title is a folder name. It goes into the URL path percent-encoded, or a
 * `?`, `#` or `%` in it changes what the URL means. And a clip the processor
 * cannot make (no duration to pick a range from, a show without its episode)
 * gets no URL at all, not one that fails every time it is requested.
 */

jest.mock('@src/utils/config', () => ({
  getServer: jest.fn((id) => ({ syncEndpoint: `https://${id}.example.com/node` })),
}))

import { generateClipVideoURL } from '@src/utils/auth_utils'

const TWO_HOURS_MS = 2 * 60 * 60 * 1000

function movie(overrides = {}) {
  return { videoURL: 'https://files.example.com/a.mkv', duration: TWO_HOURS_MS, ...overrides }
}

function parts(url) {
  const parsed = new URL(url)
  return {
    segments: parsed.pathname.split('/').map(decodeURIComponent),
    start: parsed.searchParams.get('start'),
    end: parsed.searchParams.get('end'),
    hash: parsed.hash,
  }
}

describe('generateClipVideoURL', () => {
  it('builds the movie clip URL on the title’s server', () => {
    expect(generateClipVideoURL(movie({ videoSource: 'tower' }), 'movie', 'Logan')).toBe(
      'https://tower.example.com/node/videoClip/movie/Logan?start=3200&end=3250'
    )
  })

  it('uses the default server when the item names none', () => {
    expect(generateClipVideoURL(movie(), 'movie', 'Logan')).toBe(
      'https://default.example.com/node/videoClip/movie/Logan?start=3200&end=3250'
    )
  })

  it('adds useOriginalVideo for the TV app', () => {
    expect(generateClipVideoURL(movie(), 'movie', 'Logan', true)).toBe(
      'https://default.example.com/node/videoClip/movie/Logan?start=3200&end=3250&useOriginalVideo=true'
    )
  })

  // Each of these, written into the path as it is, used to change the URL:
  // `?` and `#` ended the path (start and end were lost), `%` read as an escape.
  it.each([
    ['The End?'],
    ['Who Framed Roger Rabbit? (1988)'],
    ['Issue #1'],
    ['100% Wolf'],
    ['50%25 Off'],
    ['Fast & Furious'],
    ['Tom + Jerry = Friends'],
    ['Mission: Impossible'],
    ['AC/DC Live'],
    ['The Matrix (1999)'],
    ['Amélie'],
    ['千と千尋の神隠し'],
  ])('carries the title %p through the URL unchanged', (title) => {
    const url = generateClipVideoURL(movie(), 'movie', title, true)
    const { segments, start, end, hash } = parts(url)

    expect(segments.slice(-3)).toEqual(['videoClip', 'movie', title])
    expect(start).toBe('3200')
    expect(end).toBe('3250')
    expect(hash).toBe('')
    expect(new URL(url).searchParams.get('useOriginalVideo')).toBe('true')
  })

  it('writes the title as one path segment', () => {
    expect(generateClipVideoURL(movie(), 'movie', 'The End?')).toBe(
      'https://default.example.com/node/videoClip/movie/The%20End%3F?start=3200&end=3250'
    )
    expect(generateClipVideoURL(movie(), 'movie', 'AC/DC Live')).toContain('/videoClip/movie/AC%2FDC%20Live?')
  })

  it('builds the episode clip URL with its season and episode', () => {
    const episode = { videoURL: 'x', duration: 45 * 60 * 1000, seasonNumber: 2, episodeNumber: 7 }
    const { segments } = parts(generateClipVideoURL(episode, 'tv', "Widow's Bay?"))

    expect(segments.slice(-5)).toEqual(['videoClip', 'tv', "Widow's Bay?", '2', '7'])
  })

  it('reads the season and episode from the nested shapes too', () => {
    const item = {
      videoURL: 'x',
      duration: 45 * 60 * 1000,
      metadata: { season_number: 3 },
      episode: { episodeNumber: 4 },
    }
    expect(parts(generateClipVideoURL(item, 'tv', 'Show')).segments.slice(-2)).toEqual(['3', '4'])
  })

  it('treats season 0 as a season', () => {
    const special = { videoURL: 'x', duration: 45 * 60 * 1000, seasonNumber: 0, episodeNumber: 1 }
    expect(parts(generateClipVideoURL(special, 'tv', 'Show')).segments.slice(-2)).toEqual(['0', '1'])
  })

  it('has no URL for a show item without its season or episode', () => {
    const base = { videoURL: 'x', duration: 45 * 60 * 1000 }
    expect(generateClipVideoURL({ ...base }, 'tv', 'Show')).toBeNull()
    expect(generateClipVideoURL({ ...base, seasonNumber: 1 }, 'tv', 'Show')).toBeNull()
    expect(generateClipVideoURL({ ...base, episodeNumber: 1 }, 'tv', 'Show')).toBeNull()
  })

  it.each([[undefined], [null], [0], [-5], [NaN], ['abc'], [900]])(
    'has no URL when the duration is %p',
    (duration) => {
      // 900 ms is under a second: nothing to clip
      expect(generateClipVideoURL(movie({ duration }), 'movie', 'Logan')).toBeNull()
    }
  )

  it('has no URL without a video or a title', () => {
    expect(generateClipVideoURL({ duration: TWO_HOURS_MS }, 'movie', 'Logan')).toBeNull()
    expect(generateClipVideoURL(null, 'movie', 'Logan')).toBeNull()
    expect(generateClipVideoURL(movie(), 'movie', undefined)).toBeNull()
    expect(generateClipVideoURL(movie(), 'movie', '')).toBeNull()
  })

  it('picks a range inside a video shorter than the default one', () => {
    // 22 minutes: a third of the way in, 50 s long
    const { start, end } = parts(generateClipVideoURL(movie({ duration: 22 * 60 * 1000 }), 'movie', 'Short'))
    expect(Number(start)).toBe(440)
    expect(Number(end)).toBe(490)
  })

  it('clips a very short video from its beginning', () => {
    const { start, end } = parts(generateClipVideoURL(movie({ duration: 30 * 1000 }), 'movie', 'Tiny'))
    expect(Number(start)).toBe(0)
    expect(Number(end)).toBe(30)
  })
})
