// src/lib/arr/access.ts
// Who may use the arr routes at all: a user whose roles grant arr.request or
// arr.manage (src/lib/arr/capabilities.ts; admins hold both). Every arr route
// starts here; what each action then allows is rules.ts.
import 'server-only'
import { NextResponse } from 'next/server'
import { grantOf } from '@src/lib/roles/resolve'
import { currentPermissions } from '@src/lib/roles/session'
import { arrManage, arrPermissionsFrom, arrRequest } from './capabilities'
import type { ArrActor } from './rules'

export type { ArrActor }

/** The signed-in user as the arr routes see them, or the Response to send when they may not use them. */
export async function requireArrAccess(): Promise<ArrActor | Response> {
  const permissions = await currentPermissions()
  if (!permissions) {
    return NextResponse.json({ error: 'unauthorized', message: 'Sign in first.' }, { status: 401 })
  }
  const arr = arrPermissionsFrom(grantOf(permissions, arrRequest), grantOf(permissions, arrManage) !== null)
  if (!arr) {
    return NextResponse.json(
      { error: 'forbidden', message: 'Your account can’t send titles to Radarr or Sonarr.' },
      { status: 403 }
    )
  }
  return { userId: permissions.userId, userName: permissions.userName, permissions: arr }
}
