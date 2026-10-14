// src/lib/roles/store.ts
// Roles: named sets of capability grants, made by admins and given to users
// (the user's `roles` field, written only by the server). Grants are checked
// by each capability's own parse(), on the way in and on the way out.
import 'server-only'
import { ObjectId } from 'mongodb'
import clientPromise from '@src/lib/mongodb'
import { userQueries } from '@src/lib/userQueries'
import { RoleInputError } from './capability'
import { capabilityByKey } from './registry'

export interface Role {
  id: string
  name: string
  description: string
  /** Capability key -> its settings. */
  grants: Record<string, unknown>
}

export interface RoleInput {
  id?: string | null
  name: unknown
  description?: unknown
  grants: unknown
}

const MAX_NAME = 60
const MAX_DESCRIPTION = 200

const rolesCollection = async () => (await clientPromise).db('Media').collection('Roles')

let indexEnsured = false
async function ensureIndex(collection: Awaited<ReturnType<typeof rolesCollection>>) {
  if (indexEnsured) return
  await collection.createIndex(
    { name: 1 },
    { unique: true, name: 'unique_role_name', collation: { locale: 'en', strength: 2 } }
  )
  indexEnsured = true
}

/** Grants from a form or the database, each checked by its capability. */
export function parseGrants(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new RoleInputError('Grants must be an object.')
  const grants: Record<string, unknown> = {}
  for (const [key, settings] of Object.entries(input)) {
    const capability = capabilityByKey.get(key)
    if (!capability) throw new RoleInputError(`There is no capability called "${key}".`)
    grants[key] = capability.parse(settings)
  }
  return grants
}

function toRole(document: Record<string, any>): Role {
  // A grant for a capability that no longer exists, or that no longer parses,
  // grants nothing, rather than failing every permission check.
  const grants: Record<string, unknown> = {}
  for (const [key, settings] of Object.entries(document.grants ?? {})) {
    const capability = capabilityByKey.get(key)
    if (!capability) continue
    try {
      grants[key] = capability.parse(settings)
    } catch {
      // skipped
    }
  }
  return {
    id: document._id.toString(),
    name: typeof document.name === 'string' ? document.name : '',
    description: typeof document.description === 'string' ? document.description : '',
    grants,
  }
}

// Every permission check reads the roles, so they are shared briefly. A save
// or delete in this process drops the copy at once.
const ROLES_TTL_MS = 30_000
let cached: { at: number; roles: Role[] } | null = null

export function forgetRoles() {
  cached = null
}

export async function listRoles(): Promise<Role[]> {
  if (cached && Date.now() - cached.at < ROLES_TTL_MS) return cached.roles
  const collection = await rolesCollection()
  const documents = await collection.find({}).sort({ name: 1 }).collation({ locale: 'en', strength: 2 }).toArray()
  const roles = documents.map(toRole)
  cached = { at: Date.now(), roles }
  return roles
}

function parseRoleId(id: unknown): ObjectId {
  if (typeof id !== 'string' || !ObjectId.isValid(id)) throw new RoleInputError('That isn’t a role id.')
  return new ObjectId(id)
}

export async function saveRole(input: RoleInput): Promise<Role> {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name || name.length > MAX_NAME) throw new RoleInputError(`Give the role a name of up to ${MAX_NAME} characters.`)
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description.length > MAX_DESCRIPTION) {
    throw new RoleInputError(`Keep the description under ${MAX_DESCRIPTION} characters.`)
  }
  const grants = parseGrants(input.grants)
  if (Object.keys(grants).length === 0) throw new RoleInputError('Give the role at least one capability.')

  const collection = await rolesCollection()
  await ensureIndex(collection)
  const now = new Date()
  try {
    if (input.id) {
      const _id = parseRoleId(input.id)
      const result = await collection.updateOne({ _id }, { $set: { name, description, grants, updatedAt: now } })
      if (result.matchedCount === 0) throw new RoleInputError('That role no longer exists.')
      forgetRoles()
      return { id: _id.toString(), name, description, grants }
    }
    const result = await collection.insertOne({ name, description, grants, createdAt: now, updatedAt: now })
    forgetRoles()
    return { id: result.insertedId.toString(), name, description, grants }
  } catch (error) {
    if ((error as { code?: number })?.code === 11000) throw new RoleInputError('A role with that name already exists.')
    throw error
  }
}

/** How many users hold each role, by role id. */
export async function holdersByRole(): Promise<Record<string, number>> {
  const users = await userQueries.find({ roles: { $exists: true, $ne: [] } }, { roles: 1 })
  const counts: Record<string, number> = {}
  for (const user of users) {
    for (const id of Array.isArray(user.roles) ? user.roles : []) counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

/** Refuses while anyone holds the role: taking it off them is a deliberate step. */
export async function deleteRole(id: string): Promise<void> {
  const _id = parseRoleId(id)
  const holders = (await holdersByRole())[_id.toString()] ?? 0
  if (holders > 0) {
    throw new RoleInputError(`${holders} user${holders === 1 ? ' holds' : 's hold'} this role. Take it off them first.`)
  }
  await (await rolesCollection()).deleteOne({ _id })
  forgetRoles()
}

/** Replaces a user's roles. Every id must be an existing role. */
export async function setUserRoles(userId: string, roleIds: unknown): Promise<string[]> {
  if (!Array.isArray(roleIds) || !roleIds.every((id) => typeof id === 'string')) {
    throw new RoleInputError('Roles must be a list of role ids.')
  }
  const known = new Set((await listRoles()).map((role) => role.id))
  const ids = [...new Set(roleIds as string[])]
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length > 0) throw new RoleInputError('One of those roles no longer exists.')
  const result = await userQueries.updateById(userId, { roles: ids })
  if (result.matchedCount === 0) throw new RoleInputError('That user no longer exists.')
  return ids
}
