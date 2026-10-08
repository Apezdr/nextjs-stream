/**
 * What each row of the settings panel says, and in what order.
 *
 * Pure and framework-free, like renditionTraits.js, so the wording and the
 * ordering can be table-tested without rendering a player. Every string here
 * describes what THIS browser will play (dynamic range from the rung's own
 * VIDEO-RANGE, never a source format like Dolby Vision): the media info page,
 * not the watch page, is where a title's HDR format is listed.
 */

import { traitTags } from './renditionTraits'

/**
 * "4K"/"8K" for UHD, otherwise the size the player computed ("1080p"). The
 * player already reports a scope film's 1920×800 rung as 1080p, so no height
 * remapping is needed here.
 */
export function qualityName(label) {
  const size = parseInt(label, 10)
  if (Number.isNaN(size)) return String(label ?? '')
  if (size >= 4320) return '8K'
  if (size >= 2160) return '4K'
  return `${size}p`
}

const STANDARD_SIZES = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144]

/**
 * A picture's nominal size from its dimensions, as the player computes it for
 * its own renditions: a scope film's 1920×800 is 1080p, by its width.
 */
export function sizeFromDimensions(width, height) {
  if (width && height && width > height && width * 9 > height * 16) {
    const widescreen = Math.round((width * 9) / 16)
    if (STANDARD_SIZES.includes(widescreen)) return widescreen
  }
  const known = [width, height].filter((v) => v > 0)
  return known.length ? Math.min(...known) : 0
}

/**
 * What the TV is playing, for the casting overlay: "1080p · HDR · 7.8 Mbps".
 * `nowPlaying` is readCastNowPlaying()'s shape; null when the receiver hasn't
 * said, so the overlay shows nothing rather than a guess.
 */
export function castNowPlayingLabel(nowPlaying) {
  if (!nowPlaying?.width || !nowPlaying?.height) return null
  const size = sizeFromDimensions(nowPlaying.width, nowPlaying.height)
  return [qualityName(`${size}p`), nowPlaying.hdr && 'HDR', formatMbps(nowPlaying.bandwidth)]
    .filter(Boolean)
    .join(' · ')
}

export function formatMbps(bitrate) {
  if (!bitrate) return null
  const mbps = bitrate / 1_000_000
  return `${Number.isInteger(mbps) ? mbps : mbps.toFixed(1)} Mbps`
}

/**
 * Quality rungs as rows, best first: size, then HDR before SDR, then bitrate.
 *
 * @param {Array<{value: string, label: unknown}>} options - useQualityOptions().options;
 *   every rung option's value is its rendition's id. Auto is skipped.
 * @param {Array<object>} renditions - the store's videoRenditionList
 * @param {Map} traits - from useRenditionTraits()
 */
export function qualityRows(options, renditions, traits) {
  const rungs = []
  for (const option of options ?? []) {
    if (option.value === 'auto') continue
    const rendition = renditions?.find((r) => r.id === option.value)
    const tags = traitTags(traits, rendition)
    const size = parseInt(String(option.label), 10)
    rungs.push({
      value: option.value,
      title: qualityName(option.label),
      size: Number.isNaN(size) ? 0 : size,
      range: tags.find((tag) => tag !== 'Original') ?? null,
      original: tags.includes('Original'),
      bitrate: rendition?.bitrate ?? 0,
      highBitrate: false,
    })
  }

  // The hi-fi rung carries no manifest marker, but it is always an extra,
  // higher-bitrate copy of a rung the ladder already has at that size and
  // range (Blade Runner 2049: 1080p SDR at 8.9 and 22.1 Mbps). Original is the
  // source itself, never a copy.
  const groups = new Map()
  for (const rung of rungs) {
    if (rung.original) continue
    const key = `${rung.size}|${rung.range}`
    groups.set(key, [...(groups.get(key) ?? []), rung])
  }
  for (const group of groups.values()) {
    if (group.length > 1) group.reduce((a, b) => (b.bitrate > a.bitrate ? b : a)).highBitrate = true
  }

  rungs.sort(
    (a, b) =>
      b.size - a.size ||
      Number(Boolean(b.range)) - Number(Boolean(a.range)) ||
      b.bitrate - a.bitrate
  )
  return rungs.map(({ value, title, range, original, highBitrate, bitrate }) => ({
    value,
    title,
    range,
    detail: [original && 'Original', highBitrate && 'High bitrate', formatMbps(bitrate)]
      .filter(Boolean)
      .join(' · '),
  }))
}

/** "1080p HDR": the active rung's name for summaries, or '' before one plays. */
export function activeQualityName(options, activeRendition, traits) {
  if (!activeRendition) return ''
  const option = options?.find((o) => o.value === activeRendition.id)
  const name = option ? qualityName(option.label) : ''
  const range = traitTags(traits, activeRendition).find((tag) => tag !== 'Original')
  return [name, range].filter(Boolean).join(' ')
}

/**
 * Capped at 1.5×: a rung the transcoder has not cached yet has to be encoded
 * faster than it plays, and at 2× a cold 4K HEVC encode on a busy disk nears
 * the 27 s stall watchdog. Slower rates cost the transcoder nothing.
 */
export const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5]

export function rateLabel(rate) {
  return rate === 1 ? 'Normal' : `${rate}×`
}

// Auto-generated caption rows carry the " - Auto Generated" suffix from the
// processor's caption-stubs convention. Match against the label rather than
// any track-level metadata since the menu option doesn't expose our flag.
const AUTO_LABEL_RE = / - Auto Generated$/i

/** Off, then auto-generated, then human captions, stable within each group. */
export function sortCaptionOptions(options) {
  const isAuto = (o) => AUTO_LABEL_RE.test(String(o.label))
  return [
    ...options.filter((o) => o.value === 'off'),
    ...options.filter((o) => o.value !== 'off' && isAuto(o)),
    ...options.filter((o) => o.value !== 'off' && !isAuto(o)),
  ]
}

/**
 * A caption track's row: its name without the auto suffix, and a detail line
 * for auto-generated tracks and generation progress.
 *
 * @param {string} label - the track label
 * @param {{status?: string, progressPct?: number}} [progress] - from useAutoCaptionsProgress
 */
export function captionRow(label, progress) {
  const auto = AUTO_LABEL_RE.test(label)
  const generating =
    progress?.status === 'running'
      ? typeof progress.progressPct === 'number'
        ? `Generating… ${Math.round(progress.progressPct * 100)}%`
        : 'Generating…'
      : null
  return {
    title: label.replace(AUTO_LABEL_RE, ''),
    detail: [auto && 'Auto-generated', generating].filter(Boolean).join(' · ') || null,
    generating: Boolean(generating),
  }
}

/**
 * The English name of an audio track's language, for a detail line under its
 * endonym ("Italiano" over "Italian"), or null when it would only repeat it.
 */
export function languageName(code, label) {
  if (!code) return null
  let name
  try {
    name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code)
  } catch {
    return null
  }
  if (!name || name === code || name.toLowerCase() === String(label ?? '').toLowerCase())
    return null
  return name
}
