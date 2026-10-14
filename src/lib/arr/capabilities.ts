// src/lib/arr/capabilities.ts
// What a role can let a non-admin do with Radarr and Sonarr. Two
// capabilities: a request (send a title in chosen quality profiles, searched
// automatically, optionally picking releases by hand) and management (no
// limits, plus what only managers do). Admins hold both at full strength.
// No server-only import: the role editor reads these too.
import { RoleInputError, defineCapability } from '@src/lib/roles/capability'
import type { ArrService } from './types'

/** Quality profiles a grant allows on one service: every one, or these ids. [] is no access to that service. */
export type ProfileSet = 'all' | number[]

export interface ArrRequestSettings {
  radarr: ProfileSet
  sonarr: ProfileSet
  /** Pick a release by hand. Automatic search comes with every request grant. */
  manual: boolean
  /** Search and pick for any title the service has, not only the ones this user requested. */
  anyTitle: boolean
}

export const unionProfiles = (a: ProfileSet, b: ProfileSet): ProfileSet =>
  a === 'all' || b === 'all' ? 'all' : [...new Set([...a, ...b])].sort((x, y) => x - y)

function parseProfiles(value: unknown, service: string): ProfileSet {
  if (value === 'all') return 'all'
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || !value.every((id) => Number.isSafeInteger(id) && id > 0)) {
    throw new RoleInputError(`${service} quality profiles must be "all" or a list of profile ids.`)
  }
  return unionProfiles([], value as number[])
}

export const arrRequest = defineCapability<ArrRequestSettings>({
  key: 'arr.request',
  label: 'Request titles',
  description:
    'Send movies to Radarr and shows to Sonarr in the quality profiles chosen here; they are searched for automatically. Folder names, profile changes and rejected releases stay with managers.',
  empty: { radarr: [], sonarr: [], manual: false, anyTitle: false },
  full: { radarr: 'all', sonarr: 'all', manual: true, anyTitle: true },
  merge: (a, b) => ({
    radarr: unionProfiles(a.radarr, b.radarr),
    sonarr: unionProfiles(a.sonarr, b.sonarr),
    manual: a.manual || b.manual,
    anyTitle: a.anyTitle || b.anyTitle,
  }),
  parse(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new RoleInputError('Request settings are missing.')
    }
    const { radarr, sonarr, manual, anyTitle } = input as Record<string, unknown>
    return {
      radarr: parseProfiles(radarr, 'Radarr'),
      sonarr: parseProfiles(sonarr, 'Sonarr'),
      manual: manual === true,
      anyTitle: anyTitle === true,
    }
  },
})

export const arrManage = defineCapability<Record<string, never>>({
  key: 'arr.manage',
  label: 'Manage Radarr and Sonarr titles',
  description:
    'Everything a request allows, on any title and in any quality profile, plus choosing folders, changing a title’s quality profile and grabbing releases Radarr or Sonarr rejected.',
  empty: {},
  full: {},
  merge: () => ({}),
  parse: () => ({}),
})

/** Both grants, as the arr code reads them. */
export interface ArrPermissions {
  profiles: Record<ArrService, ProfileSet>
  manual: boolean
  anyTitle: boolean
  /** Folders, root folders, profile changes, rejected releases; and no profile or title limits. */
  manage: boolean
}

export const allowsService = (permissions: ArrPermissions, service: ArrService) => {
  const profiles = permissions.profiles[service]
  return profiles === 'all' || profiles.length > 0
}

export const allowsProfile = (permissions: ArrPermissions, service: ArrService, profileId: number) => {
  const profiles = permissions.profiles[service]
  return profiles === 'all' || profiles.includes(profileId)
}

/** Null when the grants allow nothing with either service. */
export function arrPermissionsFrom(request: ArrRequestSettings | null, manage: boolean): ArrPermissions | null {
  if (manage) return { profiles: { radarr: 'all', sonarr: 'all' }, manual: true, anyTitle: true, manage: true }
  if (!request) return null
  const permissions: ArrPermissions = {
    profiles: { radarr: request.radarr, sonarr: request.sonarr },
    manual: request.manual,
    anyTitle: request.anyTitle,
    manage: false,
  }
  return allowsService(permissions, 'radarr') || allowsService(permissions, 'sonarr') ? permissions : null
}
