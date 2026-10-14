// src/lib/arr/access.ts
// Who may send titles to Radarr/Sonarr. Admins only for now. A requester role,
// with an optional per-user quota, is planned: it plugs in here, and every arr
// route already asks this rather than checking for an admin itself.
import 'server-only'
import { isAdmin } from '@src/utils/routeAuth'

/** The signed-in user, or the Response to send when they may not use the arr routes. */
export function requireArrAccess() {
  return isAdmin()
}
