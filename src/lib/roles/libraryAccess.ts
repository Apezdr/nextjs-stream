// src/lib/roles/libraryAccess.ts
// What part of the library a viewer may see (libraryScope.ts), resolved from
// the roles they hold. Pages, Route Handlers and Server Actions resolve it
// once, from the user they already checked, and hand it to the functions that
// read titles; those functions never read the session themselves. Reading it
// from the session is session.ts's.
//
// Cost: an admin or a user with no scoped role costs nothing (no read). A
// scoped request reads nothing either: the role ids come with the session
// user, the roles from store.ts's process copy, and what a scope holds from
// a per-scope index built in memory from one catalog of the library's titles,
// read at most every CATALOG_TTL_MS per process while scoped users are about.
import 'server-only'
import { createHash } from 'crypto'
import clientPromise from '@src/lib/mongodb'
import {
  EMPTY_SCOPE,
  FULL_LIBRARY,
  assertLibraryAccess,
  canonicalScopeJson,
  scopeRule,
  unionScopes,
  type LibraryAccess,
  type LibraryScope,
} from './libraryScope'
import { forgetRoles, listRoles } from './store'
import { isAdminUser } from './rules'

/** The fields of a user their library access depends on. */
export interface ScopeHolder {
  role?: string | null
  roles?: string[] | null
}

/** One id per effective scope: users with the same scope share every cache entry keyed on it. */
export function scopeIdOf(scope: LibraryScope): string {
  return `scope-${createHash('sha256').update(canonicalScopeJson(scope)).digest('hex').slice(0, 20)}`
}

// ---------------------------------------------------------------------------
// The catalog: every movie and show by id, library key, TMDB id and rating,
// which every scope's index is worked out from. Shared by all scopes. A show
// the sync adds waits up to CATALOG_TTL_MS to enter a scope (fail closed for
// the scope's lists; a watchlist item it matches stays as it was meanwhile).

interface CatalogTitle {
  id: string
  originalTitle: string | null
  tmdbId: number | null
  rating: string | null
}
interface Catalog {
  movies: CatalogTitle[]
  shows: CatalogTitle[]
}

const CATALOG_TTL_MS = 30_000
let catalog: { at: number; value: Promise<Catalog> } | null = null

async function readCatalog(): Promise<Catalog> {
  const db = (await clientPromise).db('Media')
  // library-scope: the catalog every scope is classified from, by scopeRule
  const projection = { projection: { _id: 1, originalTitle: 1, 'metadata.id': 1, 'metadata.rating': 1 } }
  const [movies, shows] = await Promise.all([
    db.collection('FlatMovies').find({}, projection).toArray(),
    db.collection('FlatTVShows').find({}, projection).toArray(),
  ])
  const shape = (doc: Record<string, any>): CatalogTitle => ({
    id: String(doc._id),
    originalTitle: typeof doc.originalTitle === 'string' ? doc.originalTitle : null,
    tmdbId: Number.isFinite(doc.metadata?.id) ? doc.metadata.id : null,
    rating: typeof doc.metadata?.rating === 'string' ? doc.metadata.rating : null,
  })
  return { movies: movies.map(shape), shows: shows.map(shape) }
}

function libraryCatalog(): Promise<Catalog> {
  if (catalog && Date.now() - catalog.at < CATALOG_TTL_MS) return catalog.value
  const value = readCatalog()
  catalog = { at: Date.now(), value }
  value.catch(() => {
    if (catalog?.value === value) catalog = null
  })
  return value
}

// ---------------------------------------------------------------------------
// A scope's index: what it holds, worked out in memory from the catalog, once
// per scope and catalog.

export interface ScopeIndex {
  /** The shows in scope (FlatTVShows _id strings), sorted: what seasons and episodes follow. */
  showIds: string[]
  /** The library keys (originalTitle) of the movies and shows in scope. */
  movieKeys: Set<string>
  showKeys: Set<string>
  /** TMDB ids of library titles none of whose documents is in scope, by type. */
  hiddenTmdbIds: { movie: number[]; tv: number[] }
}

const indexByScope = new Map<string, { catalog: Catalog; index: ScopeIndex }>()

function buildIndex(scope: LibraryScope, { movies, shows }: Catalog): ScopeIndex {
  const rule = scopeRule(scope)
  const asDoc = (title: CatalogTitle) => ({ originalTitle: title.originalTitle, metadata: { rating: title.rating } })
  const classify = (titles: CatalogTitle[], inScope: (doc: ReturnType<typeof asDoc>) => boolean) => {
    const held: CatalogTitle[] = []
    const left: CatalogTitle[] = []
    for (const title of titles) (inScope(asDoc(title)) ? held : left).push(title)
    // A TMDB id with any document in scope stays: it is the viewer's
    const heldIds = new Set(held.map((title) => title.tmdbId))
    const hidden = [...new Set(left.map((title) => title.tmdbId).filter((id) => id !== null && !heldIds.has(id)))]
    return { held, hidden: hidden as number[] }
  }
  const movieSide = classify(movies, rule.movie)
  const showSide = classify(shows, rule.show)
  const keys = (titles: CatalogTitle[]) => new Set(titles.map((title) => title.originalTitle).filter((key): key is string => !!key))
  return {
    showIds: showSide.held.map((title) => title.id).sort(),
    movieKeys: keys(movieSide.held),
    showKeys: keys(showSide.held),
    hiddenTmdbIds: { movie: movieSide.hidden, tv: showSide.hidden },
  }
}

async function scopeIndexFor(id: string, scope: LibraryScope): Promise<ScopeIndex> {
  const current = await libraryCatalog()
  const held = indexByScope.get(id)
  if (held && held.catalog === current) return held.index
  for (const [key, entry] of indexByScope) if (entry.catalog !== current) indexByScope.delete(key)
  const index = buildIndex(scope, current)
  indexByScope.set(id, { catalog: current, index })
  return index
}

/**
 * What a viewer's scope holds, for the checks done in memory (notices,
 * watchlists). Null for the whole library, which holds everything.
 */
export async function libraryScopeIndex(access: LibraryAccess): Promise<ScopeIndex | null> {
  assertLibraryAccess(access)
  if (access.scope === null) return null
  return scopeIndexFor(access.id, access.scope)
}

// ---------------------------------------------------------------------------
// Scopes by id, for the 'use cache' functions, which are handed the id alone
// (their cache key) and resolve the access again inside: the scope behind an
// id never changes, since the id is its hash. Bounded; one this process never
// resolved (or long forgot) is refused, never read as the whole library.

const MAX_REMEMBERED_SCOPES = 256
const scopeById = new Map<string, LibraryScope>()

function remember(id: string, scope: LibraryScope) {
  scopeById.delete(id)
  scopeById.set(id, scope)
  if (scopeById.size > MAX_REMEMBERED_SCOPES) scopeById.delete(scopeById.keys().next().value as string)
}

/**
 * The access behind a scope id: what a 'use cache' function resolves its
 * scope-id argument with. A new object each call. Throws for an id this
 * process doesn't know: a cached read can't widen to the whole library.
 */
export async function libraryAccessById(id: string): Promise<LibraryAccess> {
  if (id === FULL_LIBRARY.id) return FULL_LIBRARY
  const scope = typeof id === 'string' ? scopeById.get(id) : undefined
  if (!scope) throw new Error(`Library scope ${String(id)} is not known here: resolve the viewer first (libraryAccessFor).`)
  return { id, scope, showIds: (await scopeIndexFor(id, scope)).showIds }
}

// ---------------------------------------------------------------------------
// From a user's roles.

// A held role id this process's role list lacks (a role made by another
// process, or by the startup migration after the list was read) could carry a
// scope, so the list is read again, at most this often. One still unknown
// after that counts as an empty scope: its holder sees what their other
// scoped roles allow, or nothing, never the whole library.
const STALE_ROLE_REREAD_MS = 5_000
let lastReread = 0

// The effective scope of each set of held role ids, for the role list it was
// computed from: a request resolves its scope from the cached roles without
// re-merging or re-hashing. A new role list (TTL, or a role edit) starts over.
const scopeByRoleList = new WeakMap<object, Map<string, { id: string; scope: LibraryScope } | null>>()

function effectiveScope(roles: Awaited<ReturnType<typeof listRoles>>, roleIds: string[]) {
  let byRoleIds = scopeByRoleList.get(roles)
  if (!byRoleIds) {
    byRoleIds = new Map()
    scopeByRoleList.set(roles, byRoleIds)
  }
  const key = [...roleIds].sort().join(',')
  if (byRoleIds.has(key)) return byRoleIds.get(key) ?? null
  const known = new Map(roles.map((role) => [role.id, role]))
  const scopes = roleIds.flatMap((id) => {
    const role = known.get(id)
    if (!role) return [EMPTY_SCOPE]
    return role.scope ? [role.scope] : []
  })
  let result: { id: string; scope: LibraryScope } | null = null
  if (scopes.length > 0) {
    const scope = unionScopes(scopes)
    result = { id: scopeIdOf(scope), scope }
  }
  byRoleIds.set(key, result)
  return result
}

/**
 * A user's library access: the whole library for an admin or a user holding
 * no scoped role; otherwise the union of the scopes on their roles. Roles
 * apply whether or not the account is approved yet: a scope only ever takes
 * titles away.
 */
export async function libraryAccessFor(user: ScopeHolder): Promise<LibraryAccess> {
  if (!user) throw new Error('libraryAccessFor needs a user.')
  if (isAdminUser(user)) return FULL_LIBRARY
  // A single id stored as a string (the server writes arrays) still counts
  const held: unknown = user.roles
  const roleIds = (Array.isArray(held) ? held : typeof held === 'string' ? [held] : []).filter(
    (id): id is string => typeof id === 'string' && id.length > 0
  )
  if (roleIds.length === 0) return FULL_LIBRARY
  let roles = await listRoles()
  if (!roleIds.every((id) => roles.some((role) => role.id === id)) && Date.now() - lastReread >= STALE_ROLE_REREAD_MS) {
    lastReread = Date.now()
    forgetRoles()
    roles = await listRoles()
  }
  const effective = effectiveScope(roles, roleIds)
  if (!effective) return FULL_LIBRARY
  remember(effective.id, effective.scope)
  return { id: effective.id, scope: effective.scope, showIds: (await scopeIndexFor(effective.id, effective.scope)).showIds }
}
