/**
 * An image's blurhash: whether a pass keeps the stored one, fetches a new one,
 * or removes it.
 *
 * A blurhash is a placeholder for ONE picture. It is valid only while it
 * belongs to the image the document holds: read from the server that owns
 * that image, and not older than it. Every image that carries one (a movie's
 * poster and backdrop, a show's poster and backdrop, a season's poster, an
 * episode's thumbnail) follows this rule:
 *
 *  1. Only the pass of the server that owns the image settles its blurhash.
 *     Ranked on its own, a blurhash could be another server's, of another file.
 *  2. An admin lock on the image or on the blurhash leaves the blurhash alone:
 *     a locked image is not the file server's image, and a locked blurhash is
 *     not the sync's to change.
 *  3. A stored blurhash of the stored image is kept, and nothing is fetched.
 *  4. Otherwise (none is stored, or the stored one is of another image: the
 *     image URL changed, or the blurhash was read from another server) the
 *     owner's blurhash file is fetched, when it publishes one.
 *  5. When that leaves nothing to store (no file published, or the fetch
 *     failed), a stale blurhash is removed: no blurhash is right, another
 *     picture's is not. A failed fetch is reported, so the caller does not
 *     mark its pass complete and the next run tries again.
 *
 * The image URL is compared whole. It used to be compared by its ?hash= alone,
 * which is the file's modified time: a copy of the same file on another server
 * has the same one. And a blurhash used to be fetched only "when the image
 * changed or none is stored", so one failed fetch after an image was replaced
 * left the old image's blurhash for good.
 *
 * Pure: the caller does the fetch, and stores or removes what the outcome says.
 */

/** The image and blurhash the document holds before this pass. */
export interface StoredImageBlurhash {
  /** The stored image URL. */
  url?: string | null
  /** The stored blurhash. */
  blurhash?: string | null
  /** The server the stored blurhash was read from (`<field>BlurhashSource`). */
  blurhashSource?: string | null
}

/** What the server being synced publishes for the image. */
export interface ReportedImageBlurhash {
  /**
   * The image URL this pass stores: the owner's file, as fileServerUrl builds
   * it from the payload. Empty when the server has no image.
   */
  url?: string | null
  /**
   * Where the server publishes the image's blurhash, in whatever form the
   * caller's fetch takes (a payload path or a full URL). Empty when it
   * publishes none.
   */
  blurhashUrl?: string | null
}

export interface BlurhashRuleInput {
  stored: StoredImageBlurhash
  reported: ReportedImageBlurhash
  /**
   * The id of the server being synced when it owns the image (see
   * core/ownership), null when it does not.
   */
  owner: string | null
  /** Admin locks (`lockedFields`) on the image field and on the blurhash field. */
  locks: { image: boolean; blurhash: boolean }
}

/** Why a blurhash is left as it is. */
export type BlurhashKeepReason =
  /** An admin locked the image or the blurhash. */
  | 'locked'
  /** The server being synced does not own the image. */
  | 'not-owner'
  /** The server being synced has no image to store. */
  | 'no-image'
  /** The stored blurhash is of the stored image. */
  | 'current'
  /** None is stored, and the owner publishes none to fetch. */
  | 'no-blurhash-file'

export type BlurhashDecision =
  | { action: 'keep'; reason: BlurhashKeepReason }
  | {
      action: 'fetch'
      /** `reported.blurhashUrl`, for the caller's fetch. */
      blurhashUrl: string
      /** The owner: the source a fetched blurhash is stored with. */
      source: string
      /** A blurhash of another image is stored, and goes if the fetch fails. */
      replacesStale: boolean
    }
  | { action: 'unset' }

/** What the caller stores once the rule has run. */
export type BlurhashOutcome =
  /** Store the blurhash, with `blurhashSource` as its source. */
  | { action: 'write'; blurhash: string; blurhashSource: string }
  /** Remove the blurhash and its source. */
  | { action: 'unset'; fetchFailed: boolean }
  /** Leave both as they are. */
  | { action: 'keep'; fetchFailed: boolean }

/**
 * Keep, fetch or remove: the decision before any request is made.
 */
export function decideBlurhash({ stored, reported, owner, locks }: BlurhashRuleInput): BlurhashDecision {
  if (locks.image || locks.blurhash) return { action: 'keep', reason: 'locked' }
  if (!owner) return { action: 'keep', reason: 'not-owner' }
  if (!reported.url) return { action: 'keep', reason: 'no-image' }

  const stale =
    Boolean(stored.blurhash) && (reported.url !== stored.url || stored.blurhashSource !== owner)
  if (stored.blurhash && !stale) return { action: 'keep', reason: 'current' }

  if (reported.blurhashUrl) {
    return { action: 'fetch', blurhashUrl: reported.blurhashUrl, source: owner, replacesStale: stale }
  }
  return stale ? { action: 'unset' } : { action: 'keep', reason: 'no-blurhash-file' }
}

/**
 * What a fetch decision leaves, given what the request returned. Anything but
 * a non-empty string is a failed fetch.
 */
export function settleBlurhash(
  decision: Extract<BlurhashDecision, { action: 'fetch' }>,
  fetched: unknown
): BlurhashOutcome {
  if (typeof fetched === 'string' && fetched) {
    return { action: 'write', blurhash: fetched, blurhashSource: decision.source }
  }
  return { action: decision.replacesStale ? 'unset' : 'keep', fetchFailed: true }
}

/**
 * The whole rule, for a caller that reads the file as it goes: decide, read
 * the file when the decision says so, settle.
 *
 * @param readBlurhash - What the blurhash file at `blurhashUrl` holds: the
 *   file a builder was handed (core/resources). It reports a failure by
 *   returning anything but a non-empty string; an error it throws is not
 *   caught here.
 */
export function resolveBlurhash(
  input: BlurhashRuleInput,
  readBlurhash: (blurhashUrl: string) => unknown
): BlurhashOutcome {
  const decision = decideBlurhash(input)
  if (decision.action === 'keep') return { action: 'keep', fetchFailed: false }
  if (decision.action === 'unset') return { action: 'unset', fetchFailed: false }
  return settleBlurhash(decision, readBlurhash(decision.blurhashUrl))
}
