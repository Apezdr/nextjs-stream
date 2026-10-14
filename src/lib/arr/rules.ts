// src/lib/arr/rules.ts
// What a user's roles let them do with one action: the arr.request and
// arr.manage capabilities (capabilities.ts), applied by titles.ts and picks.ts.
// No session here: the routes resolve the actor (access.ts) and pass it in.
import 'server-only'
import { allowsProfile, allowsService, type ArrPermissions } from './capabilities'
import { SERVICE_NAMES, forbidden } from './errors'
import { requestedBy } from './requestLog'
import type { ArrService, TitleRef } from './types'

export interface ArrActor {
  userId: string
  userName: string
  permissions: ArrPermissions
}

export function requireService(actor: ArrActor, service: ArrService) {
  if (!allowsService(actor.permissions, service)) throw forbidden(`Your role doesn’t include ${SERVICE_NAMES[service]}.`)
}

export function requireManage(actor: ArrActor, action: string) {
  if (!actor.permissions.manage) throw forbidden(`${action} is for managers.`)
}

/**
 * Whether the user may search or pick releases for a title the service has.
 * A manager may for any. A requester may for the titles they requested, or,
 * with "any title", for one whose quality profile their role allows: a search
 * grabs in the title's profile, so that is the quality they'd be choosing.
 */
export async function canActOn(
  actor: ArrActor,
  ref: TitleRef,
  service: ArrService,
  qualityProfileId: number
): Promise<boolean> {
  if (actor.permissions.manage) return true
  if (!allowsService(actor.permissions, service)) return false
  if (await requestedBy(actor.userId, ref)) return true
  return actor.permissions.anyTitle && allowsProfile(actor.permissions, service, qualityProfileId)
}

export async function requireActOn(actor: ArrActor, ref: TitleRef, service: ArrService, qualityProfileId: number) {
  if (await canActOn(actor, ref, service, qualityProfileId)) return
  throw forbidden(
    actor.permissions.anyTitle
      ? 'This title’s quality profile isn’t one your role allows.'
      : 'You can search only for titles you requested.'
  )
}
