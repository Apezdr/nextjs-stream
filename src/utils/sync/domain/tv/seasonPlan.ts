/**
 * A season's builder: the season's write plan from the stored season, the
 * stored show and this server's payload (SeasonSyncService writes it).
 *
 * Pure: it does no I/O. The file it reads (the season poster's blurhash) it
 * reads from the resources the prefetch step fetched for it
 * (core/resources). A file it was not handed reads as a failed fetch and is
 * named in its plan's `needs`; the service fetches those and calls it again
 * (infrastructure/fileSystem/prefetch).
 */

import type { Availability, PlanOutcome, RunConfig, SeasonEntity } from '../../core/types'
import { fileServerUrl } from '../../infrastructure/fileSystem/urls'
import { isTopLevelFieldLocked } from '../../core/locks'
import { Resources } from '../../core/resources'
import { seedDiscovery } from '../../core/discovery'
import {
  getServersReportingField,
  isHighestPriorityAmongServers,
  seasonsAcrossServers,
} from '@src/utils/sync/core/ownership'
import { draftWritePlan, emptyWritePlan } from '@src/utils/sync/core/writePlan'
import { resolveBlurhash } from '@src/utils/sync/core/imageAndBlurhash'
import { effectiveMetadata } from '@src/utils/sync/core/metadataLock'
import { readBlurhashFile } from './blurhashFile'

/**
 * What planSeason reads of the run, besides the availability: not forceSync
 * (the show's gate is checked before it runs), not the cleanup config
 * (field-absence cleanup plans apart).
 */
export type SeasonPlanRun = Pick<RunConfig, 'serverConfig' | 'allEnabledServersProbed'>

/** planSeason's input. */
export interface SeasonPlanInput {
  /** The show's folder name (originalTitle): the availability key. */
  showOriginalTitle: string
  /** The show's display title, copied onto the season. */
  displayTitle: string
  seasonNumber: number
  /** The season's LITERAL key in the file-server data, e.g. "Season 01". */
  seasonKey: string
  /** This server's payload for the season. */
  fileData: any
  run: SeasonPlanRun
  availability: Availability
  /** The season as stored, or null for a new one. */
  existing: SeasonEntity | null
  /** The stored show's id (the showId foreign key), or null. */
  showId: any
  /** The show as stored after this pass's show write: its metadata lists the seasons. */
  parentShow: any
}

/**
 * A season's write plan: the existing doc with the incoming file-server
 * data merged on top, respecting per-field server priority.
 *
 * Key differences from naive field copy:
 *  - Season metadata lives in the PARENT SHOW's metadata.seasons[] array,
 *    not in the season file-server data directly.
 *  - The poster key in file-server data is "season_poster", not "poster".
 *  - Blurhash fields in file-server data are URL paths (fetched by the
 *    blurhash rule, core/imageAndBlurhash) — never copied directly to the entity.
 *
 * The plan's removals are the fields whose data is gone, not changed. It is
 * incomplete, and its deferrals name why, when something could not be
 * settled this pass and must be retried: the episode count was held because
 * a server did not answer, or a blurhash fetch failed. The plan always
 * writes the season: it stamps lastSynced. Its `needs` are the files it read
 * and was not handed (core/resources).
 */
export function planSeason(
  {
    showOriginalTitle,
    displayTitle,
    seasonNumber,
    seasonKey,
    fileData,
    run,
    availability,
    existing,
    showId,
    parentShow,
  }: SeasonPlanInput,
  resources: Resources = new Resources()
): PlanOutcome<SeasonEntity> {
  const now = new Date()
  // What was held back, and why (the plan's incomplete and deferrals).
  const plan = emptyWritePlan<SeasonEntity>()
  const holdBack = (reason: string) => {
    plan.incomplete = true
    plan.deferrals.push(reason)
  }
  const unset: string[] = []
  const locked = (field: string) => isTopLevelFieldLocked((existing as any)?.lockedFields, field)
  // Remove a field whose data is gone. An admin lock keeps it.
  const clearField = (field: string) => {
    if (locked(field)) return
    delete (entity as any)[field]
    if (existing && (existing as any)[field] !== undefined) unset.push(field)
  }
  // A season field belongs to the highest-priority server that has a value
  // for it. The paths below use the literal season keys the servers sent:
  // the old `seasons.Season ${n}.…` guess missed every folder not named
  // exactly that ("Season 01"), a missed path counts as "nobody reports it",
  // and the priority helper then let every server write — last one synced
  // won. Two servers need not agree on the folder's name either, so the
  // reporters are gathered under every key in use for this season number.
  // Fails closed: a server the map does not list for the field never owns
  // it, even when its payload has a value there. (This server's own key is
  // always among the keys, so its path can always be built.)
  const seasonKeys = seasonKeysAcrossServers(showOriginalTitle, seasonNumber, seasonKey, availability)
  const owns = (field: string, hasValue: boolean) => {
    if (!hasValue) return false
    const reporters = [
      ...new Set(
        seasonKeys.flatMap((key) =>
          getServersReportingField(
            availability.fieldAvailability, 'tv', showOriginalTitle, `seasons.${key}.${field}`
          )
        )
      ),
    ]
    return isHighestPriorityAmongServers(reporters, run.serverConfig)
  }

  // The season this pass wants stored: the existing doc (preserving ALL
  // fields) or a new one. Either way the pass stamps lastSynced, so the plan
  // writes the season (core/writePlan writesDocument).
  const entity: SeasonEntity = existing
    ? { ...existing, lastSynced: now }
    : {
        title: `Season ${seasonNumber}`,
        originalTitle: `Season ${seasonNumber}`,
        type: 'season',
        createdAt: now,
        lastSynced: now,
        seasonNumber,
        showTitle: displayTitle,
      }

  // Heal structural fields
  if (!entity.type) entity.type = 'season'
  if (!entity.createdAt) entity.createdAt = now
  // Library-add date: seeded once, never moved later (core/discovery.ts)
  seedDiscovery(entity, existing, run.serverConfig.id, now)
  if (showId) entity.showId = showId
  // Use display title as showTitle (matches legacy document shape)
  entity.showTitle = displayTitle

  // --- Metadata from the parent show ---
  // A season's metadata is not in its own file-server data: it is the entry
  // for this season in the STORED show's metadata.seasons[]. It is derived
  // data, the same whichever server's pass copies it, so every pass does.
  // It used to be left to the server that owns the show's metadata, and a
  // season that server does not hold (the main server has the show folder
  // with artwork only; the episodes are on another) never got a title, an
  // air date or an episode count.
  const showSeasons = parentShow?.metadata?.seasons
  const seasonMetadata = Array.isArray(showSeasons)
    ? showSeasons.find((s: any) => s.season_number === seasonNumber)
    : undefined
  let cleanedMetadata: any
  if (seasonMetadata) {
    // Clean metadata: remove episodes array (stored separately)
    cleanedMetadata = { ...seasonMetadata }
    delete cleanedMetadata.episodes
  }
  // Metadata an admin locked stays as stored, and so do the fields taken
  // from it (the title, the episode count below): the show's copy would be
  // dropped on the way to the database, and must not name the season
  // (core/metadataLock).
  const metadata = effectiveMetadata<any>({
    stored: existing ? { metadata: existing.metadata, metadataSource: existing.metadataSource } : null,
    // The source is the show's metadata source, not whoever copied it.
    incoming: seasonMetadata ? { metadata: cleanedMetadata, metadataSource: parentShow?.metadataSource } : null,
    // The show's metadata lists its seasons, and not this one. (A show with
    // no metadata at all is not this case: its metadata may simply not have
    // been synced yet.)
    gone: Array.isArray(showSeasons),
    locked: locked('metadata'),
  })
  if (metadata.action === 'write') {
    const fresh = metadata.metadata
    entity.metadata = fresh
    if (metadata.metadataSource) entity.metadataSource = metadata.metadataSource

    // Extract queryable fields from metadata (matching legacy document shape)
    if (fresh.name) entity.title = fresh.name
    if (fresh.air_date) entity.airDate = new Date(fresh.air_date)
    if (fresh.overview) entity.overview = fresh.overview
    if (fresh.poster_path) entity.posterPath = fresh.poster_path
    if (fresh.vote_average != null) entity.rating = fresh.vote_average
    if (fresh.episode_count != null) entity.episodeCount = fresh.episode_count
  } else if (metadata.action === 'remove') {
    // What was copied from the season's old entry goes, so the season ends
    // as a first sync against the same metadata would leave it.
    for (const field of ['metadata', 'metadataSource', 'airDate', 'overview', 'posterPath', 'rating']) {
      clearField(field)
    }
    if (!locked('title')) entity.title = `Season ${seasonNumber}`
    // The count came from the metadata too. It is worked out again below
    // from the episodes the servers hold.
    if (!locked('episodeCount')) delete (entity as any).episodeCount
  }

  // --- Poster (priority-gated) ---
  // File-server key for season poster is "season_poster", not "poster"
  const canUpdatePoster = owns('season_poster', Boolean((fileData as any)?.season_poster))
  if (canUpdatePoster) {
    entity.posterURL = fileServerUrl(
      (fileData as any).season_poster,
      run.serverConfig
    )
    entity.posterSource = run.serverConfig.id
  }

  // Episode count: the season's metadata when it has one (the stored copy
  // while it is locked), otherwise the episodes the servers hold between
  // them, counted once each. The fallback used to be the first syncing
  // server's own count, kept from then on.
  const metadataEpisodeCount = (metadata.metadata as any)?.episode_count
  if (metadataEpisodeCount != null) {
    entity.episodeCount = metadataEpisodeCount
  } else {
    const acrossServers = seasonsAcrossServers(availability.fieldAvailability, showOriginalTitle)
      .get(seasonNumber)?.episodes.size
    if (acrossServers) {
      // With a server missing, its episodes are missing from the count. Do
      // not let it drop on such a run; say so, so the lower count is applied
      // on the next run where every server answers.
      const everyServerAnswered =
        run.allEnabledServersProbed === true
      const stored = (existing as any)?.episodeCount
      if (!everyServerAnswered && typeof stored === 'number' && stored > acrossServers) {
        entity.episodeCount = stored
        holdBack('episodeCount')
      } else {
        entity.episodeCount = acrossServers
      }
    } else if (typeof (fileData as any)?.episodeCount === 'number') {
      entity.episodeCount = (fileData as any).episodeCount
    } else if ((fileData as any)?.episodes && typeof (fileData as any).episodes === 'object') {
      entity.episodeCount = Object.keys((fileData as any).episodes).length
    }
  }

  // --- Season poster blurhash ---
  // Kept, fetched or removed by the one rule every image follows
  // (core/imageAndBlurhash): settled by the poster's owner, removed when it
  // is of another poster and nothing replaces it. A failed fetch is
  // reported, so the show is not skipped without it.
  const posterBlurhash = resolveBlurhash(
    {
      stored: {
        url: existing?.posterURL,
        blurhash: existing?.posterBlurhash,
        blurhashSource: (existing as any)?.posterBlurhashSource,
      },
      reported: {
        url: canUpdatePoster ? entity.posterURL : null,
        blurhashUrl: (fileData as any)?.seasonPosterBlurhash,
      },
      owner: canUpdatePoster ? run.serverConfig.id : null,
      locks: { image: locked('posterURL'), blurhash: locked('posterBlurhash') },
    },
    (path) => readBlurhashFile(resources, path, run)
  )
  if (posterBlurhash.action === 'write') {
    entity.posterBlurhash = posterBlurhash.blurhash
    entity.posterBlurhashSource = posterBlurhash.blurhashSource
  } else {
    if (posterBlurhash.fetchFailed) holdBack('posterBlurhash')
    if (posterBlurhash.action === 'unset') {
      clearField('posterBlurhash')
      clearField('posterBlurhashSource')
    }
  }

  // A count that could not be worked out again is removed with the metadata
  // it came from.
  if (existing && (existing as any).episodeCount !== undefined && (entity as any).episodeCount === undefined) {
    unset.push('episodeCount')
  }

  // A field is either written or removed, never both.
  const removed = [...new Set(unset)].filter((field) => (entity as any)[field] === undefined)
  return { plan: { ...plan, ...draftWritePlan(existing, entity, removed), needs: resources.needs } }
}

/**
 * Every literal key in use for one season number across the servers that
 * answered, this server's own key first.
 */
export function seasonKeysAcrossServers(
  showOriginalTitle: string,
  seasonNumber: number,
  ownKey: string,
  availability: Availability
): string[] {
  const others =
    seasonsAcrossServers(availability.fieldAvailability, showOriginalTitle).get(seasonNumber)?.keys ?? []
  return [...new Set([ownKey, ...others])]
}
