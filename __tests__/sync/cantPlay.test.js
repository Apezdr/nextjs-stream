/**
 * @jest-environment node
 *
 * "Can't play yet": the movies and episodes the library hides although they
 * have a video. Hidden is isWebVisible's answer (utils/mediaVisibility), the
 * one rule the library's lists apply; the report only adds the reason.
 */

jest.mock('@src/lib/mongodb', () => ({ __esModule: true, default: Promise.resolve({}) }))

const { createMemoryMongo } = require('../helpers/memoryMongo')
const { isWebVisible } = require('@src/utils/mediaVisibility')
const { cantPlayReason, cantPlayTitles } = require('@src/utils/sync/run/cantPlay')

const JIT = 'https://transcoder.example.com/stream/bW92aWVzL1gvWC5ta3Y/master.m3u8'

describe('cantPlayReason', () => {
  // mediaVisibility's own cases (__tests__/jit/servePreference.test.js), each with a video
  const withVideo = [
    { primaryContainer: 'mp4' },
    { primaryContainer: 'webm' },
    { primaryContainer: 'MOV' },
    { primaryContainer: 'mkv' },
    { primaryContainer: 'avi' },
    { primaryContainer: 'mkv', jitUrl: JIT, jitEligible: true },
    { primaryContainer: 'mkv', jitUrl: '' },
    { primaryContainer: 'mkv', jitUrl: null },
    { videoURL: 'https://h/movies/X/x.mp4' },
    { videoURL: 'https://h/movies/X/x.mp4?token=1' },
    { videoURL: 'https://h/movies/X/x.mkv' },
  ]

  it.each(withVideo.map((doc) => [JSON.stringify(doc), doc]))('agrees with isWebVisible for %s', (_label, doc) => {
    expect(cantPlayReason(doc) === null).toBe(isWebVisible(doc))
  })

  it('gives the answers mediaVisibility gave before', () => {
    expect(withVideo.map((doc) => cantPlayReason(doc) === null)).toEqual([
      true, true, true, false, false, true, false, false, true, true, false,
    ])
  })

  it('says nothing about a document with no video: that is "no video file yet"', () => {
    expect(cantPlayReason({})).toBeNull()
    expect(cantPlayReason(null)).toBeNull()
    expect(cantPlayReason({ videoURL: null })).toBeNull()
  })

  it('names the format: the container, else the URL’s extension', () => {
    expect(cantPlayReason({ primaryContainer: 'AVI', videoURL: 'https://h/x.mp4' })).toBe('unsupported format (.avi)')
    expect(cantPlayReason({ videoURL: 'https://h/movies/X/x.mkv?t=1' })).toBe('unsupported format (.mkv)')
  })

  it('says when an admin turned the transcoder off for the title', () => {
    expect(
      cantPlayReason({ primaryContainer: 'mkv', jitUrl: JIT, jitEligible: true, jitServeOverride: 'off' })
    ).toBe('transcoding turned off for this title (.mkv)')
  })
})

describe('cantPlayTitles', () => {
  it('lists, per server the video came from, the hidden movies and the hidden episodes by show and season', async () => {
    const mongo = createMemoryMongo()
    const col = (name) => mongo.collection('Media', name)
    col('FlatMovies').docs.push(
      { _id: 'm1', originalTitle: 'Zulu Rip (1999)', videoURL: 'https://A/z.avi', primaryContainer: 'avi', videoSource: 'A' },
      { _id: 'm2', originalTitle: 'Alpha Rip (1998)', videoURL: 'https://A/a.avi', primaryContainer: 'avi', videoSource: 'A' },
      { _id: 'm3', originalTitle: 'Plays (2020)', videoURL: 'https://A/p.mp4', primaryContainer: 'mp4', videoSource: 'A' },
      { _id: 'm4', originalTitle: 'Transcoded (2021)', videoURL: 'https://B/t.mkv', primaryContainer: 'mkv', jitUrl: JIT, jitEligible: true, videoSource: 'B' },
      { _id: 'm5', originalTitle: 'No Video (2024)', posterURL: 'https://A/poster.jpg' }
    )
    col('FlatTVShows').docs.push({ _id: 's1', originalTitle: 'Old Show (1995)' })
    col('FlatEpisodes').docs.push(
      { _id: 'e3', showId: 's1', seasonNumber: 1, episodeNumber: 3, videoURL: 'https://A/3.avi', primaryContainer: 'avi', videoSource: 'A' },
      { _id: 'e1', showId: 's1', seasonNumber: 1, episodeNumber: 1, videoURL: 'https://A/1.avi', primaryContainer: 'avi', videoSource: 'A' },
      { _id: 'e2', showId: 's1', seasonNumber: 1, episodeNumber: 2, videoURL: 'https://A/2.mp4', primaryContainer: 'mp4', videoSource: 'A' },
      { _id: 'e4', showId: 's1', seasonNumber: 2, episodeNumber: 1, videoURL: 'https://B/4.avi', primaryContainer: 'avi', videoSource: 'B' }
    )

    const report = await cantPlayTitles({ collection: (name) => col(name) })

    expect(report).toEqual({
      A: {
        movies: [
          { title: 'Alpha Rip (1998)', reason: 'unsupported format (.avi)' },
          { title: 'Zulu Rip (1999)', reason: 'unsupported format (.avi)' },
        ],
        tv: [
          {
            title: 'Old Show (1995)',
            season: 1,
            episodes: [
              { episode: 1, reason: 'unsupported format (.avi)' },
              { episode: 3, reason: 'unsupported format (.avi)' },
            ],
          },
        ],
        count: 4,
      },
      B: {
        movies: [],
        tv: [{ title: 'Old Show (1995)', season: 2, episodes: [{ episode: 1, reason: 'unsupported format (.avi)' }] }],
        count: 1,
      },
    })
  })

  it('is empty when the library hides nothing that has a video', async () => {
    const mongo = createMemoryMongo()
    mongo.collection('Media', 'FlatMovies').docs.push({ _id: 'm', originalTitle: 'Plays', videoURL: 'https://A/p.webm', videoSource: 'A' })
    expect(await cantPlayTitles({ collection: (name) => mongo.collection('Media', name) })).toEqual({})
  })
})
