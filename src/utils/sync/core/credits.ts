/**
 * The credits rule: one title's (or one episode's) credits sidecar, kept,
 * fetched or removed, for movies, shows and episodes alike
 * (CREDITS_SIDECAR.md, section 5).
 *
 * The processor publishes a `credits` value per title and per episode:
 * `{url, hash}` (the file is there), `{absent: true}` (the listing has no
 * file), `{error}` (it has one it could not read), or nothing at all (a
 * processor that predates credits). The availability map records each of
 * those leaves (`credits.url`, `credits.absent`, `credits.error`) per server.
 *
 *  - The servers that claim the credits publish a url or an error. The owner
 *    is the highest-priority claimant, fail-closed (core/ownership): an error
 *    is a claim, so a failure on the owner never hands the credits to a
 *    lower-priority server.
 *  - The owner's pass fetches the file (unless its hash is the stored one),
 *    checks its size and hash and validates it (src/utils/credits/validate),
 *    and stores it. A failure keeps what is stored, records why in
 *    `creditsStatus`, and holds the gate open.
 *  - The credits are removed only when nobody claims them, every server that
 *    has the title says `absent`, this server is one of them, and every
 *    enabled server answered. A processor that publishes no credits value
 *    never confirms an absence.
 *
 * Pure apart from hashing the fetched text: the file is read from the
 * resources the prefetch step fetched (core/resources).
 */

import { createHash } from 'crypto'
import { CREDITS_MAX_BYTES, validateCreditsText, type CreditsScope } from '@src/utils/credits/validate'
import { getServersReportingField, getServersReportingTitle, isHighestPriorityAmongServers } from './ownership'
import { isTopLevelFieldLocked } from './locks'
import type { Resource, ResourceRequest, RunConfig } from './types'

/** The stored fields the rule writes and removes. */
export const CREDITS_FIELDS = ['credits', 'creditsSource', 'creditsHash', 'creditsStatus'] as const

/** The deferral of a credits attempt that failed: the next pass tries again. */
export const CREDITS_DEFERRAL = 'credits'
/** The deferral of a removal waiting for a run on which every server answers. */
export const CREDITS_REMOVAL_DEFERRAL = 'credits removal'

/** Why the last attempt failed, while it stays failed. */
export interface CreditsStatus {
  state: 'error'
  /**
   * `fetch-failed`, a validation rejection (`too-large`, `invalid-json`,
   * `unsupported-version`, `schema`, `hash-mismatch`), `malformed-locator`,
   * or `server:<error>` for an error the processor published.
   */
  reason: string
  detail?: string
  serverId: string
  hash?: string
  /** When this reason (for this server and hash) was first recorded. */
  since: Date
}

/** What the rule reads of the stored document. */
export interface StoredCredits {
  credits?: unknown
  creditsSource?: string
  creditsHash?: string
  creditsStatus?: CreditsStatus
  lockedFields?: unknown
}

/** Which servers publish which credits leaf, and which have the title at all. */
export interface CreditsReporters {
  urls: string[]
  errors: string[]
  absent: string[]
  /** Every server that has the title (or the episode). */
  holders: string[]
}

export interface CreditsRuleInput {
  /** The document as stored (or as this pass has it so far), or null. */
  stored: StoredCredits | null
  /** This server's `credits` value for the title or episode. */
  reported: unknown
  reporters: CreditsReporters
  scope: CreditsScope
  run: Pick<RunConfig, 'serverConfig' | 'allEnabledServersProbed'>
  now: Date
}

export interface CreditsOutcome {
  set: Partial<Record<(typeof CREDITS_FIELDS)[number], unknown>>
  unset: string[]
  /** Set when the pass must not stamp the gate: CREDITS_DEFERRAL or CREDITS_REMOVAL_DEFERRAL. */
  holdBack: string | null
  /** 'stored', 'removed', 'failed' or 'unchanged', for the step's result. */
  action: 'stored' | 'removed' | 'failed' | 'unchanged'
  changes: string[]
  errors: string[]
}

/** The longest `detail` stored: it is a diagnostic for admins, not a credit. */
const MAX_DETAIL = 1000

type Reported =
  | { state: 'present'; url: string; hash: string }
  | { state: 'malformed' }
  | { state: 'absent' }
  | { state: 'error'; error: string }
  | { state: 'unknown' }

function readReported(value: unknown): Reported {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { state: 'unknown' }
  const credits = value as Record<string, unknown>
  if (typeof credits.error === 'string' && credits.error !== '') return { state: 'error', error: credits.error }
  if (typeof credits.url === 'string' && credits.url !== '') {
    return typeof credits.hash === 'string' && /^[a-f0-9]{64}$/.test(credits.hash)
      ? { state: 'present', url: credits.url, hash: credits.hash }
      : { state: 'malformed' }
  }
  if (credits.absent === true) return { state: 'absent' }
  return { state: 'unknown' }
}

/**
 * Who publishes what for a title's credits, or for an episode's under each of
 * its availability prefixes (`seasons.<season key>.episodes.<episode key>`,
 * one per season key the servers use).
 *
 * @param episodePrefixes - Omitted for a movie or a show. For an episode, its
 *   leaf prefixes: none (its paths could not be built) means nobody reports
 *   anything, so the rule neither writes nor removes its credits
 */
export function creditsReporters(
  fieldAvailability: unknown,
  mediaType: 'movies' | 'tv',
  title: string,
  episodePrefixes?: readonly string[]
): CreditsReporters {
  const reporting = (field: string): string[] =>
    episodePrefixes === undefined
      ? getServersReportingField(fieldAvailability, mediaType, title, field)
      : [...new Set(episodePrefixes.flatMap((prefix) => getServersReportingField(fieldAvailability, mediaType, title, `${prefix}.${field}`)))]
  const urls = reporting('credits.url')
  const errors = reporting('credits.error')
  const absent = reporting('credits.absent')
  // Who has the title: every server reporting anything for it. Who has an
  // episode: every server publishing its video or a credits value for it.
  const holders =
    episodePrefixes === undefined
      ? getServersReportingTitle(fieldAvailability, mediaType, title)
      : [...new Set([...reporting('videoURL'), ...urls, ...errors, ...absent])]
  return { urls, errors, absent, holders }
}

/** The file the owner's pass reads, or null when it reads none. */
export function creditsRequest(input: CreditsRuleInput): ResourceRequest | null {
  const reported = readReported(input.reported)
  if (reported.state !== 'present' || !ownsCredits(input)) return null
  return unchanged(input.stored, input.run.serverConfig.id, reported.hash)
    ? null
    : { kind: 'credits', serverId: input.run.serverConfig.id, path: reported.url }
}

/**
 * Plan the credits for one title or episode.
 *
 * @param read - Reads a file the prefetch step fetched (Resources.read): a
 *   file not handed yet reads as a failed fetch, and is recorded as a need
 */
export function planCredits(
  input: CreditsRuleInput,
  read: (request: ResourceRequest) => Resource | undefined
): CreditsOutcome {
  const { stored, reporters, run, now, scope } = input
  const serverId = run.serverConfig.id
  const outcome: CreditsOutcome = { set: {}, unset: [], holdBack: null, action: 'unchanged', changes: [], errors: [] }
  if (isTopLevelFieldLocked(stored?.lockedFields, 'credits')) return outcome

  const reported = readReported(input.reported)

  if (reporters.urls.length > 0 || reporters.errors.length > 0) {
    if (!ownsCredits(input)) return outcome

    const fail = (reason: string, detail?: string, hash?: string): CreditsOutcome => {
      const previous = stored?.creditsStatus
      const same =
        previous?.state === 'error' &&
        previous.reason === reason &&
        previous.serverId === serverId &&
        (previous.hash ?? null) === (hash ?? null) &&
        (previous.detail ?? null) === (detail ?? null)
      if (!same) {
        const status: CreditsStatus = { state: 'error', reason, serverId, since: now }
        if (detail) status.detail = detail
        if (hash) status.hash = hash
        outcome.set.creditsStatus = status
      }
      outcome.holdBack = CREDITS_DEFERRAL
      outcome.action = 'failed'
      outcome.errors.push(`credits ${reason}${detail ? `: ${detail}` : ''}`)
      return outcome
    }

    if (reported.state === 'error') return fail(`server:${reported.error}`)
    if (reported.state !== 'present') return fail('malformed-locator')
    if (unchanged(stored, serverId, reported.hash)) return outcome

    const file = read({ kind: 'credits', serverId, path: reported.url })
    if (!file || !file.ok) return fail('fetch-failed', file && !file.ok ? clip(file.error) : undefined, reported.hash)
    if (typeof file.data !== 'string') return fail('fetch-failed', 'the file did not come back as text', reported.hash)

    const text = file.data
    if (Buffer.byteLength(text, 'utf8') > CREDITS_MAX_BYTES) {
      return fail('too-large', `over ${CREDITS_MAX_BYTES} bytes`, reported.hash)
    }
    if (createHash('sha256').update(text, 'utf8').digest('hex') !== reported.hash) {
      return fail('hash-mismatch', 'the file changed since the processor published it, or is not UTF-8', reported.hash)
    }
    const validation = validateCreditsText(text, scope)
    if (!validation.ok) return fail(validation.reason, clip(validation.errors.join('; ')), reported.hash)

    outcome.set.credits = validation.document
    outcome.set.creditsSource = serverId
    outcome.set.creditsHash = reported.hash
    if (stored?.creditsStatus != null) outcome.unset.push('creditsStatus')
    outcome.action = 'stored'
    outcome.changes.push(`Updated credits (${validation.document.entries.length} entries)`)
    return outcome
  }

  // Nobody claims the credits. They are gone only when that is confirmed.
  const holdsSomething = CREDITS_FIELDS.some((field) => stored?.[field] != null)
  if (!holdsSomething) return outcome
  const confirmedAbsent =
    reported.state === 'absent' &&
    reporters.absent.includes(serverId) &&
    reporters.holders.every((holder) => reporters.absent.includes(holder))
  if (!confirmedAbsent) return outcome
  if (run.allEnabledServersProbed !== true) {
    outcome.holdBack = CREDITS_REMOVAL_DEFERRAL
    return outcome
  }
  for (const field of CREDITS_FIELDS) if (stored?.[field] != null) outcome.unset.push(field)
  outcome.action = 'removed'
  outcome.changes.push('Removed credits (no server has a credits file)')
  return outcome
}

/**
 * Apply an outcome to a builder's draft of the document (the TV builders work
 * on a copy of the stored one, core/writePlan draftWritePlan): its fields
 * set on the draft, its removals taken out of it and listed, its hold-back
 * reported.
 */
export function applyCreditsOutcome(
  outcome: CreditsOutcome,
  draft: Record<string, any>,
  unset: string[],
  holdBack: (reason: string) => void
): void {
  Object.assign(draft, outcome.set)
  for (const field of outcome.unset) {
    delete draft[field]
    if (!unset.includes(field)) unset.push(field)
  }
  if (outcome.holdBack) holdBack(outcome.holdBack)
}

/** Whether this server is the highest-priority server publishing a url or an error. */
function ownsCredits({ reporters, run }: CreditsRuleInput): boolean {
  return isHighestPriorityAmongServers([...new Set([...reporters.urls, ...reporters.errors])], run.serverConfig)
}

/** The stored credits are this server's file at this hash, and the last attempt worked. */
function unchanged(stored: StoredCredits | null, serverId: string, hash: string): boolean {
  return Boolean(
    stored &&
      stored.credits != null &&
      stored.creditsSource === serverId &&
      stored.creditsHash === hash &&
      stored.creditsStatus == null
  )
}

function clip(text: string): string {
  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 1)}…` : text
}
