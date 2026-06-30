/**
 * Field Absence Cleaner
 *
 * The domain-driven sync (`src/utils/sync/`) is additive-only: every strategy
 * `$set`s fields when the file server reports them and silently skips when it
 * doesn't (see BaseRepository.computeDiff — it only iterates keys present on the
 * merged entity, so a field that vanished from every server lingers in MongoDB
 * forever and the frontend renders a 404'd asset URL).
 *
 * This module detects optional fields that NO enabled file server reports
 * anymore but which still hold a value in the DB, so the caller can `$unset`
 * them. It is PURE — it never touches the database. The caller folds the
 * returned field names into its existing repository write.
 *
 * Safety rails (see FIELD_ABSENCE_CLEANUP_DESIGN.md):
 *  - Authoritative-pass gate: never clears unless every enabled server was
 *    probed this run (`allEnabledServersProbed`). A transient outage that drops
 *    a server from `fieldAvailability` must not be read as "field deleted".
 *  - Lock-aware: a field locked by an admin (`entity.lockedFields`) is never
 *    cleared — mirrors BaseRepository.computeDiff / filterLockedFields.
 *  - Required-field denylist: structural keys can never be passed for clearing.
 *  - Per-entity cap: if more primary fields than `maxFieldsPerEntity` look
 *    absent at once, abort the whole entity (a file server returning an empty
 *    manifest shouldn't be able to wipe a record in one pass).
 */

import { FieldAvailability } from './types'

export interface CleanableField {
  /** Entity property name to $unset (e.g. 'thumbnail'). */
  entityField: string
  /** fieldAvailability lookup path (e.g. 'seasons.Season 2.episodes.S02E05.thumbnail'). */
  fieldPath: string
  /** Companion fields cleared alongside the primary (e.g. 'thumbnailSource'). */
  companions?: string[]
}

export interface AbsenceCleanupInput {
  mediaType: 'movies' | 'tv'
  /** fieldAvailability key — originalTitle for movies/shows (episodes carry their identity in fieldPath). */
  availabilityKey: string
  /**
   * The DB document whose values we're testing for "present and clearable" +
   * reading locks from. Typed `Record<string, any>` (not `unknown`) so callers
   * can pass concrete entity interfaces (MovieEntity, EpisodeEntity, …) without
   * an index-signature cast.
   */
  entity: Record<string, any> | null | undefined
  fieldAvailability: FieldAvailability
  fields: CleanableField[]
  /**
   * Pre-flight gate. Cleanup ONLY runs when true. The caller asserts every
   * enabled server responded this run; if even one failed, pass false → no-op.
   */
  allEnabledServersProbed: boolean
  /** Abort the entity if more than this many PRIMARY fields look absent. Default 5. */
  maxFieldsPerEntity?: number
}

export interface AbsenceCleanupResult {
  /** Field names to $unset — empty means no-op. Includes triggered companions. */
  fieldsToUnset: string[]
  /** Human-readable diagnostics for SyncResult.changes / logs. */
  changes: string[]
  /** True when the per-entity cap tripped and the whole entity was skipped. */
  aborted: boolean
}

/**
 * Structural / identity fields that must never be cleared, regardless of what a
 * caller passes. Belt-and-braces against a future caller wiring 'title' etc.
 */
const REQUIRED_FIELD_DENYLIST = new Set<string>([
  '_id', 'title', 'originalTitle', 'type', 'createdAt', 'lastSynced', 'updatedAt',
  'syncRunId', 'syncHash', 'lockedFields', 'showId', 'seasonId',
  'episodeNumber', 'seasonNumber', 'showTitle', 'metadata',
])

const DEFAULT_MAX_FIELDS_PER_ENTITY = 5

/**
 * Whether a top-level field is locked per a doc's nested `lockedFields` map.
 * A nested-object lock (e.g. { metadata: { overview: true } }) locks the whole
 * top-level key — same conservative rule as BaseRepository.isTopLevelFieldLocked.
 */
function isTopLevelFieldLocked(lockedFields: any, key: string): boolean {
  if (!lockedFields || typeof lockedFields !== 'object') return false
  const lock = lockedFields[key]
  return lock === true || (lock !== null && typeof lock === 'object')
}

/** A value worth clearing — not undefined/null and not an already-empty object. */
function hasClearableValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0) {
    return false
  }
  return true
}

/**
 * Detect optional fields absent on every enabled server but still set in the DB.
 * Pure: returns the fields the caller should $unset. Never writes.
 */
export function detectAbsentFields(input: AbsenceCleanupInput): AbsenceCleanupResult {
  const empty: AbsenceCleanupResult = { fieldsToUnset: [], changes: [], aborted: false }

  // Gate 1: authoritative pass only. Resilient to transient server outages.
  if (!input.allEnabledServersProbed) return empty
  if (!input.entity || !input.fields?.length) return empty

  const lockedFields = (input.entity as any)?.lockedFields
  const serverBucket = input.fieldAvailability?.[input.mediaType]?.[input.availabilityKey] || {}
  const cap = input.maxFieldsPerEntity ?? DEFAULT_MAX_FIELDS_PER_ENTITY

  const toUnset: string[] = []
  const changes: string[] = []
  let primaryCount = 0

  for (const field of input.fields) {
    // Gate 3: never clear structural/identity fields, even if asked.
    if (REQUIRED_FIELD_DENYLIST.has(field.entityField)) {
      throw new Error(
        `FieldAbsenceCleaner: refusing to clear protected field "${field.entityField}"`
      )
    }

    const serversWithData = serverBucket[field.fieldPath] ?? []
    // Some server still reports it → keep. This is the empty-array branch that
    // isCurrentServerHighestPriorityForField returns true for, but here we read
    // it directly because we want the "nobody has it" signal, not priority.
    if (serversWithData.length !== 0) continue

    // Nothing in the DB to clear.
    if (!hasClearableValue(input.entity[field.entityField])) continue

    // Admin-locked → keep (never lose a manually-set value).
    if (isTopLevelFieldLocked(lockedFields, field.entityField)) continue

    primaryCount++
    toUnset.push(field.entityField)
    changes.push(`Cleared ${field.entityField} (absent on all servers)`)

    // Companions ride along only when they themselves have a value and aren't locked.
    for (const companion of field.companions ?? []) {
      if (REQUIRED_FIELD_DENYLIST.has(companion)) continue
      if (isTopLevelFieldLocked(lockedFields, companion)) continue
      if (!hasClearableValue(input.entity[companion])) continue
      toUnset.push(companion)
    }
  }

  // Gate 4: per-entity cap on PRIMARY fields. A catastrophic regression (e.g. a
  // file server returns an empty manifest) shouldn't wipe a record in one pass.
  if (primaryCount > cap) {
    return {
      fieldsToUnset: [],
      changes: [
        `ABORTED field-absence cleanup: ${primaryCount} primary fields looked absent ` +
        `(cap ${cap}) — likely a file-server regression, not real deletions`,
      ],
      aborted: true,
    }
  }

  return {
    fieldsToUnset: Array.from(new Set(toUnset)),
    changes,
    aborted: false,
  }
}

/** SyncContext.cleanup shape (kept in sync with core/types.ts). */
export interface CleanupConfig {
  enabled: boolean
  mode: 'enforce' | 'dry-run'
  maxFieldsPerEntity: number
  allEnabledServersProbed: boolean
}

/**
 * Build the cleanup config from the SYNC_FIELD_CLEANUP env flag. Single source of
 * truth so every sync entrypoint (movies, TV) behaves identically:
 *   - 'off'/'false'/'disabled'/'0'/'none'/'no' → undefined (fully disabled)
 *   - 'dry-run'/'dryrun'/'dry'/'log'/'observe' → dry-run (detect + log, no writes)
 *   - unset or anything else → enforce (the default)
 * `allEnabledServersProbed` is the authoritative-pass gate, threaded from the route.
 */
export function resolveCleanupConfig(allEnabledServersProbed: boolean): CleanupConfig | undefined {
  const flag = (process.env.SYNC_FIELD_CLEANUP || '').trim().toLowerCase()
  if (['off', 'false', 'disabled', '0', 'none', 'no'].includes(flag)) return undefined
  const dryRun = ['dry-run', 'dryrun', 'dry', 'log', 'observe'].includes(flag)
  return {
    enabled: true,
    mode: dryRun ? 'dry-run' : 'enforce',
    maxFieldsPerEntity: 5,
    allEnabledServersProbed: allEnabledServersProbed === true,
  }
}

export interface CleanupPlan {
  /** Fields to $unset — present ONLY in enforce mode (and when non-empty). */
  unset?: string[]
  /** Diagnostics to fold into SyncResult.changes (both modes). */
  changes: string[]
}

/**
 * Orchestration wrapper shared by all domain services: runs the pure detector,
 * emits one structured observability log (both dry-run and enforce), and returns
 * the `$unset` list only when enforcing. Keeps the mode/log/gate decision in one
 * place so every entity type behaves identically. Returns an empty plan (no log,
 * no unset) when cleanup is disabled or there's nothing to clear.
 *
 * @param log pino-style logger call, e.g. (obj, msg) => pinoLog.info(obj, msg)
 * @param logContext entity identity for the log line (show/season/episode/title…)
 */
export function planFieldCleanup(params: {
  cleanup: CleanupConfig | undefined
  mediaType: 'movies' | 'tv'
  availabilityKey: string
  entity: Record<string, any> | null | undefined
  fieldAvailability: FieldAvailability
  fields: CleanableField[]
  log: (obj: Record<string, any>, msg: string) => void
  logContext: Record<string, any>
}): CleanupPlan {
  const { cleanup } = params
  if (!cleanup?.enabled || !params.entity) return { changes: [] }

  const result = detectAbsentFields({
    mediaType: params.mediaType,
    availabilityKey: params.availabilityKey,
    entity: params.entity,
    fieldAvailability: params.fieldAvailability,
    fields: params.fields,
    allEnabledServersProbed: cleanup.allEnabledServersProbed,
    maxFieldsPerEntity: cleanup.maxFieldsPerEntity,
  })

  if (result.fieldsToUnset.length === 0 && !result.aborted) return { changes: [] }

  params.log(
    {
      ...params.logContext,
      mode: cleanup.mode,
      fields: result.fieldsToUnset,
      aborted: result.aborted,
      reason: 'absent-on-all-servers',
    },
    `field-absence cleanup (${cleanup.mode})`
  )

  return {
    unset:
      cleanup.mode === 'enforce' && result.fieldsToUnset.length > 0
        ? result.fieldsToUnset
        : undefined,
    changes: result.changes,
  }
}
