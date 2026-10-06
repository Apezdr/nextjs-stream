/**
 * `initialDiscoveryDate` — when a piece of content first entered THIS library.
 *
 * It exists because nothing else answers that question. `mediaLastModified` is
 * the video file's mtime, and it lies in both directions: a quality upgrade
 * (Radarr/Sonarr replacing the file, Tdarr re-encoding it) bumps it on content
 * that has been here for months, while a download that preserves its original
 * mtime arrives already "years old". A prod audit of the top 100 movies by
 * mtime found only 25 within a day of their real add date. "Recently Added"
 * therefore ranks on this field, with mtime as the tiebreak only.
 *
 * One rule, shared by every entity type, so movies and TV cannot drift apart:
 *
 *  1. SEEDED ONCE. A new document is dated `now`. An existing document that
 *     predates the field is healed from its `createdAt`.
 *  2. NEVER LATER. Nothing may move the date forward. A replaced file, a
 *     re-synced title, an admin edit — none of them are an arrival.
 *  3. EARLIER WINS. The only permitted rewrite is a backend-published
 *     `mediaIdentity.firstSeen` that PREDATES what we hold. That date lives in
 *     the identity sidecar on the media volume, so it survives the one thing
 *     this database cannot: a document being deleted and re-created (the
 *     orphan add/delete cycle, a rebuild). Earlier-wins, not replace, because
 *     sidecars written at the identity rollout carry the rollout date for
 *     titles that were already here.
 */

/** `initialDiscoveryServer` values that are not server ids. */
export const DISCOVERY_SOURCE_BACKFILL = 'backfill'
export const DISCOVERY_SOURCE_MANUAL = 'manual'

/**
 * A `firstSeen` further ahead than this is a broken clock on the file server,
 * not an arrival date. It is ignored rather than clamped: a guessed date is
 * worse than none, and the seeded value still stands.
 */
const MAX_FUTURE_SKEW_MS = 24 * 60 * 60 * 1000

export interface DiscoveryFields {
  createdAt?: Date
  initialDiscoveryDate?: Date
  initialDiscoveryServer?: string
}

function toValidDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value as string | number)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Read the backend's first-seen date out of a payload's `mediaIdentity`.
 *
 * Returns null for a payload that does not carry one (an older backend, or a
 * folder whose sidecar could not be written — the backend publishes null there
 * rather than a per-scan timestamp). Null means "no claim", never "now".
 */
export function resolveFirstSeen(mediaIdentity: unknown, now: Date = new Date()): Date | null {
  const raw = (mediaIdentity as { firstSeen?: unknown } | null | undefined)?.firstSeen
  if (typeof raw !== 'string') return null
  const date = toValidDate(raw)
  if (!date) return null
  if (date.getTime() > now.getTime() + MAX_FUTURE_SKEW_MS) return null
  return date
}

/**
 * Rules 1 and 2. Mutates `entity`; returns the names of the fields it set so
 * the caller can log a heal. An entity that already carries a date is left
 * exactly as it is.
 */
export function seedDiscovery<T extends DiscoveryFields>(
  entity: T,
  existing: T | null,
  serverId: string,
  now: Date
): string[] {
  if (toValidDate(entity.initialDiscoveryDate)) {
    if (entity.initialDiscoveryServer) return []
    entity.initialDiscoveryServer = serverId
    return ['initialDiscoveryServer']
  }

  // New document: it arrived now. Existing document that predates the field:
  // its creation is the best record we have of when it arrived.
  entity.initialDiscoveryDate = (existing ? toValidDate(existing.createdAt) : null) ?? now
  entity.initialDiscoveryServer = serverId
  return ['initialDiscoveryDate', 'initialDiscoveryServer']
}

/**
 * Rule 3 as a pure decision: the date to write, or null when `incoming` makes
 * no claim or does not predate `current`.
 */
export function pickEarlierDiscovery(current: unknown, incoming: Date | null): Date | null {
  if (!incoming) return null
  const held = toValidDate(current)
  if (held && held.getTime() <= incoming.getTime()) return null
  return incoming
}

/**
 * Rule 3 with several file servers. Each server that has the content is heard
 * in turn, and the result must not depend on the order:
 *
 *  - an EARLIER date is adopted, with the server that holds it ('date');
 *  - the SAME date from a server that outranks the one on record moves only
 *    the server ('server'), so two servers holding the same date always end
 *    on the higher-priority one rather than on whichever synced first.
 *
 * Returns null when `incoming` makes no claim or changes nothing.
 *
 * @param outranksHeld whether the syncing server outranks the server on record
 */
export function claimDiscovery(
  current: unknown,
  heldServer: string | undefined,
  incoming: Date | null,
  serverId: string,
  outranksHeld: (heldServerId: string) => boolean
): 'date' | 'server' | null {
  if (!incoming) return null
  const held = toValidDate(current)
  if (!held || held.getTime() > incoming.getTime()) return 'date'
  if (held.getTime() === incoming.getTime() && heldServer && heldServer !== serverId && outranksHeld(heldServer)) {
    return 'server'
  }
  return null
}

/**
 * Rule 3 applied to an entity that is built by mutation (the TV services).
 * Returns whether the date or its server moved.
 */
export function applyFirstSeen<T extends DiscoveryFields>(
  entity: T,
  mediaIdentity: unknown,
  serverId: string,
  now: Date = new Date(),
  outranksHeld: (heldServerId: string) => boolean = () => false
): boolean {
  const incoming = resolveFirstSeen(mediaIdentity, now)
  const claim = claimDiscovery(entity.initialDiscoveryDate, entity.initialDiscoveryServer, incoming, serverId, outranksHeld)
  if (!claim) return false
  if (claim === 'date') entity.initialDiscoveryDate = incoming!
  entity.initialDiscoveryServer = serverId
  return true
}
