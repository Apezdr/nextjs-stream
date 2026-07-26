/**
 * Pure resolution of the media-processor's content identity and delivery
 * facts into the values stored on a Flat* document.
 *
 * Movies and episodes carry these in different shapes — movies nest them under
 * `urls` (`urls.sources`, `urls.jitEligible`, `urls.jitUrl`), episodes carry
 * them flat beside `videoURL` — so each call site extracts its own shape and
 * hands the raw values here. The DECISIONS live in one place so the two paths
 * can never drift.
 *
 * Two deliberately different write disciplines:
 *
 *  - `mediaId` is SET-ONLY. It is durable content identity (derived from the
 *    library-relative folder path, persisted to a sidecar, so it survives
 *    renames and re-encodes) and it is what watch history joins on. A payload
 *    that could not resolve it sends `null`, which must never clear a value we
 *    already hold — hence it is also on FieldAbsenceCleaner's denylist.
 *
 *  - The delivery facts are MIRRORED: present → set, payload-present-but-
 *    field-absent → explicit `null`/`false`. That mirroring IS the durable
 *    off-switch: when an operator disables JIT on the owning host, the next
 *    sync clears the URL and those titles stop being served through the
 *    transcoder. FieldAbsenceCleaner is the wrong rail for it — that probes
 *    every server for a field nobody reports, whereas this is one owner
 *    revoking a capability it alone published, and there is no episode-level
 *    cleaner rail at all.
 *
 * Both are gated by their call sites on the videoURL priority check: they
 * describe the primary source that videoURL points at, so a server that does
 * not own the video must not be able to publish them.
 */

import type { MediaSourceEntry } from './types'

export interface RawDeliveryPayload {
  /** `urls.sources` (movies) or `sources` (episodes). */
  sources?: unknown
  /** `urls.jitEligible` (movies) or `jitEligible` (episodes). */
  jitEligible?: unknown
  /**
   * `urls.jitUrl` (movies) or `jitUrl` (episodes). Movies OMIT the key when
   * there is no URL; episodes send `null`. Both mean the same thing.
   */
  jitUrl?: unknown
}

export interface DeliveryFacts {
  sources: MediaSourceEntry[] | null
  primaryContainer: string | null
  jitEligible: boolean
  jitUrl: string | null
}

/**
 * Validate an incoming `mediaIdentity.id`.
 *
 * @returns the id when it is a well-formed `mid:` string, else null (which
 *          callers must treat as "leave the stored value alone", never as
 *          "clear it").
 */
export function resolveMediaId(mediaIdentity: unknown): string | null {
  const id = (mediaIdentity as { id?: unknown } | null | undefined)?.id
  if (typeof id !== 'string') return null
  return id.startsWith('mid:') ? id : null
}

/**
 * Resolve the stored delivery facts from a payload.
 *
 * @param payload   Raw values, already unwrapped from their per-media-type shape.
 * @param mapUrl    Converts a published (server-relative, percent-encoded)
 *                  source URL into a full URL — must be the SAME transform the
 *                  caller applies to `videoURL`, so a source entry's url and
 *                  videoURL can never disagree about host or encoding.
 */
export function resolveDeliveryFacts(
  payload: RawDeliveryPayload,
  mapUrl: (url: string) => string
): DeliveryFacts {
  const sources = Array.isArray(payload.sources)
    ? (payload.sources as any[]).map((source) => ({
        ...source,
        url: typeof source?.url === 'string' ? mapUrl(source.url) : source?.url,
      }))
    : null

  // Ordering is a backend hash contract (VIDEO_EXTENSIONS priority, then
  // filename) — the primary is found by its flag, never by position, and the
  // array is never re-sorted.
  const primary = sources?.find((source) => source?.isPrimary) ?? null

  const jitUrl =
    typeof payload.jitUrl === 'string' && payload.jitUrl.length > 0 ? payload.jitUrl : null

  return {
    sources,
    primaryContainer: typeof primary?.container === 'string' ? primary.container : null,
    jitEligible: payload.jitEligible === true,
    jitUrl,
  }
}
