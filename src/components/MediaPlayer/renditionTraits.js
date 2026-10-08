/**
 * What the quality menu can say about a rung beyond its size and bitrate.
 *
 * The player store's rendition carries only width, height, codec and bitrate,
 * so these facts come from the hls.js level it was made from:
 *   - dynamic range, from the master's per-variant VIDEO-RANGE. The transcoder
 *     emits SDR for every tonemapped rung and PQ for HDR10 passthrough; HLG is
 *     handled in case a direct-play source ever carries it.
 *   - "Original", from STABLE-VARIANT-ID="original", which the transcoder puts
 *     on the direct-play rung (the source video copied, never re-encoded).
 *
 * Dolby Vision is deliberately not a trait. It only ever rides the direct rung
 * as SUPPLEMENTAL-CODECS, which hls.js ignores and plays the HDR10 base of, so
 * in the browser that rung is HDR, not Dolby Vision.
 *
 * Pure and framework-free, like decodeHealth.js, so it can be table-tested.
 */

/**
 * The key a store rendition and its hls.js level share. The video.js adapter
 * builds each rendition from `level.width`, `level.height`, `level.videoCodec`
 * and `level.bitrate`; it keys levels on the URL too, which the store drops. A
 * collision needs two levels that differ only by URL, i.e. the same video,
 * which have the same traits anyway.
 */
export function renditionKey({ width, height, codec, bitrate } = {}) {
  return `${width}x${height}|${codec}|${bitrate}`
}

const RANGE_LABELS = { PQ: 'HDR', HLG: 'HLG' }

/** @returns {Map<string, { range: string | null, original: boolean }>} */
export function traitsFromLevels(levels) {
  const traits = new Map()
  for (const level of levels ?? []) {
    const attrs = level?.attrs ?? {}
    traits.set(
      renditionKey({
        width: level.width,
        height: level.height,
        codec: level.videoCodec,
        bitrate: level.bitrate,
      }),
      {
        range: RANGE_LABELS[attrs['VIDEO-RANGE']] ?? null,
        original: attrs['STABLE-VARIANT-ID'] === 'original',
      }
    )
  }
  return traits
}

/**
 * The key a store audio track and its hls.js track share: the video.js adapter
 * copies hls.js's `lang` and `name` into the track's `language` and `label`.
 */
export function audioTrackKey({ language, label } = {}) {
  return `${language ?? ''}|${label ?? ''}`
}

/** Keys of the hls.js audio tracks the master marks DEFAULT=YES. */
export function audioDefaultsFromTracks(tracks) {
  const defaults = new Set()
  for (const track of tracks ?? []) {
    if (track?.default) defaults.add(audioTrackKey({ language: track.lang, label: track.name }))
  }
  return defaults
}

/** The short tags to show for a rendition, in display order. */
export function traitTags(traits, rendition) {
  const t = rendition ? traits?.get(renditionKey(rendition)) : undefined
  if (!t) return []
  return [t.original && 'Original', t.range].filter(Boolean)
}
