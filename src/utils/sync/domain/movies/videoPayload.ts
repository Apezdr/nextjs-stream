/**
 * Reading a movie's video from the payload a file server publishes: the video
 * URL, the facts about the file, the chapter file, and the identity derived
 * from the URL. Used by the video step (./video), which decides what of it to
 * write.
 */

import { MediaQuality, SyncContext } from '../../core'
import { fileServerUrl, prefixedPath } from '../../infrastructure'
import { sizeInBytes } from '../../core/fileFacts'
import { preferReportedViewingExperience, sameViewingExperience } from '../../core/viewingExperience'
import { syncLogger } from '../../core/logger'

// @ts-ignore — dependency-free sibling JS module (CJS) with no .d.ts
import { generateNormalizedVideoId as computeNormalizedVideoId } from '@src/utils/videoIdentity'

// Video extensions in selection-priority order — MUST mirror the backend's
// VIDEO_EXTENSIONS (media-processor node/utils/utils.mjs). The order is
// load-bearing there: it decides which file a multi-container folder
// publishes, and .mp4 stays first so existing titles keep their URL.
const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov', '.mkv', '.webm', '.avi']

/** What the payload says about the video file. */
export interface VideoFacts {
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
}

/**
 * The video URL from the server's payload for the movie (one API call, e.g.
 * /nodejs/media/movies, fetched for the whole pass), or null when it lists
 * no video.
 */
export function videoUrlOf(originalTitle: string, fileServerData: any, context: SyncContext): string | null {
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
      syncLogger.debug(`✅ Found video URL from urls.mp4 (path: ${fileServerData.urls.mp4}) -> full: ${videoUrl}`)
      return videoUrl
    }

    // Fallback: look for a video file in fileNames (container-agnostic,
    // backend extension-priority order) and construct URL
    if (fileServerData.fileNames && Array.isArray(fileServerData.fileNames)) {
      for (const ext of VIDEO_EXTENSIONS) {
        const videoFile = fileServerData.fileNames.find((name: string) => name.toLowerCase().endsWith(ext))
        if (videoFile) {
          const relativePath = `/movies/${originalTitle}/${videoFile}`
          // Built here, so not under the server's prefix yet
          const videoUrl = fileServerUrl(prefixedPath(relativePath, context.serverConfig), context.serverConfig)
          syncLogger.debug(`✅ Found video file via fileNames (relative: ${relativePath}) -> full: ${videoUrl}`)
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
 * The facts the payload reports about the video file, or null when the
 * payload could not be read.
 */
export function videoFactsOf(originalTitle: string, fileServerData: any): VideoFacts | null {
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
      result.mediaQuality = parseMediaQualityLegacy(fileServerData.mediaQuality, fileServerData.hdr)
    }

    console.log(
      `✅ Extracted video metadata for: "${originalTitle}" (duration=${result.duration}, dimensions=${result.dimensions}, hdr=${result.hdr})`
    )
    return result
  } catch (error) {
    console.error(`Failed to extract video metadata from file server data for ${originalTitle}:`, error)
    return null
  }
}

/**
 * Parse media quality from metadata - LEGACY FORMAT with isHDR and viewingExperience
 */
function parseMediaQualityLegacy(metadata: any, hdrValue?: any): MediaQuality | undefined {
  if (!metadata) return undefined

  const quality: MediaQuality = {
    format: metadata.format || metadata.codec,
    bitDepth: metadata.bit_depth || metadata.bitDepth,
    colorSpace: metadata.color_space || metadata.colorSpace,
    transferCharacteristics: metadata.transfer_characteristics || metadata.transferCharacteristics,
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
      dolbyVision: !!(metadata.hdr_format || metadata.hdrFormat || '').toLowerCase().includes('dolby'),
      hdr10Plus: !!(metadata.hdr_format || metadata.hdrFormat || '').toLowerCase().includes('hdr10+'),
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
 * The chapter file's URL from the payload, or null when it lists none.
 */
export function chapterUrlOf(originalTitle: string, fileServerData: any, context: SyncContext): string | null {
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
 * The URL-pathname-derived `normalizedVideoId` for a movie.
 *
 * Delegates to the shared implementation in `@src/utils/videoIdentity`
 * (also re-exported by `flatDatabaseUtils`), which every cross-domain
 * consumer (WatchHistory writer, validators, lookup maps, view counts)
 * uses — the writer/reader lockstep invariant is enforced by construction
 * instead of parallel maintenance. The shared impl also canonicalizes
 * JIT-transcoder stream URLs back to their source pathname, keeping
 * identity transport-invariant.
 *
 * Historical note: an earlier version short-circuited to
 * `fileServerData._id` when the file server reported one, on the theory
 * that the fileserver _id was a more stable per-asset identifier. That
 * broke every `WatchHistory.normalizedVideoId === FlatMovies.normalizedVideoId`
 * join, because WatchHistory always derives its hash from the playback URL
 * (16 chars) while the fileserver _id was 64 chars — different identifier
 * domains that could never align. Removed 2026-05-09. If a fileserver _id
 * ever needs to be persisted, give it a separate field — don't reuse this
 * one.
 */
export function normalizedVideoIdOf(videoUrl: string | null, originalTitle: string): string {
  if (!videoUrl) {
    syncLogger.warn(`⚠️ No videoUrl available for "${originalTitle}", cannot generate normalizedVideoId`)
    return ''
  }

  return computeNormalizedVideoId(videoUrl)
}

/**
 * Compare media quality objects for equality
 */
export function isMediaQualityEqual(
  current: MediaQuality | null | undefined,
  incoming: MediaQuality | null | undefined
): boolean {
  if (!current && !incoming) return true
  if (!current || !incoming) return false

  // Property-by-property comparison with better null/undefined handling
  const formatEqual = areValuesEqual(current.format, incoming.format)
  const bitDepthEqual = areValuesEqual(current.bitDepth, incoming.bitDepth)
  const colorSpaceEqual = areValuesEqual(current.colorSpace, incoming.colorSpace)
  const transferCharEqual = areValuesEqual(current.transferCharacteristics, incoming.transferCharacteristics)
  const hdrFormatEqual = areValuesEqual(current.hdrFormat, incoming.hdrFormat)
  const enhancedViewingEqual = areValuesEqual(current.enhancedViewing, incoming.enhancedViewing)
  // The legacy fields are what the stored documents carry. Leaving them out of
  // the comparison meant a changed flag (a file re-encoded to Dolby Vision, a
  // corrected dolbyVision value) was reported "unchanged" and never written.
  const isHDREqual = areValuesEqual(current.isHDR, incoming.isHDR)
  const viewingExperienceEqual = sameViewingExperience(current.viewingExperience, incoming.viewingExperience)

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
 * Helper function to compare values treating null/undefined/empty as equivalent
 */
function areValuesEqual(value1: any, value2: any): boolean {
  // Treat null, undefined, and empty string as equivalent "empty" values
  const isEmpty = (v: any) => v === null || v === undefined || v === ''
  if (isEmpty(value1) && isEmpty(value2)) return true

  // For numbers, handle NaN cases
  if (typeof value1 === 'number' && typeof value2 === 'number') {
    if (isNaN(value1) && isNaN(value2)) return true
  }

  return value1 === value2
}
