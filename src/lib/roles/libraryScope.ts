// src/lib/roles/libraryScope.ts
// A library scope: the part of the library a role lets its holders see and
// play. It lives on the role (store.ts), never on a user. A user holding no
// scoped role sees the whole library; one holding several sees the union of
// their scopes; an admin always sees everything (libraryAccess.ts decides).
//
// A title is in a scope when it is rated at or under the scope's cap for its
// type, or hand-picked. Unrated titles (no US rating, 'NR', 'N/A') count only
// when hand-picked. Seasons and episodes follow their show.
//
// No server-only import: the role editor reads the same rules.
import { RoleInputError } from './capability'

/** US movie ratings, least to most restricted (MPAA order). */
export const MOVIE_RATINGS = ['G', 'PG', 'PG-13', 'R', 'NC-17'] as const
/** US TV ratings, least to most restricted. */
export const TV_RATINGS = ['TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'] as const

export type MovieRating = (typeof MOVIE_RATINGS)[number]
export type TvRating = (typeof TV_RATINGS)[number]
export type ScopeMediaType = 'movie' | 'tv'

/**
 * What a hand-picked title lets the holder do. v1 has one state; later ones
 * (shown greyed out, hidden) join this list, ranked from least to most, and
 * the stored shape doesn't change.
 */
export const TITLE_ACCESS = ['play'] as const
export type TitleAccess = (typeof TITLE_ACCESS)[number]

export interface ScopeTitle {
  mediaType: ScopeMediaType
  /** The library key (the folder name), never the display title. */
  originalTitle: string
  access: TitleAccess
}

export interface LibraryScope {
  /** Movies rated this or lower are in scope; null: no movie is, unless hand-picked. */
  movieRatingCap: MovieRating | null
  /** Shows rated this or lower are in scope; null: no show is, unless hand-picked. */
  tvRatingCap: TvRating | null
  /** Titles in scope whatever their rating. */
  titles: ScopeTitle[]
}

/** A scope with nothing in it: its holders see no title until an admin picks some. */
export const EMPTY_SCOPE: LibraryScope = Object.freeze({ movieRatingCap: null, tvRatingCap: null, titles: [] })

const MAX_TITLES = 2000
const MAX_TITLE_LENGTH = 500

function parseCap<R extends string>(value: unknown, ladder: readonly R[], label: string): R | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'string' && (ladder as readonly string[]).includes(value)) return value as R
  throw new RoleInputError(`${label} must be one of ${ladder.join(', ')}, or none.`)
}

const titleKey = (title: Pick<ScopeTitle, 'mediaType' | 'originalTitle'>) => `${title.mediaType}:${title.originalTitle}`

const accessRank = (access: TitleAccess) => TITLE_ACCESS.indexOf(access)

/** Sorted, one entry per title (the higher access wins), so equal scopes compare and hash alike. */
function normalizeTitles(titles: ScopeTitle[]): ScopeTitle[] {
  const byKey = new Map<string, ScopeTitle>()
  for (const title of titles) {
    const key = titleKey(title)
    const held = byKey.get(key)
    if (!held || accessRank(title.access) > accessRank(held.access)) byKey.set(key, title)
  }
  return [...byKey.values()].sort((a, b) =>
    a.mediaType === b.mediaType ? (a.originalTitle < b.originalTitle ? -1 : 1) : a.mediaType < b.mediaType ? -1 : 1
  )
}

/** A scope from an admin's form or a role document, checked. Throws RoleInputError. */
export function parseScope(input: unknown): LibraryScope {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RoleInputError('A library scope must be an object.')
  const raw = input as Record<string, unknown>
  const movieRatingCap = parseCap(raw.movieRatingCap, MOVIE_RATINGS, 'The movie rating cap')
  const tvRatingCap = parseCap(raw.tvRatingCap, TV_RATINGS, 'The TV rating cap')
  const titlesInput = raw.titles ?? []
  if (!Array.isArray(titlesInput)) throw new RoleInputError('Hand-picked titles must be a list.')
  if (titlesInput.length > MAX_TITLES) throw new RoleInputError(`Pick at most ${MAX_TITLES} titles.`)
  const titles = titlesInput.map((entry): ScopeTitle => {
    const { mediaType, originalTitle, access } = (entry ?? {}) as Record<string, unknown>
    if (mediaType !== 'movie' && mediaType !== 'tv') throw new RoleInputError('A hand-picked title must be a movie or a show.')
    if (typeof originalTitle !== 'string' || !originalTitle || originalTitle.length > MAX_TITLE_LENGTH) {
      throw new RoleInputError('A hand-picked title needs its library key.')
    }
    if (!(TITLE_ACCESS as readonly unknown[]).includes(access)) {
      throw new RoleInputError(`A hand-picked title's access must be one of ${TITLE_ACCESS.join(', ')}.`)
    }
    return { mediaType, originalTitle, access: access as TitleAccess }
  })
  return { movieRatingCap, tvRatingCap, titles: normalizeTitles(titles) }
}

function higherCap<R extends string>(a: R | null, b: R | null, ladder: readonly R[]): R | null {
  if (a === null) return b
  if (b === null) return a
  return ladder.indexOf(a) >= ladder.indexOf(b) ? a : b
}

/** Several scopes as one: the higher cap of each type, every hand-picked title. Never narrower than any of them. */
export function unionScopes(scopes: readonly LibraryScope[]): LibraryScope {
  let movieRatingCap: MovieRating | null = null
  let tvRatingCap: TvRating | null = null
  const titles: ScopeTitle[] = []
  for (const scope of scopes) {
    movieRatingCap = higherCap(movieRatingCap, scope.movieRatingCap, MOVIE_RATINGS)
    tvRatingCap = higherCap(tvRatingCap, scope.tvRatingCap, TV_RATINGS)
    titles.push(...scope.titles)
  }
  return { movieRatingCap, tvRatingCap, titles: normalizeTitles(titles) }
}

/** The ratings at or under a cap, as stored in metadata.rating. None for no cap. */
export function ratingsUpTo<R extends string>(cap: R | null, ladder: readonly R[]): R[] {
  return cap === null ? [] : ladder.slice(0, ladder.indexOf(cap) + 1)
}

/**
 * What one viewer may see of the library, as data: passed down from the page,
 * route or action that knows the viewer to every function that reads titles.
 * Across a 'use cache' boundary only its id goes, as the cache key (the scope
 * can hold thousands of picks and show ids); libraryAccessById(id) resolves it
 * again inside (libraryAccess.ts).
 * - id: 'all' for the whole library, else one id per effective scope, so
 *   viewers with the same scope share cache entries
 * - scope: null for the whole library
 * - showIds: the shows in scope (FlatTVShows _id strings, sorted), which their
 *   seasons and episodes follow; null for the whole library
 */
export interface LibraryAccess {
  id: string
  scope: LibraryScope | null
  showIds: string[] | null
}

/** The whole library: admins, and users who hold no scoped role. */
export const FULL_LIBRARY: LibraryAccess = Object.freeze({ id: 'all', scope: null, showIds: null }) as LibraryAccess

/** Throws unless `access` is a LibraryAccess: a read that lost its viewer fails, it never widens. */
export function assertLibraryAccess(access: unknown): asserts access is LibraryAccess {
  const value = access as LibraryAccess | null | undefined
  if (!value || typeof value.id !== 'string' || !('scope' in value) || !('showIds' in value)) {
    throw new Error('A library read needs the viewer’s LibraryAccess (src/lib/roles/libraryAccess.ts).')
  }
  if ((value.scope === null) !== (value.showIds === null)) throw new Error('A LibraryAccess with a scope needs its showIds.')
}

/** True for the whole library: nothing to filter. */
export function isFullLibrary(access: LibraryAccess): boolean {
  assertLibraryAccess(access)
  return access.scope === null
}

interface MediaDoc {
  _id?: unknown
  originalTitle?: unknown
  metadata?: { rating?: unknown } | null
}

interface EpisodeDoc {
  showId?: unknown
}

/**
 * A scope's rule, title by title: rated at or under the cap for its type, or
 * picked. Used where the titles are classified (libraryAccess.ts works out a
 * scope's shows with it) and for movies everywhere; a show is matched by the
 * resolved show ids instead (scopeMatcher), so queries and checks agree.
 */
export function scopeRule(scope: LibraryScope) {
  const movieRatings = new Set<string>(ratingsUpTo(scope.movieRatingCap, MOVIE_RATINGS))
  const tvRatings = new Set<string>(ratingsUpTo(scope.tvRatingCap, TV_RATINGS))
  const picked = new Set(scope.titles.map(titleKey))
  const matches = (doc: MediaDoc | null | undefined, mediaType: ScopeMediaType, ratings: Set<string>) => {
    if (!doc) return false
    const rating = doc.metadata?.rating
    if (typeof rating === 'string' && ratings.has(rating)) return true
    return typeof doc.originalTitle === 'string' && picked.has(titleKey({ mediaType, originalTitle: doc.originalTitle }))
  }
  return {
    movie: (doc: MediaDoc | null | undefined) => matches(doc, 'movie', movieRatings),
    show: (doc: MediaDoc | null | undefined) => matches(doc, 'tv', tvRatings),
  }
}

/** In-memory checks of fetched documents against an access, built once per access. */
export interface ScopeMatcher {
  movie(doc: MediaDoc | null | undefined): boolean
  /** A show: one of the access's resolved show ids (by _id). */
  show(doc: MediaDoc | null | undefined): boolean
  /** A season or an episode: in scope when its show is (by showId). */
  ofShow(doc: EpisodeDoc | null | undefined): boolean
  /** A show by its _id (string or ObjectId). */
  showId(id: unknown): boolean
}

const ALL: ScopeMatcher = { movie: (doc) => !!doc, show: (doc) => !!doc, ofShow: (doc) => !!doc, showId: () => true }

export function scopeMatcher(access: LibraryAccess): ScopeMatcher {
  if (isFullLibrary(access)) return ALL
  const rule = scopeRule(access.scope as LibraryScope)
  const shows = new Set(access.showIds)
  const hasShow = (id: unknown) => id != null && shows.has(String(id))
  return {
    movie: rule.movie,
    show: (doc) => !!doc && hasShow(doc._id),
    ofShow: (doc) => !!doc && hasShow(doc.showId),
    showId: hasShow,
  }
}

/** Same JSON for the same scope: stable key order, normalized titles. */
export function canonicalScopeJson(scope: LibraryScope): string {
  return JSON.stringify({
    movieRatingCap: scope.movieRatingCap,
    tvRatingCap: scope.tvRatingCap,
    titles: normalizeTitles(scope.titles).map(({ mediaType, originalTitle, access }) => [mediaType, originalTitle, access]),
  })
}
