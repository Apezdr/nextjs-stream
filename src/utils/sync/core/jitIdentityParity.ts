/**
 * Raw-file and JIT-manifest URLs for the same title must hash to the same
 * `normalizedVideoId`, or watch history forks: a web session served the raw
 * file and a TV session served the transcoder write two rows for one title,
 * the JIT row never resolves a `mid:`, and the next validation pass flags it
 * invalid.
 *
 * The media-processor prefixes `videoURL` with the file server's URL prefix
 * (`FILE_SERVER_PREFIX_PATH`) but encodes the JIT key from the library-
 * relative path, so parity holds only while that prefix is empty — true on
 * the production default server, false on a `/media`-prefixed one. Nothing
 * asserted it. This does, at the one place the catalog's identity is
 * derived, so a misconfigured server is loud in the sync log instead of
 * silent in Continue Watching.
 */

import { generateNormalizedVideoId } from '@src/utils/videoIdentity'

export interface JitIdentityParityInput {
  /** The URL the document will hold (post-write, post-lock). */
  videoURL?: string | null
  /** The transcoder manifest URL the backend emitted for the same file. */
  jitUrl?: string | null
}

export interface JitIdentityParityResult {
  /** True when both URLs are present and hash identically, or when there is no jitUrl to compare. */
  ok: boolean
  rawId: string | null
  jitId: string | null
}

/**
 * @returns whether the two URLs share one identity; `ok` is also true when
 *   there is no jitUrl (nothing to fork).
 */
export function checkJitIdentityParity({ videoURL, jitUrl }: JitIdentityParityInput): JitIdentityParityResult {
  if (!videoURL || !jitUrl) return { ok: true, rawId: null, jitId: null }
  let rawId: string | null = null
  let jitId: string | null = null
  try {
    rawId = generateNormalizedVideoId(videoURL)
    jitId = generateNormalizedVideoId(jitUrl)
  } catch {
    return { ok: true, rawId, jitId }
  }
  return { ok: rawId === jitId, rawId, jitId }
}

/** One warning per (videoURL, jitUrl) pair per process — sync runs every few minutes. */
const warned = new Set<string>()

/**
 * Log-once wrapper for the sync strategies. Returns the parity result so a
 * caller can also count or flag the document.
 */
export function warnOnJitIdentityFork(
  input: JitIdentityParityInput & { label: string },
  warn: (fields: Record<string, unknown>, message: string) => void
): JitIdentityParityResult {
  const result = checkJitIdentityParity(input)
  if (result.ok) return result
  const key = `${input.videoURL}|${input.jitUrl}`
  if (!warned.has(key)) {
    warned.add(key)
    warn(
      {
        label: input.label,
        videoURL: input.videoURL,
        jitUrl: input.jitUrl,
        rawId: result.rawId,
        jitId: result.jitId,
      },
      'JIT identity fork: raw videoURL and jitUrl hash to different normalizedVideoIds — watch history ' +
        'written through the transcoder will not join this document (check FILE_SERVER_PREFIX_PATH vs JIT_SOURCE_PREFIX)'
    )
  }
  return result
}

/** Test hook. */
export function _resetJitIdentityParityWarningsForTests(): void {
  warned.clear()
}
