/**
 * Admin locks (`lockedFields`): the one check the builders and the
 * repositories share. Pure; the repositories enforce the locks at the write
 * (BaseRepository.computeDiff), the builders read them to leave a locked
 * field's companions alone.
 */

/**
 * Whether a top-level field is locked according to a doc's nested `lockedFields`
 * map (e.g. { posterURL: true, metadata: { overview: true } }).
 *
 * A nested-object lock (metadata.overview) is treated as locking the WHOLE
 * top-level key here. computeDiff emits whole-object `$set` for changed nested
 * objects, so honoring a sub-path lock by partially rebuilding the object would
 * drop the locked sub-value on write — locking the whole key is the safe,
 * never-lose-data behavior. It is coarser than a sub-path-precise dot-path write
 * would be, but it never overwrites an admin's locked value.
 */
export function isTopLevelFieldLocked(lockedFields: any, key: string): boolean {
  if (!lockedFields || typeof lockedFields !== 'object') return false
  const lock = lockedFields[key]
  return lock === true || (lock !== null && typeof lock === 'object')
}
