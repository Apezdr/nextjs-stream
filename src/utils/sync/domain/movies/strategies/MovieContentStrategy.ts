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
  syncEventBus,
  MediaTypesFieldAvailability,
  getFieldPath,
  getCaptionFieldPath,
  MovieFieldPathMap,
  sanitizeForLog,
  safeStringify,
} from '../../../core'

import { MovieRepository, captionUrls, fileServerUrl, isTopLevelFieldLocked, prefixedPath } from '../../../infrastructure'

import { reconcileCaptions } from '../../../core/captionReconcile'
import {
  VIDEO_FILE_FACTS,
  planVideoFileFacts,
  sizeInBytes,
  videoFileChanged,
  type FileFactsPlan,
} from '../../../core/fileFacts'
import {
  preferReportedViewingExperience,
  sameViewingExperience,
} from '../../../core/viewingExperience'

import {
  getServersReportingField,
  isCurrentServerHighestPriorityForReportedField,
  isHighestPriorityAmongServers,
  serverOutranks,
} from '@src/utils/sync/core/ownership'
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

  constructor(private repository: MovieRepository) {}

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
          } else if ((VIDEO_FILE_FACTS as readonly string[]).includes(field)) {
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
    let ownsVideo = false
    let videoGone = false
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
    }
    // No payload for this title: there is no video URL and no availability to
    // rank against, and "no payload" is not evidence the video is gone, so this
    // path neither writes nor clears.

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
    // mediaQuality, mediaLastModified), by the rule in core/fileFacts: they
    // come from the server that owns the video and from nowhere else, and
    // one its payload does not report is removed only when the probe ran or
    // the file changed. They used to be set-if-present under their own
    // per-field priority, which also let a server with no video own `hdr`
    // and `mediaQuality` merely by reporting them as null.
    if (fileServerMovieData) {
      if (ownsVideo) {
        const videoFacts = this.extractVideoMetadataFromFileServerData(
          originalTitle,
          fileServerMovieData
        )
        // null means the payload could not be read. Change nothing rather than
        // clear on an error.
        if (videoFacts) {
          const plan = planVideoFileFacts(
            {
              duration: videoFacts.duration,
              dimensions: videoFacts.dimensions,
              size: videoFacts.fileSize,
              hdr: videoFacts.hdr,
              mediaQuality: videoFacts.mediaQuality,
              mediaLastModified: videoFacts.mediaLastModified,
            },
            videoFileChanged(currentMovie, videoUrl, isVideoUrlLocked)
          )
          this.applyVideoFileFacts(updates, unset, currentMovie, plan, originalTitle)
        }
      } else if (videoGone && !effectiveVideoUrl) {
        // The video is gone, and every fact about its file with it.
        for (const field of [
          ...VIDEO_FILE_FACTS,
          'normalizedVideoId',
          'videoSource',
          'videoInfoSource',
        ]) {
          if (hasStoredValue((currentMovie as any)[field])) unset.push(field)
        }
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
        listedCaptions = captionUrls(
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

    // Step 5: Process chapters from file server data. The chapter file belongs
    // to the highest-priority server among those that report one (ties broken
    // on server id); a server the availability map does not list for it never
    // owns it. Removal is field-absence cleanup's, on a run where every
    // enabled server answered (MovieSyncService).
    if (fileServerMovieData) {
      const chapterUrl = this.extractChapterFromFileServerData(
        originalTitle,
        fileServerMovieData,
        context
      )

      if (
        chapterUrl &&
        isCurrentServerHighestPriorityForReportedField(
          context.fieldAvailability,
          MediaTypesFieldAvailability.Movie,
          originalTitle,
          getFieldPath('chapterURL'),
          context.serverConfig
        )
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
   * Write the file-facts plan (core/fileFacts) into this strategy's update and
   * unset lists: a fact is written only when it differs from the stored one,
   * and removed only when the document holds a value for it.
   */
  private applyVideoFileFacts(
    updates: any,
    unset: string[],
    currentMovie: MovieEntity,
    plan: FileFactsPlan,
    originalTitle: string
  ): void {
    const current = currentMovie as any
    for (const fact of plan.unset) {
      if (current[fact] !== undefined && current[fact] !== null) unset.push(fact)
    }
    for (const [fact, value] of Object.entries(plan.set)) {
      const same =
        fact === 'mediaQuality'
          ? this.isMediaQualityEqual(current.mediaQuality, value as MediaQuality)
          : fact === 'mediaLastModified'
            ? current.mediaLastModified instanceof Date &&
              current.mediaLastModified.getTime() === (value as Date).getTime()
            : current[fact] === value
      if (!same) updates[fact] = value
    }
    if (plan.unreadableModified) {
      syncLogger.warn(`⚠️ Unreadable mediaLastModified in the payload for "${originalTitle}", keeping the stored value`)
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
    // Movies nest these under `urls`; each source url goes through the same
    // fileServerUrl as urls.mp4, so a source entry and videoURL can never
    // disagree about host or encoding.
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

  /** The urls.mp4 conversion: the payload's path already carries the server's prefix. */
  private toFullSourceUrl(url: string, context: SyncContext): string {
    return fileServerUrl(url, context.serverConfig)
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
      // IMPORTANT: urls.mp4 is a RELATIVE PATH from file server, already under
      // the server's prefix (e.g. "/media/movies/..."); convert to full URL
      if (fileServerData.urls?.mp4) {
        const videoUrl = fileServerUrl(fileServerData.urls.mp4, context.serverConfig)
        syncLogger.debug(
          `✅ Found video URL from urls.mp4 (path: ${fileServerData.urls.mp4}) -> full: ${videoUrl}`
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
            // Built here, so not under the server's prefix yet
            const videoUrl = fileServerUrl(prefixedPath(relativePath, context.serverConfig), context.serverConfig)
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
      const fileSize = sizeInBytes(fileServerData.additional_metadata?.size)
      if (fileSize !== undefined) result.fileSize = fileSize

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
   * `captionUrls` (infrastructure/fileSystem/urls) so movies and TV episodes build caption URLs
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
      const captionURLs = captionUrls(
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

      // Already under the server's prefix, like every path in the payload
      const fullUrl = fileServerUrl(fileServerData.urls.chapters, context.serverConfig)
      syncLogger.debug(`✅ Found chapter data: ${fullUrl}`)

      return fullUrl
    } catch (error) {
      syncLogger.error(`Failed to extract chapter data for ${originalTitle}:`, error)
      return null
    }
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
