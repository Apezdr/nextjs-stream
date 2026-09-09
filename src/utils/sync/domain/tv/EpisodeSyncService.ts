/**
 * Episode sync service — bulk-write pattern with read-merge-replace.
 *
 * Write pattern:
 *  1. Pre-fetch all existing episodes for the season (one query).
 *  2. Pre-fetch the parent TV show + season for showId/seasonId foreign keys.
 *  3. For each episode in file-server data, merge onto existing doc with priority.
 *  4. Flush all episodes with a single EpisodeRepository.bulkUpsertSeason() call.
 *
 * repository.upsert() is NEVER called inside an episode loop.
 */

import {
  EpisodeEntity,
  SyncContext,
  SyncResult,
  SyncStatus,
  MediaType,
  SyncOperation,
  syncEventBus,
  planFieldCleanup,
  resolveMediaId,
  resolveDeliveryFacts,
  type CleanableField,
  type CleanupPlan
} from '../../core'

import {
  EpisodeRepository,
  SeasonRepository,
  TVShowRepository,
  UrlBuilder,
  isTopLevelFieldLocked,
} from '../../infrastructure'
import { isCurrentServerHighestPriorityForField, createFullUrl, extractUrlHash } from '@src/utils/sync/utils'
import { fetchMetadataMultiServer } from '@src/utils/admin_utils'
import { generateNormalizedVideoId } from '@src/utils/flatDatabaseUtils'
import { warnOnJitIdentityFork } from '@src/utils/sync/core/jitIdentityParity'
import { createLogger } from '@src/lib/logger'

const pinoLog = createLogger('Sync.TV.Episode')

export class EpisodeSyncService {
  constructor(
    private readonly episodeRepository: EpisodeRepository,
    private readonly seasonRepository: SeasonRepository,
    private readonly tvShowRepository: TVShowRepository
  ) {}

  /**
   * Sync all episodes for one season via a single bulkUpsertSeason call.
   *
   * Pattern:
   *  1. Pre-fetch existing episodes + parent show/season for foreign keys.
   *  2. Build merged EpisodeEntity[] from file-server data + existing docs.
   *  3. episodeRepository.bulkUpsertSeason(entities) once — never per-episode upserts.
   */
  async syncSeason(
    showTitle: string,
    seasonNumber: number,
    context: SyncContext
  ): Promise<SyncResult[]> {
    const results: SyncResult[] = []
    const label = `${showTitle} S${seasonNumber}`

    syncEventBus.emitStarted(label, MediaType.Episode, context.serverConfig.id)

    try {
      const seasonFileData = this.extractSeasonFileData(showTitle, seasonNumber, context)

      if (!seasonFileData) {
        results.push(this.makeResult(label, context, SyncStatus.Skipped, [], [
          'No file server data found for this season'
        ]))
        return results
      }

      // Pre-fetch parent show first to resolve display title and foreign keys
      const parentShow = await this.tvShowRepository.findByOriginalTitle(showTitle)
      const showId = (parentShow as any)?._id || null
      // Use the display title for showTitle on episodes (matches legacy document shape)
      const displayTitle = parentShow?.title || showTitle

      // Find existing episodes and parent season for THIS show. Key on showId, not
      // the shared display title, so a same-titled show's rows don't leak in — and
      // so parentSeason (→ seasonId FK stamped on every episode) is the right show's.
      const [existingEpisodes, parentSeason] = await Promise.all([
        this.episodeRepository.findByShowAndSeason(displayTitle, seasonNumber, showId),
        this.seasonRepository.findSeason(displayTitle, seasonNumber, showId)
      ])

      const existingByNumber = new Map(
        existingEpisodes.map(e => [e.episodeNumber, e])
      )

      const seasonId = (parentSeason as any)?._id || null

      // Fetch episode-level hashes for this season (one HTTP call covers all episodes).
      // Enables per-episode skip when incoming hash matches stored syncHash on entity.
      await this.loadEpisodeHashesForSeason(showTitle, seasonNumber, context)

      // ---- Accumulate smart upsert ops — do NOT write one by one ----
      // `unset` carries field-absence cleanup (enforce mode only); `cleanupChanges`
      // is the diagnostic text surfaced on the SyncResult in both modes.
      const episodeOps: Array<{
        filter: Record<string, any>
        existing: EpisodeEntity | null
        merged: EpisodeEntity
        unset?: string[]
        cleanupChanges?: string[]
      }> = []

      for (const [key, fileData] of Object.entries(seasonFileData.episodes || {})) {
        const epNum = this.parseEpisodeNumber(key, fileData)
        if (epNum === null) {
          results.push(this.makeResult(
            `${label}E?`, context, SyncStatus.Skipped, [],
            [`Cannot determine episode number for key "${key}"`]
          ))
          continue
        }

        const existing = existingByNumber.get(epNum) || null

        // Episode hash skip: if incoming hash matches stored syncHash, entity builder output
        // would be identical — skip buildEpisodeEntity entirely (no HTTP fetches, no write).
        const episodeKey = this.buildEpisodeHashKey(seasonNumber, epNum)
        const incomingEpHash = context.tvEpisodeHashesCache
          ?.get(showTitle)?.get(seasonNumber)?.episodes?.[episodeKey]?.hash

        if (!context.forceSync && incomingEpHash && existing?.syncHash && incomingEpHash === existing.syncHash) {
          results.push(this.makeResult(`${label}E${epNum}`, context, SyncStatus.Skipped, [], []))
          continue
        }

        const { entity: merged, metadataFromFreshFetch } = await this.buildEpisodeEntity(showTitle, displayTitle, seasonNumber, epNum, fileData, context, existing, showId, seasonId, parentShow, seasonFileData, key)

        // Store incoming hash so next sync can compare. Gate on a confirmed fresh
        // metadata source: the inline parent fallback (display-only) and failed
        // fetches must NOT advance syncHash, or the spent gate locks the episode
        // on stale metadata. Once 2A makes the episode URL fetchable + cache-busted,
        // the fresh fetch succeeds and the gate stamps normally.
        if (incomingEpHash && metadataFromFreshFetch) (merged as any).syncHash = incomingEpHash

        // Filter shape mirrors bulkUpsertSeason: prefer showId for stability
        const filter = (merged as any).showId
          ? { showId: (merged as any).showId, seasonNumber: merged.seasonNumber, episodeNumber: merged.episodeNumber }
          : { showTitle: merged.showTitle, seasonNumber: merged.seasonNumber, episodeNumber: merged.episodeNumber }

        // Field-absence cleanup. `showTitle` here is the originalTitle (filesystem
        // key) — the fieldAvailability key. planFieldCleanup logs (both modes) and
        // returns `unset` only in enforce mode.
        const plan = this.planEpisodeCleanup(showTitle, seasonNumber, key, existing, displayTitle, epNum, context)

        episodeOps.push({ filter, existing, merged, unset: plan.unset, cleanupChanges: plan.changes })
      }

      // ---- Single smart bulk write — skips unchanged, $sets changed, inserts new ----
      if (episodeOps.length > 0) {
        await this.episodeRepository.smartBulkUpsert(episodeOps)
      }

      for (const { merged: entity, cleanupChanges } of episodeOps) {
        results.push(this.makeResult(
          `${label}E${entity.episodeNumber}`, context,
          SyncStatus.Completed,
          [`Upserted episode ${entity.episodeNumber}`, ...(cleanupChanges || [])], [],
          {
            displayTitle: entity.showTitle,
            seasonNumber: entity.seasonNumber,
            episodeNumber: entity.episodeNumber
          }
        ))
      }

      syncEventBus.emitComplete(label, MediaType.Episode, context.serverConfig.id, undefined, {
        totalOperations: episodeOps.length,
        successful: episodeOps.length,
        failed: 0
      })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      const stack = error instanceof Error ? error.stack : undefined
      syncEventBus.emitError(label, MediaType.Episode, context.serverConfig.id, msg, SyncOperation.Content)
      // emitError only fans out to SSE — log explicitly via Pino so the
      // failure surfaces in SigNoz instead of being silently counted.
      pinoLog.error(
        { label, serverId: context.serverConfig.id, err: msg, stack },
        `Episode sync failed: ${label}`
      )
      results.push(this.makeResult(label, context, SyncStatus.Failed, [], [msg]))
    }

    return results
  }

  /**
   * Sync all seasons (and their episodes) for a show.
   * Each season triggers exactly one bulkUpsertSeason() call.
   */
  async syncShow(showTitle: string, context: SyncContext): Promise<SyncResult[]> {
    const showData = context.fileServerData?.tv?.[showTitle]
    if (!showData) {
      return [this.makeResult(showTitle, context, SyncStatus.Skipped, [], [
        'No file server data found for this show'
      ])]
    }

    const allResults: SyncResult[] = []
    for (const key of Object.keys(showData.seasons || {})) {
      const seasonNumber = this.parseSeasonNumber(key)
      if (seasonNumber === null) continue
      allResults.push(...await this.syncSeason(showTitle, seasonNumber, context))
    }
    return allResults
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private extractSeasonFileData(showTitle: string, seasonNumber: number, context: SyncContext): any {
    const showData = context.fileServerData?.tv?.[showTitle]
    if (!showData?.seasons) return null

    for (const candidate of [
      String(seasonNumber),
      `Season ${seasonNumber}`,
      `season_${seasonNumber}`,
      `S${String(seasonNumber).padStart(2, '0')}`
    ]) {
      if (showData.seasons[candidate]) return showData.seasons[candidate]
    }

    for (const [key, data] of Object.entries(showData.seasons)) {
      if (this.parseSeasonNumber(key) === seasonNumber) return data
    }
    return null
  }

  /**
   * Resolve the LITERAL season key used in the file-server data (e.g. "Season 2",
   * "2", "S02") for this season number. Field-absence cleanup builds compound
   * fieldAvailability paths (`seasons.<seasonKey>.episodes.<epKey>.<field>`), and
   * those paths must use the exact keys collectFieldAvailability walked — guessing
   * the format would make every lookup miss and report false absences. Mirrors the
   * candidate order of extractSeasonFileData but returns the key, not the data.
   */
  private resolveSeasonKey(showTitle: string, seasonNumber: number, context: SyncContext): string | null {
    const showData = context.fileServerData?.tv?.[showTitle]
    if (!showData?.seasons) return null

    for (const candidate of [
      String(seasonNumber),
      `Season ${seasonNumber}`,
      `season_${seasonNumber}`,
      `S${String(seasonNumber).padStart(2, '0')}`
    ]) {
      if (showData.seasons[candidate]) return candidate
    }

    for (const key of Object.keys(showData.seasons)) {
      if (this.parseSeasonNumber(key) === seasonNumber) return key
    }
    return null
  }

  /**
   * The fieldAvailability leaf path for an episode's videoURL, or the bare
   * 'videoURL' fallback when the literal season/episode keys cannot be
   * resolved. See the call site for why the fallback is acceptable: an
   * unresolvable path and an unclaimed path behave identically (the priority
   * helper treats an empty bucket as "anyone may write").
   */
  private buildEpisodeVideoFieldPath(
    showOriginalTitle: string,
    seasonNumber: number,
    episodeFileName: string | undefined,
    context: SyncContext
  ): string {
    if (!episodeFileName) return 'videoURL'
    const seasonKey = this.resolveSeasonKey(showOriginalTitle, seasonNumber, context)
    if (!seasonKey) return 'videoURL'
    return `seasons.${seasonKey}.episodes.${episodeFileName}.videoURL`
  }

  /**
   * Build the field-absence cleanup candidates for one episode. Returns the
   * fields to $unset (enforce) and human-readable diagnostics (both modes), or
   * null when cleanup is disabled / not applicable. Conservative scope for the
   * initial rollout: thumbnail + chapters (asset URLs). videoURL is deliberately
   * EXCLUDED — clearing a video is higher-stakes and warrants its own rollout.
   */
  private planEpisodeCleanup(
    showOriginalTitle: string,
    seasonNumber: number,
    episodeKey: string,
    existing: EpisodeEntity | null,
    displayTitle: string,
    episodeNumber: number,
    context: SyncContext
  ): CleanupPlan {
    if (!context.cleanup?.enabled || !existing) return { changes: [] }

    const seasonKey = this.resolveSeasonKey(showOriginalTitle, seasonNumber, context)
    if (!seasonKey) return { changes: [] }  // can't build a trustworthy path → skip (no guessing)

    const prefix = `seasons.${seasonKey}.episodes.${episodeKey}`
    const fields: CleanableField[] = [
      {
        entityField: 'thumbnail',
        fieldPath: `${prefix}.thumbnail`,
        companions: ['thumbnailSource', 'thumbnailBlurhash', 'thumbnailBlurhashSource'],
      },
      {
        entityField: 'chapterURL',
        fieldPath: `${prefix}.chapters`,
        companions: ['chapterSource'],
      },
    ]

    return planFieldCleanup({
      cleanup: context.cleanup,
      mediaType: 'tv',
      availabilityKey: showOriginalTitle,
      entity: existing,
      fieldAvailability: context.fieldAvailability,
      fields,
      log: (obj, msg) => pinoLog.info(obj, msg),
      logContext: { show: displayTitle, originalTitle: showOriginalTitle, season: seasonNumber, episode: episodeNumber },
    })
  }

  /**
   * Build an episode entity by merging existing data with incoming file-server
   * data, respecting per-field server priority.
   *
   * Key differences from naive field copy:
   *  - fileData.metadata is a URL path, not inline data — must be fetched via
   *    fetchMetadataMultiServer. Fallback: parent show's metadata.seasons[].episodes[].
   *  - fileData.thumbnailBlurhash is a URL path to a blurhash file, not the actual
   *    blurhash string. Existing values are preserved from the spread; BlurhashStrategy
   *    handles fetching actual values.
   */
  private async buildEpisodeEntity(
    showOriginalTitle: string,
    displayTitle: string,
    seasonNumber: number,
    episodeNumber: number,
    fileData: any,
    context: SyncContext,
    existing: EpisodeEntity | null,
    showId: any,
    seasonId: any,
    parentShow: any,
    seasonFileData?: any,
    episodeFileName?: string
  ): Promise<{ entity: EpisodeEntity; metadataFromFreshFetch: boolean }> {
    const now = new Date()

    // Start from existing doc (preserving ALL fields) or create new
    const entity: EpisodeEntity = existing
      ? { ...existing, lastSynced: now }
      : {
          title: fileData?.title || `Episode ${episodeNumber}`,
          originalTitle: showOriginalTitle,  // Show's filesystem key (matches legacy)
          type: 'episode',
          createdAt: now,
          lastSynced: now,
          episodeNumber,
          seasonNumber,
          showTitle: displayTitle,
        }

    // Heal structural fields
    if (!entity.type) entity.type = 'episode'
    if (!entity.createdAt) entity.createdAt = now
    if (showId) entity.showId = showId
    if (seasonId) entity.seasonId = seasonId
    // Use display title as showTitle (matches legacy document shape)
    entity.showTitle = displayTitle

    // --- Video URL (priority-gated, use originalTitle for field availability lookup) ---
    //
    // The leaf path must be the LITERAL one collectFieldAvailability walked —
    // `seasons.<seasonKey>.episodes.<episodeKey>.videoURL`, where seasonKey is
    // the file server's own season key (a real folder name like "Season 01",
    // not a reconstructed "Season 1"). A bare 'videoURL' claims a leaf nobody
    // ever populates, and an unclaimed leaf makes the priority helper return
    // true for EVERY server — i.e. the gate silently did nothing.
    //
    // resolveSeasonKey returns null when it cannot identify the key; that path
    // falls back to the old permissive behavior rather than guessing a path
    // (a wrong path would be indistinguishable from an unclaimed one anyway).
    const videoFieldPath = this.buildEpisodeVideoFieldPath(
      showOriginalTitle,
      seasonNumber,
      episodeFileName,
      context
    )
    const canUpdateVideo = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, videoFieldPath, context.serverConfig
    )
    if (canUpdateVideo && fileData?.videoURL) {
      if (isTopLevelFieldLocked((existing as any)?.lockedFields, 'videoURL')) {
        // videoURL is admin-locked: computeDiff would drop the URL write
        // anyway, but videoSource would leak through and normalizedVideoId
        // would derive from a URL that is never stored. Keep the stored
        // (effective) videoURL and derive identity from it so it matches
        // what clients actually play and report. Locked JIT-transcoder URLs
        // canonicalize to the source pathname inside the shared impl.
        if (entity.videoURL) {
          entity.normalizedVideoId = generateNormalizedVideoId(entity.videoURL)
        }
      } else {
        entity.videoURL = createFullUrl(fileData.videoURL, context.serverConfig)
        entity.videoSource = context.serverConfig.id
        entity.normalizedVideoId = generateNormalizedVideoId(entity.videoURL)
      }
    }

    // --- Content identity + delivery facts (follow video priority) ---
    //
    // Episodes carry these flat beside videoURL, matching the backend's
    // episode payload convention. Two write disciplines, same as movies:
    // mediaId is SET-ONLY (durable identity — a payload that cannot resolve
    // it sends null, which must never clear what we hold, and it is on
    // FieldAbsenceCleaner's denylist); the delivery facts are MIRRORED so
    // that disabling JIT on the owning host clears them on the next sync.
    if (canUpdateVideo && fileData) {
      const incomingMediaId = resolveMediaId(fileData.mediaIdentity)
      if (incomingMediaId) {
        if (existing?.mediaId && existing.mediaId !== incomingMediaId) {
          pinoLog.warn(
            {
              showOriginalTitle,
              seasonNumber,
              episodeNumber,
              storedMediaId: existing.mediaId,
              incomingMediaId,
              serverId: context.serverConfig.id,
            },
            'mediaId mismatch for episode — video owner wins'
          )
        }
        entity.mediaId = incomingMediaId
      }

      // Episodes carry these flat; source urls go through the same
      // createFullUrl transform as videoURL above.
      const facts = resolveDeliveryFacts(fileData, (url) =>
        createFullUrl(url, context.serverConfig)
      )
      entity.sources = facts.sources
      entity.primaryContainer = facts.primaryContainer
      entity.jitEligible = facts.jitEligible
      entity.jitUrl = facts.jitUrl

      // The JIT manifest for the same file must key to the same identity as
      // the stored videoURL, or rows written through the transcoder never
      // join this episode. Compared against the post-lock videoURL.
      warnOnJitIdentityFork(
        {
          videoURL: entity.videoURL ?? null,
          jitUrl: entity.jitUrl ?? null,
          label: `episode:${showOriginalTitle} S${entity.seasonNumber}E${entity.episodeNumber}`,
        },
        (fields, message) => pinoLog.warn(fields, message)
      )
    }

    // --- Video info (follows video priority) ---
    if (canUpdateVideo && fileData?.videoInfo && typeof fileData.videoInfo === 'object') {
      entity.videoInfo = fileData.videoInfo
      entity.videoInfoSource = context.serverConfig.id
    }

    // --- Top-level video info fields (flat, matching legacy document shape) ---
    // Legacy extracts these from season-level and episode-level file server data
    // and stores videoInfoSource alongside them
    if (canUpdateVideo) {
      let hasVideoInfoFields = false

      // Duration from season-level lengths map (e.g., seasonFileData.lengths["S01E01"])
      if (seasonFileData?.lengths && episodeFileName && seasonFileData.lengths[episodeFileName] != null) {
        entity.duration = seasonFileData.lengths[episodeFileName]
        hasVideoInfoFields = true
      }
      // Dimensions from season-level dimensions map
      if (seasonFileData?.dimensions && episodeFileName && seasonFileData.dimensions[episodeFileName]) {
        entity.dimensions = seasonFileData.dimensions[episodeFileName]
        hasVideoInfoFields = true
      }
      // HDR, size, mediaQuality, mediaLastModified from episode-level file data
      if (fileData?.hdr !== undefined && fileData.hdr !== null) {
        entity.hdr = fileData.hdr
        hasVideoInfoFields = true
      }
      if (fileData?.size != null) {
        entity.size = fileData.size
        hasVideoInfoFields = true
      } else if (fileData?.additionalMetadata?.size != null) {
        // Size arrives as a {kb, mb, gb} object; convert to bytes to match
        // the movie path (MovieContentStrategy) so consumers can treat
        // `size` as bytes for both media types
        const sz = fileData.additionalMetadata.size
        if (typeof sz === 'number') {
          entity.size = sz
          hasVideoInfoFields = true
        } else if (typeof sz === 'object') {
          if (typeof sz.gb === 'number') {
            entity.size = Math.round(sz.gb * 1024 * 1024 * 1024)
            hasVideoInfoFields = true
          } else if (typeof sz.mb === 'number') {
            entity.size = Math.round(sz.mb * 1024 * 1024)
            hasVideoInfoFields = true
          } else if (typeof sz.kb === 'number') {
            entity.size = Math.round(sz.kb * 1024)
            hasVideoInfoFields = true
          }
        }
      }
      if (fileData?.mediaQuality) {
        entity.mediaQuality = fileData.mediaQuality
        hasVideoInfoFields = true
      }
      if (fileData?.mediaLastModified) {
        entity.mediaLastModified = new Date(fileData.mediaLastModified)
        hasVideoInfoFields = true
      }

      // Set videoInfoSource when any top-level video info field was extracted
      if (hasVideoInfoFields) {
        entity.videoInfoSource = context.serverConfig.id
      }
    }

    // --- Thumbnail (priority-gated) ---
    const canUpdateThumbnail = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, 'thumbnail', context.serverConfig
    )
    if (canUpdateThumbnail && (fileData?.thumbnail || fileData?.thumbnailURL)) {
      entity.thumbnail = createFullUrl(
        fileData.thumbnail || fileData.thumbnailURL,
        context.serverConfig
      )
      entity.thumbnailSource = context.serverConfig.id
    }

    // --- Captions (priority-gated) ---
    // Legacy field: captionURLs (object keyed by language), NOT captions (array)
    // File server data key: "subtitles" (not "captions")
    if (fileData?.subtitles && typeof fileData.subtitles === 'object') {
      const processed = UrlBuilder.processCaptionURLs(fileData.subtitles, context.serverConfig)
      if (processed && Object.keys(processed).length > 0) {
        // Merge with existing captionURLs (preserve captions from other servers)
        const merged = { ...(existing?.captionURLs || {}), ...processed }
        entity.captionURLs = merged
        entity.captionSource = context.serverConfig.id
      }
    }

    // --- Chapters (priority-gated) ---
    // Legacy stores chapterURL as a single URL string (not an array)
    const canUpdateChapters = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, 'chapters', context.serverConfig
    )
    if (canUpdateChapters && fileData?.chapters) {
      entity.chapterURL = createFullUrl(fileData.chapters, context.serverConfig)
      entity.chapterSource = context.serverConfig.id
    }

    // --- Metadata (priority-gated) ---
    // Tracks whether episode metadata came from a CONFIRMED fresh source (URL
    // fetch ok, or backend-inlined object) vs. the parent inline fallback or a
    // failure. Only a fresh source may advance the syncHash gate — the inline
    // fallback is fine for display but must not lock the episode on a stale
    // parent. Default true so "no episode metadata URL" never blocks the gate.
    let metadataFromFreshFetch = true
    const canUpdateMetadata = isCurrentServerHighestPriorityForField(
      context.fieldAvailability, 'tv', showOriginalTitle, 'metadata', context.serverConfig
    )
    if (canUpdateMetadata && fileData?.metadata) {
      // fileData.metadata is typically a URL path — fetch actual metadata from file server
      let episodeMetadata: any = null

      if (typeof fileData.metadata === 'string') {
        try {
          episodeMetadata = await fetchMetadataMultiServer(
            context.serverConfig.id,
            fileData.metadata,
            'file',
            'tv',
            showOriginalTitle
          )
        } catch {
          // Fetch failed — try fallback below
        }
        // Capture the URL-fetch outcome BEFORE the inline fallback overwrites it.
        metadataFromFreshFetch = !!(episodeMetadata && typeof episodeMetadata === 'object' && !episodeMetadata.error)
      } else if (typeof fileData.metadata === 'object') {
        episodeMetadata = fileData.metadata
        metadataFromFreshFetch = true
      }

      // Fallback: parent show's metadata.seasons[].episodes[] array (DISPLAY ONLY —
      // does NOT flip metadataFromFreshFetch, so it never advances the gate).
      if (!episodeMetadata || episodeMetadata.error) {
        const seasonMeta = parentShow?.metadata?.seasons?.find(
          (s: any) => s.season_number === seasonNumber
        )
        if (seasonMeta?.episodes) {
          episodeMetadata = seasonMeta.episodes.find(
            (e: any) => e.episode_number === episodeNumber
          )
        }
      }

      if (episodeMetadata && typeof episodeMetadata === 'object' && !episodeMetadata.error) {
        entity.metadata = episodeMetadata
        entity.metadataSource = context.serverConfig.id

        // Extract title from metadata if available
        if (episodeMetadata.name) entity.title = episodeMetadata.name
      }
    }

    // --- Thumbnail Blurhash (priority-gated, fetch actual string) ---
    // Legacy pattern: fetchMetadataMultiServer(id, url, 'blurhash', 'tv', originalTitle)
    if (fileData?.thumbnailBlurhash) {
      // Build the field path matching legacy: "seasons.Season N.episodes.FILENAME.thumbnailBlurhash"
      const seasonKey = Object.keys(
        context.fileServerData?.tv?.[showOriginalTitle]?.seasons || {}
      ).find(k => this.parseSeasonNumber(k) === seasonNumber) || String(seasonNumber)
      const blurhashFieldPath = `seasons.${seasonKey}.thumbnailBlurhash`

      const canUpdateBlurhash = isCurrentServerHighestPriorityForField(
        context.fieldAvailability, 'tv', showOriginalTitle, blurhashFieldPath, context.serverConfig
      )
      if (canUpdateBlurhash) {
        // Skip fetch if the thumbnail image file hasn't changed (?hash= param comparison)
        const newThumbUrl = (fileData?.thumbnail || fileData?.thumbnailURL)
          ? createFullUrl(fileData.thumbnail || fileData.thumbnailURL, context.serverConfig) : null
        const thumbImageChanged = extractUrlHash(newThumbUrl ?? '') !== extractUrlHash(existing?.thumbnail ?? '')
        if (thumbImageChanged || !existing?.thumbnailBlurhash) {
          try {
            const blurhashUrl = createFullUrl(fileData.thumbnailBlurhash, context.serverConfig)
            const blurhash = await fetchMetadataMultiServer(
              context.serverConfig.id, blurhashUrl, 'blurhash', 'tv', showOriginalTitle
            )
            if (blurhash && typeof blurhash === 'string' && !(blurhash as any).error) {
              entity.thumbnailBlurhash = blurhash
              entity.thumbnailBlurhashSource = context.serverConfig.id
            }
          } catch {
            // Blurhash fetch failed — preserve existing value from spread
          }
        }
        // else: thumbnail image unchanged, existing thumbnailBlurhash preserved by spread
      }
    }

    return { entity, metadataFromFreshFetch }
  }

  /**
   * Convert season + episode numbers to S01E01 format — matches episode keys
   * returned by /api/metadata-hashes/tv/{title}/{seasonNumber}.episodes
   */
  private buildEpisodeHashKey(seasonNumber: number, episodeNumber: number): string {
    return `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`
  }

  /**
   * Fetch episode-level hashes for one season from the media processor Node server.
   * Result is cached in context.tvEpisodeHashesCache for per-episode lookup.
   * Silently degrades if the endpoint is unavailable — sync proceeds without skip.
   */
  private async loadEpisodeHashesForSeason(
    showTitle: string,
    seasonNumber: number,
    context: SyncContext
  ): Promise<void> {
    if (!context.tvEpisodeHashesCache || !context.serverConfig.nodeUrl) return
    if (context.tvEpisodeHashesCache.get(showTitle)?.has(seasonNumber)) return  // already loaded

    const url = `${context.serverConfig.nodeUrl}/api/metadata-hashes/tv/${encodeURIComponent(showTitle)}/${seasonNumber}`
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000)
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }
      })
      clearTimeout(timeoutId)
      if (res.ok) {
        const data = await res.json()
        if (!context.tvEpisodeHashesCache.has(showTitle)) {
          context.tvEpisodeHashesCache.set(showTitle, new Map())
        }
        context.tvEpisodeHashesCache.get(showTitle)!.set(seasonNumber, data)
      }
    } catch {
      clearTimeout(timeoutId)
      // Graceful degradation — proceed without episode-level skip for this season
    }
  }

  private parseEpisodeNumber(key: string, data: any): number | null {
    if (typeof data?.episodeNumber === 'number' && data.episodeNumber > 0) return data.episodeNumber
    const match = key.match(/(?:episode_?|ep_?|e)?(\d+)/i)
    const n = match ? parseInt(match[1], 10) : NaN
    return n > 0 ? n : null
  }

  private parseSeasonNumber(key: string): number | null {
    const match = key.match(/(?:season_?|s)?(\d+)/i)
    const n = match ? parseInt(match[1], 10) : NaN
    return n >= 0 ? n : null
  }

  private makeResult(
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
      mediaType: MediaType.Episode,
      operation: SyncOperation.Content,
      serverId: context.serverConfig.id,
      timestamp: new Date(),
      changes,
      errors,
      // Display title + season/episode numbers for post-sync cache invalidation
      // (episode page tags key on display title, not the filesystem showTitle).
      ...(metadata ? { metadata } : {})
    }
  }
}
