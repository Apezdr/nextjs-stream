/**
 * @jest-environment node
 *
 * One server's pass over a title's stored captions. See the module header for
 * the three rules; each case here is one of them or a reason it is shaped the
 * way it is.
 */

const { reconcileCaptions } = require('@src/utils/sync/core/captionReconcile')

const entry = (serverId, extra = {}) => ({
  url: `https://${serverId}.example/en.srt`,
  srcLang: 'en',
  lastModified: 'm1',
  sourceServerId: serverId,
  ...extra,
})

/** Server `serverId` passes; `listedBy` says which servers list each language this run. */
function pass({ existing, listed, serverId, listedBy, priorities = { A: 1, B: 2 }, allProbed = true }) {
  const owner = (language) =>
    [...(listedBy[language] ?? [])].sort((x, y) => priorities[x] - priorities[y])[0]
  return reconcileCaptions({
    existing,
    listed,
    serverId,
    ownsLanguage: (language) => owner(language) === serverId,
    listedByAnyServer: (language) => (listedBy[language] ?? []).length > 0,
    allEnabledServersProbed: allProbed,
  })
}

describe('reconcileCaptions', () => {
  it('writes a language the server lists and owns', () => {
    const result = pass({
      existing: undefined,
      listed: { English: entry('A') },
      serverId: 'A',
      listedBy: { English: ['A'] },
    })
    expect(result).toMatchObject({ changed: true, written: ['English'], removed: [] })
    expect(result.captions.English.sourceServerId).toBe('A')
  })

  it('does not write a language a higher-priority server also lists', () => {
    const result = pass({
      existing: { English: entry('A') },
      listed: { English: entry('B') },
      serverId: 'B',
      listedBy: { English: ['A', 'B'] },
    })
    expect(result.changed).toBe(false)
    expect(result.captions.English.sourceServerId).toBe('A')
  })

  it('leaves another server\'s languages in place', () => {
    const result = pass({
      existing: { Spanish: entry('B') },
      listed: { English: entry('A') },
      serverId: 'A',
      listedBy: { English: ['A'], Spanish: ['B'] },
    })
    expect(Object.keys(result.captions).sort()).toEqual(['English', 'Spanish'])
  })

  it('reports no change when the stored entry is already this one', () => {
    const result = pass({
      existing: { English: entry('A') },
      listed: { English: entry('A') },
      serverId: 'A',
      listedBy: { English: ['A'] },
    })
    expect(result).toMatchObject({ changed: false, written: [], removed: [] })
  })

  it('replaces the entry when the file changed', () => {
    const result = pass({
      existing: { English: entry('A') },
      listed: { English: entry('A', { lastModified: 'm2' }) },
      serverId: 'A',
      listedBy: { English: ['A'] },
    })
    expect(result.written).toEqual(['English'])
    expect(result.captions.English.lastModified).toBe('m2')
  })

  it('removes an entry its own server no longer lists, including the last one', () => {
    const result = pass({
      existing: { English: entry('A') },
      listed: null,
      serverId: 'A',
      listedBy: {},
    })
    expect(result).toMatchObject({ changed: true, removed: ['English'] })
    expect(result.captions).toEqual({})
  })

  it('removes its withdrawn entry even on a run with a server missing', () => {
    const result = pass({
      existing: { English: entry('A') },
      listed: null,
      serverId: 'A',
      listedBy: {},
      allProbed: false,
    })
    expect(result.removed).toEqual(['English'])
  })

  it('removes an entry no server lists, once every server has answered', () => {
    const orphan = { English: { url: 'https://old.example/en.srt', srcLang: 'en' } }
    expect(pass({ existing: orphan, listed: null, serverId: 'A', listedBy: {} }).removed).toEqual(['English'])
  })

  it('keeps another server\'s entry while that server may simply be down', () => {
    const result = pass({
      existing: { Spanish: entry('B') },
      listed: { English: entry('A') },
      serverId: 'A',
      listedBy: { English: ['A'] },
      allProbed: false,
    })
    expect(Object.keys(result.captions).sort()).toEqual(['English', 'Spanish'])
  })

  it('reports that entry as withheld, so the caller retries when every server answers', () => {
    const args = {
      existing: { Spanish: entry('B') },
      listed: { English: entry('A') },
      serverId: 'A',
      listedBy: { English: ['A'] },
    }
    expect(pass({ ...args, allProbed: false }).withheld).toEqual(['Spanish'])
    // Once they all answer it is removed, and nothing is left pending.
    expect(pass({ ...args, allProbed: true })).toMatchObject({ removed: ['Spanish'], withheld: [] })
  })

  it('does not report as withheld an entry another server still lists', () => {
    const result = pass({
      existing: { Spanish: entry('B') },
      listed: { English: entry('A') },
      serverId: 'A',
      listedBy: { English: ['A'], Spanish: ['B'] },
      allProbed: false,
    })
    expect(result.withheld).toEqual([])
  })

  it('treats a stored null and a missing value as the same entry', () => {
    // MongoDB hands back null for a field that was written as undefined.
    const stored = { url: 'https://A.example/en.srt', srcLang: 'en', lastModified: null, sourceServerId: 'A' }
    const listed = { url: 'https://A.example/en.srt', srcLang: 'en', sourceServerId: 'A' }
    const result = pass({ existing: { English: stored }, listed: { English: listed }, serverId: 'A', listedBy: { English: ['A'] } })
    expect(result).toMatchObject({ changed: false, written: [] })
  })

  it('returns a changed map with English first and the rest by name', () => {
    const result = pass({
      existing: { Spanish: entry('B'), French: entry('B') },
      listed: { 'English (SDH)': entry('A'), Arabic: entry('A') },
      serverId: 'A',
      listedBy: { 'English (SDH)': ['A'], Arabic: ['A'], Spanish: ['B'], French: ['B'] },
    })
    expect(Object.keys(result.captions)).toEqual(['English (SDH)', 'Arabic', 'French', 'Spanish'])
  })

  it('removes a withdrawn auto-generated caption like any other', () => {
    const result = pass({
      existing: { English: entry('A', { autoGenerated: true, pending: true }) },
      listed: null,
      serverId: 'A',
      listedBy: {},
    })
    expect(result.removed).toEqual(['English'])
  })

  it('does not mutate what it was given', () => {
    const existing = { English: entry('A') }
    pass({ existing, listed: null, serverId: 'A', listedBy: {} })
    expect(Object.keys(existing)).toEqual(['English'])
  })

  describe('the same end state in either server order', () => {
    const settle = (order, start, listedByServer) => {
      const listedBy = {}
      for (const [serverId, listed] of Object.entries(listedByServer)) {
        for (const language of Object.keys(listed ?? {})) {
          listedBy[language] = [...(listedBy[language] ?? []), serverId]
        }
      }
      let captions = start
      for (const serverId of order) {
        captions = pass({ existing: captions, listed: listedByServer[serverId], serverId, listedBy }).captions
      }
      return captions
    }

    it.each([
      ['both list English', undefined, { A: { English: entry('A') }, B: { English: entry('B') } }],
      ['different languages', undefined, { A: { English: entry('A') }, B: { Spanish: entry('B') } }],
      ['the owner dropped English', { English: entry('A') }, { A: null, B: { English: entry('B') } }],
      ['the other server dropped its language', { English: entry('A'), Spanish: entry('B') }, { A: { English: entry('A') }, B: null }],
      ['both dropped everything', { English: entry('A'), Spanish: entry('B') }, { A: null, B: null }],
    ])('%s', (_name, start, listedByServer) => {
      expect(settle(['B', 'A'], start, listedByServer)).toEqual(settle(['A', 'B'], start, listedByServer))
    })
  })
})
