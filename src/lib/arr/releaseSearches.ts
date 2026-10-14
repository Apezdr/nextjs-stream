// src/lib/arr/releaseSearches.ts
// Interactive searches as jobs. A search waits for the service's slowest
// indexer, which can outlast Cloudflare's 100 s limit on a response, so
// starting one answers at once and the dialog polls. The results stay here:
// a release's guid can carry an indexer's API key, so the browser gets an id
// per release that a grab swaps back. The app runs as one process
// (node server.js), so memory is the right home; a restart means searching again.
import 'server-only'
import { randomUUID } from 'node:crypto'
import { createLogger } from '@src/lib/logger'
import { ArrError } from './http'
import type { ReleaseSummary, ReleaseTarget, StoredRelease } from './releases'
import { ArrRequestError, REASON_TEXT, SERVICE_NAMES } from './titles'
import type { ArrFailureReason, ArrService, TitleRef } from './types'

const log = createLogger('ArrReleaseSearch')

/** The service drops its results 30 min after the search; stop offering grabs a little sooner. */
export const RESULTS_TTL_MS = 25 * 60_000
/** Every search asks every indexer, so per admin: two at a time, 30 an hour. */
export const MAX_RUNNING_PER_USER = 2
export const MAX_STARTS_PER_HOUR = 30
const HOUR_MS = 60 * 60_000
const MAX_KEPT = 50

export interface ReleaseSearch {
  id: string
  ownerId: string
  service: ArrService
  title: TitleRef
  target: ReleaseTarget
  startedAt: number
  finishedAt: number | null
  state: 'searching' | 'done' | 'failed'
  releases: StoredRelease[]
  /** Indexes into `releases` grabbed from this search. */
  grabbed: Set<number>
  failure: { reason: ArrFailureReason; message: string } | null
}

/** What the browser polls: each release by its index in the search, never its guid. */
export interface ReleaseSearchView {
  id: string
  state: ReleaseSearch['state']
  service: ArrService
  target: { kind: 'movie' } | { kind: 'season'; seasonNumber: number } | { kind: 'episode'; episodeId: number }
  startedAt: string
  finishedAt: string | null
  /** When grabs stop working, once the search has finished. */
  expiresAt: string | null
  releases: Array<ReleaseSummary & { id: string; grabbed: boolean }>
  failure: ReleaseSearch['failure']
}

const searches = new Map<string, ReleaseSearch>()
const startsByOwner = new Map<string, number[]>()

const sameSearch = (search: ReleaseSearch, service: ArrService, target: ReleaseTarget) =>
  search.service === service && JSON.stringify(search.target) === JSON.stringify(target)

export const isExpired = (search: ReleaseSearch, now = Date.now()) =>
  search.finishedAt !== null && now - search.finishedAt > RESULTS_TTL_MS

function prune(now: number) {
  for (const [id, search] of searches) if (isExpired(search, now)) searches.delete(id)
  if (searches.size > MAX_KEPT) {
    const finished = [...searches.values()]
      .filter((search) => search.state !== 'searching')
      .sort((a, b) => a.startedAt - b.startedAt)
    for (const search of finished.slice(0, searches.size - MAX_KEPT)) searches.delete(search.id)
  }
  for (const [ownerId, starts] of startsByOwner) {
    const recent = starts.filter((at) => now - at < HOUR_MS)
    if (recent.length > 0) startsByOwner.set(ownerId, recent)
    else startsByOwner.delete(ownerId)
  }
}

function failureOf(error: unknown, service: ArrService): NonNullable<ReleaseSearch['failure']> {
  const name = SERVICE_NAMES[service]
  if (!(error instanceof ArrError)) return { reason: 'invalid_response', message: `${name} couldn’t search.` }
  if (error.reason === 'timeout') {
    return { reason: 'timeout', message: `${name}’s indexers took too long to answer. Try again.` }
  }
  if (error.reason === 'rejected' && error.messages.length > 0) {
    return { reason: 'rejected', message: `${name}: ${error.messages.join(' ')}` }
  }
  return { reason: error.reason, message: `${name} couldn’t search: ${REASON_TEXT[error.reason]}.` }
}

export interface StartSearch {
  ownerId: string
  service: ArrService
  title: TitleRef
  target: ReleaseTarget
  /** The service call; runs in the background. */
  run: () => Promise<StoredRelease[]>
}

/**
 * Starts a search, or joins the same one already running (a second click, a
 * second tab). Throws a 429 when the admin has too many running or has used
 * the hour's searches.
 */
export function startReleaseSearch({ ownerId, service, title, target, run }: StartSearch): ReleaseSearch {
  const now = Date.now()
  prune(now)
  for (const search of searches.values()) {
    if (search.state === 'searching' && sameSearch(search, service, target)) return search
  }
  const running = [...searches.values()].filter((search) => search.ownerId === ownerId && search.state === 'searching')
  if (running.length >= MAX_RUNNING_PER_USER) {
    throw new ArrRequestError(429, 'busy', 'Two searches are already running. Wait for one to finish.')
  }
  const starts = startsByOwner.get(ownerId) ?? []
  if (starts.length >= MAX_STARTS_PER_HOUR) {
    throw new ArrRequestError(
      429,
      'too_many_searches',
      `That’s ${MAX_STARTS_PER_HOUR} searches this hour, and each one asks every indexer. Try again later.`
    )
  }
  startsByOwner.set(ownerId, [...starts, now])

  const search: ReleaseSearch = {
    id: randomUUID(),
    ownerId,
    service,
    title,
    target,
    startedAt: now,
    finishedAt: null,
    state: 'searching',
    releases: [],
    grabbed: new Set(),
    failure: null,
  }
  searches.set(search.id, search)
  run().then(
    (releases) => {
      search.releases = releases
      search.state = 'done'
      search.finishedAt = Date.now()
    },
    (error) => {
      search.failure = failureOf(error, service)
      search.state = 'failed'
      search.finishedAt = Date.now()
      log.warn({ service, reason: search.failure.reason, target: target.kind }, 'Interactive search failed')
    }
  )
  return search
}

/** A search by id; null once unknown or expired. */
export function getReleaseSearch(id: string): ReleaseSearch | null {
  prune(Date.now())
  return searches.get(id) ?? null
}

/** Forgets a search whose results the service no longer has. */
export function forgetReleaseSearch(id: string) {
  searches.delete(id)
}

export function viewOf(search: ReleaseSearch): ReleaseSearchView {
  const { target } = search
  return {
    id: search.id,
    state: search.state,
    service: search.service,
    target:
      target.kind === 'movie'
        ? { kind: 'movie' }
        : target.kind === 'season'
          ? { kind: 'season', seasonNumber: target.seasonNumber }
          : { kind: 'episode', episodeId: target.episodeId },
    startedAt: new Date(search.startedAt).toISOString(),
    finishedAt: search.finishedAt === null ? null : new Date(search.finishedAt).toISOString(),
    expiresAt:
      search.state === 'done' && search.finishedAt !== null
        ? new Date(search.finishedAt + RESULTS_TTL_MS).toISOString()
        : null,
    releases: search.releases.map((release, index) => ({
      id: String(index),
      ...release.summary,
      grabbed: search.grabbed.has(index),
    })),
    failure: search.failure,
  }
}
