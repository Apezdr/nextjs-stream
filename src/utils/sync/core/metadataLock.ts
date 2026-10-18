/**
 * Metadata an admin locked, and what a pass derives from it.
 *
 * A document's metadata (the TMDB copy a file server publishes) is where
 * other fields come from: a movie's and a show's display title, a show's
 * dates and status, a season's title, air date and episode count, an
 * episode's title. An admin who locks `metadata` (lockedFields) keeps the
 * stored copy, and so keeps everything derived from it: the write chokepoint
 * (BaseRepository.computeDiff / smartBulkUpsert) drops a new copy on its way
 * to the database, and a field taken from that copy would describe metadata
 * the document does not hold.
 *
 * For movies, shows, seasons and episodes alike:
 *
 *  1. Locked: the stored copy stays, and derived fields are read from it.
 *  2. Not locked, and the pass brings a copy: that copy is written, and
 *     derived fields are read from it.
 *  3. Not locked, and the pass brings none: the stored copy stays. When the
 *     source says there is none any more (a season the show's metadata no
 *     longer lists), a stored copy is removed, with what was derived from it.
 *
 * The lock is enforced again at the write chokepoint; this module decides
 * what the builders derive from.
 *
 * Pure: the caller fetches, judges whether what it fetched is usable, writes
 * what the outcome says and derives its own fields from `metadata`.
 */

/** One copy of a document's metadata and the server it was read from. */
export interface MetadataCopy<M> {
  metadata?: M | null
  /** `metadataSource` */
  metadataSource?: string
}

export interface MetadataLockInput<M> {
  /** What the document holds; null or undefined for a new document. */
  stored: MetadataCopy<M> | null | undefined
  /**
   * The copy this pass brings, as the caller judged it usable; null or
   * undefined when it brings none. A copy without `metadata` is none.
   */
  incoming: MetadataCopy<M> | null | undefined
  /** The source says the document has no metadata any more. */
  gone?: boolean
  /** Whether an admin locked the document's `metadata`. */
  locked: boolean
}

export type MetadataOutcome<M> =
  /**
   * Write the incoming copy, and derive from it. A copy that names no
   * source keeps the stored source.
   */
  | { action: 'write'; metadata: M; metadataSource: string | undefined }
  /** The stored copy stays (locked, or nothing came in); derive from it. */
  | { action: 'keep'; metadata: M | null | undefined; metadataSource: string | undefined; locked: boolean }
  /** Remove the stored copy and what was derived from it. */
  | { action: 'remove'; metadata: undefined; metadataSource: undefined }

/**
 * The metadata a document ends this pass with, and what the pass does to it.
 */
export function effectiveMetadata<M>({ stored, incoming, gone = false, locked }: MetadataLockInput<M>): MetadataOutcome<M> {
  const keep = (): MetadataOutcome<M> => ({
    action: 'keep',
    metadata: stored?.metadata,
    metadataSource: stored?.metadataSource,
    locked,
  })
  if (locked) return keep()
  if (incoming?.metadata !== undefined && incoming.metadata !== null) {
    return {
      action: 'write',
      metadata: incoming.metadata,
      metadataSource: incoming.metadataSource ?? stored?.metadataSource,
    }
  }
  if (gone && stored?.metadata) return { action: 'remove', metadata: undefined, metadataSource: undefined }
  return keep()
}
