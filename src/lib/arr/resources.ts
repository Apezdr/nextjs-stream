// src/lib/arr/resources.ts
// Mapping helpers both services share: Radarr and Sonarr answer quality
// profiles, root folders and queue records in the same v3 shape. Pure.
import { parseTimeSpan } from '@src/lib/mediaQueues/normalize'
import type { ArrDownload, QualityProfile, RootFolder } from './types'

export type ArrRecord = Record<string, unknown>

export const isRecord = (value: unknown): value is ArrRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

export const asRecords = (value: unknown): ArrRecord[] => (Array.isArray(value) ? value.filter(isRecord) : [])

export const finiteNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export function toQualityProfiles(raw: unknown): QualityProfile[] {
  return asRecords(raw)
    .filter((profile) => typeof profile.id === 'number' && typeof profile.name === 'string')
    .map((profile) => ({ id: profile.id as number, name: profile.name as string }))
}

export function toRootFolders(raw: unknown): RootFolder[] {
  return asRecords(raw)
    .filter((folder) => typeof folder.path === 'string' && folder.path !== '')
    .map((folder) => ({
      path: folder.path as string,
      accessible: folder.accessible !== false,
      freeSpaceBytes: finiteNumber(folder.freeSpace),
    }))
}

/** The quality profile most titles already use: the likeliest choice for the next one. */
export function mostUsedProfileId(titles: unknown, profiles: QualityProfile[]): number | null {
  const known = new Set(profiles.map((profile) => profile.id))
  const counts = new Map<number, number>()
  for (const title of asRecords(titles)) {
    const id = title.qualityProfileId
    if (typeof id === 'number' && known.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  let best: number | null = null
  let bestCount = 0
  for (const [id, count] of counts) {
    if (count > bestCount) {
      best = id
      bestCount = count
    }
  }
  return best
}

/**
 * What is downloading for one title, from its queue records. Progress is over
 * the bytes of every record (a season can be several downloads) and is null
 * while any record's size is unknown; the time left is the slowest record's.
 */
export function summarizeDownload(records: ArrRecord[]): ArrDownload | null {
  if (records.length === 0) return null
  let size = 0
  let left = 0
  let sized = true
  let timeLeftSeconds: number | null = null
  for (const record of records) {
    const recordSize = finiteNumber(record.size)
    const recordLeft = finiteNumber(record.sizeleft)
    if (recordSize === null || recordLeft === null || recordSize <= 0) {
      sized = false
    } else {
      size += recordSize
      left += Math.min(Math.max(recordLeft, 0), recordSize)
    }
    const seconds = parseTimeSpan(record.timeleft)
    if (seconds !== null) timeLeftSeconds = Math.max(timeLeftSeconds ?? 0, seconds)
  }
  return {
    progress: sized && size > 0 ? Math.round(((size - left) / size) * 100) : null,
    timeLeftSeconds,
    records: records.length,
  }
}

/** A queue page's records, summarized per title (Radarr's movieId, Sonarr's seriesId). */
export function downloadsByTitle(page: unknown, idField: 'movieId' | 'seriesId'): Map<number, ArrDownload> {
  const grouped = new Map<number, ArrRecord[]>()
  for (const record of asRecords(isRecord(page) ? page.records : null)) {
    const id = record[idField]
    if (typeof id !== 'number') continue
    const group = grouped.get(id)
    if (group) group.push(record)
    else grouped.set(id, [record])
  }
  const downloads = new Map<number, ArrDownload>()
  for (const [id, records] of grouped) {
    const summary = summarizeDownload(records)
    if (summary) downloads.set(id, summary)
  }
  return downloads
}

/** Queue records read for the status chips; a title queued past this many shows no progress. */
export const QUEUE_PAGE_SIZE = 250
