/**
 * Credits as they are shown: a stored credits document (or, for an episode,
 * its show's and its own) turned into the list of entries a client renders
 * (CREDITS_SIDECAR.md, sections 4, 6 and 7).
 *
 * Each entry's `assetIds` become the `assets` they name, from the file the
 * entry came from, and each entry gets a `scope`. An episode inherits its
 * show's entries: silence never removes one, `suppress` hides one, an entry
 * with `replaces` takes the place of the ones it names, and any other entry
 * is added after the inherited ones (both are kept when two ids collide).
 *
 * A stored document is checked again before it is shown (an admin edit or an
 * older build could have stored one that is not valid now); one that fails
 * is shown as nothing, never in part.
 *
 * Pure: the API, the pages and the tests use it alike.
 */

import {
  validateCreditsDocument,
  type CreditsAsset,
  type CreditsDocument,
  type CreditsEntry,
  type CreditsScope,
} from './validate'

export type CreditsEntryScope = 'title' | 'show' | 'episode' | 'library'

export interface ResolvedCreditsEntry extends Omit<CreditsEntry, 'assetIds' | 'replaces'> {
  scope: CreditsEntryScope
  assets: CreditsAsset[]
}

export interface ResolvedCredits {
  schemaVersion: 1
  entries: ResolvedCreditsEntry[]
}

/** A movie's or a show's credits, ready to show; null when there are none. */
export function resolveTitleCredits(stored: unknown): ResolvedCredits | null {
  const document = readStored(stored, 'title')
  if (!document) return null
  return finish(document.entries.map((entry) => resolveEntry(entry, document, 'title')))
}

/**
 * An episode's credits, ready to show: its show's, with its own file's
 * suppressions, replacements and additions applied. Null when there are none.
 *
 * @param showCredits - The show's stored `credits`
 * @param episodeCredits - The episode's stored `credits` (its own file only)
 */
export function resolveEpisodeCredits(showCredits: unknown, episodeCredits: unknown): ResolvedCredits | null {
  const show = readStored(showCredits, 'title')
  const episode = readStored(episodeCredits, 'episode')
  if (!show && !episode) return null

  let entries: ResolvedCreditsEntry[] = show ? show.entries.map((entry) => resolveEntry(entry, show, 'show')) : []
  if (!episode) return finish(entries)

  const suppressed = new Set(episode.suppress ?? [])
  entries = entries.filter((entry) => !suppressed.has(entry.id))

  for (const own of episode.entries) {
    const resolved = resolveEntry(own, episode, 'episode')
    const replaced = new Set(own.replaces ?? [])
    const at = replaced.size > 0 ? entries.findIndex((entry) => entry.scope === 'show' && replaced.has(entry.id)) : -1
    if (at === -1) {
      entries.push(resolved)
      continue
    }
    entries = entries.filter((entry, index) => index === at || !(entry.scope === 'show' && replaced.has(entry.id)))
    entries.splice(at, 1, resolved)
  }
  return finish(entries)
}

/**
 * The library's credits, ready to show: each server's library file (in the
 * order given: server priority), a file two servers share shown once. Null
 * when there are none.
 *
 * @param stored - Each server's stored library credits: `credits` and `creditsHash`
 */
export function resolveLibraryCredits(stored: readonly { credits?: unknown; creditsHash?: unknown }[]): ResolvedCredits | null {
  const seen = new Set<unknown>()
  const entries: ResolvedCreditsEntry[] = []
  for (const record of stored) {
    if (record.creditsHash != null) {
      if (seen.has(record.creditsHash)) continue
      seen.add(record.creditsHash)
    }
    const document = readStored(record.credits, 'library')
    if (document) entries.push(...document.entries.map((entry) => resolveEntry(entry, document, 'library')))
  }
  return finish(entries)
}

function readStored(stored: unknown, scope: CreditsScope): CreditsDocument | null {
  if (stored === null || stored === undefined) return null
  const validation = validateCreditsDocument(stored, scope)
  return validation.ok ? validation.document : null
}

function resolveEntry(entry: CreditsEntry, document: CreditsDocument, scope: CreditsEntryScope): ResolvedCreditsEntry {
  const { assetIds, replaces: _replaces, ...rest } = entry
  const byId = new Map(document.assets.map((asset) => [asset.id, asset]))
  return {
    ...rest,
    scope,
    assets: assetIds.map((id) => byId.get(id)).filter((asset): asset is CreditsAsset => Boolean(asset)),
  }
}

function finish(entries: ResolvedCreditsEntry[]): ResolvedCredits | null {
  return entries.length > 0 ? { schemaVersion: 1, entries } : null
}
