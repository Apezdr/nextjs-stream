/**
 * Movie content sync strategy
 * Handles synchronization of movie video content (video URLs, duration, quality info)
 */

import {
  SyncStrategy,
  SyncContext,
  SyncResult,
  SyncStatus,
  SyncOperation,
  MediaType,
  BaseMediaEntity,
  MovieEntity,
  resolveMediaId,
  resolveFirstSeen,
  claimDiscovery,
  resolveDeliveryFacts,
  resolveEffectiveVideoUrl,
  VideoInfo,
  MediaQuality,
  ServerConfig,
  syncEventBus,
  MediaTypesFieldAvailability,
  getFieldPath,
  getCaptionFieldPath,
  MovieFieldPathMap,
  sanitizeForLog,
  safeStringify,
} from '../../../core'

import { MovieRepository, UrlBuilder, isTopLevelFieldLocked } from '../../../infrastructure'

import { FileServerAdapter } from '../../../core'
import { reconcileCaptions } from '../../../core/captionReconcile'
import {
  preferReportedViewingExperience,
  sameViewingExperience,
} from '../../../core/viewingExperience'

import {
  isCurrentServerHighestPriorityForField,
  getServersReportingField,
  isHighestPriorityAmongServers,
  serverOutranks,
} from '@src/utils/sync/utils'
import { syncLogger } from '../../../core/logger'
import { warnOnJitIdentityFork } from '../../../core/jitIdentityParity'
import isEqual from 'lodash/isEqual'
 
// @ts-ignore — dependency-free sibling JS module (CJS) with no .d.ts
import { generateNormalizedVideoId as computeNormalizedVideoId } from '@src/utils/videoIdentity'

export class MovieContentStrategy implements SyncStrategy {
  readonly name = 'MovieContentStrategy'
  readonly supportedOperations = [SyncOperation.Content]
  readonly supportedMediaTypes = [MediaType.Movie]

  // Video extensions in selection-priority order — MUST mirror the backend's
  // VIDEO_EXTENSIONS (media-processor node/utils/utils.mjs). The order is
  // load-bearing there: it decides which file a multi-container folder
  // publishes, and .mp4 stays first so existing titles keep their URL.
  private readonly VIDEO_EXTENSIONS = [
    '.mp4',
    '.m4v',
    '.mov',
    '.mkv',
    '.webm',
    '.avi',
  ]

  // Common video filenames to check (in priority order)
  private readonly VIDEO_FILENAMES = ['video', 'movie', 'film', 'main', 'feature']

  // Everything on the document that describes the primary video FILE. These
  // follow the file: written from the payload of the server that owns the
  // video, and cleared with it. mediaId is not here on purpose — it is the
  // folder's durable identity and is set-only (see
  // applyIdentityAndDeliveryUpdates).
  private readonly VIDEO_FILE_FACT_FIELDS = [
    'duration',
    'dimensions',
    'size',
    'hdr',
    'mediaQuality',
    'mediaLastModified',
  ] as const

  constructor(
    private repository: MovieRepository,
    private fileAdapter: FileServerAdapter
  ) {}

  canHandle(context: SyncContext): boolean {
    return (
      context.mediaType === MediaType.Movie &&
      context.operation === SyncOperation.Content &&
      this.supportedMediaTypes.includes(context.mediaType) &&
      this.supportedOperations.includes(context.operation)
    )
  }

  async sync(entity: BaseMediaEntity | null, context: SyncContext): Promise<SyncResult> {
    const startTime = Date.now()
    const title = context.entityTitle || entity?.title || 'unknown'
    const originalTitle = context.entityOriginalTitle || entity?.originalTitle || title

    syncLogger.debug(`🎬 MovieContentStrategy starting for: "${title}"`)

    if (!originalTitle || originalTitle.trim().length === 0) {
      return this.createResult(
        title,
        context,
        SyncStatus.Failed,
        [],
        ['originalTitle is required for content sync operations'],
        { processingTime: Date.now() - startTime }
      )
    }

    try {
      syncEventBus.emitProgress(
        title,
        MediaType.Movie,
        context.serverConfig.id,
        SyncOperation.Content,
        { stage: 'starting', progress: 0 }
      )

      // Get current movie entity using originalTitle (filesystem key)
      let movie = entity as MovieEntity | null
      if (!movie) {
        // 🚀 OPTIMIZATION: Check cache first, then database
        if (context.movieCache?.has(originalTitle)) {
          movie = context.movieCache.get(originalTitle)!
          syncLogger.debug(`💾 Cache HIT for "${originalTitle}"`)
        } else {
          syncLogger.debug(`🔍 Cache MISS for "${originalTitle}", querying database...`)
          movie = await this.repository.findByOriginalTitle(originalTitle)
          if (!movie) {
            syncLogger.debug(
              `🎬 Movie not in database, creating basic entity for content: "${originalTitle}"`
            )
            movie = {
              title,
              originalTitle,
              lastSynced: new Date(),
              metadata: {},
            }
          }
        }
      }

      const changes: string[] = []
      const {
        updates: contentUpdates,
        unset: contentUnset,
        deferred,
      } = await this.syncVideoContent(originalTitle, context, movie)

      // A removal held back for lack of a full probe: tell MovieSyncService not
      // to mark this pass complete, or it would be skipped from now on and the
      // removal never retried.
      if (deferred) {
        if (!context.pendingMovieDeferrals) context.pendingMovieDeferrals = new Set()
        context.pendingMovieDeferrals.add(originalTitle)
      }

      if (Object.keys(contentUpdates).length > 0 || contentUnset.length > 0) {
        // The display title is not this strategy's to write: MovieSyncService
        // derives it once, from the stored metadata, at the consolidated write.
        // Forcing the folder name in here is what made a title flip between
        // "The Matrix" and "The Matrix (1999)" depending on which strategy had
        // something to change.
        const movieToSave: any = {
          ...movie,
          ...contentUpdates,
          originalTitle, // Ensure originalTitle is always set
          lastSynced: new Date(),
        }

        // Add source tracking for updated content fields
        Object.keys(contentUpdates).forEach((field) => {
          if (
            field === 'videoURL' ||
            // Delivery/identity facts are companions of the video block: they
            // describe the primary source that videoURL points at, so they
            // share its owner rather than carrying independent provenance.
            field === 'sources' ||
            field === 'primaryContainer' ||
            field === 'jitEligible' ||
            field === 'jitUrl' ||
            field === 'mediaId'
          ) {
            movieToSave.videoSource = context.serverConfig.id
          } else if (
            field === 'duration' ||
            field === 'dimensions' ||
            field === 'hdr' ||
            field === 'mediaQuality' ||
            field === 'mediaLastModified'
          ) {
            // All video metadata fields use videoInfoSource
            movieToSave.videoInfoSource = context.serverConfig.id
          } else if (field === 'captionURLs') {
            // The map can hold entries from several servers. Name the source
            // from the map itself (its first language, alphabetically) so the
            // value does not depend on which server's pass ran last.
            const captions = contentUpdates.captionURLs as Record<string, any>
            const firstLanguage = Object.keys(captions).sort()[0]
            movieToSave.captionSource =
              captions[firstLanguage]?.sourceServerId ?? context.serverConfig.id
          } else if (field === 'chapterURL') {
            movieToSave.chapterSource = context.serverConfig.id
          }
        })

        // A title that ends this pass with no video has no video source. The
        // loop above stamps one whenever a video-block field changed, which
        // includes clearing the URL and setting the folder's mediaId on a
        // title that never had a video; put back whatever was stored.
        const videoUrlAfter =
          'videoURL' in contentUpdates ? contentUpdates.videoURL : (movie as any).videoURL
        if (videoUrlAfter == null) {
          if ((movie as any).videoSource === undefined) delete movieToSave.videoSource
          else movieToSave.videoSource = (movie as any).videoSource
        }

        // A field being cleared must not also ride along as a value (the
        // spread above carries the document's old one, and a source stamp may
        // have just been set for a field whose data is going).
        for (const field of contentUnset) delete movieToSave[field]

        // Accumulate changes for consolidated write in MovieSyncService
        if (context.pendingMovieUpdates) {
          const prev: any = { ...(context.pendingMovieUpdates.get(originalTitle) || {}) }
          for (const field of contentUnset) delete prev[field]
          context.pendingMovieUpdates.set(originalTitle, { ...prev, ...movieToSave })
          if (contentUnset.length > 0) {
            if (!context.pendingMovieUnsets) context.pendingMovieUnsets = new Map()
            const pendingUnset = context.pendingMovieUnsets.get(originalTitle) ?? new Set<string>()
            for (const field of contentUnset) pendingUnset.add(field)
            context.pendingMovieUnsets.set(originalTitle, pendingUnset)
          }
        } else {
          await this.repository.upsert(movieToSave)
        }

        // Add specific changes for each updated field
        Object.keys(contentUpdates).forEach((key) => {
          changes.push(`Updated ${key}`)
        })
        contentUnset.forEach((key) => {
          changes.push(`Cleared ${key}`)
        })

        syncEventBus.emitProgress(
          title,
          MediaType.Movie,
          context.serverConfig.id,
          SyncOperation.Content,
          {
            stage: 'completed',
            progress: 100,
            updatedFields: [...Object.keys(contentUpdates), ...contentUnset],
          }
        )
      } else {
        syncEventBus.emitProgress(
          title,
          MediaType.Movie,
          context.serverConfig.id,
          SyncOperation.Content,
          { stage: 'unchanged', progress: 100 }
        )
      }

      return this.createResult(
        title,
        context,
        changes.length > 0 ? SyncStatus.Completed : SyncStatus.Skipped,
        changes,
        [],
        {
          processingTime: Date.now() - startTime,
          contentProcessed: [...Object.keys(contentUpdates), ...contentUnset],
        }
      )
    } catch (error) {
      syncEventBus.emitError(
        title,
        MediaType.Movie,
        context.serverConfig.id,
        error instanceof Error ? error.message : String(error),
        SyncOperation.Content
      )

      return this.createResult(
        title,
        context,
        SyncStatus.Failed,
        [],
        [error instanceof Error ? error.message : String(error)],
        { processingTime: Date.now() - startTime }
      )
    }
  }

  /**
   * Sync video content for a movie using originalTitle (filesystem key)
   */
  private async syncVideoContent(
    originalTitle: string,
    context: SyncContext,
    currentMovie: MovieEntity
  ): Promise<{
    /** Fields to write. */
    updates: {
      videoURL?: string | null
      duration?: number
      dimensions?: string
      hdr?: string
      mediaQuality?: MediaQuality
      mediaLastModified?: Date
      normalizedVideoId?: string
      captionURLs?: Record<
        string,
        {
          srcLang: string
          url: string
          lastModified?: string
          sourceServerId?: string
        }
      >
      chapterURL?: string
    }
    /** Fields to remove from the document: their data is gone, not changed. */
    unset: string[]
    /** A removal was held back because not every enabled server answered. */
    deferred: boolean
  }> {
    const updates: any = {}
    const unset: string[] = []
    let deferred = false
    const hasStoredValue = (value: unknown) => value !== undefined && value !== null

    syncLogger.debug(`Syncing video content for: "${originalTitle}"`)

    let fileServerMovieData = null

    // Extract the specific movie data from the file server data structure
    if (context.fileServerData?.movies?.[originalTitle]) {
      fileServerMovieData = context.fileServerData.movies[originalTitle]
      syncLogger.debug(`Found file server data for "${originalTitle}"`)
    } else {
      syncLogger.debug(`No file server data found for "${originalTitle}"`)
    }

    // Step 1: Get video URL from file server data
    let videoUrl: string | null = null
    if (fileServerMovieData) {
      videoUrl = this.getVideoUrlFromFileServerData(originalTitle, fileServerMovieData, context)
    } else {
      syncLogger.debug(`No file server data available for "${originalTitle}", falling back to file probing`)
      videoUrl = await this.findVideoFileByProbing(originalTitle, context)
    }

    // Who may write the video block, and who may clear it.
    //
    // WRITE: only the highest-priority server that HAS a video for this title.
    // The check used to be "no server with the field outranks me", which a
    // server without the field passes whenever its priority number is lower.
    // So a folder with no video on the main server (an override placeholder,
    // or a folder whose file was deleted) set videoURL, sources and jitUrl to
    // null on every run, and the server that does have the video put them
    // back — which of the two the run ended on depended on server order.
    //
    // CLEAR: only when NO server has a video for it, and only on the say-so of
    // the server the stored video came from, or on a run in which every enabled
    // server answered. A server that is down has not deleted its files.
    const videoPath = getFieldPath('videoURL')
    const isVideoUrlLocked = isTopLevelFieldLocked((currentMovie as any)?.lockedFields, 'videoURL')
    let ownsVideo: boolean
    let videoGone: boolean
    if (fileServerMovieData) {
      const reporters = getServersReportingField(
        context.fieldAvailability,
        'movies',
        originalTitle,
        videoPath
      )
      // A URL found through the fileNames fallback has no urls.mp4 leaf, so
      // the server is not among the reporters. It counts as having the video
      // only when nobody reports one: ranked alongside real reporters it would
      // be an owner in its own pass and absent from everyone else's, and two
      // servers would each conclude they own the video.
      const serversWithVideo =
        reporters.length > 0 ? reporters : videoUrl != null ? [context.serverConfig.id] : []
      ownsVideo = videoUrl != null && isHighestPriorityAmongServers(serversWithVideo, context.serverConfig)
      const noServerHasVideo = videoUrl == null && reporters.length === 0
      videoGone = noServerHasVideo && this.mayDeclareVideoGone(currentMovie, context)
      if (noServerHasVideo && !videoGone && currentMovie.videoURL) {
        // There is a video to clear and this pass may not clear it.
        deferred = true
      }
    } else {
      // No payload for this title: the URL, if any, came from probing, and
      // there is no availability to rank against. A probe that finds nothing
      // (or fails) is not evidence the video is gone, so this path never clears.
      ownsVideo =
        videoUrl != null &&
        (this.shouldUpdateField(videoPath, originalTitle, context) || !currentMovie.videoURL)
      videoGone = false
    }

    if (ownsVideo) {
      if (currentMovie.videoURL !== videoUrl) {
        updates.videoURL = videoUrl
        syncLogger.debug(
          `✅ Updating videoURL from server ${context.serverConfig.id}: "${currentMovie.videoURL}" → "${videoUrl}"`
        )
      }
    } else if (videoGone && currentMovie.videoURL) {
      updates.videoURL = null
      syncLogger.debug(
        `✅ Clearing videoURL: no server has a video for "${originalTitle}" (was "${currentMovie.videoURL}")`
      )
    }

    // The owner's id is the video's source, whether or not the URL itself moved
    // (a hand-over between two servers serving the same path leaves the URL as
    // it was). Stamped here rather than left to "a field changed", so the value
    // does not depend on the title's history.
    if (ownsVideo && fileServerMovieData) {
      if ((currentMovie as any).videoSource !== context.serverConfig.id) {
        updates.videoSource = context.serverConfig.id
      }
      if ((currentMovie as any).videoInfoSource !== context.serverConfig.id) {
        updates.videoInfoSource = context.serverConfig.id
      }
    }

    // The URL this write leaves in the document (a locked URL stays whatever
    // lands in `updates`). Everything derived from the file keys off this.
    const effectiveVideoUrl = resolveEffectiveVideoUrl({
      currentVideoUrl: currentMovie.videoURL,
      updates,
      isVideoUrlLocked,
    })

    // Step 2: Facts about the video file (duration, dimensions, size, hdr,
    // mediaQuality, mediaLastModified).
    //
    // These describe the file videoURL points at, so they come from the server
    // that owns the video and from nowhere else: a value in its payload is
    // written, and a value its probe did not report is cleared. They used to
    // be set-if-present under their own per-field priority, which left an
    // "HDR10" label on a title whose file had been replaced by an SDR one (the
    // payload says hdr: null), left the whole block behind when the file was
    // deleted, and let a server with no video own `hdr` and `mediaQuality`
    // merely by reporting them as null.
    if (fileServerMovieData) {
      if (ownsVideo) {
        const videoFacts = this.extractVideoMetadataFromFileServerData(
          originalTitle,
          fileServerMovieData
        )
        // null means the payload could not be read. Change nothing rather than
        // clear on an error.
        if (videoFacts) {
          // The stored facts describe the stored URL. When this pass points the
          // title at another file (another server's, or a replacement under a
          // new name) they are not that file's, probed or not.
          const differentFile = !isVideoUrlLocked && currentMovie.videoURL !== videoUrl
          this.mirrorVideoFileFacts(updates, unset, currentMovie, videoFacts, originalTitle, differentFile)
        }
      } else if (videoGone && !effectiveVideoUrl) {
        for (const field of [
          ...this.VIDEO_FILE_FACT_FIELDS,
          'normalizedVideoId',
          'videoSource',
          'videoInfoSource',
        ]) {
          if (hasStoredValue((currentMovie as any)[field])) unset.push(field)
        }
      }
    } else if (videoUrl || currentMovie.videoURL) {
      // No payload for this title: the per-file probe below is all there is.
      let videoMetadata: {
        duration?: number
        dimensions?: string
        hdr?: string
        mediaLastModified?: Date
        codec?: string
        bitrate?: number
        frameRate?: number
        audioCodec?: string
        audioChannels?: number
        fileSize?: number
        mediaQuality?: MediaQuality
      } | null = null
      syncLogger.debug(`No file server data for "${originalTitle}" metadata, falling back to legacy method`)
      videoMetadata = await this.extractVideoMetadata(
        videoUrl || currentMovie.videoURL!,
        originalTitle,
        context
      )

      if (videoMetadata) {
        // LEGACY STRUCTURE: Store fields FLAT at root level (NO nested videoInfo object)

        // Check priority for each metadata field separately
        if (
          videoMetadata.duration &&
          this.shouldUpdateField(getFieldPath('duration'), originalTitle, context)
        ) {
          if (currentMovie.duration !== videoMetadata.duration) {
            updates.duration = videoMetadata.duration
            syncLogger.debug(
              `✅ Updating duration from server ${context.serverConfig.id}: ${currentMovie.duration} → ${videoMetadata.duration}`
            )
          } else {
            syncLogger.debug(
              `📝 Duration unchanged: ${videoMetadata.duration} (server ${context.serverConfig.id} has priority but value identical)`
            )
          }
        }

        if (
          videoMetadata.dimensions &&
          this.shouldUpdateField(getFieldPath('dimensions'), originalTitle, context)
        ) {
          if (currentMovie.dimensions !== videoMetadata.dimensions) {
            updates.dimensions = videoMetadata.dimensions
            syncLogger.debug(
              `✅ Updating dimensions from server ${context.serverConfig.id}: "${currentMovie.dimensions}" → "${videoMetadata.dimensions}"`
            )
          } else {
            syncLogger.debug(
              `📝 Dimensions unchanged: "${videoMetadata.dimensions}" (server ${context.serverConfig.id} has priority but value identical)`
            )
          }
        }

        // HDR field at root level (legacy format)
        if (
          videoMetadata.hdr &&
          this.shouldUpdateField(getFieldPath('hdr'), originalTitle, context)
        ) {
          if (currentMovie.hdr !== videoMetadata.hdr) {
            updates.hdr = videoMetadata.hdr
            syncLogger.debug(
              `✅ Updating hdr from server ${context.serverConfig.id}: "${currentMovie.hdr}" → "${videoMetadata.hdr}"`
            )
          } else {
            console.log(
              `📝 HDR unchanged: "${videoMetadata.hdr}" (server ${context.serverConfig.id} has priority but value identical)`
            )
          }
        }

        // NEW: Media last modified field (legacy format)
        if (
          videoMetadata.mediaLastModified &&
          this.shouldUpdateField(getFieldPath('mediaLastModified'), originalTitle, context)
        ) {
          const currentModified = currentMovie.mediaLastModified
          const newModified = videoMetadata.mediaLastModified
          if (!currentModified || currentModified.getTime() !== newModified.getTime()) {
            updates.mediaLastModified = newModified
            console.log(`✅ Updating mediaLastModified from server ${context.serverConfig.id}`)
          } else {
            console.log(
              `📝 MediaLastModified unchanged (server ${context.serverConfig.id} has priority but value identical)`
            )
          }
        }

        // FIX: Add size field update logic here
        // Check priority for any of the size subfields (gb, mb, kb)
        const shouldUpdateSize =
          this.shouldUpdateField('additional_metadata.size.gb', originalTitle, context) ||
          this.shouldUpdateField('additional_metadata.size.mb', originalTitle, context) ||
          this.shouldUpdateField('additional_metadata.size.kb', originalTitle, context)

        if (videoMetadata.fileSize && shouldUpdateSize) {
          if (currentMovie.size !== videoMetadata.fileSize) {
            updates.size = videoMetadata.fileSize
            console.log(
              `✅ Updating size from server ${context.serverConfig.id}: ${currentMovie.size} → ${videoMetadata.fileSize}`
            )
          } else {
            console.log(
              `📝 Size unchanged: ${videoMetadata.fileSize} (server ${context.serverConfig.id} has priority but value identical)`
            )
          }
        }

        if (
          videoMetadata.mediaQuality &&
          this.shouldUpdateMediaQuality(videoMetadata.mediaQuality, originalTitle, context)
        ) {
          const currentQuality = currentMovie.mediaQuality
          if (!this.isMediaQualityEqual(currentQuality, videoMetadata.mediaQuality)) {
            updates.mediaQuality = videoMetadata.mediaQuality
            console.log(`✅ Updating mediaQuality from server ${context.serverConfig.id}`)
            console.log(`   Current:`, currentQuality)
            console.log(`   New:`, videoMetadata.mediaQuality)
          } else {
            console.log(
              `📝 MediaQuality unchanged (server ${context.serverConfig.id} has priority for some fields but value identical)`
            )
          }
        }

        // NOTE: videoInfo uses FLAT structure only
        // All fields are stored at root level: duration, dimensions, hdr, mediaQuality, mediaLastModified
      }
    }

    // Step 3: Generate normalized video ID for deduplication.
    // Derived from the EFFECTIVE videoURL — the value this write actually
    // leaves in the doc, which is NOT always the URL this server reported.
    // Two things withhold it, and both must be honored here:
    //
    //   1. An admin lock, which computeDiff drops on the way to Mongo.
    //   2. Field PRIORITY. A server that does not own videoURL never gets its
    //      URL written (the block above is gated on `ownsVideo`), but this
    //      step used to hash that URL anyway — so on a title present on two
    //      servers, the non-owner's pass silently re-keyed the doc to its own
    //      path shape while videoURL kept the owner's. Every
    //      `WatchHistory.normalizedVideoId === FlatMovies.normalizedVideoId`
    //      join for that title then failed: the client reports a hash of the
    //      URL it was served, and the catalog holds a hash of a URL nobody
    //      plays. Observed as three movies keyed to an un-prefixed path while
    //      served from a `prefixPath: '/media'` server.
    //
    // Deriving from the post-write value covers both, and makes any server's
    // pass repair a title that drifted. The rule itself lives in
    // `resolveEffectiveVideoUrl` (sync/core) — the TV path applies the same
    // discipline inline in EpisodeSyncService, deriving from `entity.videoURL`
    // inside its own priority gate. For a locked JIT-transcoder URL the shared
    // canonicalizer maps it to the source pathname, so locked-JIT and unlocked
    // produce the same id. Must agree with
    // flatDatabaseUtils.generateNormalizedVideoId so WatchHistory joins work.
    // Not tracked in fieldAvailability (it's derivable, not authoritative).
    // (effectiveVideoUrl is resolved above, right after the videoURL decision.
    // With no URL left there is no id to derive; a stale one is cleared with
    // the rest of the file's facts in step 2.)
    if (effectiveVideoUrl) {
      const normalizedId = this.generateNormalizedVideoId(
        effectiveVideoUrl,
        originalTitle,
        fileServerMovieData
      )
      if (currentMovie.normalizedVideoId !== normalizedId) {
        updates.normalizedVideoId = normalizedId
        syncLogger.debug(
          `✅ Updating normalizedVideoId from server ${context.serverConfig.id}: "${currentMovie.normalizedVideoId}" → "${normalizedId}"`
        )
      } else {
        syncLogger.debug(
          `📝 NormalizedVideoId unchanged: "${normalizedId}"`
        )
      }
      // The JIT manifest for the same file must key to the same identity, or
      // rows written through the transcoder never join this document.
      warnOnJitIdentityFork(
        {
          videoURL: effectiveVideoUrl,
          jitUrl: ('jitUrl' in updates ? updates.jitUrl : currentMovie.jitUrl) ?? null,
          label: `movie:${originalTitle}`,
        },
        (fields, message) => syncLogger.warn(`${message} ${JSON.stringify(fields)}`)
      )
    }

    // Step 3b: Ingest the backend's content identity and delivery facts.
    //
    // These ride the video block's ownership (see the source-stamp mapping in
    // sync()) rather than claiming their own fieldAvailability leaves: they
    // describe the primary source that videoURL points at, so a server that
    // does not own videoURL must not be able to publish them. The server that
    // may declare the video gone mirrors them too: that is what clears them.
    if (fileServerMovieData && (ownsVideo || videoGone)) {
      this.applyIdentityAndDeliveryUpdates(
        updates,
        currentMovie,
        fileServerMovieData,
        originalTitle,
        context
      )
    }

    // Step 3c: Library-add date (earlier-wins, never later; core/discovery.ts).
    // The backend's first-seen date lives in the identity sidecar on the media
    // volume, so it survives this document being deleted and re-created. It is
    // adopted ONLY when it predates what we hold: a sidecar written at the
    // identity rollout carries the rollout date for a title that was already
    // here, and that must not re-date the title.
    //
    // Every server that has the title's video is heard, not just the video's
    // owner: the earliest date any of them holds is when the title entered the
    // library. Heard from the owner alone, the stored date depended on which
    // server happened to be down when the title was first synced.
    if (fileServerMovieData && (videoUrl != null || videoGone)) {
      const firstSeen = resolveFirstSeen((fileServerMovieData as any).mediaIdentity)
      const claim = claimDiscovery(
        currentMovie.initialDiscoveryDate,
        currentMovie.initialDiscoveryServer,
        firstSeen,
        context.serverConfig.id,
        (heldServerId) => serverOutranks(context.serverConfig, heldServerId)
      )
      if (claim === 'date') updates.initialDiscoveryDate = firstSeen
      if (claim) updates.initialDiscoveryServer = context.serverConfig.id
    }

    // Step 4: Captions. One language belongs to the highest-priority server
    // that lists it; this pass edits the stored map entry by entry (see
    // core/captionReconcile). It used to replace the whole map with the
    // languages this server owns and to do nothing when it listed none, so two
    // servers overwrote each other every run and a removed subtitle stayed
    // once it was the last.
    if (fileServerMovieData) {
      let listedCaptions: Record<string, any> | null = null
      let captionsReadable = true
      try {
        listedCaptions = UrlBuilder.processCaptionURLs(
          (fileServerMovieData as any)?.urls?.subtitles,
          context.serverConfig
        )
      } catch (error) {
        // Not being able to read the list is not the same as an empty list:
        // leave the stored captions alone.
        captionsReadable = false
        syncLogger.error(`Failed to read captions for ${originalTitle}:`, error)
      }

      if (captionsReadable) {
        const serversListing = (language: string) =>
          getServersReportingField(
            context.fieldAvailability,
            'movies',
            originalTitle,
            getCaptionFieldPath(language, 'url')
          )
        const result = reconcileCaptions({
          existing: currentMovie.captionURLs as Record<string, any> | undefined,
          listed: listedCaptions,
          serverId: context.serverConfig.id,
          ownsLanguage: (language) => {
            const servers = serversListing(language)
            return isHighestPriorityAmongServers(
              servers.includes(context.serverConfig.id)
                ? servers
                : [...servers, context.serverConfig.id],
              context.serverConfig
            )
          },
          listedByAnyServer: (language) => serversListing(language).length > 0,
          allEnabledServersProbed: this.allEnabledServersProbed(context),
        })

        if (result.withheld.length > 0) deferred = true

        if (result.changed) {
          if (Object.keys(result.captions).length > 0) {
            updates.captionURLs = result.captions
          } else {
            // No captions left: drop the field rather than store an empty map.
            unset.push('captionURLs', 'captionSource')
          }
          syncLogger.debug(
            `✅ Captions for "${originalTitle}" from server ${context.serverConfig.id}: ` +
              `wrote [${result.written.join(', ')}], removed [${result.removed.join(', ')}]`
          )
        }
      }
    }

    // Step 5: Process chapters from file server data
    if (fileServerMovieData) {
      const chapterUrl = this.extractChapterFromFileServerData(
        originalTitle,
        fileServerMovieData,
        context
      )

      if (
        chapterUrl &&
        this.shouldUpdateField(getFieldPath('chapterURL'), originalTitle, context)
      ) {
        if (currentMovie.chapterURL !== chapterUrl) {
          updates.chapterURL = chapterUrl
          syncLogger.debug(
            `✅ Updating chapterURL from server ${context.serverConfig.id}: "${chapterUrl}"`
          )
        } else {
          syncLogger.debug(
            `📝 ChapterURL unchanged: "${chapterUrl}" (server ${context.serverConfig.id} has priority but value identical)`
          )
        }
      }
    }

    return { updates, unset, deferred }
  }

  /**
   * Whether every enabled server answered this run. Only then does "no server
   * reports it" mean the data is gone rather than that a server is down.
   */
  private allEnabledServersProbed(context: SyncContext): boolean {
    return (
      (context.allEnabledServersProbed ?? context.cleanup?.allEnabledServersProbed) === true
    )
  }

  /**
   * Whether this pass may treat "no server has a video for this title" as the
   * video being gone. The server the stored video came from can always say so.
   * Any other server can only on a run in which every enabled server answered:
   * otherwise the owner may simply be down.
   */
  private mayDeclareVideoGone(currentMovie: MovieEntity, context: SyncContext): boolean {
    const storedOwner = (currentMovie as any)?.videoSource
    return (
      !storedOwner ||
      storedOwner === context.serverConfig.id ||
      this.allEnabledServersProbed(context)
    )
  }

  /**
   * Make the document's facts about the video file match the owning server's
   * payload: a value it reports is written, and a value its probe did not
   * report is cleared.
   *
   * Clearing needs evidence that the probe ran. A file server that cannot
   * probe a file still publishes it, with every fact null and an empty
   * `additional_metadata` (a file mid-copy, a sidecar being regenerated). That
   * is not "these facts are gone" — the file is there and its facts are simply
   * unknown this scan — and the stored ones are left alone. A probed video
   * always has a duration, so a duration in the payload is the evidence: with
   * one, `hdr: null` means the file is SDR; without one, it means nothing.
   *
   * That holds while the document still points at the same file. Facts stored
   * for ANOTHER file (the video was handed to this server, or replaced under a
   * new name) are removed whether or not the new file has been probed: an
   * unknown is better than the previous file's HDR label.
   */
  private mirrorVideoFileFacts(
    updates: any,
    unset: string[],
    currentMovie: MovieEntity,
    facts: {
      duration?: number
      dimensions?: string
      hdr?: string
      mediaLastModified?: Date
      fileSize?: number
      mediaQuality?: MediaQuality
    },
    originalTitle: string,
    /** The stored facts are of another file than the one the payload describes. */
    differentFile: boolean
  ): void {
    const current = currentMovie as any
    const probed = facts.duration !== undefined && facts.duration !== null
    const mirror = (field: string, incoming: unknown, same: (a: any, b: any) => boolean) => {
      if (incoming === undefined || incoming === null || incoming === '') {
        if ((probed || differentFile) && current[field] !== undefined && current[field] !== null) unset.push(field)
      } else if (!same(current[field], incoming)) {
        updates[field] = incoming
      }
    }
    const strictlyEqual = (a: any, b: any) => a === b

    mirror('duration', facts.duration, strictlyEqual)
    mirror('dimensions', facts.dimensions, strictlyEqual)
    mirror('size', facts.fileSize, strictlyEqual)
    mirror('hdr', facts.hdr, strictlyEqual)
    mirror('mediaQuality', facts.mediaQuality, (a, b) => this.isMediaQualityEqual(a, b))

    // The file's modified time is set when the payload has one and otherwise
    // left alone: a file that exists has one, so its absence is a failed stat,
    // not a fact.
    const modified = facts.mediaLastModified
    if (modified instanceof Date && Number.isNaN(modified.getTime())) {
      syncLogger.warn(`⚠️ Unreadable mediaLastModified in the payload for "${originalTitle}", keeping the stored value`)
    } else if (modified instanceof Date) {
      const stored = current.mediaLastModified
      if (!(stored instanceof Date) || stored.getTime() !== modified.getTime()) {
        updates.mediaLastModified = modified
      }
    }
  }

  /**
   * Get video URL from existing file server data (passed through sync context)
   * The file server data is already fetched via single API call (e.g., /nodejs/media/movies)
   */
  /**
   * Ingest the backend's content identity (`mediaIdentity.id`) and the
   * delivery facts describing the primary source (`sources[]`,
   * `primaryContainer`, `jitEligible`, `jitUrl`).
   *
   * Two deliberately different write disciplines:
   *
   * - `mediaId` is SET-ONLY. It is durable content identity (folder-derived,
   *   sidecar-persisted); a payload that cannot resolve it emits `null`, which
   *   must never clear a value we already hold. It is also on
   *   FieldAbsenceCleaner's denylist for the same reason.
   *
   * - The delivery facts are MIRRORED: present → set, payload-present-but-
   *   absent → explicit null/false. That mirroring IS the durable off-switch —
   *   when an operator disables JIT on the owning host, the next sync clears
   *   the URL and those titles stop being served through the transcoder.
   *   FieldAbsenceCleaner is the wrong rail for this (it probes all servers
   *   and has no episode-level equivalent), so the owner mirrors instead.
   *
   * Both are gated by the caller on the videoURL priority check, so a server
   * that does not own the video cannot publish either.
   */
  private applyIdentityAndDeliveryUpdates(
    updates: any,
    currentMovie: MovieEntity,
    fileServerData: any,
    originalTitle: string,
    context: SyncContext
  ): void {
    // --- Content identity (set-only) ---
    const incomingMediaId = resolveMediaId(fileServerData.mediaIdentity)
    if (incomingMediaId) {
      if (currentMovie.mediaId && currentMovie.mediaId !== incomingMediaId) {
        // Two servers derive the same id for the same folder by construction,
        // so a mismatch means a sidecar was pinned on one side (e.g. a folder
        // renamed on one server only). The video owner wins; surface it so the
        // divergence is fixable rather than silently absorbed.
        syncLogger.warn(
          `⚠️ mediaId mismatch for "${originalTitle}": stored "${currentMovie.mediaId}" (source ${currentMovie.videoSource}) → incoming "${incomingMediaId}" from server ${context.serverConfig.id}`
        )
      }
      if (currentMovie.mediaId !== incomingMediaId) {
        updates.mediaId = incomingMediaId
      }
    }

    // --- Delivery facts (mirrored) ---
    // Movies nest these under `urls`; the same prefix-strip + createFullUrl
    // transform used for urls.mp4 is applied to each source url so a source
    // entry and videoURL can never disagree about host or encoding.
    const facts = resolveDeliveryFacts(
      {
        sources: fileServerData.urls?.sources,
        jitEligible: fileServerData.urls?.jitEligible,
        jitUrl: fileServerData.urls?.jitUrl,
      },
      (url) => this.toFullSourceUrl(url, context)
    )

    if (!isEqual(currentMovie.sources ?? null, facts.sources)) {
      updates.sources = facts.sources
    }
    if ((currentMovie.primaryContainer ?? null) !== facts.primaryContainer) {
      updates.primaryContainer = facts.primaryContainer
    }
    if ((currentMovie.jitEligible ?? false) !== facts.jitEligible) {
      updates.jitEligible = facts.jitEligible
    }
    if ((currentMovie.jitUrl ?? null) !== facts.jitUrl) {
      updates.jitUrl = facts.jitUrl
    }
  }

  /**
   * Mirror of the urls.mp4 conversion: strip a doubled server prefix, then
   * build the full URL.
   */
  private toFullSourceUrl(url: string, context: SyncContext): string {
    let relativePath = url
    if (context.serverConfig.prefix && relativePath.startsWith(context.serverConfig.prefix)) {
      relativePath = relativePath.substring(context.serverConfig.prefix.length)
    }
    return UrlBuilder.createFullUrl(relativePath, context.serverConfig)
  }

  private getVideoUrlFromFileServerData(
    originalTitle: string,
    fileServerData: any,
    context: SyncContext
  ): string | null {
    console.log(`🔍 Getting video URL from file server data for: "${originalTitle}"`)

    if (!fileServerData) {
      console.log(`❌ No file server data provided for: "${originalTitle}"`)
      return null
    }

    try {
      // Check if we have video URL in the expected format (urls.mp4)
      // IMPORTANT: urls.mp4 is a RELATIVE PATH from file server, convert to full URL
      if (fileServerData.urls?.mp4) {
        let relativePath = fileServerData.urls.mp4

        // Strip prefix if it's already included in the relative path to avoid double prefixes
        // e.g., if path is "/media/movies/..." and prefix is "/media", remove prefix from path
        if (context.serverConfig.prefix && relativePath.startsWith(context.serverConfig.prefix)) {
          relativePath = relativePath.substring(context.serverConfig.prefix.length)
          console.log(
            `🔧 Stripped prefix "${context.serverConfig.prefix}" from path: ${fileServerData.urls.mp4} -> ${relativePath}`
          )
        }

        const videoUrl = UrlBuilder.createFullUrl(relativePath, context.serverConfig)
        syncLogger.debug(
          `✅ Found video URL from urls.mp4 (final path: ${relativePath}) -> full: ${videoUrl}`
        )
        return videoUrl
      }

      // Fallback: look for a video file in fileNames (container-agnostic,
      // backend extension-priority order) and construct URL
      if (fileServerData.fileNames && Array.isArray(fileServerData.fileNames)) {
        for (const ext of this.VIDEO_EXTENSIONS) {
          const videoFile = fileServerData.fileNames.find((name: string) =>
            name.toLowerCase().endsWith(ext)
          )
          if (videoFile) {
            const relativePath = `/movies/${originalTitle}/${videoFile}`
            const videoUrl = UrlBuilder.createFullUrl(relativePath, context.serverConfig)
            syncLogger.debug(
              `✅ Found video file via fileNames (relative: ${relativePath}) -> full: ${videoUrl}`
            )
            return videoUrl
          }
        }
      }

      console.log(`❌ No video URL found in file server data for: "${originalTitle}"`)
      return null
    } catch (error) {
      console.error('Failed to extract video URL from file server data:', error)
      return null
    }
  }

  /**
   * Fallback method to probe for video files directly
   */
  private async findVideoFileByProbing(
    originalTitle: string,
    context: SyncContext
  ): Promise<string | null> {
    console.log(`🔍 Probing for video files for: "${originalTitle}"`)

    // Generate potential video file paths
    const potentialPaths: string[] = []

    // Try different filename patterns with different extensions
    for (const filename of this.VIDEO_FILENAMES) {
      for (const ext of this.VIDEO_EXTENSIONS) {
        potentialPaths.push(`/movies/${originalTitle}/${filename}${ext}`)
      }
    }

    // Also try the movie title as filename
    for (const ext of this.VIDEO_EXTENSIONS) {
      potentialPaths.push(`/movies/${originalTitle}/${originalTitle}${ext}`)
    }

    // Convert paths to full URLs
    const urls = potentialPaths.map((path) => UrlBuilder.createFullUrl(path, context.serverConfig))

    try {
      const availability = await this.fileAdapter.validateAvailability(urls)
      if (availability.available.length > 0) {
        const foundUrl = availability.available[0] // First available (highest priority by extension order)
        console.log(`✅ Found video file via probing: ${foundUrl}`)
        return foundUrl
      }

      console.log(`❌ No video file found for: "${originalTitle}"`)
      return null
    } catch (error) {
      console.error('Failed to probe for video files:', error)
      return null
    }
  }

  /**
   * Extract video metadata from existing file server data (passed through sync context)
   */
  private extractVideoMetadataFromFileServerData(
    originalTitle: string,
    fileServerData: any
  ): {
    duration?: number
    dimensions?: string
    hdr?: string
    mediaLastModified?: Date
    codec?: string
    bitrate?: number
    frameRate?: number
    audioCodec?: string
    audioChannels?: number
    fileSize?: number
    mediaQuality?: MediaQuality
  } | null {
    try {
      console.log(`🔍 Extracting video metadata from file server data for: "${originalTitle}"`)

      if (!fileServerData) {
        console.log(`❌ No file server data provided for metadata extraction: "${originalTitle}"`)
        return null
      }

      // NOTE: no container gate here. This used to bail unless an .mp4 was
      // present in fileNames, which made every MKV/MOV-only movie (visible
      // since the backend's container-agnostic pivot) sync a videoURL with
      // NO duration/dimensions/hdr/size/mediaQuality. All fields below read
      // container-agnostic payload data (additional_metadata.*, hdr,
      // urls.mediaLastModified) — the file's container is irrelevant.

      // Extract metadata using the same patterns as the old sync system
      const result: any = {}

      // Duration - prefer normalized additional_metadata.duration (backend-normalized)
      if (fileServerData.additional_metadata?.duration != null) {
        result.duration = fileServerData.additional_metadata.duration
      }

      // Dimensions - prefer normalized additional_metadata.dimensions or width/height
      if (fileServerData.additional_metadata?.dimensions) {
        result.dimensions = fileServerData.additional_metadata.dimensions
      } else if (
        fileServerData.additional_metadata?.width &&
        fileServerData.additional_metadata?.height
      ) {
        result.dimensions = `${fileServerData.additional_metadata.width}x${fileServerData.additional_metadata.height}`
      }

      // HDR field at root level (legacy format) - STRING value like "10-bit SDR (BT.709)" or "HDR10"
      if (fileServerData.hdr !== undefined && fileServerData.hdr !== null) {
        result.hdr = String(fileServerData.hdr)
      }

      // Media last modified from urls.mediaLastModified (legacy format)
      if (fileServerData.urls?.mediaLastModified) {
        result.mediaLastModified = new Date(fileServerData.urls.mediaLastModified)
      }

      // File size from additional_metadata (supports {kb, mb, gb} object or numeric)
      if (fileServerData.additional_metadata?.size != null) {
        const sz = fileServerData.additional_metadata.size
        if (typeof sz === 'number') {
          result.fileSize = sz
        } else if (typeof sz === 'object') {
          if (typeof sz.gb === 'number') {
            result.fileSize = Math.round(sz.gb * 1024 * 1024 * 1024)
          } else if (typeof sz.mb === 'number') {
            result.fileSize = Math.round(sz.mb * 1024 * 1024)
          } else if (typeof sz.kb === 'number') {
            result.fileSize = Math.round(sz.kb * 1024)
          }
        }
      }

      // Audio/Video codec info from additional_metadata
      if (fileServerData.additional_metadata?.video?.[0]) {
        const videoInfo = fileServerData.additional_metadata.video[0]
        result.codec = videoInfo.codec
        result.bitrate = videoInfo.bitrate
        result.frameRate = videoInfo.frame_rate
      }

      if (fileServerData.additional_metadata?.audio?.[0]) {
        const audioInfo = fileServerData.additional_metadata.audio[0]
        result.audioCodec = audioInfo.codec
        result.audioChannels = audioInfo.channels
      }

      // Media quality object - MUST match legacy structure with isHDR and viewingExperience
      if (fileServerData.mediaQuality) {
        result.mediaQuality = this.parseMediaQualityLegacy(
          fileServerData.mediaQuality,
          fileServerData.hdr
        )
      }

      console.log(
        `✅ Extracted video metadata for: "${originalTitle}" (duration=${result.duration}, dimensions=${result.dimensions}, hdr=${result.hdr})`
      )
      return result
    } catch (error) {
      console.error(
        `Failed to extract video metadata from file server data for ${originalTitle}:`,
        error
      )
      return null
    }
  }

  /**
   * Legacy method for extracting metadata from individual files (kept as fallback)
   * Respects ResourceManager HTTP throttling when available in context
   */
  private async extractVideoMetadata(
    videoUrl: string,
    originalTitle: string,
    context: SyncContext
  ): Promise<{
    duration?: number
    dimensions?: string
    codec?: string
    bitrate?: number
    frameRate?: number
    audioCodec?: string
    audioChannels?: number
    fileSize?: number
    mediaQuality?: MediaQuality
  } | null> {
    const doFetch = async () => {
      try {
        console.log(`🔍 Extracting video metadata for: "${originalTitle}"`)

        // Try to get metadata from server's metadata file first
        const metadataPath = `/movies/${originalTitle}/video.json`
        const metadataUrl = UrlBuilder.createFullUrl(metadataPath, context.serverConfig)

        try {
          const availability = await this.fileAdapter.validateAvailability([metadataUrl])

          if (availability.available.includes(metadataUrl)) {
            const response = await fetch(metadataUrl, {
              signal: AbortSignal.timeout(10000),
              headers: {
                Accept: 'application/json',
                'Cache-Control': 'no-cache',
              },
            })

            if (response.ok) {
              const metadata = await response.json()
              console.log(`✅ Found video metadata file for: "${originalTitle}"`)

              return {
                duration: metadata.duration || metadata.length,
                dimensions: metadata.dimensions || metadata.resolution,
                codec: metadata.codec || metadata.video_codec,
                bitrate: metadata.bitrate || metadata.video_bitrate,
                frameRate: metadata.framerate || metadata.frame_rate,
                audioCodec: metadata.audio_codec,
                audioChannels: metadata.audio_channels,
                fileSize: metadata.size || metadata.file_size,
                mediaQuality: this.parseMediaQuality(metadata),
              }
            }
          }
        } catch (error) {
          console.warn(`⚠️ Failed to fetch video metadata for ${originalTitle}: ${error.message}`)
        }

        // Fallback: Try to extract basic info from video file headers
        const basicInfo = await this.extractBasicVideoInfo(videoUrl)
        console.log(`📝 Extracted basic video info for: "${originalTitle}"`)
        return basicInfo
      } catch (error) {
        console.error(`Failed to extract video metadata for ${originalTitle}:`, error)
        return null
      }
    }

    // Throttle through ResourceManager if available
    if (context.resourceManager) {
      return context.resourceManager.throttleHttp(doFetch)
    }
    return doFetch()
  }

  /**
   * Extract basic video information from video file
   */
  private async extractBasicVideoInfo(videoUrl: string): Promise<{
    duration?: number
    dimensions?: string
    fileSize?: number
    mediaQuality?: MediaQuality
  } | null> {
    try {
      // Get file metadata via HEAD request
      try {
        const urlObj = new URL(videoUrl)
        const serverConfig: ServerConfig = {
          baseUrl: urlObj.origin,
          id: 'temp',
          priority: 999,
          enabled: true,
        }
        const relativePath = UrlBuilder.getRelativePath(videoUrl, serverConfig) || videoUrl
        const metadata = await this.fileAdapter.getMetadata(relativePath, serverConfig)

        if (!metadata.exists) {
          return null
        }

        // Basic quality detection from filename
        const filename = videoUrl.split('/').pop() || ''
        const mediaQuality = this.detectQualityFromFilename(filename)

        return {
          fileSize: metadata.size,
          mediaQuality,
        }
      } catch (urlError) {
        console.warn('Failed to parse video URL for metadata extraction:', urlError)
        return null
      }
    } catch (error) {
      console.warn('Failed to extract basic video info:', error)
      return null
    }
  }

  /**
   * Parse media quality from metadata - LEGACY FORMAT with isHDR and viewingExperience
   */
  private parseMediaQualityLegacy(metadata: any, hdrValue?: any): MediaQuality | undefined {
    if (!metadata) return undefined

    const quality: MediaQuality = {
      format: metadata.format || metadata.codec,
      bitDepth: metadata.bit_depth || metadata.bitDepth,
      colorSpace: metadata.color_space || metadata.colorSpace,
      transferCharacteristics:
        metadata.transfer_characteristics || metadata.transferCharacteristics,
    }

    // Determine HDR status
    const hasHDR = !!(
      metadata.hdr_format ||
      metadata.hdrFormat ||
      metadata.isHDR ||
      (typeof hdrValue === 'string' && hdrValue.toLowerCase().includes('hdr'))
    )

    // Add isHDR field (legacy format)
    quality.isHDR = hasHDR

    // Add viewingExperience object (legacy format) instead of simple enhancedViewing boolean.
    // The flags the file server reports win; the rebuilt ones only fill in for a
    // payload that carries none (see preferReportedViewingExperience).
    quality.viewingExperience = preferReportedViewingExperience(
      {
        enhancedColor:
          metadata.enhanced_viewing ||
          metadata.enhancedViewing ||
          (quality.bitDepth !== undefined && quality.bitDepth >= 10) ||
          false,
        highDynamicRange: hasHDR,
        dolbyVision: !!(metadata.hdr_format || metadata.hdrFormat || '')
          .toLowerCase()
          .includes('dolby'),
        hdr10Plus: !!(metadata.hdr_format || metadata.hdrFormat || '')
          .toLowerCase()
          .includes('hdr10+'),
        standardHDR:
          hasHDR &&
          !(metadata.hdr_format || metadata.hdrFormat || '').toLowerCase().includes('dolby') &&
          !(metadata.hdr_format || metadata.hdrFormat || '').toLowerCase().includes('hdr10+'),
      },
      metadata.viewingExperience
    )

    return quality
  }

  /**
   * Parse media quality from metadata - NEW FORMAT (kept for compatibility)
   */
  private parseMediaQuality(metadata: any): MediaQuality | undefined {
    if (!metadata) return undefined

    return {
      format: metadata.format || metadata.codec,
      bitDepth: metadata.bit_depth || metadata.bitDepth,
      colorSpace: metadata.color_space || metadata.colorSpace,
      transferCharacteristics:
        metadata.transfer_characteristics || metadata.transferCharacteristics,
      hdrFormat: metadata.hdr_format || metadata.hdrFormat,
      enhancedViewing: metadata.enhanced_viewing || metadata.enhancedViewing || false,
    }
  }

  /**
   * Detect media quality from filename patterns
   */
  private detectQualityFromFilename(filename: string): MediaQuality {
    const upper = filename.toUpperCase()

    const mediaQuality: MediaQuality = {
      enhancedViewing: false,
    }

    // Format detection
    if (upper.includes('HEVC') || upper.includes('H265') || upper.includes('X265')) {
      mediaQuality.format = 'HEVC'
    } else if (upper.includes('H264') || upper.includes('X264') || upper.includes('AVC')) {
      mediaQuality.format = 'AVC'
    }

    // Bit depth detection
    if (upper.includes('10BIT') || upper.includes('10-BIT')) {
      mediaQuality.bitDepth = 10
    } else if (upper.includes('8BIT') || upper.includes('8-BIT')) {
      mediaQuality.bitDepth = 8
    }

    // HDR detection
    if (upper.includes('HDR10+')) {
      mediaQuality.hdrFormat = 'HDR10+'
      mediaQuality.enhancedViewing = true
    } else if (upper.includes('HDR10')) {
      mediaQuality.hdrFormat = 'HDR10'
      mediaQuality.enhancedViewing = true
    } else if (upper.includes('DOLBY') && upper.includes('VISION')) {
      mediaQuality.hdrFormat = 'Dolby Vision'
      mediaQuality.enhancedViewing = true
    } else if (upper.includes('HDR')) {
      mediaQuality.hdrFormat = 'HDR'
      mediaQuality.enhancedViewing = true
    }

    // Color space detection
    if (upper.includes('BT2020') || upper.includes('BT.2020')) {
      mediaQuality.colorSpace = 'BT.2020'
    } else if (upper.includes('BT709') || upper.includes('BT.709')) {
      mediaQuality.colorSpace = 'BT.709'
    }

    return mediaQuality
  }

  /**
   * Compute the URL-pathname-derived `normalizedVideoId` for a movie.
   *
   * Delegates to the shared implementation in `@src/utils/videoIdentity`
   * (also re-exported by `flatDatabaseUtils`), which every cross-domain
   * consumer (WatchHistory writer, validators, lookup maps, view counts)
   * uses — the writer/reader lockstep invariant is enforced by construction
   * instead of parallel maintenance. The shared impl also canonicalizes
   * JIT-transcoder stream URLs back to their source pathname, keeping
   * identity transport-invariant.
   *
   * Historical note: an earlier version of this method short-circuited to
   * `fileServerData._id` when the file server reported one, on the theory
   * that the fileserver _id was a more stable per-asset identifier. That
   * broke every `WatchHistory.normalizedVideoId === FlatMovies.normalizedVideoId`
   * join, because WatchHistory always derives its hash from the playback URL
   * (16 chars) while the fileserver _id was 64 chars — different identifier
   * domains that could never align. Removed 2026-05-09. If a fileserver _id
   * ever needs to be persisted, give it a separate field — don't reuse this
   * one.
   */
  private generateNormalizedVideoId(
    videoUrl: string | null,
    originalTitle: string,
    _fileServerData?: any
  ): string {
    if (!videoUrl) {
      syncLogger.warn(
        `⚠️ No videoUrl available for "${originalTitle}", cannot generate normalizedVideoId`
      )
      return ''
    }

    return computeNormalizedVideoId(videoUrl)
  }

  /**
   * Helper function to compare values treating null/undefined/empty as equivalent
   */
  private areValuesEqual(value1: any, value2: any): boolean {
    // Treat null, undefined, and empty string as equivalent "empty" values
    const isEmpty = (v: any) => v === null || v === undefined || v === ''
    if (isEmpty(value1) && isEmpty(value2)) return true

    // For numbers, handle NaN cases
    if (typeof value1 === 'number' && typeof value2 === 'number') {
      if (isNaN(value1) && isNaN(value2)) return true
    }

    return value1 === value2
  }

  /**
   * Compare media quality objects for equality
   */
  private isMediaQualityEqual(
    current: MediaQuality | null | undefined,
    incoming: MediaQuality | null | undefined
  ): boolean {
    if (!current && !incoming) return true
    if (!current || !incoming) return false

    // Property-by-property comparison with better null/undefined handling
    const formatEqual = this.areValuesEqual(current.format, incoming.format)
    const bitDepthEqual = this.areValuesEqual(current.bitDepth, incoming.bitDepth)
    const colorSpaceEqual = this.areValuesEqual(current.colorSpace, incoming.colorSpace)
    const transferCharEqual = this.areValuesEqual(
      current.transferCharacteristics,
      incoming.transferCharacteristics
    )
    const hdrFormatEqual = this.areValuesEqual(current.hdrFormat, incoming.hdrFormat)
    const enhancedViewingEqual = this.areValuesEqual(
      current.enhancedViewing,
      incoming.enhancedViewing
    )
    // The legacy fields are what the stored documents carry. Leaving them out of
    // the comparison meant a changed flag (a file re-encoded to Dolby Vision, a
    // corrected dolbyVision value) was reported "unchanged" and never written.
    const isHDREqual = this.areValuesEqual(current.isHDR, incoming.isHDR)
    const viewingExperienceEqual = sameViewingExperience(
      current.viewingExperience,
      incoming.viewingExperience
    )

    // Log only if there are differences (reduced to key fields only, no full objects)
    const allEqual =
      formatEqual &&
      bitDepthEqual &&
      colorSpaceEqual &&
      transferCharEqual &&
      hdrFormatEqual &&
      enhancedViewingEqual &&
      isHDREqual &&
      viewingExperienceEqual

    if (!allEqual) {
      syncLogger.debug(
        `🔍 MediaQuality differs: format=${!formatEqual}, bitDepth=${!bitDepthEqual}, colorSpace=${!colorSpaceEqual}, transfer=${!transferCharEqual}, hdr=${!hdrFormatEqual}, viewing=${!enhancedViewingEqual}, isHDR=${!isHDREqual}, viewingExperience=${!viewingExperienceEqual}`
      )
    }

    return allEqual
  }

  /**
   * Compare video info objects for equality
   */
  private isVideoInfoEqual(current: VideoInfo | null | undefined, incoming: VideoInfo): boolean {
    if (!current && !incoming) return true
    if (!current || !incoming) return false

    // Property-by-property comparison with better null/undefined handling
    const durationEqual = this.areValuesEqual(current.duration, incoming.duration)
    const resolutionEqual = this.areValuesEqual(current.resolution, incoming.resolution)
    const codecEqual = this.areValuesEqual(current.codec, incoming.codec)
    const bitrateEqual = this.areValuesEqual(current.bitrate, incoming.bitrate)
    const frameRateEqual = this.areValuesEqual(current.frameRate, incoming.frameRate)
    const audioCodecEqual = this.areValuesEqual(current.audioCodec, incoming.audioCodec)
    const audioChannelsEqual = this.areValuesEqual(current.audioChannels, incoming.audioChannels)
    const fileSizeEqual = this.areValuesEqual(current.fileSize, incoming.fileSize)
    const mediaQualityEqual = this.isMediaQualityEqual(current.mediaQuality, incoming.mediaQuality)

    const allEqual =
      durationEqual &&
      resolutionEqual &&
      codecEqual &&
      bitrateEqual &&
      frameRateEqual &&
      audioCodecEqual &&
      audioChannelsEqual &&
      fileSizeEqual &&
      mediaQualityEqual

    // Log only if there are differences (summary only, no full objects)
    if (!allEqual) {
      syncLogger.debug(
        `🔍 VideoInfo differs: duration=${!durationEqual}, resolution=${!resolutionEqual}, codec=${!codecEqual}, bitrate=${!bitrateEqual}, frameRate=${!frameRateEqual}, audio=${!audioCodecEqual}/${!audioChannelsEqual}, size=${!fileSizeEqual}, quality=${!mediaQualityEqual}`
      )
    }

    return allEqual
  }

  /**
   * Extract captions from file server data.
   *
   * Delegates URL resolution to the shared, absolute-safe
   * `UrlBuilder.processCaptionURLs` so movies and TV episodes build caption URLs
   * identically — including the pending-vs-completed auto-caption handling (a
   * completed `.auto.srt` is a relative path and MUST be prefixed; only an
   * already-absolute pending track URL is passed through).
   */
  private extractCaptionsFromFileServerData(
    originalTitle: string,
    fileServerData: any,
    context: SyncContext
  ): Record<string, any> | null {
    try {
      const captionURLs = UrlBuilder.processCaptionURLs(
        fileServerData?.urls?.subtitles,
        context.serverConfig
      )
      if (!captionURLs) {
        syncLogger.debug(`❌ No subtitles found in file server data for: "${originalTitle}"`)
        return null
      }
      syncLogger.debug(
        `🎬 Extracted ${Object.keys(captionURLs).length} caption(s) for "${originalTitle}": ${Object.keys(captionURLs).join(', ')}`
      )
      return captionURLs
    } catch (error) {
      syncLogger.error(`Failed to extract captions for ${originalTitle}:`, error)
      return null
    }
  }

  /**
   * Extract chapter data from file server data
   */
  private extractChapterFromFileServerData(
    originalTitle: string,
    fileServerData: any,
    context: SyncContext
  ): string | null {
    try {
      syncLogger.debug(`🎬 Extracting chapter data for: "${originalTitle}"`)

      // Check if we have chapter data in the file server data
      if (!fileServerData?.urls?.chapters) {
        syncLogger.debug(`❌ No chapters found in file server data for: "${originalTitle}"`)
        return null
      }

      const relativePath = fileServerData.urls.chapters

      // Strip prefix if it's already included in the relative path to avoid double prefixes
      let cleanPath = relativePath
      if (context.serverConfig.prefix && cleanPath.startsWith(context.serverConfig.prefix)) {
        cleanPath = cleanPath.substring(context.serverConfig.prefix.length)
      }

      const fullUrl = UrlBuilder.createFullUrl(cleanPath, context.serverConfig)
      syncLogger.debug(`✅ Found chapter data: ${fullUrl}`)

      return fullUrl
    } catch (error) {
      syncLogger.error(`Failed to extract chapter data for ${originalTitle}:`, error)
      return null
    }
  }

  /**
   * Check if mediaQuality should be updated based on individual field priority
   * Only updates if this server has priority for at least one mediaQuality subfield
   */
  private shouldUpdateMediaQuality(
    mediaQuality: MediaQuality,
    originalTitle: string,
    context: SyncContext
  ): boolean {
    syncLogger.debug(
      `🔍 MediaQuality priority check for: "${originalTitle}", server=${context.serverConfig.id}`
    )

    // Check if fieldAvailability is present in context
    if (!context.fieldAvailability) {
      syncLogger.debug(`⚠️ No fieldAvailability in context, defaulting to true for mediaQuality`)
      return true
    }

    // Ensure mediaType exists in fieldAvailability
    if (!context.fieldAvailability[MediaTypesFieldAvailability.Movie]) {
      syncLogger.debug(
        `⚠️ MediaType.Movie not found in fieldAvailability, defaulting to true for mediaQuality`
      )
      return true
    }

    // Check if the movie exists in fieldAvailability (using originalTitle as key)
    const movieFields = context.fieldAvailability[MediaTypesFieldAvailability.Movie][originalTitle]
    if (!movieFields) {
      syncLogger.debug(
        `⚠️ Movie "${originalTitle}" not found in fieldAvailability, defaulting to true for mediaQuality`
      )
      return true
    }

    // List of mediaQuality subfields to check
    const mediaQualityFields = [
      'mediaQuality.format',
      'mediaQuality.bitDepth',
      'mediaQuality.colorSpace',
      'mediaQuality.transferCharacteristics',
      'mediaQuality.isHDR',
      'mediaQuality.viewingExperience.enhancedColor',
      'mediaQuality.viewingExperience.highDynamicRange',
      'mediaQuality.viewingExperience.dolbyVision',
      'mediaQuality.viewingExperience.hdr10Plus',
      'mediaQuality.viewingExperience.standardHDR',
    ]

    // Check if this server has priority for any mediaQuality subfield
    for (const fieldPath of mediaQualityFields) {
      if (this.shouldUpdateField(fieldPath, originalTitle, context)) {
        syncLogger.debug(`✅ Server ${context.serverConfig.id} has priority for ${fieldPath}`)
        return true
      } else {
        syncLogger.debug(
          `❌ Server ${context.serverConfig.id} does NOT have priority for ${fieldPath}`
        )
      }
    }

    syncLogger.debug(
      `⚠️ Server ${context.serverConfig.id} has no priority for any mediaQuality fields, skipping update`
    )
    return false
  }

  /**
   * Check if the specified field should be updated based on server priority
   * CRITICAL: Always use originalTitle (filesystem key) for fieldAvailability lookups
   */
  private shouldUpdateField(field: string, originalTitle: string, context: SyncContext): boolean {
    syncLogger.debug(
      `🔍 Priority check: field="${field}", originalTitle="${originalTitle}", server=${context.serverConfig.id}`
    )

    // Check if fieldAvailability is present in context
    if (!context.fieldAvailability) {
      syncLogger.debug(`⚠️ No fieldAvailability in context, defaulting to true for ${field}`)
      return true
    }

    // Ensure mediaType exists in fieldAvailability
    if (!context.fieldAvailability[MediaTypesFieldAvailability.Movie]) {
      syncLogger.debug(
        `⚠️ MediaType.Movie not found in fieldAvailability, defaulting to true for ${field}`
      )
      return true
    }

    // Check if the movie exists in fieldAvailability (using originalTitle as key)
    const movieFields = context.fieldAvailability[MediaTypesFieldAvailability.Movie][originalTitle]
    if (!movieFields) {
      syncLogger.debug(
        `⚠️ Movie "${originalTitle}" not found in fieldAvailability, defaulting to true`
      )
      return true
    }

    // Get servers that have this field
    const serversWithField = movieFields[field] || []
    syncLogger.debug(
      `📊 Servers with ${field}: ${JSON.stringify(serversWithField)} (${serversWithField.length} total)`
    )

    // Check priority
    const hasHighestPriority = isCurrentServerHighestPriorityForField(
      context.fieldAvailability,
      MediaTypesFieldAvailability.Movie,
      originalTitle, // ← CRITICAL: Always use originalTitle for consistency
      field,
      context.serverConfig
    )

    if (hasHighestPriority) {
      syncLogger.debug(
        `✅ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) has highest priority for ${field}`
      )
    } else {
      syncLogger.debug(
        `❌ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) does NOT have highest priority for ${field}`
      )
    }

    return hasHighestPriority
  }

  /**
   * Create standardized sync result
   */
  private createResult(
    entityId: string,
    context: SyncContext,
    status: SyncStatus,
    changes: string[],
    errors: string[],
    metadata?: Record<string, any>
  ): SyncResult {
    return {
      status,
      entityId,
      mediaType: MediaType.Movie,
      operation: SyncOperation.Content,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      metadata,
    }
  }

  async validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean> {
    return !!(entity.originalTitle && context.serverConfig.id)
  }
}
