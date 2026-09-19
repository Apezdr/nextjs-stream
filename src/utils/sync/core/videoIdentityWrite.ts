/**
 * Pure rule for which URL a Flat* document's `normalizedVideoId` must be
 * derived from.
 *
 * The invariant: **identity is derived from the URL the document will hold
 * after this write** — never from the URL the syncing server happens to
 * report. `WatchHistory.normalizedVideoId` is always a hash of the URL the
 * client was actually served, so the moment the catalog keys a title from a
 * different URL, every watch-history join for that title fails: the row is
 * written under one hash and looked up under another. Nothing errors; resume
 * positions and Continue Watching simply stop finding the title.
 *
 * Two things withhold a reported URL from the document, and both have caused
 * exactly that fork:
 *
 *  1. **An admin lock** — `computeDiff` drops a locked `videoURL` on the way
 *     to Mongo, so the reported URL is never stored.
 *  2. **Field priority** — a server that does not own `videoURL` never gets
 *     its URL written at all. On a title present on two servers with
 *     different path shapes (say one with `prefixPath: '/media'`), the
 *     non-owner's pass would re-key the document to its own shape while
 *     `videoURL` kept the owner's.
 *
 * Because the answer is "whatever the document ends up holding", any server's
 * pass also *repairs* a title that has already drifted.
 *
 * The value returned still has to go through the shared
 * `generateNormalizedVideoId`, which canonicalizes JIT-transcoder stream URLs
 * to their source pathname — so a locked JIT URL and an unlocked raw URL for
 * the same file produce the same id.
 */

export interface EffectiveVideoUrlInput {
  /** The document's current `videoURL`, before this write. */
  currentVideoUrl?: string | null
  /**
   * The pending update set. `videoURL` is present here only when this server
   * both owns the field and has a different value; absent means the stored
   * URL stands.
   */
  updates: { videoURL?: string | null }
  /** True when `videoURL` is admin-locked on this document. */
  isVideoUrlLocked: boolean
}

/**
 * The URL this write will leave in the document — the only correct input to
 * `normalizedVideoId`.
 */
export function resolveEffectiveVideoUrl({
  currentVideoUrl,
  updates,
  isVideoUrlLocked,
}: EffectiveVideoUrlInput): string | null {
  // A locked field keeps the stored value no matter what lands in `updates`.
  if (isVideoUrlLocked) return currentVideoUrl ?? null

  // Not in `updates` ⇒ this server did not (or could not) change it.
  if (!('videoURL' in updates)) return currentVideoUrl ?? null

  return updates.videoURL ?? null
}
