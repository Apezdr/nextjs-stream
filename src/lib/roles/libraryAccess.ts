// src/lib/roles/libraryAccess.ts
// What part of the library a viewer may see (libraryScope.ts), resolved from
// the roles they hold. Pages, Route Handlers and Server Actions resolve it
// once, from the user they already checked, and hand it to the functions that
// read titles; those functions never read the session themselves. Reading it
// from the session is session.ts's.
import 'server-only'
import { createHash } from 'crypto'
import clientPromise from '@src/lib/mongodb'
import { showScopeFragment } from '@src/utils/mediaVisibility'
import { FULL_LIBRARY, canonicalScopeJson, unionScopes, type LibraryAccess, type LibraryScope } from './libraryScope'
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

// The shows a scope holds, by scope id, shared briefly like the roles
// (store.ts): every scoped request needs them for its seasons and episodes.
// A role edit that changes a scope changes its id, so only a show the sync
// brings into a scope waits, up to SHOWS_TTL_MS, to appear.
const SHOWS_TTL_MS = 30_000
const showsByScope = new Map<string, { at: number; showIds: Promise<string[]> }>()

async function readShowIds(scope: LibraryScope): Promise<string[]> {
  const shows = await (await clientPromise)
    .db('Media')
    .collection('FlatTVShows')
    .find(showScopeFragment(scope), { projection: { _id: 1 } })
    .toArray()
  return shows.map((show) => show._id.toString()).sort()
}

function showIdsFor(id: string, scope: LibraryScope): Promise<string[]> {
  const held = showsByScope.get(id)
  if (held && Date.now() - held.at < SHOWS_TTL_MS) return held.showIds
  for (const [key, entry] of showsByScope) if (Date.now() - entry.at >= SHOWS_TTL_MS) showsByScope.delete(key)
  const showIds = readShowIds(scope)
  showsByScope.set(id, { at: Date.now(), showIds })
  showIds.catch(() => showsByScope.delete(id))
  return showIds
}

// A held role id this process's role list lacks (a role made by another
// process, or by the startup migration after the list was read) could carry a
// scope, so the list is read again rather than letting its holder see the
// whole library until the copy expires. At most this often, so a dangling id
// can't turn every request into a read.
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
  const scopes = roles.filter((role) => roleIds.includes(role.id) && role.scope).map((role) => role.scope as LibraryScope)
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
 *
 * No database read on the way: the role ids come with the session user, the
 * roles from store.ts's process copy, the show list from showIdsFor's. An
 * admin or a user with no roles costs nothing at all.
 */
export async function libraryAccessFor(user: ScopeHolder): Promise<LibraryAccess> {
  if (!user) throw new Error('libraryAccessFor needs a user.')
  if (isAdminUser(user)) return FULL_LIBRARY
  const roleIds = Array.isArray(user.roles) ? user.roles : []
  if (roleIds.length === 0) return FULL_LIBRARY
  let roles = await listRoles()
  if (!roleIds.every((id) => roles.some((role) => role.id === id)) && Date.now() - lastReread >= STALE_ROLE_REREAD_MS) {
    lastReread = Date.now()
    forgetRoles()
    roles = await listRoles()
  }
  const effective = effectiveScope(roles, roleIds)
  if (!effective) return FULL_LIBRARY
  return { id: effective.id, scope: effective.scope, showIds: await showIdsFor(effective.id, effective.scope) }
}
