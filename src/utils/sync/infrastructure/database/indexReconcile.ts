/**
 * An index that already exists under the name (or the key) the sync asks for,
 * with other options: brought in line with the code's definition.
 *
 * createIndex answers IndexOptionsConflict (85) or IndexKeySpecsConflict (86)
 * when an index of the same name or the same key exists with other options.
 * BaseRepository.createIndexSafely used to take either as "already exists",
 * so an index an older version created with other options was never
 * corrected: a database that once had the display-title indexes UNIQUE kept
 * them, and two titles sharing a display name then failed every write with
 * E11000.
 *
 * On such a conflict the existing index is read (by name, else by key) and
 * compared with the requested one: the key (fields, order, direction) and
 * unique, sparse, partialFilterExpression, expireAfterSeconds and collation.
 * The name alone is not compared: an equivalent index under another name is
 * kept, as before. When they differ, the existing index is dropped and the
 * requested one created, in one log line. When that create fails (a unique
 * index over duplicate values), the previous definition is created again and
 * the failure logged: the collection is never left without the index. Each
 * index is reconciled at most once per process, so a failed attempt is not
 * repeated on every sync.
 */

import isEqual from 'lodash/isEqual'

/** The options compared besides the key. */
const COMPARED_OPTIONS = ['unique', 'sparse', 'partialFilterExpression', 'expireAfterSeconds', 'collation'] as const

/** Fields of a stored index document that are not createIndex options. */
const NOT_OPTIONS = new Set(['v', 'key', 'ns'])

/** The part of a collection reconciling reads and writes. */
export interface IndexedCollection {
  indexes(): Promise<Record<string, any>[]>
  createIndex(key: Record<string, any>, options?: Record<string, any>): Promise<unknown>
  dropIndex(name: string): Promise<unknown>
}

/** What came of a conflict. */
export type ReconcileOutcome =
  | 'matches'
  | 'replaced'
  | 'restored'
  | 'not-found'
  | 'unreadable'
  | 'kept'
  | 'already-attempted'

/** Whether createIndex refused because an index of that name or key exists with other options. */
export function isIndexConflict(error: any): boolean {
  return (
    error?.code === 85 ||
    error?.code === 86 ||
    error?.codeName === 'IndexOptionsConflict' ||
    error?.codeName === 'IndexKeySpecsConflict'
  )
}

/** The name MongoDB gives an index created without one. */
export function defaultIndexName(key: Record<string, any>): string {
  return Object.entries(key)
    .map(([field, direction]) => `${field}_${direction}`)
    .join('_')
}

const textFields = (key: Record<string, any>) =>
  Object.entries(key).filter(([, direction]) => direction === 'text').map(([field]) => field)

/**
 * Whether a stored index has the requested key: the same fields in the same
 * order with the same directions. A text index is stored as `_fts`/`_ftsx`
 * with its fields in `weights`, so its text fields are compared as a set.
 */
export function sameIndexKey(index: Record<string, any>, key: Record<string, any>): boolean {
  const text = textFields(key)
  if (text.length === 0) return isEqual(Object.entries(index.key ?? {}), Object.entries(key))
  if (index.key?._fts !== 'text') return false
  const stored = Object.keys(index.weights ?? {}).sort()
  const others = (entries: [string, any][]) => entries.filter(([field]) => field !== '_fts' && field !== '_ftsx')
  return (
    isEqual(stored, [...text].sort()) &&
    isEqual(others(Object.entries(index.key)), Object.entries(key).filter(([, direction]) => direction !== 'text'))
  )
}

function sameCollation(stored: Record<string, any> | undefined, wanted: Record<string, any> | undefined): boolean {
  if (!wanted) return !stored || stored.locale === 'simple'
  // MongoDB stores every collation field; the request names some of them
  return Boolean(stored) && Object.entries(wanted).every(([field, value]) => isEqual(stored?.[field], value))
}

/** What differs between a stored index and the requested one ('key' and the option names); empty when nothing does. */
export function indexDifferences(
  index: Record<string, any>,
  key: Record<string, any>,
  options: Record<string, any> = {}
): string[] {
  const differences: string[] = []
  if (!sameIndexKey(index, key)) differences.push('key')
  for (const option of COMPARED_OPTIONS) {
    const same =
      option === 'unique' || option === 'sparse'
        ? Boolean(index[option]) === Boolean(options[option])
        : option === 'collation'
          ? sameCollation(index.collation, options.collation)
          : isEqual(index[option] ?? null, options[option] ?? null)
    if (!same) differences.push(option)
  }
  return differences
}

/** An index's key and compared options, for the log line. */
function describe(name: string, key: Record<string, any>, options: Record<string, any>): string {
  const shown: Record<string, any> = { key }
  for (const option of COMPARED_OPTIONS) {
    if (options[option] !== undefined && options[option] !== false) shown[option] = options[option]
  }
  return `${name} ${JSON.stringify(shown)}`
}

/** A stored index document as createIndex options, to create it again as it was. */
function previousOptions(index: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(index).filter(([field]) => !NOT_OPTIONS.has(field)))
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** The indexes reconciled in this process, as `<collection>.<index name>`. */
function attemptedThisProcess(): Set<string> {
  const store = globalThis as typeof globalThis & { __syncIndexReconciles?: Set<string> }
  if (!store.__syncIndexReconciles) store.__syncIndexReconciles = new Set()
  return store.__syncIndexReconciles
}

/**
 * Bring an index that conflicted with the requested definition in line with
 * it (see the module comment). Throws only when the requested index could not
 * be created and the previous one could not be created again either: the
 * collection then has neither, and its repository's createIndexes reports the
 * failure, so the next sync tries again.
 *
 * @param retry - Runs one database call with the caller's transient-error retries
 */
export async function reconcileIndex(
  collection: IndexedCollection,
  collectionName: string,
  key: Record<string, any>,
  options: Record<string, any> = {},
  retry: <R>(call: () => Promise<R>) => Promise<R> = (call) => call()
): Promise<ReconcileOutcome> {
  const name = options.name ?? defaultIndexName(key)
  const attempted = attemptedThisProcess()
  if (attempted.has(`${collectionName}.${name}`)) return 'already-attempted'
  attempted.add(`${collectionName}.${name}`)

  let existing: Record<string, any> | undefined
  try {
    const indexes = await retry(() => collection.indexes())
    existing = indexes.find((index) => index.name === name) ?? indexes.find((index) => sameIndexKey(index, key))
  } catch (error) {
    console.warn(`[indexes] ${collectionName}: could not read the indexes to compare ${name} (${message(error)}); left as they are`)
    return 'unreadable'
  }
  if (!existing) return 'not-found'
  const differences = indexDifferences(existing, key, options)
  if (differences.length === 0) return 'matches'

  const before = describe(existing.name, existing.key, existing)
  const after = describe(name, key, options)
  try {
    await retry(() => collection.dropIndex(existing.name))
  } catch (error) {
    console.error(`[indexes] ${collectionName}: could not drop ${before} to create ${after} (${message(error)}); kept it`)
    return 'kept'
  }
  try {
    await retry(() => collection.createIndex(key, options))
    console.info(`[indexes] ${collectionName}: replaced ${before} with ${after} (${differences.join(', ')} differed)`)
    return 'replaced'
  } catch (error) {
    try {
      await retry(() => collection.createIndex(existing.key, previousOptions(existing)))
    } catch (restoreError) {
      console.error(
        `[indexes] ${collectionName}: could not create ${after} (${message(error)}) nor restore ${before} ` +
          `(${message(restoreError)}): the collection has neither`
      )
      throw restoreError
    }
    console.error(`[indexes] ${collectionName}: could not create ${after} (${message(error)}); restored ${before}`)
    return 'restored'
  }
}
