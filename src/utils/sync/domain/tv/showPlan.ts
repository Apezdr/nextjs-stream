/**
 * A show's builder: the show's write plan from the stored show and this
 * server's payload (TVShowSyncService writes it).
 *
 * Pure: it does no I/O. The files it reads (the show's metadata file, the
 * poster's and backdrop's blurhashes) it reads from the resources the
 * prefetch step fetched for it (core/resources). A file it was not handed
 * reads as a failed fetch and is named in its plan's `needs`; the service
 * fetches those and calls it again (infrastructure/fileSystem/prefetch).
 */

import type { Availability, PlanOutcome, ResourceRequest, RunConfig, TVShowEntity } from '../../core/types'
import { fileServerUrl } from '../../infrastructure/fileSystem/urls'
import { isTopLevelFieldLocked } from '../../core/locks'
import { Resources } from '../../core/resources'
import {
  isCurrentServerHighestPriorityForReportedField,
  serverOutranks,
} from '@src/utils/sync/core/ownership'
import { resolveBlurhash } from '@src/utils/sync/core/imageAndBlurhash'
import { effectiveMetadata } from '@src/utils/sync/core/metadataLock'
import { resolveTitle } from '@src/utils/sync/core/title'
import { draftWritePlan, emptyWritePlan } from '../../core/writePlan'
import { seedDiscovery, applyFirstSeen } from '../../core/discovery'
import { resolveMediaId } from '../../core/deliveryFacts'
import { readBlurhashFile } from './blurhashFile'

/**
 * What planTVShow reads of the run, besides the availability: not forceSync
 * (the gate is checked before it runs), not the cleanup config (field-absence
 * cleanup plans apart).
 */
export type TVShowPlanRun = Pick<RunConfig, 'serverConfig' | 'allEnabledServersProbed'>

/** planTVShow's input. */
export interface TVShowPlanInput {
  /** The show's folder name (originalTitle): the payload, availability and database key. */
  showTitle: string
  /** This server's payload for the show (`fileServer.tv[showTitle]`). */
  fileData: any
  run: TVShowPlanRun
  availability: Availability
  /** The show as stored before this pass, or null for a new one. */
  existing: TVShowEntity | null
}

/**
 * The show's write plan: the stored show with the incoming file-server data
 * merged on top, respecting per-field server priority.
 *
 * - If the document already exists, start from it (preserving all fields).
 * - For each field group (metadata, poster, backdrop, logo), only overwrite
 *   if the current server has highest priority for that field.
 * - Structural fields (type, createdAt) are healed if missing.
 *
 * The plan's removals are the fields whose data is gone, not changed. It is
 * incomplete, and its deferrals name why, when the metadata fetch failed,
 * the stored season count was kept above this run's because a server did
 * not answer, or a blurhash the file server publishes could not be fetched.
 * The plan always writes the show: it stamps lastSynced. Its `needs` are the
 * files it read and was not handed (core/resources).
 */
export function planTVShow(
  { showTitle, fileData, run, availability, existing }: TVShowPlanInput,
  resources: Resources = new Resources()
): PlanOutcome<TVShowEntity> {
  const now = new Date()
  // What was held back, and why (the plan's incomplete and deferrals).
  const plan = emptyWritePlan<TVShowEntity>()
  const holdBack = (reason: string) => {
    plan.incomplete = true
    plan.deferrals.push(reason)
  }
  // Fields to remove from the stored show: their data is gone, not changed.
  const unset: string[] = []

  // The show this pass wants stored: the existing doc (preserving ALL
  // fields) or a new one. Either way the pass stamps lastSynced, so the
  // plan writes the show (wroteDocument).
  const entity: TVShowEntity = existing
    ? { ...existing, lastSynced: now }
    : {
        title: showTitle,
        originalTitle: showTitle,
        type: 'tvShow',
        createdAt: now,
        lastSynced: now,
        titleSource: run.serverConfig.id,
        originalTitleSource: run.serverConfig.id,
      }
  const planned = (): PlanOutcome<TVShowEntity> => ({
    plan: { ...plan, ...draftWritePlan(existing, entity, unset), needs: resources.needs },
    wroteDocument: true,
  })

  // Heal structural fields that must always be present
  if (!entity.type) entity.type = 'tvShow'
  if (!entity.createdAt) entity.createdAt = now
  if (!entity.originalTitle) entity.originalTitle = showTitle
  // Library-add date: seeded once, never moved later (core/discovery.ts).
  // The show's own date is for detail pages; "Recently Added" ranks a show by
  // its newest EPISODE, so a new season of an old show still surfaces.
  seedDiscovery(entity, existing, run.serverConfig.id, now)

  if (!fileData) return planned()
  const locked = (field: string) => isTopLevelFieldLocked((existing as any)?.lockedFields, field)

  // --- Metadata (priority-gated) ---
  // Tracks whether we have a CONFIRMED fresh metadata source. Default true so
  // that "nothing to fetch" / "not metadata-authoritative" never blocks the
  // show's gate; only an attempted-but-failed fetch flips it false.
  let metadataFetchSucceeded = true
  // The show's metadata — and with it the show's identity below — belongs to
  // the highest-priority server that HAS a metadata file for it. The legacy
  // check also passed a higher-priority server that has none; it had nothing
  // to write as metadata, but it did write its own identity, and when two
  // servers' ids differed the show's mediaId changed twice per run.
  const canUpdateMetadata = isCurrentServerHighestPriorityForReportedField(
    availability.fieldAvailability, 'tv', showTitle, 'metadata', run.serverConfig
  )

  if (canUpdateMetadata && fileData.metadata) {
    // fileData.metadata is a URL path to the metadata JSON — fetch actual data
    let showMetadata: any = null

    if (typeof fileData.metadata === 'string') {
      // URL path — fetch real metadata from the file server. Mark the gate as
      // not-yet-confirmed: only a usable response flips it back true below, so
      // a failed/stale fetch leaves the gate unstamped for retry next sync.
      metadataFetchSucceeded = false
      // Read by the prefetch step through fetchMetadataMultiServer. A fetch
      // that failed reads as null — preserve existing metadata.
      const metadataFile: ResourceRequest = { kind: 'metadata', serverId: run.serverConfig.id, path: fileData.metadata }
      showMetadata = resources.data(metadataFile)
    } else if (typeof fileData.metadata === 'object') {
      // Already inline (rare, but handle gracefully) — a fresh source
      showMetadata = fileData.metadata
    }

    const fetchedUsable = Boolean(showMetadata && typeof showMetadata === 'object' && !showMetadata.error)
    if (fetchedUsable) {
      metadataFetchSucceeded = true
    }
    // Metadata an admin locked stays as stored, and so do the fields taken
    // from it: the fetched copy is dropped on the way to the database
    // (core/metadataLock).
    const metadata = effectiveMetadata<any>({
      stored: existing ? { metadata: existing.metadata, metadataSource: existing.metadataSource } : null,
      incoming: fetchedUsable ? { metadata: showMetadata, metadataSource: run.serverConfig.id } : null,
      locked: locked('metadata'),
    })
    if (metadata.action === 'write') {
      const fresh = metadata.metadata
      entity.metadata = fresh
      entity.metadataSource = metadata.metadataSource

      // Extract queryable fields from metadata (matching legacy document shape)
      if (fresh.first_air_date) entity.firstAirDate = new Date(fresh.first_air_date)
      if (fresh.last_air_date) entity.lastAirDate = new Date(fresh.last_air_date)
      if (fresh.status) entity.status = fresh.status
      if (fresh.number_of_seasons != null) entity.numberOfSeasons = fresh.number_of_seasons
      if (fresh.vote_average != null) entity.rating = fresh.vote_average
      if (fresh.overview) entity.overview = fresh.overview
      if (fresh.genres) entity.genres = fresh.genres
      if (fresh.networks) entity.networks = fresh.networks
    }
  }
  // A failed or stale metadata fetch leaves the gate open for the next run
  // to retry.
  if (!metadataFetchSucceeded) holdBack('metadata')

  // --- Display title (core/title) ---
  // Derived on every pass from the metadata the show ends this pass with
  // (`entity.metadata` is the fresh copy written above, or what is stored),
  // so it never depends on which server last fetched. The source goes with
  // it; a locked title keeps its source, and the title itself is dropped at
  // the write chokepoint.
  const titleRule = resolveTitle({
    originalTitle: showTitle,
    metadata: { metadata: entity.metadata, metadataSource: entity.metadataSource },
    fieldAvailability: availability.fieldAvailability,
    mediaType: 'tv',
    serverConfig: run.serverConfig,
    stored: existing,
    locks: { title: locked('title') },
  })
  if (titleRule.writeTitle) entity.title = titleRule.title
  if (titleRule.writeTitleSource) entity.titleSource = titleRule.titleSource

  // --- Show identity (follows metadata priority) ---
  // A show has no video of its own, so the metadata owner — the show-level
  // ownership signal this builder already has — publishes it. mediaId is
  // SET-ONLY: a payload that cannot resolve it sends null, which must never
  // clear what we hold.
  if (canUpdateMetadata) {
    const incomingShowMediaId = resolveMediaId(fileData.mediaIdentity)
    if (incomingShowMediaId) entity.mediaId = incomingShowMediaId
  }

  // --- Library-add date (earlier-wins, core/discovery.ts) ---
  // The backend's sidecar date is adopted only when it predates ours. Every
  // server that has the show is heard: the earliest date any of them holds
  // is when the show entered the library. Heard from the metadata owner
  // alone, the date depended on which server was down when the show was
  // first synced.
  applyFirstSeen(entity, fileData.mediaIdentity, run.serverConfig.id, now, (heldServerId) =>
    serverOutranks(run.serverConfig, heldServerId)
  )

  // --- Poster, backdrop, logo ---
  // Each belongs to the highest-priority server among those that report it
  // (ties broken on server id). A server the availability map does not list
  // for the field never owns it. The fail-open check these used also let
  // through a server when no server reported the field, and every server
  // of the best priority, so with two of them the show held whichever
  // synced last.
  const canUpdatePoster = isCurrentServerHighestPriorityForReportedField(
    availability.fieldAvailability, 'tv', showTitle, 'poster', run.serverConfig
  )
  if (canUpdatePoster && (fileData.posterURL || fileData.poster)) {
    entity.posterURL = fileServerUrl(fileData.posterURL || fileData.poster, run.serverConfig)
    entity.posterSource = run.serverConfig.id
  }

  const canUpdateBackdrop = isCurrentServerHighestPriorityForReportedField(
    availability.fieldAvailability, 'tv', showTitle, 'backdrop', run.serverConfig
  )
  if (canUpdateBackdrop && (fileData.backdropURL || fileData.backdrop)) {
    entity.backdrop = fileServerUrl(fileData.backdropURL || fileData.backdrop, run.serverConfig)
    entity.backdropSource = run.serverConfig.id
  }

  const canUpdateLogo = isCurrentServerHighestPriorityForReportedField(
    availability.fieldAvailability, 'tv', showTitle, 'logo', run.serverConfig
  )
  if (canUpdateLogo && (fileData.logoURL || fileData.logo)) {
    entity.logo = fileServerUrl(fileData.logoURL || fileData.logo, run.serverConfig)
    entity.logoSource = run.serverConfig.id
  }

  // --- Poster / backdrop blurhash ---
  // Kept, fetched or removed by the one rule every image follows
  // (core/imageAndBlurhash): settled by the image's owner, removed when it
  // is of another image and nothing replaces it. A failed fetch is reported,
  // so the show is not skipped from now on without it.
  const applyBlurhashRule = (
    ownsImage: boolean,
    blurhashPath: unknown,
    imagePath: unknown,
    imageField: 'posterURL' | 'backdrop',
    field: 'posterBlurhash' | 'backdropBlurhash'
  ) => {
    const sourceField = `${field}Source`
    const outcome = resolveBlurhash(
      {
        stored: {
          url: (existing as any)?.[imageField],
          blurhash: (existing as any)?.[field],
          blurhashSource: (existing as any)?.[sourceField],
        },
        reported: {
          url: ownsImage && imagePath ? fileServerUrl(imagePath as string, run.serverConfig) : null,
          blurhashUrl: blurhashPath as string | null | undefined,
        },
        owner: ownsImage ? run.serverConfig.id : null,
        locks: { image: locked(imageField), blurhash: locked(field) },
      },
      (path) => readBlurhashFile(resources, path, run)
    )

    if (outcome.action === 'write') {
      (entity as any)[field] = outcome.blurhash
      ;(entity as any)[sourceField] = outcome.blurhashSource
      return
    }
    if (outcome.fetchFailed) holdBack(field)
    if (outcome.action === 'unset') {
      delete (entity as any)[field]
      delete (entity as any)[sourceField]
      unset.push(field, sourceField)
    }
  }
  applyBlurhashRule(canUpdatePoster, fileData.posterBlurhash, fileData.posterURL || fileData.poster, 'posterURL', 'posterBlurhash')
  applyBlurhashRule(canUpdateBackdrop, fileData.backdropBlurhash, fileData.backdropURL || fileData.backdrop, 'backdrop', 'backdropBlurhash')

  // Season count: the seasons any server has, counted once each. It used to
  // be each server's own count, written by every pass, so a show whose
  // seasons are split across servers (or whose folder on the main server
  // holds only artwork) ended on whichever server synced last.
  const seasonCount = countSeasonsAcrossServers(showTitle, fileData, availability)
  const everyServerAnswered =
    run.allEnabledServersProbed === true
  if (seasonCount !== null) {
    // With a server missing, its seasons are missing from the count. Do not
    // let it drop on such a run: the seasons have not gone anywhere. The
    // caller is told, so the lower count is applied on the next run where
    // every server answers instead of this pass being skipped from now on.
    const stored = (existing as any)?.seasonCount
    const seasonCountHeld = !everyServerAnswered && typeof stored === 'number' && stored > seasonCount
    entity.seasonCount = seasonCountHeld ? stored : seasonCount
    if (seasonCountHeld) holdBack('seasonCount')
  }

  // The show's gate is NOT stamped here. syncTVShow settles it after the
  // seasons and episodes are written (finalizeShow); the plan's
  // `incomplete` tells it whether this part may be counted as done.
  return planned()
}

/**
 * The number of distinct seasons of a show across every server that answered
 * this run, read from the availability map (its paths start with the literal
 * season key each server sent). Falls back to this server's own payload when
 * the map has nothing for the show. Null when neither says anything.
 */
function countSeasonsAcrossServers(showTitle: string, fileData: any, availability: Availability): number | null {
  const seasonNumbers = new Set<number>()
  const note = (seasonKey: string) => {
    const match = seasonKey.match(/(?:season_?|s)?(\d+)/i)
    if (match) seasonNumbers.add(parseInt(match[1], 10))
  }

  const bucket = (availability.fieldAvailability as any)?.tv?.[showTitle]
  if (bucket && typeof bucket === 'object') {
    for (const path of Object.keys(bucket)) {
      if (!path.startsWith('seasons.')) continue
      const rest = path.slice('seasons.'.length)
      // The season key ends where the season's own fields begin.
      const end = rest.search(/\.(episodes|lengths|dimensions|season_poster|seasonPosterBlurhash|seasonNumber)(\.|$)/)
      if (end > 0) note(rest.slice(0, end))
    }
  }
  if (seasonNumbers.size > 0) return seasonNumbers.size

  if (typeof fileData?.seasonCount === 'number') return fileData.seasonCount
  if (fileData?.seasons && typeof fileData.seasons === 'object') {
    for (const seasonKey of Object.keys(fileData.seasons)) note(seasonKey)
    return seasonNumbers.size
  }
  return null
}
