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
  VideoInfo,
  MediaQuality,
  ServerConfig,
  syncEventBus,
  MediaTypesFieldAvailability,
  getFieldPath,
  getCaptionFieldPath,
  filterCaptionsByFieldAvailability,
  MovieFieldPathMap
} from '../../../core'

import { 
  MovieRepository,
  UrlBuilder 
} from '../../../infrastructure'

import {
  FileServerAdapter
} from '../../../core'

import { isCurrentServerHighestPriorityForField } from '@src/utils/sync/utils'

export class MovieContentStrategy implements SyncStrategy {
  readonly name = 'MovieContentStrategy'
  readonly supportedOperations = [SyncOperation.Content]
  readonly supportedMediaTypes = [MediaType.Movie]

  // Common video file extensions in priority order (best quality first)
  private readonly VIDEO_EXTENSIONS = [
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v'
  ]

  // Common video filenames to check (in priority order)
  private readonly VIDEO_FILENAMES = [
    'video', 'movie', 'film', 'main', 'feature'
  ]

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

    console.log(`🎬 MovieContentStrategy starting for: "${title}"`)

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
          console.log(`💾 Cache HIT for "${originalTitle}"`)
        } else {
          console.log(`🔍 Cache MISS for "${originalTitle}", querying database...`)
          movie = await this.repository.findByOriginalTitle(originalTitle)
          if (!movie) {
            console.log(`🎬 Movie not in database, creating basic entity for content: "${originalTitle}"`)
            movie = {
              title,
              originalTitle,
              lastSynced: new Date(),
              metadata: {}
            }
          }
        }
      }

      const changes: string[] = []
      const contentUpdates = await this.syncVideoContent(originalTitle, context, movie)

      if (Object.keys(contentUpdates).length > 0) {
        // Use upsert to handle both new and existing movies
        const movieToSave = {
          ...movie,
          ...contentUpdates,
          title, // Ensure title is always set
          originalTitle, // Ensure originalTitle is always set
          lastSynced: new Date()
        }

        // Add source tracking for updated content fields
        Object.keys(contentUpdates).forEach(field => {
          if (field === 'videoURL') {
            movieToSave.videoSource = context.serverConfig.id
          } else if (field === 'duration' || field === 'dimensions' ||
                     field === 'hdr' || field === 'mediaQuality' || field === 'mediaLastModified') {
            // All video metadata fields use videoInfoSource
            movieToSave.videoInfoSource = context.serverConfig.id
          } else if (field === 'captionURLs') {
            movieToSave.captionSource = context.serverConfig.id
          } else if (field === 'chapterURL') {
            movieToSave.chapterSource = context.serverConfig.id
          }
        })

        await this.repository.upsert(movieToSave)
        
        // Add specific changes for each updated field
        Object.keys(contentUpdates).forEach(key => {
          changes.push(`Updated ${key}`)
        });

        syncEventBus.emitProgress(
          title,
          MediaType.Movie,
          context.serverConfig.id,
          SyncOperation.Content,
          { 
            stage: 'completed', 
            progress: 100, 
            updatedFields: Object.keys(contentUpdates)
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
          contentProcessed: Object.keys(contentUpdates)
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
    videoURL?: string
    duration?: number
    dimensions?: string
    hdr?: string 
    mediaQuality?: MediaQuality
    mediaLastModified?: Date
    normalizedVideoId?: string
    captionURLs?: Record<string, {
      srcLang: string
      url: string
      lastModified?: string
      sourceServerId?: string
    }>
    chapterURL?: string
  }> {
    const updates: any = {}

    console.log(`🎥 Syncing video content for: "${originalTitle}"`)

    //debugger; // Debug point to investigate video content sync

    // Get file server data from context (now passed through properly)
    console.log('🔍 Context keys:', Object.keys(context))
    
    let fileServerMovieData = null
    
    // Extract the specific movie data from the file server data structure
    if (context.fileServerData?.movies?.[originalTitle]) {
      fileServerMovieData = context.fileServerData.movies[originalTitle]
      console.log(`✅ Found file server data for "${originalTitle}"`)
    } else {
      console.log(`❌ No file server data found for "${originalTitle}"`)
      console.log('🔍 Available movies in file server:', context.fileServerData?.movies ? Object.keys(context.fileServerData.movies) : 'No movies object')
    }

    console.log('🔍 File server movie data for', originalTitle, ':', fileServerMovieData)

    // Step 1: Get video URL from file server data
    let videoUrl: string | null = null
    if (fileServerMovieData) {
      videoUrl = this.getVideoUrlFromFileServerData(originalTitle, fileServerMovieData, context)
    } else {
      console.log('⚠️ No file server data available, falling back to file probing')
      videoUrl = await this.findVideoFileByProbing(originalTitle, context)
    }
    
    // Enhanced logging to debug the video URL check
    console.log(`🔍 Debug - videoUrl: ${videoUrl ? 'exists' : 'missing'}, currentUrl: ${currentMovie.videoURL ? 'exists' : 'missing'}`)
    
    const shouldUpdate = this.shouldUpdateField(getFieldPath('videoURL'), originalTitle, context)
    console.log(`🔍 Debug - shouldUpdateField for videoURL: ${shouldUpdate}`)
    
    // Adjusted to also process content when existing video URL exists in currentMovie
    if ((videoUrl || currentMovie.videoURL) && (shouldUpdate || !currentMovie.videoURL)) {
      const currentUrl = currentMovie.videoURL
      if (currentUrl !== videoUrl) {
        updates.videoURL = videoUrl
        console.log(`✅ Updating videoURL from server ${context.serverConfig.id}: "${currentUrl}" → "${videoUrl}"`)
      } else {
        console.log(`📝 VideoURL unchanged: "${videoUrl}" (server ${context.serverConfig.id} has priority but value identical)`)
      }
    }

    // Step 2: Extract video metadata from file server data
    if (videoUrl || currentMovie.videoURL) {
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
      if (fileServerMovieData) {
        videoMetadata = this.extractVideoMetadataFromFileServerData(originalTitle, fileServerMovieData)
      } else {
        console.log('⚠️ No file server data for metadata, trying legacy method')
        videoMetadata = await this.extractVideoMetadata(videoUrl || currentMovie.videoURL!, originalTitle, context)
      }
      
      if (videoMetadata) {
        // LEGACY STRUCTURE: Store fields FLAT at root level (NO nested videoInfo object)
        
        // Check priority for each metadata field separately
        if (videoMetadata.duration && this.shouldUpdateField(getFieldPath('duration'), originalTitle, context)) {
          if (currentMovie.duration !== videoMetadata.duration) {
            updates.duration = videoMetadata.duration
            console.log(`✅ Updating duration from server ${context.serverConfig.id}: ${currentMovie.duration} → ${videoMetadata.duration}`)
          } else {
            console.log(`📝 Duration unchanged: ${videoMetadata.duration} (server ${context.serverConfig.id} has priority but value identical)`)
          }
        }

        if (videoMetadata.dimensions && this.shouldUpdateField(getFieldPath('dimensions'), originalTitle, context)) {
          if (currentMovie.dimensions !== videoMetadata.dimensions) {
            updates.dimensions = videoMetadata.dimensions
            console.log(`✅ Updating dimensions from server ${context.serverConfig.id}: "${currentMovie.dimensions}" → "${videoMetadata.dimensions}"`)
          } else {
            console.log(`📝 Dimensions unchanged: "${videoMetadata.dimensions}" (server ${context.serverConfig.id} has priority but value identical)`)
          }
        }
        
        // HDR field at root level (legacy format)
        if (videoMetadata.hdr && this.shouldUpdateField(getFieldPath('hdr'), originalTitle, context)) {
          if (currentMovie.hdr !== videoMetadata.hdr) {
            updates.hdr = videoMetadata.hdr
            console.log(`✅ Updating hdr from server ${context.serverConfig.id}: "${currentMovie.hdr}" → "${videoMetadata.hdr}"`)
          } else {
            console.log(`📝 HDR unchanged: "${videoMetadata.hdr}" (server ${context.serverConfig.id} has priority but value identical)`)
          }
        }
        
        // NEW: Media last modified field (legacy format)
        if (videoMetadata.mediaLastModified && this.shouldUpdateField(getFieldPath('mediaLastModified'), originalTitle, context)) {
          const currentModified = currentMovie.mediaLastModified
          const newModified = videoMetadata.mediaLastModified
          if (!currentModified || currentModified.getTime() !== newModified.getTime()) {
            updates.mediaLastModified = newModified
            console.log(`✅ Updating mediaLastModified from server ${context.serverConfig.id}`)
          } else {
            console.log(`📝 MediaLastModified unchanged (server ${context.serverConfig.id} has priority but value identical)`)
          }
        }

        if (videoMetadata.mediaQuality && this.shouldUpdateMediaQuality(videoMetadata.mediaQuality, originalTitle, context)) {
          const currentQuality = currentMovie.mediaQuality
          if (!this.isMediaQualityEqual(currentQuality, videoMetadata.mediaQuality)) {
            updates.mediaQuality = videoMetadata.mediaQuality
            console.log(`✅ Updating mediaQuality from server ${context.serverConfig.id}`)
            console.log(`   Current:`, currentQuality)
            console.log(`   New:`, videoMetadata.mediaQuality)
          } else {
            console.log(`📝 MediaQuality unchanged (server ${context.serverConfig.id} has priority for some fields but value identical)`)
          }
        }

        // NOTE: videoInfo uses FLAT structure only
        // All fields are stored at root level: duration, dimensions, hdr, mediaQuality, mediaLastModified
      }
    }

    // Step 3: Generate normalized video ID for deduplication
    // Note: normalizedVideoId is a computed field from fileServer._id or videoUrl hash, not tracked in fieldAvailability
    const hasFileServerId = fileServerMovieData && typeof fileServerMovieData === 'object' && '_id' in fileServerMovieData
    if (videoUrl || hasFileServerId) {
      const normalizedId = this.generateNormalizedVideoId(videoUrl, originalTitle, fileServerMovieData)
      if (currentMovie.normalizedVideoId !== normalizedId) {
        updates.normalizedVideoId = normalizedId
        console.log(`✅ Updating normalizedVideoId from server ${context.serverConfig.id}: "${currentMovie.normalizedVideoId}" → "${normalizedId}"`)
      } else {
        console.log(`📝 NormalizedVideoId unchanged: "${normalizedId}" (computed from ${hasFileServerId ? 'fileServer._id' : 'videoUrl hash'})`)
      }
    }

    // Step 4: Process captions from file server data
    if (fileServerMovieData) {
      const allCaptions = this.extractCaptionsFromFileServerData(originalTitle, fileServerMovieData, context)
      
      if (allCaptions) {
        // Filter captions based on individual field priority (not root captionURLs field)
        const filteredCaptions = filterCaptionsByFieldAvailability(
          allCaptions,
          originalTitle,
          context.fieldAvailability,
          context.serverConfig,
          (fieldPath: string, title: string) => this.shouldUpdateField(fieldPath, title, context)
        )
        
        if (Object.keys(filteredCaptions).length > 0) {
          // Check if filtered captions have changed
          if (!this.areCaptionsEqual(currentMovie.captionURLs, filteredCaptions)) {
            updates.captionURLs = filteredCaptions
            console.log(`✅ Updating captionURLs from server ${context.serverConfig.id}`)
            console.log(`   Found ${Object.keys(filteredCaptions).length} caption(s): ${Object.keys(filteredCaptions).join(', ')}`)
            console.log(`   Filtered from ${Object.keys(allCaptions).length} available caption(s) based on field availability`)
          } else {
            console.log(`📝 CaptionURLs unchanged (server ${context.serverConfig.id} has priority for some fields but values identical)`)
          }
        } else {
          console.log(`⚠️ Server ${context.serverConfig.id} has no priority for any caption fields, skipping caption update`)
        }
      }
    }

    // Step 5: Process chapters from file server data
    if (fileServerMovieData) {
      const chapterUrl = this.extractChapterFromFileServerData(originalTitle, fileServerMovieData, context)
      
      if (chapterUrl && this.shouldUpdateField(getFieldPath('chapterURL'), originalTitle, context)) {
        if (currentMovie.chapterURL !== chapterUrl) {
          updates.chapterURL = chapterUrl
          console.log(`✅ Updating chapterURL from server ${context.serverConfig.id}: "${chapterUrl}"`)
        } else {
          console.log(`📝 ChapterURL unchanged: "${chapterUrl}" (server ${context.serverConfig.id} has priority but value identical)`)
        }
      }
    }

    return updates
  }

  /**
   * Get video URL from existing file server data (passed through sync context)
   * The file server data is already fetched via single API call (e.g., /nodejs/media/movies)
   */
  private getVideoUrlFromFileServerData(originalTitle: string, fileServerData: any, context: SyncContext): string | null {
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
          console.log(`🔧 Stripped prefix "${context.serverConfig.prefix}" from path: ${fileServerData.urls.mp4} -> ${relativePath}`)
        }
        
        const videoUrl = UrlBuilder.createFullUrl(relativePath, context.serverConfig)
        console.log(`✅ Found video URL from urls.mp4 (final path: ${relativePath}) -> full: ${videoUrl}`)
        return videoUrl
      }
      
      // Fallback: look for MP4 file in fileNames and construct URL
      if (fileServerData.fileNames && Array.isArray(fileServerData.fileNames)) {
        const mp4File = fileServerData.fileNames.find((name: string) => name.endsWith('.mp4'))
        if (mp4File) {
          const relativePath = `/movies/${originalTitle}/${mp4File}`
          const videoUrl = UrlBuilder.createFullUrl(relativePath, context.serverConfig)
          console.log(`✅ Found video file via fileNames (relative: ${relativePath}) -> full: ${videoUrl}`)
          return videoUrl
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
  private async findVideoFileByProbing(originalTitle: string, context: SyncContext): Promise<string | null> {
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
    const urls = potentialPaths.map(path => UrlBuilder.createFullUrl(path, context.serverConfig))

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

      // Find the MP4 file to get its metadata
      let mp4File = null
      if (fileServerData.fileNames && Array.isArray(fileServerData.fileNames)) {
        mp4File = fileServerData.fileNames.find((name: string) => name.endsWith('.mp4'))
      }

      if (!mp4File) {
        console.log(`❌ No MP4 file found in fileNames for: "${originalTitle}"`)
        return null
      }

      // Extract metadata using the same patterns as the old sync system
      const result: any = {}

      // Duration - prefer normalized additional_metadata.duration (backend-normalized)
      if (fileServerData.additional_metadata?.duration != null) {
        result.duration = fileServerData.additional_metadata.duration
      }

      // Dimensions - prefer normalized additional_metadata.dimensions or width/height
      if (fileServerData.additional_metadata?.dimensions) {
        result.dimensions = fileServerData.additional_metadata.dimensions
      } else if (fileServerData.additional_metadata?.width && fileServerData.additional_metadata?.height) {
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
        result.mediaQuality = this.parseMediaQualityLegacy(fileServerData.mediaQuality, fileServerData.hdr)
      }

      console.log(`✅ Extracted video metadata for: "${originalTitle}"`, result)
      return result

    } catch (error) {
      console.error(`Failed to extract video metadata from file server data for ${originalTitle}:`, error)
      return null
    }
  }

  /**
   * Legacy method for extracting metadata from individual files (kept as fallback)
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
              'Accept': 'application/json',
              'Cache-Control': 'no-cache'
            }
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
              mediaQuality: this.parseMediaQuality(metadata)
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
          enabled: true 
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
          mediaQuality
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
      transferCharacteristics: metadata.transfer_characteristics || metadata.transferCharacteristics
    }
    
    // Determine HDR status
    const hasHDR = !!(metadata.hdr_format || metadata.hdrFormat || metadata.isHDR ||
                     (typeof hdrValue === 'string' && hdrValue.toLowerCase().includes('hdr')))
    
    // Add isHDR field (legacy format)
    quality.isHDR = hasHDR
    
    // Add viewingExperience object (legacy format) instead of simple enhancedViewing boolean
    quality.viewingExperience = {
      enhancedColor: metadata.enhanced_viewing || metadata.enhancedViewing || (quality.bitDepth !== undefined && quality.bitDepth >= 10) || false,
      highDynamicRange: hasHDR,
      dolbyVision: !!(metadata.hdr_format || metadata.hdrFormat || '').toLowerCase().includes('dolby'),
      hdr10Plus: !!(metadata.hdr_format || metadata.hdrFormat || '').toLowerCase().includes('hdr10+'),
      standardHDR: hasHDR && !(metadata.hdr_format || metadata.hdrFormat || '').toLowerCase().includes('dolby') &&
                   !(metadata.hdr_format || metadata.hdrFormat || '').toLowerCase().includes('hdr10+')
    }

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
      transferCharacteristics: metadata.transfer_characteristics || metadata.transferCharacteristics,
      hdrFormat: metadata.hdr_format || metadata.hdrFormat,
      enhancedViewing: metadata.enhanced_viewing || metadata.enhancedViewing || false
    }
  }

  /**
   * Detect media quality from filename patterns
   */
  private detectQualityFromFilename(filename: string): MediaQuality {
    const upper = filename.toUpperCase()
    
    const mediaQuality: MediaQuality = {
      enhancedViewing: false
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
   * Generate normalized video ID for deduplication
   * Priority 1: Use _id from fileserver data (legacy format)
   * Priority 2: Fallback to crypto hash if no _id available
   */
  private generateNormalizedVideoId(
    videoUrl: string | null,
    originalTitle: string,
    fileServerData?: any
  ): string {
    // Priority 1: Use _id from fileserver data if available
    if (fileServerData?._id) {
      console.log(`✅ Using fileserver _id as normalizedVideoId for "${originalTitle}": ${fileServerData._id}`)
      return fileServerData._id
    }
    
    // Priority 2: Fallback to hash generation if no _id
    if (!videoUrl) {
      console.warn(`⚠️ No videoUrl or _id available for "${originalTitle}", cannot generate normalizedVideoId`)
      return ''
    }
    
    console.log(`⚠️ No _id in fileserver data for "${originalTitle}", falling back to URL hash`)
    
    try {
      const crypto = require('crypto')
      
      // Normalize URL before hashing (same as legacy)
      let normalizedUrl = videoUrl
      
      // Try to decode if encoded
      try {
        normalizedUrl = decodeURIComponent(decodeURIComponent(videoUrl))
      } catch (e) {
        try {
          normalizedUrl = decodeURIComponent(videoUrl)
        } catch (e2) {
          normalizedUrl = videoUrl
        }
      }
      
      // Extract path portion only
      try {
        const urlObj = new URL(normalizedUrl)
        normalizedUrl = urlObj.pathname
      } catch (e) {
        // Use whole string if URL parsing fails
      }
      
      // Convert to lowercase
      normalizedUrl = normalizedUrl.toLowerCase()
      
      // Create SHA-256 hash
      const hash = crypto.createHash('sha256')
      hash.update(normalizedUrl)
      
      // Return first 16 characters (matches legacy format)
      return hash.digest('hex').substring(0, 16)
    } catch (error) {
      console.error(`Error generating normalized video ID for URL: ${videoUrl}`, error)
      
      // Fallback to simple string manipulation
      const fallbackStr = videoUrl.toLowerCase().replace(/[^a-z0-9]/g, '')
      return `fallback_${fallbackStr.substring(0, 10)}`
    }
  }

  /**
   * Helper function to compare values treating null/undefined/empty as equivalent
   */
  private areValuesEqual(value1: any, value2: any): boolean {
    // Treat null, undefined, and empty string as equivalent "empty" values
    const isEmpty = (v: any) => v === null || v === undefined || v === '';
    if (isEmpty(value1) && isEmpty(value2)) return true;
    
    // For numbers, handle NaN cases
    if (typeof value1 === 'number' && typeof value2 === 'number') {
      if (isNaN(value1) && isNaN(value2)) return true;
    }
    
    return value1 === value2;
  }

  /**
   * Compare media quality objects for equality
   */
  private isMediaQualityEqual(current: MediaQuality | null | undefined, incoming: MediaQuality | null | undefined): boolean {
    if (!current && !incoming) return true
    if (!current || !incoming) return false

    // Enable detailed logging with DEBUG_SYNC=true env var
    const debugEnabled = process.env.DEBUG_SYNC === 'true';
    if (debugEnabled) {
      console.log(`🔍 Comparing MediaQuality objects:
Current: ${JSON.stringify(current)}
Incoming: ${JSON.stringify(incoming)}`);
    }

    // Property-by-property comparison with better null/undefined handling
    const formatEqual = this.areValuesEqual(current.format, incoming.format);
    const bitDepthEqual = this.areValuesEqual(current.bitDepth, incoming.bitDepth);
    const colorSpaceEqual = this.areValuesEqual(current.colorSpace, incoming.colorSpace);
    const transferCharEqual = this.areValuesEqual(current.transferCharacteristics, incoming.transferCharacteristics);
    const hdrFormatEqual = this.areValuesEqual(current.hdrFormat, incoming.hdrFormat);
    const enhancedViewingEqual = this.areValuesEqual(current.enhancedViewing, incoming.enhancedViewing);

    // Log any differences if debug is enabled
    if (debugEnabled) {
      if (!formatEqual) console.log(`⚠️ MediaQuality format differs: ${current.format} vs ${incoming.format}`);
      if (!bitDepthEqual) console.log(`⚠️ MediaQuality bitDepth differs: ${current.bitDepth} vs ${incoming.bitDepth}`);
      if (!colorSpaceEqual) console.log(`⚠️ MediaQuality colorSpace differs: ${current.colorSpace} vs ${incoming.colorSpace}`);
      if (!transferCharEqual) console.log(`⚠️ MediaQuality transferCharacteristics differs: ${current.transferCharacteristics} vs ${incoming.transferCharacteristics}`);
      if (!hdrFormatEqual) console.log(`⚠️ MediaQuality hdrFormat differs: ${current.hdrFormat} vs ${incoming.hdrFormat}`);
      if (!enhancedViewingEqual) console.log(`⚠️ MediaQuality enhancedViewing differs: ${current.enhancedViewing} vs ${incoming.enhancedViewing}`);
    }

    return formatEqual && bitDepthEqual && colorSpaceEqual && 
           transferCharEqual && hdrFormatEqual && enhancedViewingEqual;
  }

  /**
   * Compare video info objects for equality
   */
  private isVideoInfoEqual(current: VideoInfo | null | undefined, incoming: VideoInfo): boolean {
    if (!current && !incoming) return true
    if (!current || !incoming) return false

    // Enable detailed logging with DEBUG_SYNC=true env var
    const debugEnabled = process.env.DEBUG_SYNC === 'true';
    if (debugEnabled) {
      console.log(`🔍 Comparing VideoInfo objects:
Current: ${JSON.stringify(current)}
Incoming: ${JSON.stringify(incoming)}`);
    }

    // Property-by-property comparison with better null/undefined handling
    const durationEqual = this.areValuesEqual(current.duration, incoming.duration);
    const resolutionEqual = this.areValuesEqual(current.resolution, incoming.resolution);
    const codecEqual = this.areValuesEqual(current.codec, incoming.codec);
    const bitrateEqual = this.areValuesEqual(current.bitrate, incoming.bitrate);
    const frameRateEqual = this.areValuesEqual(current.frameRate, incoming.frameRate);
    const audioCodecEqual = this.areValuesEqual(current.audioCodec, incoming.audioCodec);
    const audioChannelsEqual = this.areValuesEqual(current.audioChannels, incoming.audioChannels);
    const fileSizeEqual = this.areValuesEqual(current.fileSize, incoming.fileSize);
    const mediaQualityEqual = this.isMediaQualityEqual(current.mediaQuality, incoming.mediaQuality);

    // Log any differences if debug is enabled
    if (debugEnabled) {
      if (!durationEqual) console.log(`⚠️ VideoInfo duration differs: ${current.duration} vs ${incoming.duration}`);
      if (!resolutionEqual) console.log(`⚠️ VideoInfo resolution differs: ${current.resolution} vs ${incoming.resolution}`);
      if (!codecEqual) console.log(`⚠️ VideoInfo codec differs: ${current.codec} vs ${incoming.codec}`);
      if (!bitrateEqual) console.log(`⚠️ VideoInfo bitrate differs: ${current.bitrate} vs ${incoming.bitrate}`);
      if (!frameRateEqual) console.log(`⚠️ VideoInfo frameRate differs: ${current.frameRate} vs ${incoming.frameRate}`);
      if (!audioCodecEqual) console.log(`⚠️ VideoInfo audioCodec differs: ${current.audioCodec} vs ${incoming.audioCodec}`);
      if (!audioChannelsEqual) console.log(`⚠️ VideoInfo audioChannels differs: ${current.audioChannels} vs ${incoming.audioChannels}`);
      if (!fileSizeEqual) console.log(`⚠️ VideoInfo fileSize differs: ${current.fileSize} vs ${incoming.fileSize}`);
      if (!mediaQualityEqual) console.log(`⚠️ VideoInfo mediaQuality differs (see above for details)`);
    }

    return durationEqual && resolutionEqual && codecEqual && bitrateEqual && 
           frameRateEqual && audioCodecEqual && audioChannelsEqual && 
           fileSizeEqual && mediaQualityEqual;
  }

  /**
   * Extract captions from file server data
   */
  private extractCaptionsFromFileServerData(
    originalTitle: string,
    fileServerData: any,
    context: SyncContext
  ): Record<string, {
    srcLang: string
    url: string
    lastModified?: string
    sourceServerId?: string
  }> | null {
    try {
      console.log(`🎬 Extracting captions for: "${originalTitle}"`)
      
      // Check if we have subtitles in the file server data
      if (!fileServerData?.urls?.subtitles) {
        console.log(`❌ No subtitles found in file server data for: "${originalTitle}"`)
        return null
      }

      const captionURLs: Record<string, {
        srcLang: string
        url: string
        lastModified?: string
        sourceServerId?: string
      }> = {}
      
      const subtitles = fileServerData.urls.subtitles

      // Transform subtitle structure to captionURLs format
      // FROM: { "English": { url: "/path", srcLang: "en" } }
      // TO: { "English": { url: "/full/url/path", srcLang: "en", sourceServerId: "..." } }
      for (const [language, subtitleData] of Object.entries(subtitles)) {
        if (subtitleData && typeof subtitleData === 'object' && 'url' in subtitleData) {
          const relativePath = (subtitleData as any).url
          const srcLang = (subtitleData as any).srcLang || 'en'
          const lastModified = (subtitleData as any).lastModified
          
          // Strip prefix if it's already included in the relative path to avoid double prefixes
          let cleanPath = relativePath
          if (context.serverConfig.prefix && cleanPath.startsWith(context.serverConfig.prefix)) {
            cleanPath = cleanPath.substring(context.serverConfig.prefix.length)
          }
          
          const fullUrl = UrlBuilder.createFullUrl(cleanPath, context.serverConfig)
          
          captionURLs[language] = {
            srcLang,
            url: fullUrl,
            lastModified,
            sourceServerId: context.serverConfig.id
          }
          
          console.log(`✅ Found caption for ${language}: ${fullUrl}`)
        }
      }

      return Object.keys(captionURLs).length > 0 ? captionURLs : null
    } catch (error) {
      console.error(`Failed to extract captions for ${originalTitle}:`, error)
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
      console.log(`🎬 Extracting chapter data for: "${originalTitle}"`)
      
      // Check if we have chapter data in the file server data
      if (!fileServerData?.urls?.chapters) {
        console.log(`❌ No chapters found in file server data for: "${originalTitle}"`)
        return null
      }

      const relativePath = fileServerData.urls.chapters
      
      // Strip prefix if it's already included in the relative path to avoid double prefixes
      let cleanPath = relativePath
      if (context.serverConfig.prefix && cleanPath.startsWith(context.serverConfig.prefix)) {
        cleanPath = cleanPath.substring(context.serverConfig.prefix.length)
      }
      
      const fullUrl = UrlBuilder.createFullUrl(cleanPath, context.serverConfig)
      console.log(`✅ Found chapter data: ${fullUrl}`)
      
      return fullUrl
    } catch (error) {
      console.error(`Failed to extract chapter data for ${originalTitle}:`, error)
      return null
    }
  }

  /**
   * Check if mediaQuality should be updated based on individual field priority
   * Only updates if this server has priority for at least one mediaQuality subfield
   */
  private shouldUpdateMediaQuality(mediaQuality: MediaQuality, originalTitle: string, context: SyncContext): boolean {
    console.log(`🔍 MediaQuality priority check for: "${originalTitle}", server=${context.serverConfig.id}`)

    // Check if fieldAvailability is present in context
    if (!context.fieldAvailability) {
      console.log(`⚠️ No fieldAvailability in context, defaulting to true for mediaQuality`)
      return true
    }

    // Ensure mediaType exists in fieldAvailability
    if (!context.fieldAvailability[MediaTypesFieldAvailability.Movie]) {
      console.log(`⚠️ MediaType.Movie not found in fieldAvailability, defaulting to true for mediaQuality`)
      return true
    }

    // Check if the movie exists in fieldAvailability (using originalTitle as key)
    const movieFields = context.fieldAvailability[MediaTypesFieldAvailability.Movie][originalTitle]
    if (!movieFields) {
      console.log(`⚠️ Movie "${originalTitle}" not found in fieldAvailability, defaulting to true for mediaQuality`)
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
      'mediaQuality.viewingExperience.standardHDR'
    ]

    // Check if this server has priority for any mediaQuality subfield
    for (const fieldPath of mediaQualityFields) {
      if (this.shouldUpdateField(fieldPath, originalTitle, context)) {
        console.log(`✅ Server ${context.serverConfig.id} has priority for ${fieldPath}`)
        return true
      } else {
        console.log(`❌ Server ${context.serverConfig.id} does NOT have priority for ${fieldPath}`)
      }
    }

    console.log(`⚠️ Server ${context.serverConfig.id} has no priority for any mediaQuality fields, skipping update`)
    return false
  }

  /**
   * Check if the specified field should be updated based on server priority
   * CRITICAL: Always use originalTitle (filesystem key) for fieldAvailability lookups
   */
  private shouldUpdateField(field: string, originalTitle: string, context: SyncContext): boolean {
    console.log(`🔍 Priority check: field="${field}", originalTitle="${originalTitle}", server=${context.serverConfig.id}`)
    
    // Check if fieldAvailability is present in context
    if (!context.fieldAvailability) {
      console.log(`⚠️ No fieldAvailability in context, defaulting to true for ${field}`)
      return true
    }

    // Ensure mediaType exists in fieldAvailability
    if (!context.fieldAvailability[MediaTypesFieldAvailability.Movie]) {
      console.log(`⚠️ MediaType.Movie not found in fieldAvailability, defaulting to true for ${field}`)
      return true
    }

    // Check if the movie exists in fieldAvailability (using originalTitle as key)
    const movieFields = context.fieldAvailability[MediaTypesFieldAvailability.Movie][originalTitle]
    if (!movieFields) {
      console.log(`⚠️ Movie "${originalTitle}" not found in fieldAvailability, defaulting to true`)
      return true
    }

    // Get servers that have this field
    const serversWithField = movieFields[field] || []
    console.log(`📊 Servers with ${field}: ${JSON.stringify(serversWithField)} (${serversWithField.length} total)`)

    // Check priority
    const hasHighestPriority = isCurrentServerHighestPriorityForField(
      context.fieldAvailability,
      MediaTypesFieldAvailability.Movie,
      originalTitle,  // ← CRITICAL: Always use originalTitle for consistency
      field,
      context.serverConfig
    )
    
    if (hasHighestPriority) {
      console.log(`✅ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) has highest priority for ${field}`)
    } else {
      console.log(`❌ Server ${context.serverConfig.id} (priority ${context.serverConfig.priority}) does NOT have highest priority for ${field}`)
    }
    
    return hasHighestPriority
  }

  /**
   * Compare caption objects for equality
   */
  private areCaptionsEqual(
    current: Record<string, {
      srcLang: string
      url: string
      lastModified?: string
      sourceServerId?: string
    }> | null | undefined,
    incoming: Record<string, {
      srcLang: string
      url: string
      lastModified?: string
      sourceServerId?: string
    }> | null | undefined
  ): boolean {
    if (!current && !incoming) return true
    if (!current || !incoming) return false
    
    // Enable detailed logging with DEBUG_SYNC=true env var
    const debugEnabled = process.env.DEBUG_SYNC === 'true';
    if (debugEnabled) {
      console.log(`🔍 Comparing caption objects:
Current: ${JSON.stringify(current)}
Incoming: ${JSON.stringify(incoming)}`);
    }
    
    const currentKeys = Object.keys(current).sort()
    const incomingKeys = Object.keys(incoming).sort()
    
    if (currentKeys.length !== incomingKeys.length) {
      if (debugEnabled) {
        console.log(`⚠️ Caption key count differs: ${currentKeys.length} vs ${incomingKeys.length}`);
        console.log(`Current keys: ${currentKeys.join(', ')}`);
        console.log(`Incoming keys: ${incomingKeys.join(', ')}`);
      }
      return false
    }
    
    for (let i = 0; i < currentKeys.length; i++) {
      const key = currentKeys[i]
      if (key !== incomingKeys[i]) {
        if (debugEnabled) console.log(`⚠️ Caption key order differs: ${key} vs ${incomingKeys[i]}`);
        return false
      }
      
      // Compare URL and srcLang fields using the areValuesEqual helper for consistent null/undefined handling
      const urlEqual = this.areValuesEqual(current[key].url, incoming[key].url);
      const srcLangEqual = this.areValuesEqual(current[key].srcLang, incoming[key].srcLang);
      
      if (!urlEqual || !srcLangEqual) {
        if (debugEnabled) {
          if (!urlEqual) console.log(`⚠️ Caption URL differs for ${key}: ${current[key].url} vs ${incoming[key].url}`);
          if (!srcLangEqual) console.log(`⚠️ Caption srcLang differs for ${key}: ${current[key].srcLang} vs ${incoming[key].srcLang}`);
        }
        return false
      }
    }
    
    return true
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
      metadata
    }
  }

  async validate?(entity: BaseMediaEntity, context: SyncContext): Promise<boolean> {
    return !!(entity.originalTitle && context.serverConfig.id)
  }
}
