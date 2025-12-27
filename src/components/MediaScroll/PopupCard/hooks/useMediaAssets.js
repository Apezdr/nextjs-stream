import { useMemo } from 'react'
import { getFullImageUrl } from '@src/utils'

/**
 * Custom hook to manage media assets (images, logos) and their visibility
 * 
 * This hook encapsulates the logic for:
 * - Determining which image sources to use (logo, poster, backdrop, thumbnail)
 * - Calculating which images should be visible based on playback state
 * - Managing blurhash placeholders
 * 
 * @param {Object} data - The fetched media data
 * @param {Object} props - Props passed from parent containing fallback values
 * @param {Object} playbackState - Current video playback state
 * @returns {Object} Image configuration and visibility flags
 */
export const useMediaAssets = (data, props, playbackState) => {
  const { shouldPlay, isThumbnailLoaded, showBackdrop, delayBackdropHide } = playbackState

  // Memoize computed image sources and blurhashes
  const imageConfig = useMemo(() => {
    const logoSrc = data?.logo || data?.logo_path || props.metadata?.logo_path
    const posterSrc = data?.posterURL || props.posterURL
    const posterBlur = data?.posterBlurhash || props.posterBlurhash
    const backdropSrc = props.backdrop ?? data?.backdrop ?? (data?.backdrop_path ? getFullImageUrl(data?.backdrop_path, 'w500') : null)
    const backdropBlur = props.backdropBlurhash ?? data?.backdropBlurhash
    const thumbnailSrc = data?.thumbnail
    const thumbnailBlur = data?.blurhash?.thumbnail || data?.thumbnailBlurhash
    
    return {
      logoSrc,
      posterSrc,
      posterBlur,
      backdropSrc,
      backdropBlur,
      thumbnailSrc,
      thumbnailBlur,
      hasLogo: !!logoSrc,
      hasBackdrop: !!backdropSrc,
      hasPoster: !!posterSrc,
      hasThumbnail: !!thumbnailSrc,
    }
  }, [
    data?.logo,
    data?.logo_path,
    data?.posterURL,
    data?.posterBlurhash,
    data?.backdrop,
    data?.backdrop_path,
    data?.backdropBlurhash,
    data?.thumbnail,
    data?.blurhash?.thumbnail,
    data?.thumbnailBlurhash,
    props.metadata?.logo_path,
    props.posterURL,
    props.posterBlurhash,
    props.backdrop,
    props.backdropBlurhash,
  ])

  // Memoize visibility flags
  const visibilityFlags = useMemo(() => {
    const { hasBackdrop, hasThumbnail, hasPoster } = imageConfig
    
    const shouldShowPoster = !shouldPlay && !hasBackdrop && !hasThumbnail && hasPoster
    
    // Simple fix: for thumbnails, never show backdrop once thumbnail loads
    const shouldShowBackdrop = hasBackdrop && (
      hasThumbnail 
        ? (!isThumbnailLoaded && showBackdrop)  // Show backdrop until thumbnail loads, then never again
        : (!shouldPlay || delayBackdropHide)     // Non-thumbnails: use delay logic
    )
    
    const shouldShowThumbnail = !shouldPlay && hasThumbnail
    
    return {
      shouldShowPoster,
      shouldShowBackdrop,
      shouldShowThumbnail,
    }
  }, [shouldPlay, imageConfig, isThumbnailLoaded, showBackdrop, delayBackdropHide])

  return {
    imageConfig,
    visibilityFlags,
  }
}