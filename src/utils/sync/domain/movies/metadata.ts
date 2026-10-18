/**
 * A movie's metadata step: the metadata file of the server that owns it, with
 * hash-based change detection.
 *
 * The first of the movie's steps (MovieSyncService). Its plan sets the
 * metadata, its source, the schema version and the hash; it never names the
 * display title, which MovieSyncService derives once from the metadata the
 * document ends up with (core/title).
 */

import {
  MovieEntity,
  SyncContext,
  SyncStatus,
  SyncOperation,
  MediaType,
  syncEventBus,
  getFieldPath,
} from '../../core'
import { syncLogger } from '../../core/logger'
import { emptyWritePlan } from '../../core/writePlan'
import { fetchMetadataMultiServer } from '../../infrastructure'
import { isCurrentServerHighestPriorityForReportedField } from '@src/utils/sync/core/ownership'
import { movieStepResult, type MovieStepInput, type MovieStepOutcome } from './step'

/** Current version of the metadata schema, raised as the stored shape changes. */
const METADATA_SCHEMA_VERSION = '2.1'

/** The deferral a failed metadata step reports: the next pass fetches again. */
const METADATA_FAILED = 'metadata'

/**
 * Sync a movie's metadata.
 *
 * Writes nothing (and reports Skipped) when this server does not own the
 * metadata, or when its hash is unchanged for metadata this server supplied.
 * A failed fetch reports Failed and leaves the plan incomplete; it preserves
 * metadata that is already stored, and writes a minimal stub for a movie
 * that has none.
 */
export async function syncMovieMetadata({ originalTitle, movie, context }: MovieStepInput): Promise<MovieStepOutcome> {
  const startTime = Date.now()
  const title = originalTitle
  const plan = emptyWritePlan<MovieEntity>()
  // Whether the step writes the movie: set where its plan stamps lastSynced.
  let wroteDocument = false
  const outcome = (
    entityId: string,
    status: SyncStatus,
    changes: string[],
    errors: string[],
    metadata: Record<string, any>
  ): MovieStepOutcome => {
    if (status === SyncStatus.Failed) {
      plan.incomplete = true
      plan.deferrals.push(METADATA_FAILED)
    }
    return {
      plan,
      wroteDocument,
      result: movieStepResult(entityId, SyncOperation.Metadata, context, status, changes, errors, metadata),
    }
  }

  syncLogger.debug(`🎬 Movie metadata step starting for: "${title}"`)

  if (!title || title.trim().length === 0) {
    return outcome('unknown', SyncStatus.Failed, [], ['Movie title is required but was not provided'], {
      processingTime: Date.now() - startTime,
    })
  }

  try {
    syncEventBus.emitProgress(title, MediaType.Movie, context.serverConfig.id, SyncOperation.Metadata, {
      stage: 'starting',
      progress: 0,
    })

    const changes: string[] = []

    // 🚀 CRITICAL FIX: Check priority FIRST before doing any work
    // This prevents lower-priority servers from wasting API calls
    //
    // Metadata belongs to the highest-priority server that HAS a metadata file
    // for the title. The check used to be "no server with one outranks me",
    // which a server without one passes whenever its priority number is
    // lower: its fetch then came back empty, and that emptiness replaced the
    // metadata another server had supplied, on every run.
    const canUpdateMetadata = isCurrentServerHighestPriorityForReportedField(
      context.fieldAvailability,
      'movies',
      originalTitle,
      getFieldPath('metadata'),
      context.serverConfig
    )

    if (!canUpdateMetadata) {
      syncLogger.debug(`⏭️ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) does not have priority for metadata, skipping`)
      return outcome(title, SyncStatus.Skipped, [], [], {
        processingTime: Date.now() - startTime,
        reason: 'server does not have priority for metadata field',
      })
    }

    syncLogger.debug(`✅ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) has priority for metadata, proceeding`)

    // Check if we have metadata hash from context for change detection
    const metadataHashInfo = context.metadataHashesCache?.titles?.[originalTitle]
    const currentMetadataHash = movie.metadataHash

    // Guard: only trust the hash skip when metadata is actually populated.
    // If metadata is empty ({} or absent), force a re-fetch even when hashes match —
    // this repairs movies that previously had their metadata clobbered by a bug
    // while the metadataHash was still stored, leaving them permanently stuck in skip.
    const metadataIsPopulated = hasExternalMetadata(movie)

    // The stored hash is the hash of ONE server's copy: the one the stored
    // metadata was fetched from. It says nothing about this server's copy
    // unless this server is that one. Without this, a metadata owner that was
    // down when the title was first synced never took the metadata back once
    // its copy hashed the same, and the title kept naming the other server
    // as its metadata source.
    const storedMetadataIsFromThisServer = movie.metadataSource === context.serverConfig.id

    // If we have both hashes and they match, skip metadata fetch (optimization)
    if (metadataHashInfo?.hash && currentMetadataHash && metadataHashInfo.hash === currentMetadataHash && metadataIsPopulated && storedMetadataIsFromThisServer) {
      syncLogger.debug(`📝 Metadata hash unchanged for "${originalTitle}" (${metadataHashInfo.hash}), skipping fetch`)
      return outcome(title, SyncStatus.Skipped, [], [], {
        processingTime: Date.now() - startTime,
        reason: 'metadata hash unchanged',
      })
    }

    if (metadataHashInfo?.hash) {
      syncLogger.debug(`🔄 Metadata hash changed for "${originalTitle}": ${currentMetadataHash || 'none'} → ${metadataHashInfo.hash}`)
    }

    const fetchedMetadata = await extractMetadata(originalTitle, context)
    const metadataFetchFailed = !fetchedMetadata

    // A failed metadata fetch must NOT advance the sync gate. Preserve any
    // existing good metadata instead of clobbering it with a stub, and report
    // Failed so the plan is incomplete: the gate and metadataHash stay
    // unstamped. Without this, a transient fetch error (e.g. file-server blip)
    // during a hash change would stamp the gate and lock the movie out of
    // future metadata refreshes — the "spent gate" failure mode.
    if (metadataFetchFailed) {
      if (hasExternalMetadata(movie)) {
        syncLogger.warn(`⚠️ Metadata fetch failed for "${originalTitle}"; preserving existing metadata, leaving sync gate open for retry`)
        return outcome(title, SyncStatus.Failed, [], ['metadata fetch failed; preserved existing metadata'], {
          processingTime: Date.now() - startTime,
          reason: 'metadata fetch failed',
        })
      }
      syncLogger.debug(`📝 Metadata fetch failed for new movie "${title}"; writing minimal stub, leaving sync gate open for retry`)
    }

    // Use the fetched metadata, or a minimal stub for a never-before-seen
    // movie whose first fetch failed. The stub's hasExternalMetadata:false
    // keeps the skip guard open so the next sync retries.
    const metadata = fetchedMetadata || {
      title,
      source: context.serverConfig.id,
      dateAdded: new Date().toISOString(),
      lastScanned: new Date().toISOString(),
      hasExternalMetadata: false,
    }

    // Attach the metadata hash ONLY when the fetch succeeded — never stamp the
    // gate off a stub built from a failed fetch.
    if (!metadataFetchFailed && metadataHashInfo?.hash) {
      metadata._metadataHash = metadataHashInfo.hash
    }

    // The step writes the movie whenever it got this far (lastSynced at least).
    const set: Partial<MovieEntity> = { lastSynced: new Date() }
    wroteDocument = true

    // Check if entity needs version upgrade or normal metadata update
    const needsVersionUpgrade = !movie.syncVersion || movie.syncVersion < METADATA_SCHEMA_VERSION

    // We only reach here if we have priority for metadata (checked above).
    // Apply metadata normalization (includes migrations for version upgrades)
    const normalizedMetadata = normalizeMetadata(metadata)

    // For version upgrades, apply normalization but still check if values actually changed
    // This ensures old data gets migrated to new schema (e.g., string → Date conversion)
    //
    // Metadata stored from ANOTHER server is replaced by the owner's copy even
    // when the comparison calls the two equal (it tolerates keys only the
    // stored copy has): the document must hold what its metadataSource says
    // it holds, whichever server happened to supply it first.
    const storedFromAnotherServer = !metadataFetchFailed && movie.metadataSource !== context.serverConfig.id
    const metadataChanged = storedFromAnotherServer || !isMetadataEqual(movie.metadata, normalizedMetadata)

    if (needsVersionUpgrade || metadataChanged) {
      set.metadata = normalizedMetadata
      set.metadataSource = context.serverConfig.id
      set.syncVersion = METADATA_SCHEMA_VERSION // Update version after successful migration

      // Store metadata hash for future change detection
      if (metadata._metadataHash) {
        set.metadataHash = metadata._metadataHash
        syncLogger.debug(`📊 Storing metadata hash: ${metadata._metadataHash}`)
      }

      if (needsVersionUpgrade && metadataChanged) {
        changes.push(`Updated movie metadata (schema migration: ${movie.syncVersion || 'none'} → ${METADATA_SCHEMA_VERSION})`)
        syncLogger.debug(`🔄 Schema migration with changes: "${originalTitle}" ${movie.syncVersion || 'none'} → ${METADATA_SCHEMA_VERSION}`)
      } else if (needsVersionUpgrade && !metadataChanged) {
        changes.push(`Schema version updated (${movie.syncVersion || 'none'} → ${METADATA_SCHEMA_VERSION})`)
        syncLogger.debug(`📋 Schema version updated (no data changes): "${originalTitle}" ${movie.syncVersion || 'none'} → ${METADATA_SCHEMA_VERSION}`)
      } else {
        changes.push('Updated movie metadata')
        syncLogger.debug(`🔄 Metadata changed for: "${originalTitle}"`)
      }

      // Log Date objects being saved for debugging
      if (normalizedMetadata.release_date instanceof Date) {
        syncLogger.debug(`📅 Saving release_date as Date object: ${normalizedMetadata.release_date.toISOString()}`)
      } else if (normalizedMetadata.release_date) {
        syncLogger.debug(`📅 Saving release_date as ${typeof normalizedMetadata.release_date}: ${normalizedMetadata.release_date}`)
      }
    }

    plan.set = set

    syncEventBus.emitProgress(title, MediaType.Movie, context.serverConfig.id, SyncOperation.Metadata, {
      stage: changes.length > 0 ? 'updated' : 'unchanged',
      progress: 100,
    })

    return outcome(
      title,
      metadataFetchFailed ? SyncStatus.Failed : SyncStatus.Completed,
      changes,
      metadataFetchFailed ? ['metadata fetch failed; wrote minimal stub'] : [],
      {
        processingTime: Date.now() - startTime,
        metadataFields: Object.keys(metadata),
      }
    )
  } catch (error) {
    syncEventBus.emitError(
      title,
      MediaType.Movie,
      context.serverConfig.id,
      error instanceof Error ? error.message : String(error),
      SyncOperation.Metadata
    )
    plan.set = {}
    wroteDocument = false
    return outcome(title, SyncStatus.Failed, [], [error instanceof Error ? error.message : String(error)], {
      processingTime: Date.now() - startTime,
    })
  }
}

/** Whether the movie holds metadata a fetch filled in (not empty, not a stub). */
function hasExternalMetadata(movie: MovieEntity): boolean {
  return Boolean(
    movie.metadata &&
      typeof movie.metadata === 'object' &&
      Object.keys(movie.metadata).length > 0 &&
      movie.metadata.hasExternalMetadata !== false
  )
}

/**
 * Extract metadata from file server using originalTitle (filesystem key)
 * through fetchMetadataMultiServer (caching, retries). That takes the
 * ResourceManager's HTTP slot itself: wrapping it in throttleHttp here
 * would hold one slot while waiting for another.
 */
async function extractMetadata(originalTitle: string, context: SyncContext): Promise<Record<string, any> | null> {
  try {
    // Get metadata URL from fileserver data if available
    const fileServerData = context.fileServerData?.movies?.[originalTitle]
    const metadataRelativePath = fileServerData?.urls?.metadata

    const metadata = await fetchMetadataMultiServer(
      context.serverConfig.id,
      metadataRelativePath,
      'file',
      'movie',
      originalTitle
    )

    syncLogger.debug(`✅ Fetched metadata for "${originalTitle}" from ${context.serverConfig.id}`)
    return metadata
  } catch (error) {
    syncLogger.error(`Failed to extract metadata for ${originalTitle}:`, error)
    return null
  }
}

/**
 * Normalize metadata to ensure proper data types
 */
function normalizeMetadata(metadata: Record<string, any>): Record<string, any> {
  if (!metadata || typeof metadata !== 'object') {
    syncLogger.debug('🔧 Normalizing metadata: input is null or not an object')
    return metadata
  }

  const normalized = { ...metadata }
  let hasChanges = false

  syncLogger.debug(`🔧 Normalizing metadata with ${Object.keys(metadata).length} fields`)

  // Convert release_date to Date object if it's a string
  if (normalized.release_date) {
    const originalType = typeof normalized.release_date
    const originalValue = normalized.release_date

    if (typeof normalized.release_date === 'string') {
      try {
        const dateObj = new Date(normalized.release_date)

        // Validate that the date is valid
        if (!isNaN(dateObj.getTime())) {
          normalized.release_date = dateObj
          hasChanges = true
          syncLogger.debug(`✅ Normalized release_date: "${originalValue}" (${originalType}) -> ${dateObj.toISOString()} (Date object)`)
        } else {
          syncLogger.warn(`⚠️ Invalid date string, keeping original: ${originalValue}`)
        }
      } catch (error) {
        syncLogger.warn(`⚠️ Failed to convert release_date to Date: ${originalValue} - ${error.message}`)
        // Keep original value if conversion fails
      }
    } else if (normalized.release_date instanceof Date) {
      syncLogger.debug(`✅ release_date already a Date object: ${normalized.release_date.toISOString()}`)
    } else {
      syncLogger.debug(`ℹ️ release_date is ${originalType}, no normalization needed: ${originalValue}`)
    }
  } else {
    syncLogger.debug('ℹ️ No release_date field found in metadata')
  }

  // Add other normalization rules here as needed
  // e.g., normalize runtime to number, genres to array, etc.

  if (normalized.runtime && typeof normalized.runtime === 'string') {
    const runtimeNum = parseInt(normalized.runtime, 10)
    if (!isNaN(runtimeNum)) {
      normalized.runtime = runtimeNum
      hasChanges = true
      syncLogger.debug(`✅ Normalized runtime: "${metadata.runtime}" -> ${runtimeNum} (number)`)
    }
  }

  if (hasChanges) {
    syncLogger.debug(`🔧 Metadata normalization completed with changes`)
  } else {
    syncLogger.debug(`🔧 Metadata normalization completed - no changes needed`)
  }

  return normalized
}

/**
 * Compare metadata objects for equality with proper Date object handling.
 * Keys only the stored copy has are tolerated.
 */
function isMetadataEqual(current: Record<string, any> = {}, incoming: Record<string, any>): boolean {
  for (const key of Object.keys(incoming)) {
    if (!valuesEqual(current[key], incoming[key])) {
      syncLogger.debug(`🔍 Metadata difference found for key "${key}": ${current[key]} !== ${incoming[key]}`)
      return false
    }
  }
  return true
}

/**
 * Compare two values with proper handling for Date objects and other types
 */
function valuesEqual(current: any, incoming: any): boolean {
  // Handle null/undefined cases
  if (current === null && incoming === null) return true
  if (current === undefined && incoming === undefined) return true
  if (current == null || incoming == null) return false

  // Handle Date objects - compare by time value
  if (current instanceof Date && incoming instanceof Date) {
    const result = current.getTime() === incoming.getTime()
    if (!result) {
      syncLogger.debug(`🔍 Date comparison: ${current.toISOString()} !== ${incoming.toISOString()}`)
    }
    return result
  }

  // Handle Date vs string comparison (for backwards compatibility)
  if (current instanceof Date && typeof incoming === 'string') {
    try {
      const incomingDate = new Date(incoming)
      const result = current.getTime() === incomingDate.getTime()
      if (!result) {
        syncLogger.debug(`🔍 Date vs string comparison: ${current.toISOString()} !== ${incoming}`)
      }
      return result
    } catch {
      return false
    }
  }

  if (typeof current === 'string' && incoming instanceof Date) {
    try {
      const currentDate = new Date(current)
      const result = currentDate.getTime() === incoming.getTime()
      if (!result) {
        syncLogger.debug(`🔍 String vs Date comparison: ${current} !== ${incoming.toISOString()}`)
      }
      return result
    } catch {
      return false
    }
  }

  // Handle arrays
  if (Array.isArray(current) && Array.isArray(incoming)) {
    if (current.length !== incoming.length) return false
    return current.every((item, index) => valuesEqual(item, incoming[index]))
  }

  // Handle objects (but not Date objects, which are handled above)
  if (typeof current === 'object' && typeof incoming === 'object' &&
      !(current instanceof Date) && !(incoming instanceof Date)) {
    const currentKeys = Object.keys(current || {})
    const incomingKeys = Object.keys(incoming || {})

    if (currentKeys.length !== incomingKeys.length) return false

    return currentKeys.every(key => valuesEqual(current[key], incoming[key]))
  }

  // Handle primitive types
  return current === incoming
}
