/**
 * @jest-environment node
 *
 * The parts of the sync report the admin's popup shows that the passes do not
 * produce themselves: the titles with no video file yet, with the reason
 * their files give, and per server the titles checked, updated, unchanged and
 * failed.
 */

const { noVideoReason, noVideoTitles, createTitleCounts } = require('@src/utils/sync/run/syncReport')

describe('noVideoReason', () => {
  it.each([
    ['no files at all', [], 'no video file'],
    ['artwork and metadata only', ['poster.jpg', 'backdrop.jpg', 'metadata.json', 'Film.en.srt'], 'no video file'],
    ['a file list that is missing', undefined, 'no video file'],
    ['an .avi', ['Film (1999).avi', 'poster.jpg'], 'unsupported format (.avi)'],
    ['an upper-case extension', ['FILM.AVI'], 'unsupported format (.avi)'],
    ['two unsupported formats, each named once', ['a.wmv', 'b.avi', 'c.avi'], 'unsupported format (.avi, .wmv)'],
    ['a qBittorrent download', ['Film.mkv.!qb', 'poster.jpg'], 'still downloading'],
    ['a .part file', ['Film.mkv.part'], 'still downloading'],
    ['a browser download', ['Film.mp4.crdownload'], 'still downloading'],
    ['a download beside an unsupported file', ['Film.avi', 'Film.mkv.part'], 'still downloading'],
  ])('is "%s" → %s', (_label, fileNames, label) => {
    expect(noVideoReason(fileNames).label).toBe(label)
  })

  it('names its code', () => {
    expect(noVideoReason(['a.avi']).code).toBe('unsupported')
    expect(noVideoReason(['a.part']).code).toBe('downloading')
    expect(noVideoReason([]).code).toBe('none')
  })

  it('does not call a served container unsupported', () => {
    for (const name of ['a.mp4', 'a.m4v', 'a.mov', 'a.mkv', 'a.webm']) {
      expect(noVideoReason([name]).code).toBe('none')
    }
  })
})

describe('noVideoTitles', () => {
  const episode = (videoURL) => ({ videoURL })

  it('lists each movie with no primary video, with the reason its files give', () => {
    const fileServer = {
      movies: {
        'Has Video (2001)': { urls: { mp4: '/movies/a/a.mkv' }, fileNames: ['a.mkv'] },
        'Not Yet (2024)': { urls: { poster: '/p.jpg' }, fileNames: ['poster.jpg', 'metadata.json'] },
        'Old Rip (1999)': { urls: {}, fileNames: ['Old Rip (1999).avi'] },
      },
    }

    expect(noVideoTitles(fileServer).movies).toEqual([
      { title: 'Not Yet (2024)', reason: 'no video file' },
      { title: 'Old Rip (1999)', reason: 'unsupported format (.avi)' },
    ])
  })

  it('lists a show with no season, each season with no episode video, and a show with none at all', () => {
    const fileServer = {
      tv: {
        'Empty Show': { seasons: {} },
        'Partly Here': {
          seasons: {
            'Season 1': { episodes: { S01E01: episode('/tv/p/1.mkv') } },
            'Season 2': { episodes: {} },
          },
        },
        'Nothing Yet': { seasons: { 'Season 1': { episodes: { S01E01: episode(null) } } } },
      },
    }

    expect(noVideoTitles(fileServer).tv).toEqual([
      { title: 'Empty Show', season: null, reason: 'no video file' },
      { title: 'Partly Here', season: 'Season 2', reason: 'no video file' },
      { title: 'Nothing Yet', season: 'Season 1', reason: 'no video file' },
      { title: 'Nothing Yet', season: null, reason: 'no video file' },
    ])
  })

  it('is empty for a server with nothing missing, or no payload', () => {
    expect(noVideoTitles({ movies: { A: { urls: { mp4: '/a.mp4' } } } })).toEqual({ movies: [], tv: [] })
    expect(noVideoTitles(undefined)).toEqual({ movies: [], tv: [] })
  })
})
describe('createTitleCounts', () => {
  const result = (status, errors = [], metadata = undefined) => ({ status, errors, ...(metadata ? { metadata } : {}) })
  const changed = () => result('completed', [], { documentChanged: true })

  it('puts every title checked in exactly one of updated, unchanged and failed', () => {
    const counts = createTitleCounts()
    // A gate skip: one skipped result
    counts.record('movies', 'Skipped On Its Gate', [result('skipped')])
    // A full pass that wrote nothing
    counts.record('movies', 'Nothing To Write', [result('skipped'), result('skipped')])
    // A movie with nothing to sync: no results
    counts.record('movies', 'Nothing To Sync', [])
    counts.record('movies', 'Written', [result('skipped'), changed()])
    // A show whose show result was skipped and an episode written
    counts.record('tv', 'A Show', [result('skipped'), changed()])
    // A new document counts as updated
    counts.record('movies', 'New', [result('completed', [], { created: true })])
    counts.record('tv', 'Broken Show', [changed(), result('failed', ['', 'episode metadata fetch failed'])])

    expect(counts.counts()).toEqual({
      checked: 7,
      updated: 3,
      unchanged: 3,
      failed: 1,
      failures: [{ kind: 'tv', title: 'Broken Show', error: 'episode metadata fetch failed' }],
    })
  })

  it('counts a title whose writes ran but changed nothing as unchanged: "completed" alone is not a change', () => {
    const counts = createTitleCounts()
    counts.record('tv', 'Settled Show', [result('completed'), result('completed', [], { documentChanged: false })])
    counts.record('movies', 'Settled Movie', [result('completed'), result('completed')])
    expect(counts.counts()).toMatchObject({ checked: 2, updated: 0, unchanged: 2 })
  })

  it('names a failure without a message as such', () => {
    const counts = createTitleCounts()
    counts.record('movies', 'Quiet Failure', [result('failed')])
    expect(counts.counts().failures).toEqual([{ kind: 'movies', title: 'Quiet Failure', error: 'failed without a message' }])
  })

  it('hands out a copy, so later titles do not change a report already sent', () => {
    const counts = createTitleCounts()
    counts.record('movies', 'First', [changed()])
    const first = counts.counts()
    counts.record('movies', 'Second', [result('failed', ['boom'])])
    expect(first).toEqual({ checked: 1, updated: 1, unchanged: 0, failed: 0, failures: [] })
  })
})
