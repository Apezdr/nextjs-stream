import 'server-only'

import mongoClient from '@src/lib/mongodb'
import { createLogger } from '@src/lib/logger'
import {
  DEFAULT_ALLOWED_NETWORKS,
  evaluateLocalAccess,
} from '@src/utils/localAccess'
import { LocalAccessSettingsManager } from '@src/utils/admin_database'

const log = createLogger('Auth.LocalAccess')

const localAccessSettings = new LocalAccessSettingsManager()

/**
 * Local owner access, server side.
 *
 * `evaluateLocalAccess` decides whether the request is trustworthy; this module
 * decides who it becomes. The answer is always the server owner — the first
 * admin account — mirroring how Plex attributes unauthenticated local playback
 * to the account that owns the server.
 */

/**
 * The deployment must opt in before the admin toggle can do anything. Without
 * a proxy secret in the environment there is no trustworthy locality signal,
 * so a stock deployment cannot enable this by accident.
 */
function getAssertionSecret() {
  const secret = process.env.LOCAL_ACCESS_ASSERTION_SECRET
  return typeof secret === 'string' ? secret.trim() : ''
}

function getAllowedNetworks() {
  const configured = process.env.LOCAL_ACCESS_ALLOWED_NETWORKS
  if (typeof configured === 'string' && configured.trim()) return configured
  return DEFAULT_ALLOWED_NETWORKS
}

/** True when the environment is capable of local access at all. */
export function isLocalAccessConfigured() {
  return getAssertionSecret().length >= 32
}

/**
 * The owner is the earliest-created admin. Resolved fresh each time so a
 * demoted or deleted owner stops qualifying immediately.
 *
 * @returns {Promise<object|null>}
 */
export async function resolveServerOwner() {
  const client = await mongoClient
  const db = client.db(process.env.MONGODB_AUTH_DB || 'Users')
  const configuredEmail = process.env.LOCAL_ACCESS_OWNER_EMAIL?.trim()

  const query = configuredEmail
    ? { email: configuredEmail, role: 'admin' }
    : { role: 'admin' }

  return db
    .collection('user')
    .findOne(query, { sort: { createdAt: 1, _id: 1 } })
}

/**
 * Build the owner session for a request that qualified for local access, or
 * null. Shaped like Better Auth's `/get-session` response so callers cannot
 * tell the difference — except for `authSource`, which marks its provenance,
 * and the absent `session.token`: no real credential is minted, so a bypassed
 * request cannot be replayed anywhere else.
 *
 * @param {Headers} requestHeaders
 * @returns {Promise<{session: object, user: object}|null>}
 */
export async function getLocalOwnerSession(requestHeaders) {
  if (!isLocalAccessConfigured()) return null

  let enabled = false
  try {
    enabled = await localAccessSettings.getEnabled()
  } catch (error) {
    // A settings read failure must not open the door.
    log.error({ error }, 'Local access settings unreadable; denying')
    return null
  }

  const decision = evaluateLocalAccess({
    headers: requestHeaders,
    enabled,
    assertionSecret: getAssertionSecret(),
    allowedNetworks: getAllowedNetworks(),
  })
  if (!decision.allowed) return null

  // This path is an optional bypass; a failure here must deny, never take down
  // session resolution for everyone else.
  let owner
  try {
    owner = await resolveServerOwner()
  } catch (error) {
    log.error({ error }, 'Owner lookup failed; denying local access')
    return null
  }
  if (!owner) {
    log.warn('Local access allowed but no admin account exists; denying')
    return null
  }
  if (owner.approved === false || owner.banned === true) {
    log.warn({ ownerId: String(owner._id) }, 'Owner is not usable; denying local access')
    return null
  }

  log.info({ clientIp: decision.clientIp, ownerId: String(owner._id) }, 'Local owner access granted')

  return {
    session: {
      id: `local-access:${owner._id}`,
      userId: String(owner._id),
      // Deliberately no token: nothing here can be replayed as a credential.
      expiresAt: new Date(Date.now() + 60_000),
      authSource: 'local-access',
    },
    user: {
      ...owner,
      id: String(owner._id),
      authSource: 'local-access',
    },
  }
}
