/**
 * @jest-environment node
 *
 * Which titles a manifest tick passes over (run/selectTitles): every title a
 * full pass would do anything for, by rules R1 to R7, and no other.
 */

const { ObjectId } = require('mongodb')
const {
  selectTitles,
  stateRules,
  databaseRules,
  entriesRequests,
  readSelectionFacts,
} = require('@src/utils/sync/run/selectTitles')

const H0 = '0000000000000000'
const H1 = '1111111111111111'

/** A KindManifest: `titles` maps a name to its hash, or to [hash, {seasonKey: episodeKeys}] for TV. */
function km(titles, version = 1.0001) {
  return {
    etag: 'W/"m"',
    format: 2,
    version,
    titles: new Map(
      Object.entries(titles).map(([name, value]) =>
        Array.isArray(value)
          ? [name, { hash: value[0], seasons: new Map(Object.entries(value[1])) }]
          : [name, { hash: value }]
      )
    ),
  }
}

const servers = (byId) => new Map(Object.entries(byId))
const applied = (byKind) => ({
  tv: new Map(Object.entries(byKind.tv || {}).map(([t, s]) => [t, new Map(Object.entries(s))])),
  movies: new Map(Object.entries(byKind.movies || {}).map(([t, s]) => [t, new Map(Object.entries(s))])),
})
const gates = (...ids) => Object.fromEntries(ids.map((id) => [id, `g2:x#${id}`]))
const facts = ({ movies = {}, shows = {}, episodes = {}, seasons = {} } = {}) => ({
  movies: new Map(Object.entries(movies)),
  shows: new Map(Object.entries(shows)),
  episodeCounts: new Map(Object.entries(episodes)),
  seasonCounts: new Map(Object.entries(seasons)),
})
const asObject = (selected) => ({ tv: Object.fromEntries(selected.tv), movies: Object.fromEntries(selected.movies) })

describe('stateRules (R1, R2, R7)', () => {
  const manifests = servers({
    A: { movies: km({ Film: H1, Same: H0 }), tv: km({}) },
    B: { movies: km({ Film: H0, Same: H0 }), tv: km({}) },
  })

  it('R1: selects a title whose hash on one server is not the one it applied, and leaves the unchanged one', () => {
    const result = stateRules({ manifests, applied: applied({ movies: { Film: { A: H0, B: H0 }, Same: { A: H0, B: H0 } } }) })
    expect(asObject(result).movies).toEqual({ Film: ['R1'] })
  })

  it('R2: selects a new title, one a server gained, and one a server stopped answering for', () => {
    const was = applied({ movies: { Film: { A: H1 }, Same: { A: H0, B: H0, C: H0 } } })
    const result = stateRules({ manifests, applied: was })
    // Film: B gained it (and its hash is new to B); Same: C did not answer
    expect(asObject(result).movies).toEqual({ Film: ['R1', 'R2'], Same: ['R2'] })
    expect(asObject(stateRules({ manifests, applied: applied({}) })).movies).toEqual({ Film: ['R1', 'R2'], Same: ['R1', 'R2'] })
  })

  it('R7: selects every title of a kind whose list version moved on a server', () => {
    const held = servers({ A: { movies: km({}, 1.0000), tv: km({}) } })
    const was = applied({ movies: { Film: { A: H1, B: H0 }, Same: { A: H0, B: H0 } } })
    expect(asObject(stateRules({ manifests, applied: was, held })).movies).toEqual({ Film: ['R7'], Same: ['R7'] })
  })

  it('keys every title by its folder name, `__proto__` and `constructor` included', () => {
    const movies = km({})
    movies.titles = new Map([['__proto__', { hash: H0 }], ['constructor', { hash: H1 }]])
    const odd = servers({ A: { movies, tv: km({}) } })
    const result = stateRules({ manifests: odd, applied: applied({ movies: { constructor: { A: H1 } } }) })
    expect([...result.movies]).toEqual([['__proto__', ['R1', 'R2']]])
  })
})

describe('databaseRules (R3 to R6)', () => {
  const tvManifests = servers({
    A: { movies: km({ Film: H0 }), tv: km({ Show: [H0, { 'Season 1': ['S01E01', 'S01E02'], Specials: ['S00E01'] }] }) },
    B: { movies: km({}), tv: km({ Show: [H0, { 'Season 1': ['S01E01', 'S01E02', 'S01E03'] }] }) },
  })
  const show = { syncGates: gates('A', 'B'), showKey: 'id1', visibleEpisodeCount: 3 }

  it('selects nothing when every lister has a gate and the database holds what they list', () => {
    const result = databaseRules({
      manifests: tvManifests,
      facts: facts({ movies: { Film: { syncGates: gates('A') } }, shows: { Show: show }, episodes: { id1: 3 }, seasons: { id1: 1 } }),
    })
    expect(asObject(result)).toEqual({ tv: {}, movies: {} })
  })

  it('R3: selects a title whose document lacks a lister’s gate (absent, null or empty), not a non-lister’s', () => {
    const result = databaseRules({
      manifests: tvManifests,
      facts: facts({
        movies: { Film: { syncGates: gates('B') } },
        shows: { Show: { ...show, syncGates: { A: 'g2:x', B: '' } } },
        episodes: { id1: 3 },
        seasons: { id1: 1 },
      }),
    })
    expect(asObject(result)).toEqual({ tv: { Show: ['R3'] }, movies: { Film: ['R3'] } })
    const nullGates = databaseRules({ manifests: tvManifests, facts: facts({ movies: { Film: { syncGates: null } }, shows: { Show: show }, episodes: { id1: 3 }, seasons: { id1: 1 } }) })
    expect(asObject(nullGates).movies).toEqual({ Film: ['R3'] })
  })

  it('R4: selects a title with no document', () => {
    expect(asObject(databaseRules({ manifests: tvManifests, facts: facts() }))).toEqual({ tv: { Show: ['R4'] }, movies: { Film: ['R4'] } })
  })

  it('R5: selects a show the database holds fewer episodes or seasons of than one server lists, counting stored seasons only', () => {
    const drift = (episodes, seasons) =>
      asObject(databaseRules({ manifests: tvManifests, facts: facts({ movies: { Film: { syncGates: gates('A') } }, shows: { Show: show }, episodes: { id1: episodes }, seasons: { id1: seasons } }) })).tv
    expect(drift(2, 1)).toEqual({ Show: ['R5'] }) // B lists 3
    expect(drift(3, 0)).toEqual({ Show: ['R5'] })
    expect(drift(3, 1)).toEqual({}) // "Specials" and its episode are never stored
  })

  it('R6: selects a show with no visibleEpisodeCount field, not one where it is null', () => {
    const { visibleEpisodeCount: _drop, ...without } = show
    const pick = (doc) => asObject(databaseRules({ manifests: tvManifests, facts: facts({ movies: { Film: { syncGates: gates('A') } }, shows: { Show: doc }, episodes: { id1: 3 }, seasons: { id1: 1 } }) })).tv
    expect(pick(without)).toEqual({ Show: ['R6'] })
    expect(pick({ ...show, visibleEpisodeCount: null })).toEqual({})
  })
})

describe('selectTitles', () => {
  const manifests = servers({ A: { movies: km({ Film: H0, Other: H0 }), tv: km({ Show: [H0, {}] }) } })

  it('passes over every listed title on an `all` tick', () => {
    expect(asObject(selectTitles({ mode: 'all', manifests }))).toEqual({ tv: { Show: ['all'] }, movies: { Film: ['all'], Other: ['all'] } })
  })

  it('unites the state and database rules on a select tick', () => {
    const result = selectTitles({
      mode: 'select',
      manifests,
      applied: applied({ movies: { Film: { A: H1 }, Other: { A: H0 } }, tv: { Show: { A: H0 } } }),
      held: new Map(),
      facts: facts({ movies: { Film: { syncGates: gates('A') } }, shows: { Show: { syncGates: gates('A'), showKey: 's', visibleEpisodeCount: 0 } } }),
    })
    expect(asObject(result)).toEqual({ tv: {}, movies: { Film: ['R1'], Other: ['R4'] } })
  })
})

describe('entriesRequests', () => {
  it('asks each server for the selected titles it lists, all of them as {all: true}, and nothing it need not', () => {
    const manifests = servers({
      A: { movies: km({ Film: H0, Other: H0 }), tv: km({ Show: [H0, {}] }) },
      B: { movies: km({ Film: H0 }), tv: km({}) },
      C: { movies: km({ Else: H0 }), tv: km({}) },
    })
    const selected = { movies: new Map([['Film', ['R1']]]), tv: new Map([['Show', ['R3']]]) }
    expect(Object.fromEntries(entriesRequests(selected, manifests))).toEqual({
      A: { movies: { titles: ['Film'] }, tv: { all: true } },
      B: { movies: { all: true } },
    })
  })
})

describe('readSelectionFacts', () => {
  it('maps documents by folder name and counts episodes and seasons per show id; a shared folder name reads as open', async () => {
    const showId = new ObjectId()
    const docs = {
      FlatMovies: [{ originalTitle: 'Film', syncGates: gates('A') }, { originalTitle: 'Twice', syncGates: gates('A') }, { originalTitle: 'Twice', syncGates: gates('A') }],
      FlatTVShows: [{ _id: showId, originalTitle: 'Show', syncGates: gates('A') }],
    }
    const groups = { FlatEpisodes: [{ _id: showId, n: 4 }], FlatSeasons: [{ _id: showId, n: 2 }] }
    const db = {
      collection: (name) => ({
        find: () => ({ toArray: async () => docs[name] }),
        aggregate: (pipeline) => {
          expect(pipeline).toEqual([{ $group: { _id: '$showId', n: { $sum: 1 } } }])
          return { toArray: async () => groups[name] }
        },
      }),
    }
    const result = await readSelectionFacts(db)
    expect(result.movies.get('Film')).toEqual({ syncGates: gates('A') })
    expect(result.movies.get('Twice')).toEqual({ syncGates: null })
    expect(result.shows.get('Show')).toEqual({ syncGates: gates('A'), showKey: String(showId) })
    expect(result.episodeCounts.get(String(showId))).toBe(4)
    expect(result.seasonCounts.get(String(showId))).toBe(2)
  })
})
