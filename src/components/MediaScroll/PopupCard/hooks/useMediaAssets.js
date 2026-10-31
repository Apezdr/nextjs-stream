import { useMemo } from 'react'
import { getFullImageUrl } from '@src/utils'

/**
 * The episode thumbnail the card already shows, when it has one: a rail
 * episode card's poster is the episode's own thumbnail, with that image's
 * blurhash (episodeCardImage), and `thumbnail` names it. The popup opens on
 * that pair instead of the show's backdrop while its own fetch is in flight,
 * and keeps it after (the fetch returns the same URL), so the image never
 * changes under the viewer.
 *
 * Not for a trailer card, whose `thumbnail` can be the show poster standing in.
 *
 * @param {{ thumbnail?: string|null, posterURL?: string|null, isTrailer?: boolean }} props
 * @returns {string|null}
 */
export const railThumbnailOf = (props) =>
  !props.isTrailer && props.thumbnail && props.thumbnail === props.posterURL ? props.thumbnail : null

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

  const railThumbnail = railThumbnailOf(props)

  // Memoize computed image sources and blurhashes
  const imageConfig = useMemo(() => {
    const logoSrc = data?.logo || data?.logo_path || props.metadata?.logo_path
    const posterSrc = data?.posterURL || props.posterURL
    const posterBlur = data?.posterBlurhash || props.posterBlurhash
    const backdropSrc = props.backdrop ?? data?.backdrop ?? (data?.backdrop_path ? getFullImageUrl(data?.backdrop_path, 'w500') : null)
    const backdropBlur = props.backdropBlurhash ?? data?.backdropBlurhash
    const thumbnailSrc = railThumbnail ?? data?.thumbnail
    // The card's blurhash is its poster's, which is this thumbnail's
    const thumbnailBlur = (railThumbnail ? props.posterBlurhash : null) || data?.blurhash?.thumbnail || data?.thumbnailBlurhash
    
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
    railThumbnail,
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