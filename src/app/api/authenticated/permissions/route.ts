// src/app/api/authenticated/permissions/route.ts
// The signed-in user's capabilities (src/lib/roles), so the browser can offer
// only what they may do. Every action is checked again on the server.
//
//   GET   { admin, grants: { [capabilityKey]: settings } }
import { NextResponse } from 'next/server'
import { currentPermissions } from '@src/lib/roles/session'

export async function GET() {
  const permissions = await currentPermissions()
  if (!permissions) return NextResponse.json({ error: 'unauthorized', message: 'Sign in first.' }, { status: 401 })
  return NextResponse.json({ admin: permissions.admin, grants: permissions.grants })
}
