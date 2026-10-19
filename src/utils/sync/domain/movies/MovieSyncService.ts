/**
 * Movie sync service: one server's pass over one movie.
 *
 * The pass reads the stored movie once, and is skipped when this server's gate
 * on it still holds (core/syncGate). Otherwise it runs four steps, always in
 * this order, each of which returns a write plan and a result:
 *
 *   1. metadata (./metadata): the metadata file of the server that owns it;
 *   2. artwork (./artwork): poster, backdrop and logo, their blurhashes, and
 *      the backdrop focal-point hints;
 *   3. video (./video): the video and the facts about its file, the content
 *      identity and delivery facts, captions and chapters;
 *   4. the blurhash retry (./artwork): a second attempt at a blurhash the
 *      artwork step's fetch did not get.
 *
 * The steps do no I/O. The files a step reads (the metadata file, the
 * blurhashes) it names in its plan's `needs`; each step is run through the
 * prefetch step (infrastructure/fileSystem/prefetch), which fetches them and
 * calls it again with them, one step at a time, in step order.
 *
 * Field-absence cleanup adds a plan of its own, and so does the movie's
 * normalization (the fields normalizeMovieEntity heals) when a step writes.
 * The plans are merged into one (core/writePlan), the display title is
 * derived from the metadata the document ends up with (core/title), and the
 * merged plan's `incomplete` decides the gate. One write, or none, follows.
 */

import {
  MovieEntity,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus,
  planFieldCleanup,
  seedDiscovery,
  type CleanableField,
  type FieldAvailability,
  type MoviePassParts,
  type RunConfig,
  type WritePlan,
} from '../../core'

import { MovieRepository } from '../../infrastructure'
import { buildWithResources, type PrefetchContext } from '../../infrastructure/fileSystem/prefetch'
import { isTopLevelFieldLocked } from '../../core/locks'
import type { Resources } from '../../core/resources'

import { createLogger } from '@src/lib/logger'
import { buildSyncGate, readSyncGate, changesDocument, nextSyncGates, availabilityFingerprint, payloadFingerprint } from '../../core/syncGate'
import { cleanupWritePlan, draftWritePlan, emptyWritePlan, mergeWritePlans, writesDocument } from '../../core/writePlan'
import { effectiveMetadata } from '../../core/metadataLock'
import { resolveTitle } from '../../core/title'
import { syncLogger } from '../../core/logger'
import isEqual from 'lodash/isEqual'
import { syncMovieMetadata } from './metadata'
import { syncMovieArtwork, retryMovieBlurhashes } from './artwork'
import { syncMovieVideo } from './video'
import type { MovieStepOutcome } from './step'

const pinoLog = createLogger('Sync.Movie')

// Movie asset fields eligible for field-absence cleanup. Paths carry the `urls.`
// prefix (movie fileAvailability is built from movieData.urls.*). videoURL
// (urls.mp4) and captions are deliberately excluded — higher-stakes / per-language.
const MOVIE_CLEANABLE_FIELDS: CleanableField[] = [
  { entityField: 'posterURL', fieldPath: 'urls.poster', companions: ['posterSource', 'posterBlurhash', 'posterBlurhashSource'] },
  { entityField: 'backdrop', fieldPath: 'urls.backdrop', companions: ['backdropSource', 'backdropBlurhash', 'backdropBlurhashSource'] },
  { entityField: 'logo', fieldPath: 'urls.logo', companions: ['logoSource', 'logoBlurhash'] },
  { entityField: 'chapterURL', fieldPath: 'urls.chapters', companions: ['chapterSource'] },
]

/** How many steps a pass runs (the event log's operation count). */
const MOVIE_STEP_COUNT = 4

/**
 * The value a movie's skip gate must hold, for one server, for that server's
 * pass to be skipped: a fingerprint of the payload being applied and a
 * fingerprint of which servers have which fields for the title. See
 * core/syncGate for the whole rule.
 */
export function movieSyncGate(
  payload: unknown,
  fieldAvailability: FieldAvailability,
  originalTitle: string
): string {
  return buildSyncGate(
    payloadFingerprint(payload),
    availabilityFingerprint(fieldAvailability, 'movies', originalTitle)
  )
}

export class MovieSyncService {
  constructor(private repository: MovieRepository) {}

  /**
   * One server's pass over one movie.
   *
   * @param originalTitle - The movie's folder name: its key in the payload,
   *   in the availability map and in the database, and its results' entity id
   * @param payload - This server's payload for the movie (`fileServer.movies[originalTitle]`)
   * @param parts - The pass's run, availability and caches (core/types); each
   *   step is handed only the parts it reads
   */
  async syncMovie(
    originalTitle: string,
    payload: any,
    { run, availability, caches }: MoviePassParts
  ): Promise<SyncResult[]> {
    const title = originalTitle

    syncEventBus.emitStarted(title, MediaType.Movie, run.serverConfig.id)

    try {
      // Whole-movie early-skip: bypass entity normalisation and all steps
      // when neither this server's payload nor the who-has-what picture for the
      // title has changed since this server's last complete pass, and no other
      // server has changed the document since (movieSyncGate).
      //
      // The gate is only ever stamped by a pass that left nothing undone, so
      // a matching gate is by itself the evidence the earlier checks here used
      // to look for in the stored metadata.
      const syncGate = movieSyncGate(
        payload,
        availability.fieldAvailability,
        originalTitle
      )

      // The one read of the stored movie: the gate check, the steps and the
      // write all work from it.
      const existingMovie = await this.repository.findByOriginalTitle(originalTitle)

      if (!run.forceSync && readSyncGate(existingMovie as any, run.serverConfig.id) === syncGate) {
        syncEventBus.emitComplete(title, MediaType.Movie, run.serverConfig.id, undefined, {
          totalOperations: 0,
          successful: 0,
          failed: 0
        })
        return [{
          status: SyncStatus.Skipped,
          entityId: title,
          mediaType: MediaType.Movie,
          operation: SyncOperation.Metadata,
          serverId: run.serverConfig.id,
          timestamp: new Date(),
          changes: [],
          errors: []
        }]
      }

      // Normalize entity to ensure complete schema (handles new, existing, and partial records)
      const normalized = this.normalizeMovieEntity(existingMovie, originalTitle, originalTitle, run)

      // ---- The steps, in order. Each sees the movie with what the steps
      // before it set; none of them writes. ----
      const results: SyncResult[] = []
      const stepPlans: WritePlan<MovieEntity>[] = []
      // Whether the metadata, artwork or video step writes the movie: its
      // plan stamps lastSynced (core/writePlan writesDocument).
      let stepsWrite = false
      let movie: MovieEntity = normalized
      // The files a step reads are fetched by the prefetch step: through
      // fetchMetadataMultiServer, or (the artwork step's first blurhash read)
      // in a slot of the pass's throttle.
      const prefetch: PrefetchContext = { mediaType: 'movie', title: originalTitle, throttle: caches.resourceManager }
      // Each step is called with the movie as it stands, the files fetched
      // for it and, besides them, only the parts of the pass it reads (./step).
      const runStep = async <O extends MovieStepOutcome>(
        operation: SyncOperation,
        step: (movie: MovieEntity, resources: Resources) => O
      ): Promise<O | null> => {
        let outcome: O | null = null
        let stepOutcome: MovieStepOutcome
        try {
          const current = movie
          outcome = await buildWithResources((resources) => step(current, resources), prefetch)
          stepOutcome = outcome
        } catch (error) {
          const errorResult: SyncResult = {
            status: SyncStatus.Failed,
            entityId: title,
            mediaType: MediaType.Movie,
            operation,
            serverId: run.serverConfig.id,
            timestamp: new Date(),
            changes: [],
            errors: [error instanceof Error ? error.message : String(error)]
          }
          syncEventBus.emitError(title, MediaType.Movie, run.serverConfig.id, errorResult.errors[0], operation)
          stepOutcome = {
            plan: { ...emptyWritePlan<MovieEntity>(), incomplete: true, deferrals: [operation] },
            result: errorResult,
          }
        }
        results.push(stepOutcome.result)
        stepPlans.push(stepOutcome.plan)
        if (writesDocument(stepOutcome.plan)) stepsWrite = true
        movie = { ...movie, ...stepOutcome.plan.set } as MovieEntity
        return outcome
      }

      await runStep(SyncOperation.Metadata, (movie, resources) =>
        syncMovieMetadata({ originalTitle, movie, payload, run, availability }, resources)
      )
      const artwork = await runStep(SyncOperation.Assets, (movie, resources) =>
        syncMovieArtwork({ originalTitle, movie, payload, run, availability }, resources)
      )
      await runStep(SyncOperation.Content, (movie) =>
        syncMovieVideo({ originalTitle, movie, payload, run, availability })
      )
      await runStep(SyncOperation.Blurhash, (_movie, resources) =>
        retryMovieBlurhashes({ originalTitle, run }, artwork?.retries ?? [], resources)
      )

      // ---- Field-absence cleanup: drop asset fields no enabled server
      // reports anymore (only meaningful for an existing doc).
      // planFieldCleanup logs (both modes) and returns `unset` only in
      // enforce. originalTitle is the fieldAvailability key; the log names
      // the stored display title, as the TV services name the show's. ----
      const cleanupPlan = planFieldCleanup({
        cleanup: run.cleanup,
        mediaType: 'movies',
        availabilityKey: originalTitle,
        entity: existingMovie,
        fieldAvailability: availability.fieldAvailability,
        fields: MOVIE_CLEANABLE_FIELDS,
        log: (obj, msg) => pinoLog.info(obj, msg),
        logContext: { title: existingMovie?.title || title, originalTitle },
      })

      // What normalizeMovieEntity added or healed (a missing type, discovery
      // date, source..., and lastSynced) is written whenever the metadata,
      // artwork or video step writes (stepsWrite: each says so where it stamps
      // lastSynced), as the strategies they replace wrote the whole movie
      // then. A pass in which nothing but the blurhash retry, the title or the
      // gate changes writes only that.

      // ---- One plan (core/writePlan): the cleanup's removals (and a removal
      // it held back because not every server answered) first, then the
      // normalization, then the steps' plans in step order. The normalized
      // movie is a draft of the stored one: its plan sets what it added or
      // healed, every field for a new movie. ----
      const merged = mergeWritePlans<MovieEntity>([
        cleanupWritePlan<MovieEntity>(cleanupPlan),
        stepsWrite
          ? { ...emptyWritePlan<MovieEntity>(), ...draftWritePlan(existingMovie, normalized, []) }
          : emptyWritePlan<MovieEntity>(),
        ...stepPlans,
      ], originalTitle)

      // Fields whose data is gone. An admin lock keeps a field, here as
      // everywhere else.
      const lockedFields = (existingMovie as any)?.lockedFields
      const unsetFields = merged.unset.filter((field) => !isTopLevelFieldLocked(lockedFields, field))

      const pending: any = { ...merged.set }

      // The display title and its source are derived here, once, from the
      // metadata the document ends up with (core/title). Each strategy used to
      // write a title of its own (the metadata strategy the TMDB one, the asset
      // and content strategies the folder name), so the stored title depended
      // on which of them last had something to change.
      // (A locked `metadata` keeps what is stored: the plan's copy will be
      // dropped on the way to the database, so it must not name the title.
      // See core/metadataLock.)
      const metadataCopy = effectiveMetadata<Record<string, any>>({
        stored: existingMovie
          ? { metadata: existingMovie.metadata, metadataSource: existingMovie.metadataSource }
          : null,
        incoming: { metadata: pending.metadata, metadataSource: pending.metadataSource },
        locked: isTopLevelFieldLocked(lockedFields, 'metadata'),
      })
      const titleLocked = isTopLevelFieldLocked(lockedFields, 'title')
      const titleRule = resolveTitle({
        originalTitle,
        metadata: metadataCopy,
        fieldAvailability: availability.fieldAvailability,
        mediaType: 'movies',
        serverConfig: run.serverConfig,
        stored: existingMovie,
        locks: { title: titleLocked },
      })
      const displayTitle = titleRule.title
      if (titleRule.writeTitle) {
        pending.title = displayTitle
      } else {
        // Unchanged: make sure the normalized folder name cannot override it.
        delete pending.title
      }
      // Only the rule's source is written, and only when it differs.
      delete pending.titleSource
      if (titleRule.writeTitleSource) pending.titleSource = titleRule.titleSource

      // The skip gate (core/syncGate). This server's entry is stamped only when
      // the merged plan held nothing back: no step failed, no removal was held
      // back, no file was left unfetched (merged.gate). That includes a pass
      // that found nothing to change, which would otherwise be repeated in
      // full on every run. Otherwise it is left out, so the next run does the
      // work again. A pass that changed the document drops the other servers'
      // entries.
      const documentChanged = changesDocument(existingMovie as any, pending, unsetFields)
      const gateToStamp = merged.gate === 'stamp' ? syncGate : null
      if (!gateToStamp) {
        syncLogger.debug(`Gate left open for "${originalTitle}": ${merged.deferrals.join(', ')}`)
      }
      const storedGates = ((existingMovie as any)?.syncGates ?? {}) as Record<string, string>
      const gates = nextSyncGates(storedGates, run.serverConfig.id, gateToStamp, documentChanged)
      if (!isEqual(gates, storedGates)) pending.syncGates = gates

      // Write when the plan sets something OR there are fields to clear. A
      // pure field-absence pass (empty set + unset) must still write.
      if (Object.keys(pending).length > 0 || unsetFields.length > 0) {
        if (!existingMovie) {
          // New document — full insert of the normalized movie with what the
          // steps set. There is nothing stored to remove; a field a step
          // wanted gone is simply left out.
          const toInsert: any = { ...movie, ...pending }
          for (const field of unsetFields) delete toInsert[field]
          await this.repository.upsert(toInsert)
        } else {
          // Existing document — diff against the stored one, write only
          // changes, and $unset the fields whose data is gone (absent on every
          // server, or removed by a step).
          await this.repository.smartUpsert(
            { ...existingMovie, ...pending } as any,
            existingMovie as any,
            { unset: unsetFields }
          )
        }
      }

      // Stamp the resolved display title onto completed results. (The post-sync
      // cache invalidation does not read it: the page caches are tagged by the
      // folder name, which run/writtenMedia takes from the title being synced.)
      // A corrected display title is a change in its own right: the media
      // pages show it. When no step had anything else to write there is no
      // completed result to carry it to the cache invalidation, so add one.
      const titleChanged = Boolean(existingMovie) && existingMovie!.title !== displayTitle && !titleLocked
      if (titleChanged && !results.some(r => r.status === SyncStatus.Completed)) {
        results.push({
          status: SyncStatus.Completed,
          entityId: title,
          mediaType: MediaType.Movie,
          operation: SyncOperation.Metadata,
          serverId: run.serverConfig.id,
          timestamp: new Date(),
          changes: [`Updated display title: "${displayTitle}"`],
          errors: []
        })
      }
      for (const r of results) {
        if (r.status === SyncStatus.Completed) {
          r.metadata = {
            ...r.metadata,
            displayTitle,
            // No document existed before this pass inserted one (counted for
            // the admins' sync notice).
            ...(existingMovie ? {} : { created: true }),
            // The write changed the movie's data: "completed" only says a
            // step wrote (the sync report's "updated" count, run/syncReport)
            ...(documentChanged ? { documentChanged: true } : {}),
          }
        }
      }
      // Surface field-absence diagnostics on the first completed result (once).
      if (cleanupPlan.changes.length > 0) {
        const firstCompleted = results.find(r => r.status === SyncStatus.Completed)
        if (firstCompleted) firstCompleted.changes = [...firstCompleted.changes, ...cleanupPlan.changes]
      }

      syncEventBus.emitComplete(title, MediaType.Movie, run.serverConfig.id, undefined, {
        totalOperations: MOVIE_STEP_COUNT,
        successful: results.filter(r => r.status === SyncStatus.Completed).length,
        failed: results.filter(r => r.status === SyncStatus.Failed).length
      })

      return results

    } catch (error) {
      const errorResult: SyncResult = {
        status: SyncStatus.Failed,
        entityId: title,
        mediaType: MediaType.Movie,
        operation: SyncOperation.Metadata, // Default operation for general failures
        serverId: run.serverConfig.id,
        timestamp: new Date(),
        changes: [],
        errors: [error instanceof Error ? error.message : String(error)]
      }

      syncEventBus.emitError(
        title,
        MediaType.Movie,
        run.serverConfig.id,
        errorResult.errors[0]
      )

      return [errorResult]
    }
  }

  /**
   * Normalize movie entity to ensure complete schema regardless of input state
   * Handles new entities, existing entities, partial records, and schema migrations
   */
  private normalizeMovieEntity(
    existingMovie: MovieEntity | null,
    title: string,
    originalTitle: string,
    run: Pick<RunConfig, 'serverConfig'>
  ): MovieEntity {
    const now = new Date()
    
    // If existing movie found, preserve all existing data
    if (existingMovie) {
      console.log(`🔄 Normalizing existing movie entity for: "${title}"`)
      
      // Start with existing movie data - preserve everything
      const normalizedMovie: MovieEntity = {
        ...existingMovie,
        // Update sync timestamp
        lastSynced: now,
        // Ensure core fields are current
        title,
        originalTitle
      }
      
      // Heal any critical missing fields
      this.healCriticalFields(normalizedMovie, existingMovie, run)
      
      console.log(`🔧 Entity normalized: preserved all ${Object.keys(existingMovie).length} existing fields`)
      return normalizedMovie
    }
    
    // Creating new movie - set all required legacy fields for compatibility
    console.log(`🆕 Creating new movie entity for: "${title}" (originalTitle: "${originalTitle}")`)
    
    const normalizedMovie: MovieEntity = {
      // Core identification
      title,
      originalTitle,
      
      // REQUIRED: Legacy discovery fields (for "recently added" queries, type filtering, etc.)
      type: 'movie',
      createdAt: now,
      initialDiscoveryDate: now,
      initialDiscoveryServer: run.serverConfig.id,
      
      // Sync tracking
      lastSynced: now,
      
      // Content metadata (empty object, will be populated by strategies)
      metadata: {},
      
      // Source tracking for field-level ownership
      titleSource: run.serverConfig.id,
      originalTitleSource: run.serverConfig.id,
      
      // All other fields will be populated by strategies as needed
      // No need to initialize them as undefined - strategies will set them when data is available
    }
    
    console.log(`🔍 TRACE: New entity created with ${Object.keys(normalizedMovie).length} fields:`, Object.keys(normalizedMovie).sort())
    
    return normalizedMovie
  }
  
  /**
   * Heal critical fields that must never be null/undefined for system stability
   */
  private healCriticalFields(
    normalizedMovie: MovieEntity,
    existingMovie: MovieEntity,
    run: Pick<RunConfig, 'serverConfig'>
  ): void {
    const healedFields: string[] = []
    
    // Ensure legacy discovery fields exist (for backward compatibility)
    if (!normalizedMovie.type) {
      normalizedMovie.type = 'movie'
      healedFields.push('type')
    }
    
    if (!normalizedMovie.createdAt) {
      normalizedMovie.createdAt = new Date()
      healedFields.push('createdAt')
    }
    
    // One rule for movies and TV (core/discovery.ts): a document that predates
    // the field is healed from its createdAt; a date already held never moves.
    healedFields.push(
      ...seedDiscovery(normalizedMovie, existingMovie, run.serverConfig.id, new Date())
    )

    // Ensure source tracking for critical fields
    if (!normalizedMovie.titleSource) {
      normalizedMovie.titleSource = run.serverConfig.id
      healedFields.push('titleSource')
    }
    
    if (!normalizedMovie.originalTitleSource) {
      normalizedMovie.originalTitleSource = run.serverConfig.id
      healedFields.push('originalTitleSource')
    }
    
    // Ensure metadata is always an object
    if (!normalizedMovie.metadata || typeof normalizedMovie.metadata !== 'object') {
      normalizedMovie.metadata = {}
      healedFields.push('metadata')
    }
    
    if (healedFields.length > 0) {
      console.log(`🏥 Healed critical fields: ${healedFields.join(', ')}`)
    }
  }
}
