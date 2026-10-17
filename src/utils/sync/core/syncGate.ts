/**
 * The skip gate, shared by movies, shows and episodes.
 *
 * A server's pass over a title may be skipped only when nothing that decides
 * what the pass would write has changed since that server's last COMPLETE pass:
 *
 *   1. the server's own data for the title — a fingerprint of the payload that
 *      was actually applied (`payloadFingerprint` in this file);
 *   2. which servers have which fields for the title — the availability
 *      fingerprint (`availabilityFingerprint` in this file). Ownership follows
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
import { getServer } from '@src/utils/config'
import { sortedPathsOf } from './ownership'

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

/**
 * A short, stable fingerprint of WHO HAS WHAT for one title this run: every
 * field path any server reported for it, the servers reporting each, and those
 * servers' priorities.
 *
 * It is the second half of the skip decision. A server's payload hash says
 * whether that server's own data changed. What the server must write also
 * depends on which fields it owns, and that changes when ANOTHER server gains
 * or loses a field: the server that owned the video deletes its file, and the
 * one that now has to supply it has a payload that did not change at all.
 * Skipping on the payload hash alone left that title without a video until the
 * second server's own data happened to change.
 *
 * Not cryptographic; it only has to change when the picture does.
 *
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {string} mediaType - 'movies' or 'tv'
 * @param {string} mediaTitle - originalTitle (the filesystem key)
 * @returns {string} 16 hex characters
 */
export function availabilityFingerprint(fieldAvailability: any, mediaType: string, mediaTitle: string): string {
  const bucket = fieldAvailability?.[mediaType]?.[mediaTitle]
  if (!bucket || typeof bucket !== 'object') return fingerprintPaths({}, [])
  return fingerprintPaths(bucket, sortedPathsOf(bucket))
}

/**
 * A short fingerprint of a piece of file-server payload, exactly as it was
 * received and applied.
 *
 * The third part of the skip decision. The file server's own hash for a title
 * is fetched separately from the payload — for episodes, minutes later — and a
 * scan can commit in between. The sync then stamps the NEW hash on documents
 * built from the OLD payload, and the next run, seeing that hash again, skips
 * the title: it stays on the old data until something else changes it. Keeping
 * a fingerprint of the payload that was actually applied closes that: the next
 * run's payload is different, so it is not skipped. It also covers any field a
 * file server publishes but leaves out of its hash.
 *
 * The payload is built from stored rows with nothing time-dependent in it, so
 * an unchanged title serialises identically from one request to the next.
 *
 * @param {unknown} payload
 * @returns {string} 16 hex characters
 */
export function payloadFingerprint(payload: unknown): string {
  const text = JSON.stringify(payload === undefined ? null : payload)
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ code, 0x811c9dc5) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/**
 * The same fingerprint over several prefixes at once. One episode has several
 * when two servers name its season folder differently ("Season 1" on one,
 * "Season 01" on the other): each server's leaves sit under its own folder
 * name, and together they are the picture for that episode.
 *
 * @param {Object} fieldAvailability - Field availability mapping
 * @param {string} mediaType - 'movies' or 'tv'
 * @param {string} mediaTitle - originalTitle (the filesystem key)
 * @param {string[]} prefixes - Path prefixes, each including its trailing dot
 * @returns {string} 16 hex characters
 */
export function availabilityFingerprintForPrefixes(
  fieldAvailability: any,
  mediaType: string,
  mediaTitle: string,
  prefixes: string[]
): string {
  const bucket = fieldAvailability?.[mediaType]?.[mediaTitle]
  if (!bucket || typeof bucket !== 'object' || !Array.isArray(prefixes) || prefixes.length === 0) {
    return fingerprintPaths({}, [])
  }
  const paths = sortedPathsOf(bucket)
  const slice: string[] = []
  for (const prefix of [...new Set(prefixes)].sort()) {
    let low = 0
    let high = paths.length
    while (low < high) {
      const mid = (low + high) >>> 1
      if (paths[mid] < prefix) low = mid + 1
      else high = mid
    }
    for (let i = low; i < paths.length && paths[i].startsWith(prefix); i++) slice.push(paths[i])
  }
  return fingerprintPaths(bucket, slice)
}

function fingerprintPaths(bucket: any, paths: string[]): string {
  const serverIds = new Set<string>()

  // Two independent 32-bit FNV-1a passes (different offsets) → 64 bits.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  const mix = (text: string): void => {
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0
      h2 = Math.imul(h2 ^ code, 0x811c9dc5) >>> 0
    }
  }

  for (const path of paths) {
    const reporters = Array.isArray(bucket[path]) ? [...bucket[path]].map(String).sort() : []
    for (const id of reporters) serverIds.add(id)
    mix(`${path}=>${reporters.join(',')};`)
  }
  for (const id of [...serverIds].sort()) {
    let priority: number | undefined
    try {
      priority = getServer(id)?.priority
    } catch {
      priority = undefined
    }
    mix(`${id}@${priority};`)
  }

  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}
