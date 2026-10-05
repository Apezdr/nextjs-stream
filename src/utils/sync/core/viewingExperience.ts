/**
 * The `viewingExperience` flags a file server reports for a video.
 *
 * A file server measures these from the stream itself (the Dolby Vision
 * record, HDR10+ metadata, the transfer characteristics) and sends them inside
 * `mediaQuality`. The movie sync used to rebuild them from `hdr_format` /
 * `hdrFormat`, fields no file server sends, so `dolbyVision` and `hdr10Plus`
 * came out false for every movie and `standardHDR` true for every HDR one.
 * Episodes were never affected: their sync stores the reported object as is.
 *
 * A reported flag wins over the rebuilt one. A flag the server did not report
 * as a boolean keeps the rebuilt value, so a payload from an older file server
 * behaves exactly as before.
 */

import type { MediaQuality } from './types'

type ViewingExperience = NonNullable<MediaQuality['viewingExperience']>

const FLAGS = [
  'enhancedColor',
  'highDynamicRange',
  'dolbyVision',
  'hdr10Plus',
  'standardHDR',
] as const

/**
 * @param derived - The flags rebuilt from the rest of the payload
 * @param reported - The payload's `mediaQuality.viewingExperience`, if any
 * @returns `derived` with every flag the server reported as a boolean replaced
 *   by the reported value
 */
export function preferReportedViewingExperience(
  derived: ViewingExperience,
  reported: unknown
): ViewingExperience {
  if (!reported || typeof reported !== 'object') return derived

  const merged: ViewingExperience = { ...derived }
  for (const flag of FLAGS) {
    const value = (reported as Record<string, unknown>)[flag]
    if (typeof value === 'boolean') merged[flag] = value
  }
  return merged
}

/**
 * Whether two sets of flags say the same thing. The movie sync compares the
 * stored `mediaQuality` with the incoming one to decide whether to write; this
 * is the part of that comparison that covers the flags, so a changed flag (a
 * file re-encoded to Dolby Vision, a corrected `dolbyVision`) is written.
 *
 * Key order does not matter, and a missing object equals one with no flags set.
 */
export function sameViewingExperience(
  a: ViewingExperience | null | undefined,
  b: ViewingExperience | null | undefined
): boolean {
  return FLAGS.every((flag) => a?.[flag] === b?.[flag])
}
