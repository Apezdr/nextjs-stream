/**
 * @jest-environment node
 *
 * Library scopes (src/lib/roles/libraryScope.ts): what a scope holds, how
 * several combine, and the Mongo fragments every viewer-facing read filters
 * with (src/utils/mediaVisibility.js). The whole library must add nothing to
 * a query: the common case keeps exactly its old shape.
 */
const { ObjectId } = require('mongodb')
const {
  EMPTY_SCOPE,
  FULL_LIBRARY,
  MOVIE_RATINGS,
  TV_RATINGS,
  assertLibraryAccess,
  canonicalScopeJson,
  parseScope,
  ratingsUpTo,
  scopeMatcher,
  scopeRule,
  unionScopes,
} = require('@src/lib/roles/libraryScope')
const { RoleInputError } = require('@src/lib/roles/capability')
const {
  libraryEpisodeFilter,
  libraryMovieFilter,
  libraryShowFilter,
  scopeEpisodeFilter,
  scopeMovieFilter,
  scopeShowFilter,
  visibleEpisodeFilter,
  visibleMovieFilter,
  visibleShowFilter,
} = require('@src/utils/mediaVisibility')

const SHOW_A = '64b7f0c2a1b2c3d4e5f60701'
const SHOW_B = '64b7f0c2a1b2c3d4e5f60702'
const picked = (mediaType, originalTitle) => ({ mediaType, originalTitle, access: 'play' })
const scoped = (scope, showIds = []) => ({ id: 'scope-test', scope, showIds })

describe('parseScope', () => {
  it('reads caps and hand-picked titles, sorted and one entry per title', () => {
    expect(
      parseScope({
        movieRatingCap: 'PG-13',
        tvRatingCap: '',
        titles: [picked('tv', 'Show B'), picked('movie', 'Film A'), picked('tv', 'Show B')],
      })
    ).toEqual({ movieRatingCap: 'PG-13', tvRatingCap: null, titles: [picked('movie', 'Film A'), picked('tv', 'Show B')] })
  })

  it('an empty scope is a scope: its holders see nothing until titles are picked', () => {
    expect(parseScope({})).toEqual(EMPTY_SCOPE)
  })

  it.each([
    [{ movieRatingCap: 'TV-MA' }, 'movie rating cap'],
    [{ tvRatingCap: 'R' }, 'TV rating cap'],
    [{ titles: 'Film A' }, 'must be a list'],
    [{ titles: [{ mediaType: 'book', originalTitle: 'X', access: 'play' }] }, 'a movie or a show'],
    [{ titles: [{ mediaType: 'movie', originalTitle: '', access: 'play' }] }, 'library key'],
    [{ titles: [{ mediaType: 'movie', originalTitle: 'X', access: 'greyed' }] }, "access must be one of play"],
    [[], 'must be an object'],
  ])('refuses %j', (input, message) => {
    expect(() => parseScope(input)).toThrow(RoleInputError)
    expect(() => parseScope(input)).toThrow(message)
  })
})

describe('unionScopes', () => {
  it('takes the higher cap of each type and every picked title', () => {
    const kids = { movieRatingCap: 'PG', tvRatingCap: 'TV-Y7', titles: [picked('movie', 'Film A')] }
    const teens = { movieRatingCap: 'PG-13', tvRatingCap: null, titles: [picked('tv', 'Show B'), picked('movie', 'Film A')] }
    expect(unionScopes([kids, teens])).toEqual({
      movieRatingCap: 'PG-13',
      tvRatingCap: 'TV-Y7',
      titles: [picked('movie', 'Film A'), picked('tv', 'Show B')],
    })
  })

  it('is the same scope, and the same JSON, whatever order the roles come in', () => {
    const a = { movieRatingCap: 'G', tvRatingCap: null, titles: [picked('tv', 'Z'), picked('movie', 'A')] }
    const b = { movieRatingCap: null, tvRatingCap: 'TV-G', titles: [picked('movie', 'M')] }
    expect(canonicalScopeJson(unionScopes([a, b]))).toBe(canonicalScopeJson(unionScopes([b, a])))
  })
})

it('a cap holds its rating and every one under it, in MPAA and US TV order', () => {
  expect(ratingsUpTo('PG-13', MOVIE_RATINGS)).toEqual(['G', 'PG', 'PG-13'])
  expect(ratingsUpTo('TV-14', TV_RATINGS)).toEqual(['TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14'])
  expect(ratingsUpTo(null, MOVIE_RATINGS)).toEqual([])
})

describe('scopeRule and scopeMatcher', () => {
  const scope = { movieRatingCap: 'PG', tvRatingCap: 'TV-PG', titles: [picked('movie', 'Unrated Pick'), picked('tv', 'Picked Show')] }
  const rule = scopeRule(scope)
  const inScope = scopeMatcher(scoped(scope, [SHOW_A]))

  it('holds a movie under the cap, or picked; an unrated one only when picked', () => {
    expect(inScope.movie({ originalTitle: 'Kids Film', metadata: { rating: 'G' } })).toBe(true)
    expect(inScope.movie({ originalTitle: 'Teen Film', metadata: { rating: 'PG-13' } })).toBe(false)
    expect(inScope.movie({ originalTitle: 'Unrated', metadata: { rating: 'NR' } })).toBe(false)
    expect(inScope.movie({ originalTitle: 'No Rating', metadata: {} })).toBe(false)
    expect(inScope.movie({ originalTitle: 'Unrated Pick', metadata: { rating: 'NR' } })).toBe(true)
    // A pick is by library key and type: a show of the same name is not the movie
    expect(rule.show({ originalTitle: 'Unrated Pick', metadata: {} })).toBe(false)
  })

  it('the rule holds a show under the TV cap, or picked', () => {
    expect(rule.show({ originalTitle: 'Show', metadata: { rating: 'TV-G' } })).toBe(true)
    expect(rule.show({ originalTitle: 'Show', metadata: { rating: 'TV-MA' } })).toBe(false)
    expect(rule.show({ originalTitle: 'Picked Show', metadata: { rating: 'TV-MA' } })).toBe(true)
  })

  it('the matcher holds a show by the scope’s resolved show ids, and its seasons and episodes with it', () => {
    expect(inScope.show({ _id: new ObjectId(SHOW_A) })).toBe(true)
    expect(inScope.show({ _id: SHOW_B, metadata: { rating: 'TV-Y' } })).toBe(false)
    expect(inScope.ofShow({ showId: new ObjectId(SHOW_A) })).toBe(true)
    expect(inScope.ofShow({ showId: SHOW_B })).toBe(false)
    expect(inScope.ofShow({})).toBe(false)
  })

  it('the whole library holds everything', () => {
    const all = scopeMatcher(FULL_LIBRARY)
    expect(all.movie({ metadata: { rating: 'NC-17' } })).toBe(true)
    expect(all.ofShow({ showId: SHOW_B })).toBe(true)
    expect(all.movie(null)).toBe(false)
  })
})

it('a read without a LibraryAccess fails, it never widens to the whole library', () => {
  expect(() => assertLibraryAccess(undefined)).toThrow('needs the viewer’s LibraryAccess')
  expect(() => assertLibraryAccess({ id: 'x' })).toThrow('needs the viewer’s LibraryAccess')
  expect(() => assertLibraryAccess({ id: 'x', scope: EMPTY_SCOPE, showIds: null })).toThrow('needs its showIds')
  expect(() => libraryMovieFilter(undefined)).toThrow('needs the viewer’s LibraryAccess')
  expect(() => scopeMatcher(null)).toThrow('needs the viewer’s LibraryAccess')
})

describe('the Mongo fragments', () => {
  it('the whole library adds nothing: the queries keep exactly their old shape', () => {
    expect(libraryMovieFilter(FULL_LIBRARY)).toEqual(visibleMovieFilter())
    expect(libraryShowFilter(FULL_LIBRARY)).toEqual(visibleShowFilter())
    expect(libraryEpisodeFilter(FULL_LIBRARY)).toEqual(visibleEpisodeFilter())
    expect(scopeMovieFilter(FULL_LIBRARY)).toEqual({})
    expect(scopeShowFilter(FULL_LIBRARY)).toEqual({})
    expect(scopeEpisodeFilter(FULL_LIBRARY)).toEqual({})
  })

  it('a scope is bounded $in lists: the ratings under the cap and the picked keys for movies, the resolved ids for shows', () => {
    const access = scoped({ movieRatingCap: 'PG', tvRatingCap: null, titles: [picked('movie', 'A'), picked('tv', 'S')] }, [SHOW_A])
    expect(scopeMovieFilter(access)).toEqual({
      $and: [{ $or: [{ 'metadata.rating': { $in: ['G', 'PG'] } }, { originalTitle: { $in: ['A'] } }] }],
    })
    // Shows by _id (indexed), seasons and episodes by showId
    expect(scopeShowFilter(access)).toEqual({ $and: [{ _id: { $in: [new ObjectId(SHOW_A)] } }] })
    expect(scopeEpisodeFilter(access)).toEqual({ $and: [{ showId: { $in: [new ObjectId(SHOW_A)] } }] })
    expect(libraryMovieFilter(access)).toEqual({ $and: [visibleMovieFilter(), ...scopeMovieFilter(access).$and] })
    expect(Object.keys(libraryEpisodeFilter(access))).toEqual(['$and'])
  })

  it('every fragment is one $and key: spread beside a caller’s own _id or $or, it replaces neither', () => {
    const access = scoped(EMPTY_SCOPE, [SHOW_A])
    const query = { _id: new ObjectId(SHOW_B), $or: [{ a: 1 }], ...scopeShowFilter(access) }
    expect(query._id).toEqual(new ObjectId(SHOW_B))
    expect(query.$or).toEqual([{ a: 1 }])
    expect(query.$and).toEqual([{ _id: { $in: [new ObjectId(SHOW_A)] } }])
  })

  it('an empty scope matches nothing', () => {
    const access = scoped(EMPTY_SCOPE)
    expect(scopeMovieFilter(access)).toEqual({ $and: [{ $or: [{ 'metadata.rating': { $in: [] } }, { originalTitle: { $in: [] } }] }] })
    expect(scopeShowFilter(access)).toEqual({ $and: [{ _id: { $in: [] } }] })
    expect(scopeEpisodeFilter(access)).toEqual({ $and: [{ showId: { $in: [] } }] })
  })
})
