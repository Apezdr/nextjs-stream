/**
 * A document's display title and the server it is credited to.
 *
 * Two titles: `originalTitle` is the folder name. It keys the database, the
 * availability map and every request to a file server, and nothing here ever
 * changes it. `title` is for display only, and this rule decides it once per
 * pass, from the metadata the document ends up with (core/metadataLock):
 *
 *  1. The metadata's title, trimmed, when it has one. A stub written after a
 *     failed first fetch (`hasExternalMetadata: false`) carries the folder
 *     name, which is not a metadata title.
 *  2. Otherwise the folder name.
 *
 * `titleSource` goes with it:
 *
 *  1. The metadata's source, when the title is the metadata's.
 *  2. Otherwise the highest-priority server among those that have the folder
 *     this run (core/ownership, which fails closed: a server that does not
 *     have the folder is never credited). Another server's pass leaves it.
 *
 * The folder name is the same on every server, so before this rule the
 * source of a title with no metadata anywhere was whichever server had
 * created the document, and the title itself depended on which strategy last
 * had something to change.
 *
 * An admin-locked title keeps its source here; the title itself is dropped
 * at the write chokepoint (BaseRepository.computeDiff).
 *
 * Movies follow this rule. The show builder does not: it takes a show's title
 * from a usable fresh copy's `name` and leaves `titleSource` as the document
 * was created.
 *
 * Pure: the caller writes what the outcome says.
 */

import { getServersReportingTitle, isHighestPriorityAmongServers } from './ownership'

export interface TitleRuleInput {
  /** The folder name. */
  originalTitle: string
  /** The metadata the document ends this pass with, and its source (effectiveMetadata). */
  metadata: { metadata?: unknown; metadataSource?: string }
  /** Which servers report which fields, for every server that answered this run. */
  fieldAvailability: unknown
  mediaType: 'movies' | 'tv'
  /** The server being synced. */
  serverConfig: { id: string; priority: number }
  /** The stored document; null or undefined for a new one. */
  stored: { title?: string; titleSource?: string } | null | undefined
  /** Admin locks (`lockedFields`). */
  locks: { title: boolean }
}

export interface TitleOutcome {
  /** The display title. */
  title: string
  /** The server it is credited to; undefined when this pass does not say. */
  titleSource: string | undefined
  /** Write `title`: the document is new, or holds another title. */
  writeTitle: boolean
  /** Write `titleSource`: there is one, the title is not locked, and the document holds another. */
  writeTitleSource: boolean
}

/** The metadata's own title, or '' when it has none. */
function metadataTitleOf(metadata: unknown): string {
  const copy = metadata as { title?: unknown; hasExternalMetadata?: unknown } | null | undefined
  return typeof copy?.title === 'string' && copy.hasExternalMetadata !== false ? copy.title.trim() : ''
}

export function resolveTitle({
  originalTitle,
  metadata,
  fieldAvailability,
  mediaType,
  serverConfig,
  stored,
  locks,
}: TitleRuleInput): TitleOutcome {
  const metadataTitle = metadataTitleOf(metadata.metadata)
  const title = metadataTitle || originalTitle
  const titleSource = metadataTitle
    ? metadata.metadataSource
    : isHighestPriorityAmongServers(getServersReportingTitle(fieldAvailability, mediaType, originalTitle), serverConfig)
      ? serverConfig.id
      : undefined

  return {
    title,
    titleSource,
    writeTitle: !stored || stored.title !== title,
    writeTitleSource: Boolean(titleSource) && !locks.title && stored?.titleSource !== titleSource,
  }
}
