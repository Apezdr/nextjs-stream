// src/lib/roles/resolve.ts
// What a user may do: the grants of every role they hold, merged per
// capability. Admins (the better-auth role, from ADMIN_USER_EMAILS) hold every
// capability at full strength and need no roles. An account waiting for
// approval holds nothing, whatever it has been given.
import 'server-only'
import type { Capability } from './capability'
import { CAPABILITIES } from './registry'
import { listRoles } from './store'

export interface RoleHolder {
  id: string
  name?: string | null
  email?: string | null
  role?: string | null
  approved?: boolean | null
  roles?: string[] | null
}

export interface Permissions {
  userId: string
  userName: string
  admin: boolean
  /** Capability key -> this user's merged settings. A key that is absent is not granted. */
  grants: Record<string, unknown>
}

export async function permissionsFor(user: RoleHolder): Promise<Permissions> {
  const identity = { userId: user.id, userName: user.name || user.email || 'User' }
  if (user.role === 'admin') {
    return {
      ...identity,
      admin: true,
      grants: Object.fromEntries(CAPABILITIES.map((capability) => [capability.key, capability.full])),
    }
  }
  const roleIds = user.approved === true && Array.isArray(user.roles) ? user.roles : []
  if (roleIds.length === 0) return { ...identity, admin: false, grants: {} }

  const held = (await listRoles()).filter((role) => roleIds.includes(role.id))
  const grants: Record<string, unknown> = {}
  for (const capability of CAPABILITIES) {
    for (const role of held) {
      if (!(capability.key in role.grants)) continue
      const settings = role.grants[capability.key]
      grants[capability.key] = capability.key in grants ? capability.merge(grants[capability.key], settings) : settings
    }
  }
  return { ...identity, admin: false, grants }
}

/** The user's settings for one capability, or null when they don't hold it. */
export function grantOf<S>(permissions: Permissions, capability: Capability<S>): S | null {
  return capability.key in permissions.grants ? (permissions.grants[capability.key] as S) : null
}
