// src/lib/roles/session.ts
// The signed-in user's permissions, for routes and server components.
import 'server-only'
import { getSession } from '@src/lib/cachedAuth'
import { permissionsFor, type Permissions } from './resolve'

/** Null when nobody is signed in. */
export async function currentPermissions(): Promise<Permissions | null> {
  const session = await getSession()
  return session?.user ? permissionsFor(session.user) : null
}
