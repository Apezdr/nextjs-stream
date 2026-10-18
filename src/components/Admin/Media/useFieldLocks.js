import { useState } from 'react'

/** The title field's hint, in every editor that locks the title on edit. */
export const TITLE_LOCK_HELP =
  'Changing the title locks it, so the sync keeps yours. Unlock it to let the sync set it again.'

/**
 * The hint on a field the editors store in `metadata.*` (Overview, the TMDB
 * ID). The sync replaces the metadata whenever it takes a fresh copy, unless
 * `metadata` is locked. The editors do not lock it on edit: that would freeze
 * every field derived from the metadata, so the hint says what will happen.
 */
export const METADATA_FIELD_HELP =
  'Comes from the metadata: the next metadata refresh replaces it unless the metadata is locked. This lock locks all metadata.'

/**
 * The TMDB ID's hint: the metadata hint, and where to choose the TMDB entry
 * so that it lasts, which is the processor's `tmdb.config` for the folder.
 *
 * @param {boolean} tmdbConfigOnPage - Whether the editor shows TmdbConfigButton
 */
export function tmdbIdHelp(tmdbConfigOnPage) {
  const where = tmdbConfigOnPage
    ? 'set the ID in TMDB Config, above (the processor\'s tmdb.config)'
    : 'set the ID in the processor\'s tmdb.config for the title\'s folder'
  return `${METADATA_FIELD_HELP} To match the title to another TMDB entry, ${where}.`
}

/**
 * An editor's per-field locks (`lockedFields`), and the rule that locks a
 * field when the admin changes it.
 *
 * The sync rewrites every field that is not locked on its next pass (the
 * repositories skip only locked ones; `manualFields` records who set a value
 * and does not stop a sync write), so an edit to a field the sync owns is
 * undone unless the field is locked. For each field in `lockOnEdit`:
 *  - a value that differs from the stored one turns the field's lock on, in
 *    the form, where the admin sees it, and `autoLocked` says so, for the
 *    field to announce (LockableField);
 *  - typing the stored value back, or clearing the field, puts the stored
 *    lock back: an empty value is never locked, since a lock on a missing
 *    value would stop the sync from ever restoring it (the save actions
 *    refuse to clear a stored title anyway);
 *  - once the admin uses the field's lock toggle, the toggle decides: later
 *    edits do not move it, and the save sends what the form shows.
 *
 * @param {Object|null} record - The stored document; null on create
 * @param {string[]} lockOnEdit - The fields locked when the admin changes them
 */
export function useFieldLocks(record, lockOnEdit = []) {
  const storedLocks = record?.lockedFields ?? {}
  const [locks, setLocks] = useState(() => ({ ...storedLocks }))
  // Fields whose lock the admin has set by hand in this form
  const [toggled, setToggled] = useState(() => new Set())

  const isLocked = (key) => locks[key] === true

  const toggleLock = (key) => {
    setToggled((prev) => (prev.has(key) ? prev : new Set(prev).add(key)))
    setLocks((prev) => {
      const next = { ...prev }
      if (next[key] === true) delete next[key]
      else next[key] = true
      return next
    })
  }

  /** Call with every new value of a field; only `lockOnEdit` fields react. */
  const noteEdit = (key, value) => {
    if (!lockOnEdit.includes(key) || toggled.has(key)) return
    // The save trims, so whitespace alone is not a change, and a field
    // holding nothing but whitespace is empty.
    const typed = String(value ?? '').trim()
    const changed = typed !== '' && typed !== String(record?.[key] ?? '').trim()
    setLocks((prev) => {
      const next = { ...prev }
      if (changed) next[key] = true
      else if (key in storedLocks) next[key] = storedLocks[key]
      else delete next[key]
      return next
    })
  }

  /**
   * Whether the field's lock is on because the admin changed its value: on,
   * not on as stored, and not set by hand. Only noteEdit turns such a lock on.
   */
  const autoLocked = (key) =>
    lockOnEdit.includes(key) && locks[key] === true && storedLocks[key] !== true && !toggled.has(key)

  return { locks, isLocked, toggleLock, noteEdit, autoLocked }
}
