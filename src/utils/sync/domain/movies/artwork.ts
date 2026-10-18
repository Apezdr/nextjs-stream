/**
 * A movie's artwork: the poster, backdrop and logo URLs, the poster's and
 * backdrop's blurhashes, and the backdrop focal-point hints.
 *
 * Two of the movie's steps (MovieSyncService) live here:
 *
 *  - syncMovieArtwork, the second step: each image belongs to the
 *    highest-priority server that reports it. Its URL is written from that
 *    server's payload, and its blurhash is decided once, by the rule every
 *    image follows (core/imageAndBlurhash), with one fetch of the blurhash
 *    file the owner publishes.
 *  - retryMovieBlurhashes, the fourth and last step: a second attempt, through
 *    fetchMetadataMultiServer (its retries and its cache fallback), at each
 *    blurhash the first fetch did not get, for an image that had none. It
 *    takes the artwork step's decision for the image and decides nothing
 *    itself. (A stale blurhash whose replacement could not be fetched is
 *    removed by the artwork step, and not tried again in the same pass.)
 *
 * Both return write plans; neither writes.
 */

import {
  BackdropFocal,
  MovieEntity,
  SyncContext,
  SyncStatus,
  SyncOperation,
  MediaType,
  syncEventBus,
  getFieldPath,
  MovieFieldPathMap,
} from '../../core'
import { emptyWritePlan } from '../../core/writePlan'
import { fetchMetadataMultiServer, fileServerUrl, isTopLevelFieldLocked } from '../../infrastructure'
import {
  isCurrentServerHighestPriorityForReportedField,
  getServersReportingField,
} from '@src/utils/sync/core/ownership'
import { decideBlurhash, settleBlurhash, type BlurhashDecision } from '@src/utils/sync/core/imageAndBlurhash'
import { httpGet } from '@src/lib/httpHelper'
import { syncLogger } from '../../core/logger'
import { movieStepResult, type MovieStepInput, type MovieStepOutcome } from './step'

/** A blurhash the artwork step's single fetch did not get, for an image that had none. */
export interface BlurhashRetry {
  /** The blurhash field (`posterBlurhash`, `backdropBlurhash`). */
  field: string
  /** Its source field. */
  sourceField: string
  /** The artwork step's decision for the image: fetch the owner's blurhash file. */
  decision: Extract<BlurhashDecision, { action: 'fetch' }>
}

export interface MovieArtworkOutcome extends MovieStepOutcome {
  /** For retryMovieBlurhashes, which runs after the video step. */
  retries: BlurhashRetry[]
}

/**
 * The artwork step. See the module comment.
 */
export async function syncMovieArtwork({ originalTitle, movie, context }: MovieStepInput): Promise<MovieArtworkOutcome> {
  const startTime = Date.now()
  const title = originalTitle
  const plan = emptyWritePlan<MovieEntity>()
  const retries: BlurhashRetry[] = []

  try {
    syncEventBus.emitProgress(title, MediaType.Movie, context.serverConfig.id, SyncOperation.Assets, {
      stage: 'starting',
      progress: 0,
    })

    const changes: string[] = []
    const { updates: assetUpdates, cleared } = await decideArtwork(originalTitle, context, movie, plan, retries)
    changes.push(...cleared.map((key) => `Cleared ${key}`))

    if (Object.keys(assetUpdates).length > 0) {
      const set: any = { ...assetUpdates, lastSynced: new Date() }

      // Add source tracking for updated asset fields
      Object.keys(assetUpdates).forEach((field) => {
        // Map field names to their source tracking fields
        if (field === 'posterURL') {
          set.posterSource = context.serverConfig.id
        } else if (field === 'backdrop') {
          set.backdropSource = context.serverConfig.id
        } else if (field === 'logo') {
          set.logoSource = context.serverConfig.id
        } else if (field === 'backdropFocal') {
          set.backdropFocalSource = context.serverConfig.id
        } else if (field === 'backdropFocalSuggested') {
          set.backdropFocalSuggestedSource = context.serverConfig.id
        }
      })
      plan.set = set
      changes.push(...Object.keys(assetUpdates).map((key) => `Updated ${key}`))

      syncEventBus.emitProgress(title, MediaType.Movie, context.serverConfig.id, SyncOperation.Assets, {
        stage: 'completed',
        progress: 100,
        updatedAssets: Object.keys(assetUpdates),
      })
    } else {
      syncEventBus.emitProgress(title, MediaType.Movie, context.serverConfig.id, SyncOperation.Assets, {
        stage: 'unchanged',
        progress: 100,
      })
    }

    return {
      plan,
      retries,
      result: movieStepResult(
        title,
        SyncOperation.Assets,
        context,
        changes.length > 0 ? SyncStatus.Completed : SyncStatus.Skipped,
        changes,
        [],
        { processingTime: Date.now() - startTime, assetsProcessed: Object.keys(assetUpdates) }
      ),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    syncEventBus.emitError(title, MediaType.Movie, context.serverConfig.id, message, SyncOperation.Assets)
    // Nothing is written. What the step had already asked to remove, held
    // back or left to the retry stands.
    plan.set = {}
    plan.incomplete = true
    plan.deferrals.push('artwork')
    return {
      plan,
      retries,
      result: movieStepResult(title, SyncOperation.Assets, context, SyncStatus.Failed, [], [message], {
        processingTime: Date.now() - startTime,
      }),
    }
  }
}

/**
 * The blurhash retry step. See the module comment.
 *
 * @param retries - The artwork step's retries, poster first
 */
export async function retryMovieBlurhashes(
  { originalTitle, context }: MovieStepInput,
  retries: readonly BlurhashRetry[]
): Promise<MovieStepOutcome> {
  const startTime = Date.now()
  const title = originalTitle
  const plan = emptyWritePlan<MovieEntity>()

  try {
    syncEventBus.emitProgress(title, MediaType.Movie, context.serverConfig.id, SyncOperation.Blurhash, {
      stage: 'starting',
      progress: 0,
    })

    const changes: string[] = []
    const set: Record<string, any> = {}
    for (const { field, sourceField, decision } of retries) {
      console.log(
        `🔍 Movie blurhash retry: fetching "${field}" for "${originalTitle}" (server: "${context.serverConfig.id}", path: ${decision.blurhashUrl})`
      )
      // fetchMetadataMultiServer takes the ResourceManager's HTTP slot itself:
      // wrapping it in throttleHttp would hold one slot while waiting for another.
      let fetched: unknown = null
      try {
        fetched = await fetchMetadataMultiServer(context.serverConfig.id, decision.blurhashUrl, 'blurhash', 'movie', originalTitle)
      } catch (fetchError) {
        console.warn(
          `⚠️ Movie blurhash retry: failed to fetch "${field}" for "${originalTitle}":`,
          fetchError instanceof Error ? fetchError.message : String(fetchError)
        )
      }
      const outcome = settleBlurhash(decision, fetched)
      if (outcome.action !== 'write') {
        // Still missing: the pass is not complete, so the title is not
        // skipped from now on with the blurhash missing.
        console.log(`⏭️ Movie blurhash retry: "${field}" fetch returned empty/null for "${originalTitle}"`)
        plan.incomplete = true
        plan.deferrals.push(field)
        continue
      }
      set[field] = outcome.blurhash
      set[sourceField] = outcome.blurhashSource
      changes.push(`Updated ${field}`)
      console.log(`✅ Movie blurhash retry: "${field}" updated for "${originalTitle}" (server: ${context.serverConfig.id})`)
    }
    plan.set = set

    syncEventBus.emitProgress(
      title,
      MediaType.Movie,
      context.serverConfig.id,
      SyncOperation.Blurhash,
      changes.length > 0 ? { stage: 'completed', progress: 100, updatedFields: changes } : { stage: 'unchanged', progress: 100 }
    )

    return {
      plan,
      result: movieStepResult(
        title,
        SyncOperation.Blurhash,
        context,
        changes.length > 0 ? SyncStatus.Completed : SyncStatus.Skipped,
        changes,
        [],
        { processingTime: Date.now() - startTime }
      ),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    syncEventBus.emitError(title, MediaType.Movie, context.serverConfig.id, message, SyncOperation.Blurhash)
    return {
      plan: { ...emptyWritePlan<MovieEntity>(), incomplete: true, deferrals: ['blurhash retry'] },
      result: movieStepResult(title, SyncOperation.Blurhash, context, SyncStatus.Failed, [], [message], {
        processingTime: Date.now() - startTime,
      }),
    }
  }
}

/**
 * Decide every image and hint for a movie from this server's payload (URLs
 * from fileServerData, which carry ?hash= for cache-busting and change
 * detection). Returns the fields to write and the names of the fields cleared.
 * What to remove, hold back or retry goes straight into `plan` and `retries`,
 * so that a throw part way keeps what was decided before it.
 */
async function decideArtwork(
  originalTitle: string,
  context: SyncContext,
  currentMovie: MovieEntity,
  plan: MovieStepOutcome['plan'],
  retries: BlurhashRetry[]
): Promise<{
  updates: {
    posterURL?: string
    backdrop?: string
    logo?: string
    posterBlurhash?: string
    backdropBlurhash?: string
    posterBlurhashSource?: string
    backdropBlurhashSource?: string
    backdropFocal?: BackdropFocal
    backdropFocalSuggested?: BackdropFocal
  }
  cleared: string[]
}> {
  const updates: any = {}
  const cleared: string[] = []
  const unset = (fields: string[]) => {
    for (const field of fields) if (!plan.unset.includes(field)) plan.unset.push(field)
  }

  // Get file server data for this movie
  const fileServerData = context.fileServerData?.movies?.[originalTitle]
  if (!fileServerData?.urls) {
    syncLogger.debug(`⏭️ No fileServerData.urls found for "${originalTitle}"`)
    return { updates, cleared }
  }

  // Define asset types with their corresponding field names
  // IMPORTANT: poster uses "posterURL", but backdrop and logo do NOT have "URL" suffix
  const assetTypes = [
    { type: 'poster', urlField: 'posterURL', fileServerKey: 'poster' },
    { type: 'backdrop', urlField: 'backdrop', fileServerKey: 'backdrop' },
    { type: 'logo', urlField: 'logo', fileServerKey: 'logo' },
  ]

  // Process each asset type
  for (const { type, urlField, fileServerKey } of assetTypes) {
    const assetRelativePath = fileServerData.urls[fileServerKey]

    if (!assetRelativePath) {
      syncLogger.debug(`⏭️ No ${type} path in fileServerData.urls for "${originalTitle}"`)
      continue
    }

    // The asset belongs to the highest-priority server that HAS it.
    // CRITICAL: Use type-safe field path mapping (e.g., posterURL → "urls.poster")
    const fieldPath = getFieldPath(urlField as keyof typeof MovieFieldPathMap)
    if (!ownsReportedField(fieldPath, originalTitle, context)) {
      syncLogger.debug(`⏭️ Skipping ${urlField} - server ${context.serverConfig.id} does not have highest priority for ${fieldPath}`)
      continue
    }

    // Build full URL: fileServerData paths already include the prefix
    const newAssetUrl = fileServerUrl(assetRelativePath, context.serverConfig)
    const currentUrl = currentMovie[urlField as keyof MovieEntity] as string

    // The stored URL must be the owner's URL. The two used to be compared by
    // their ?hash= alone, which is the image file's modified time: a copy of
    // the same file on another server has the same one. So when a title
    // moved to another server, or the owner was down when the title was
    // first synced, the stored URL kept pointing at the other server for good.
    const newHash = extractHashFromUrl(newAssetUrl)
    const currentHash = currentUrl ? extractHashFromUrl(currentUrl) : null
    const assetChanged = newAssetUrl !== currentUrl

    syncLogger.debug(`🔍 Asset comparison for ${type}:`, {
      newHash,
      currentHash,
      changed: assetChanged,
    })

    // Update asset URL if changed
    if (assetChanged) {
      updates[urlField] = newAssetUrl
      syncLogger.debug(`✅ Updating ${urlField} from server ${context.serverConfig.id} (hash changed: ${currentHash} → ${newHash})`)
    }

    // Blurhash for poster and backdrop: kept, fetched or removed by the one
    // rule every image follows (core/imageAndBlurhash), decided once here.
    // This server owns the image (checked above).
    if (type === 'poster' || type === 'backdrop') {
      const blurhashField = type === 'poster' ? 'posterBlurhash' : 'backdropBlurhash'
      const blurhashSourceField = type === 'poster' ? 'posterBlurhashSource' : 'backdropBlurhashSource'
      const lockedFields = (currentMovie as any).lockedFields
      const currentBlurhash = currentMovie[blurhashField as keyof MovieEntity] as string | undefined

      const decision = decideBlurhash({
        stored: {
          url: currentUrl,
          blurhash: currentBlurhash,
          blurhashSource: (currentMovie as any)[blurhashSourceField],
        },
        reported: { url: newAssetUrl, blurhashUrl: fileServerData.urls[blurhashField] },
        owner: context.serverConfig.id,
        locks: {
          image: isTopLevelFieldLocked(lockedFields, urlField),
          blurhash: isTopLevelFieldLocked(lockedFields, blurhashField),
        },
      })
      const outcome =
        decision.action === 'fetch'
          ? settleBlurhash(
              decision,
              // The payload's path is already under the server's prefix.
              await fetchBlurhashData(fileServerUrl(decision.blurhashUrl, context.serverConfig), context)
            )
          : decision.action === 'unset'
            ? ({ action: 'unset', fetchFailed: false } as const)
            : ({ action: 'keep', fetchFailed: false } as const)

      if (outcome.action === 'write') {
        if (currentBlurhash !== outcome.blurhash) updates[blurhashField] = outcome.blurhash
        if ((currentMovie as any)[blurhashSourceField] !== outcome.blurhashSource) {
          updates[blurhashSourceField] = outcome.blurhashSource
        }
      } else {
        if (outcome.fetchFailed && decision.action === 'fetch') {
          if (decision.replacesStale) {
            // A stale blurhash goes (below), and is not tried again this
            // pass: the pass is not complete, so the next run fetches it.
            plan.incomplete = true
            plan.deferrals.push(blurhashField)
          } else {
            // None was stored: the retry step tries again.
            retries.push({ field: blurhashField, sourceField: blurhashSourceField, decision })
          }
        }
        if (outcome.action === 'unset') {
          unset([blurhashField, blurhashSourceField])
          cleared.push(blurhashField)
        }
      }
    }
  }

  // Backdrop focal-point hints — top-level scalars in fileServerData, plain
  // string enum (not URL/hash). The file server always publishes both keys,
  // null when it has no hint.
  //
  // A hint belongs to the highest-priority server that HAS one. A server
  // without one used to write its null whenever no higher-priority server
  // was listed for the field, and the server with the hint wrote it back:
  // the stored value flipped on every run and neither server was ever
  // skipped. The hint is removed only when no server has one, and then only
  // on a run where every server answered.
  // `undefined` means the server doesn't supply the field at all — skip.
  for (const focalField of ['backdropFocal', 'backdropFocalSuggested'] as const) {
    const incoming = fileServerData[focalField]
    if (incoming === undefined) {
      syncLogger.debug(`⏭️ No ${focalField} in fileServerData for "${originalTitle}"`)
      continue
    }

    const fieldPath = getFieldPath(focalField)
    const current = currentMovie[focalField] ?? null

    if (incoming !== null && incoming !== '') {
      if (!ownsReportedField(fieldPath, originalTitle, context)) {
        syncLogger.debug(`⏭️ Skipping ${focalField} - server ${context.serverConfig.id} does not have highest priority for ${fieldPath}`)
        continue
      }
      // The owner's id is the hint's source whether or not the value moved.
      if ((currentMovie as any)[`${focalField}Source`] !== context.serverConfig.id) {
        updates[`${focalField}Source`] = context.serverConfig.id
      }
      if (incoming !== current) {
        updates[focalField] = incoming as BackdropFocal
        syncLogger.debug(`✅ Updating ${focalField} from server ${context.serverConfig.id} ("${current}" → "${incoming}")`)
      }
      continue
    }

    // This server has no hint. Nothing to do unless one is stored and no
    // server has one any more.
    if (current === null) continue
    // A hint an admin locked stays, whatever the servers say.
    if (isTopLevelFieldLocked((currentMovie as any).lockedFields, focalField)) continue
    const serversWithHint = getServersReportingField(context.fieldAvailability, 'movies', originalTitle, fieldPath)
    if (serversWithHint.length > 0) continue
    if ((context.allEnabledServersProbed ?? context.cleanup?.allEnabledServersProbed) === true) {
      unset([focalField, `${focalField}Source`])
      cleared.push(focalField)
    } else {
      // Its server may simply be down. Retry on a run where they all answer.
      plan.incomplete = true
      plan.deferrals.push(focalField)
    }
  }

  return { updates, cleared }
}

/**
 * Extract hash parameter from URL for change detection
 * URLs include hash like: /path/to/image.jpg?hash=abc123
 */
function extractHashFromUrl(url: string): string | null {
  try {
    const urlObj = new URL(url)
    return urlObj.searchParams.get('hash')
  } catch {
    // If URL parsing fails, return null
    return null
  }
}

/**
 * Fetch actual blurhash data from URL using httpHelper
 * httpHelper handles caching and HTTP errors internally
 * Returns null on failure so the field is OMITTED (not set to null in database)
 * Respects ResourceManager HTTP throttling when available in context
 */
async function fetchBlurhashData(blurhashUrl: string, context?: SyncContext): Promise<string | null> {
  const doFetch = async () => {
    try {
      const response = await httpGet(
        blurhashUrl,
        {
          timeout: 3000, // 3 second timeout for blurhash (matches legacy)
          responseType: 'text',
          headers: {
            Accept: 'text/plain, */*',
          },
        },
        true // returnCacheDataIfAvailable - return cached data on 304
      )

      // Check Content-Type header - should be text/plain, not text/html (error page)
      const contentType = response.headers['content-type'] || response.headers['Content-Type'] || ''
      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        syncLogger.warn(`⚠️ Blurhash URL returned HTML (error page), Content-Type: ${contentType}`)
        return null
      }

      // Extract data from wrapper if it's a cached response with _dataType
      // httpHelper stores text as: { _dataType: 'text', _isBuffer: false, data: actualText }
      let blurhashData = response.data
      if (blurhashData && typeof blurhashData === 'object' && blurhashData._dataType === 'text') {
        blurhashData = blurhashData.data
      }

      const trimmedData = blurhashData ? blurhashData.trim() : null

      if (!trimmedData) {
        return null
      }

      return trimmedData
    } catch (error) {
      // httpHelper throws on HTTP errors (404, 500, timeouts, etc)
      // Return null so field is OMITTED from database update (not set to null)
      syncLogger.warn(`⚠️ Failed to fetch blurhash:`, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  // Throttle through ResourceManager if available
  if (context?.resourceManager) {
    return context.resourceManager.throttleHttp(doFetch)
  }
  return doFetch()
}

/**
 * Whether this server is the highest-priority server that HAS a value at
 * `fieldPath` for the title. Fails closed: a server that does not report the
 * field never owns it, and neither does anyone when the availability map is
 * missing.
 */
function ownsReportedField(fieldPath: string, originalTitle: string, context: SyncContext): boolean {
  return isCurrentServerHighestPriorityForReportedField(
    context.fieldAvailability, 'movies', originalTitle, fieldPath, context.serverConfig
  )
}
