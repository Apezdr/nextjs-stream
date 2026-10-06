/**
 * The skip gate, shared by movies, shows and episodes.
 *
 * A server's pass over a title may be skipped only when nothing that decides
 * what the pass would write has changed since that server's last COMPLETE pass:
 *
 *   1. the server's own data for the title — a fingerprint of the payload that
 *      was actually applied (`payloadFingerprint` in sync/utils);
 *   2. which servers have which fields for the title — the availability
 *      fingerprint (`availabilityFingerprint` in sync/utils). Ownership follows
 *      from it, and it moves when ANOTHER server gains or loses a field while
 *      this server's payload stays byte for byte the same;
 *   3. the document itself — if another server's pass changed it in between,
 *      this server's last pass was against a document that no longer exists.
 *
 * The documents used to carry one `syncHash`: the hash the file server
 * publishes for the title, stamped by whichever server wrote last and compared
 * against whichever server came next. That answers none of the three for two
 * servers: a server whose own payload was unchanged was skipped at the very
 * moment it had become the owner of a field (the server that had the video
 * deleted its file), and the title kept a dead link until the second server's
 * own data happened to change.
 *
 * The file server's hash is not part of the gate at all. It is fetched
 * separately from the payload — for episodes, minutes later — so a scan landing
 * in between left a NEW hash stamped on documents built from the OLD payload,
 * and the title skipped from then on. It can also be unavailable (a failed
 * request; a season folder the hash endpoint cannot resolve), which left such
 * titles with no gate. The payload is what is applied, it is always there, and
 * it carries everything the hash is computed from; a field a file server
 * publishes but leaves out of its hash is covered too.
 *
 * The gate is stored per server, in
 * `syncGates: { <serverId>: "g<version>:<payload>#<availability>" }`.
 * (1) and (2) are the stored value. (3) is how it is written: a pass that
 * changes the document keeps only its own entry.
 *
 * A gate is stamped only when the pass ran to the end with nothing failed and
 * nothing deferred, including a pass that found nothing to change — otherwise
 * that pass would be repeated in full on every run. "Deferred" covers a removal
 * the pass held back because not every server answered this run: the pass must
 * run again when they all do.
 *
 * SYNC_GATE_VERSION is part of the value. Raise it when the rules for what a
 * pass writes change, so already-gated documents are reprocessed once instead
 * of keeping what the old rules left.
 */

import isEqual from 'lodash/isEqual'

/** Fields that record the sync itself, not the title. */
export const GATE_BOOKKEEPING_FIELDS: ReadonlySet<string> = new Set([
  'syncGates',
  'syncHash',
  'contentHash',
  'lastSynced',
  'updatedAt',
  'syncRunId',
])

export const SYNC_GATE_VERSION = 1

/**
 * The value a server's gate must hold for its pass to be skipped.
 *
 * @param payload - Fingerprint of the payload being applied (payloadFingerprint)
 * @param availability - Who-has-what fingerprint (availabilityFingerprint)
 */
export function buildSyncGate(payload: string, availability: string): string {
  return `g${SYNC_GATE_VERSION}:${payload}#${availability}`
}

/** A server's stored gate, or undefined when it has none. */
export function readSyncGate(
  entity: Record<string, any> | null | undefined,
  serverId: string
): string | undefined {
  const gates = entity?.syncGates
  if (!gates || typeof gates !== 'object') return undefined
  const gate = gates[serverId]
  return typeof gate === 'string' && gate ? gate : undefined
}

function isTopLevelFieldLocked(lockedFields: any, key: string): boolean {
  if (!lockedFields || typeof lockedFields !== 'object') return false
  const lock = lockedFields[key]
  return lock === true || (lock !== null && typeof lock === 'object')
}

/**
 * Whether writing `next` over `existing` changes the title's data.
 *
 * Mirrors what the repositories actually write: bookkeeping fields do not
 * count, a field an admin locked is dropped before the write and so does not
 * count either, and a field to remove counts only if the document has it.
 *
 * @param existing - The stored document, or null for a new one
 * @param next - The document the pass wants stored (may be a partial set of fields)
 * @param unset - Fields the pass wants removed
 */
export function changesDocument(
  existing: Record<string, any> | null | undefined,
  next: Record<string, any>,
  unset: readonly string[] = []
): boolean {
  if (!existing) return true
  const lockedFields = existing.lockedFields

  for (const field of unset) {
    if (isTopLevelFieldLocked(lockedFields, field)) continue
    if (existing[field] !== undefined) return true
  }
  for (const field of Object.keys(next)) {
    if (field === '_id' || field === 'createdAt') continue
    if (GATE_BOOKKEEPING_FIELDS.has(field)) continue
    if (isTopLevelFieldLocked(lockedFields, field)) continue
    if (!isEqual(existing[field], next[field])) return true
  }
  return false
}

/**
 * The `syncGates` map to store after a pass.
 *
 * @param storedGates - The document's current map
 * @param serverId - The server that just passed
 * @param gate - Its gate, or null when the pass must be retried (something
 *   failed or was deferred) and so may not be stamped
 * @param documentChanged - Whether the pass changed the title's data
 */
export function nextSyncGates(
  storedGates: Record<string, string> | null | undefined,
  serverId: string,
  gate: string | null,
  documentChanged: boolean
): Record<string, string> {
  const stored = storedGates && typeof storedGates === 'object' ? storedGates : {}
  if (documentChanged) {
    // Every other server's gate was stamped on the old document.
    return gate ? { [serverId]: gate } : {}
  }
  if (gate) return { ...stored, [serverId]: gate }
  // Nothing changed and nothing to stamp: this server's old entry, if any, must
  // not survive a pass that did not complete.
  const { [serverId]: _dropped, ...others } = stored
  return others
}

/** Every collection whose documents carry `syncGates`. */
export const GATED_COLLECTIONS = ['FlatMovies', 'FlatTVShows', 'FlatSeasons', 'FlatEpisodes'] as const

/**
 * Remove every stored gate, so the next run looks at every title again.
 *
 * For a writer that does not keep the gates: the legacy flat sync writes each
 * field with its own update, and a gate left in place after it would let the
 * next run skip a title those rules have just rewritten. It throws when a
 * collection cannot be updated — the caller must not go on to write under
 * gates it failed to remove.
 *
 * @param db - The media database (anything with `collection(name).updateMany`)
 * @returns How many documents had a gate removed
 */
export async function clearSyncGates(db: {
  collection: (name: string) => { updateMany: (filter: any, update: any) => Promise<any> }
}): Promise<number> {
  const results = await Promise.all(
    GATED_COLLECTIONS.map((name) =>
      db.collection(name).updateMany({ syncGates: { $exists: true } }, { $unset: { syncGates: '' } })
    )
  )
  return results.reduce((total, result) => total + (result?.modifiedCount ?? 0), 0)
}
