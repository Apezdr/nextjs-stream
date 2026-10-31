'use client'

import { useState, useCallback, ViewTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import dynamic from 'next/dynamic'
import { classNames } from '@src/utils'
import RetryImage from '@components/RetryImage'

// Import the CardVideoPlayer with z-[40]
const CardVideoPlayer = dynamic(() => import('@src/components/MediaScroll/CardVideoPlayer'), {
  ssr: false,
})

/**
 * MediaHero Component
 * 
 * Handles the visual display layer of the PopupCard including:
 * - Logo overlay with dynamic positioning
 * - Video player integration
 * - Multiple image layers with z-index stacking (poster/backdrop/thumbnail)
 * - Smooth transitions between different visual states
 * 
 * @param {Object} props - Component props
 * @param {string} props.title - Media title for alt text
 * @param {Object} props.imagePosition - Position and dimensions for the media area
 * @param {Object} props.imageConfig - Image URLs and flags from useMediaAssets
 * @param {Object} props.visibilityFlags - Which images should be visible
 * @param {Object} props.playbackState - Current video playback state
 * @param {string} props.videoURL - Video URL if available
 * @param {boolean} props.shouldPlay - Whether video should be playing
 * @param {Function} props.onVideoReady - Callback when video is ready
 * @param {Function} props.dispatch - State dispatch function for video events
 * @param {Function} props.handleImageLoad - Handler for image load events
 * @param {boolean} props.isLoading - Whether data is still loading
 */
const MediaHero = ({
  title,
  imagePosition,
  imageConfig,
  visibilityFlags,
  playbackState,
  videoURL,
  shouldPlay,
  onVideoReady,
  dispatch,
  handleImageLoad,
  isLoading,
  viewTransitionName,
}) => {
  const [logoLoaded, setLogoLoaded] = useState(false)
  // The URL RetryImage gave up on, per layer (it reports once, after its
  // retries). Keyed by URL: the popup's fetch can swap a layer's source, and a
  // new one deserves its own attempts.
  const [failedSrc, setFailedSrc] = useState({})

  // Extract image configuration
  const {
    logoSrc,
    posterSrc,
    posterBlur,
    backdropSrc,
    backdropBlur,
    thumbnailSrc,
    thumbnailBlur,
    hasLogo,
    hasBackdrop,
    hasPoster,
    hasThumbnail,
  } = imageConfig

  // Extract visibility flags
  const { shouldShowBackdrop, shouldShowThumbnail } = visibilityFlags

  const failed = {
    thumbnail: Boolean(thumbnailSrc) && failedSrc.thumbnail === thumbnailSrc,
    backdrop: Boolean(backdropSrc) && failedSrc.backdrop === backdropSrc,
    poster: Boolean(posterSrc) && failedSrc.poster === posterSrc,
  }
  const srcOf = { thumbnail: thumbnailSrc, backdrop: backdropSrc, poster: posterSrc }

  // The layers fall through, best first: thumbnail, backdrop, poster. The
  // poster is the last resort, so it also shows once everything above it has
  // failed. (A failed thumbnail already keeps the backdrop up: the backdrop
  // leaves only when the thumbnail loads.)
  const shouldShowPoster =
    visibilityFlags.shouldShowPoster ||
    (!shouldPlay && hasPoster && (!hasBackdrop || failed.backdrop) && (!hasThumbnail || failed.thumbnail))

  // A failed layer steps aside when a working one sits under it; only the
  // last one standing shows its blurhash or the frosted glass
  const backdropBelow = shouldShowBackdrop && !failed.backdrop
  const posterBelow = hasPoster && !failed.poster
  const thumbnailWhenFailed = backdropBelow || posterBelow ? 'hide' : 'frost'
  const backdropWhenFailed = posterBelow ? 'hide' : 'frost'

  // A failed image counts as settled: the clip waits for the image to be seen,
  // and with none to see it should not wait forever
  const handleLayerError = (layer) => () => {
    setFailedSrc((prev) => ({ ...prev, [layer]: srcOf[layer] }))
    handleImageLoad()
  }

  // Handle logo image loading
  const handleLogoLoad = useCallback(() => {
    setLogoLoaded(true)
  }, [])

  const hero = (
    <div
      // Dark under the art, so a blurhash or the frosted glass reads as it does
      // on the pages, rather than as white on the popup's white body
      className="relative overflow-hidden rounded-t-lg bg-[#0f1633]"
      style={{
        height: imagePosition.height,
        width: imagePosition.expandedWidth,
      }}
    >
      {/* Logo if present (z-[50]) */}
      {hasLogo && (
        <RetryImage
          whenFailed="hide"
          quality={25}
          fill
          loading="eager"
          priority
          src={logoSrc}
          alt={`${title} Logo`}
          className={classNames(
            "absolute !w-auto transform max-w-[185px] inset-0 object-contain select-none z-[50]",
            "transition-all duration-[1.4s] ease-in-out",
            // Fade in when loaded
            logoLoaded ? 'opacity-100' : 'opacity-0',
            // Dim it if the video is playing
            shouldPlay ? 'opacity-45 hover:opacity-100' : '',
            // Center it if the video is not playing
            shouldPlay ? '!top-4 !left-8 max-h-5' : '!top-[67%] !left-1/2 max-h-14 -translate-x-1/2'
          )}
          onLoad={handleLogoLoad}
        />
      )}

      {/* Video (z-[40]) is always rendered if videoURL exists, but only visible if shouldPlay */}
      {videoURL && (
        <CardVideoPlayer
          height={imagePosition?.height}
          width={imagePosition?.expandedWidth}
          onVideoReady={onVideoReady}
          playingVideo={playbackState.playingVideo}
          onPlaying={() => dispatch({ type: 'SET_PLAYING_VIDEO', value: true })}
          onVideoEnd={() => dispatch({ type: 'VIDEO_ENDED' })}
          videoURL={videoURL}
          shouldPlay={shouldPlay}
        />
      )}

      {/* Overlapping transitions for backdrop/thumbnail/poster */}
      <AnimatePresence mode="sync">
        {/* Poster fallback (lowest) => z-[10] */}
        {shouldShowPoster && (
          <motion.div
            key="poster"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 4.8 }}
            className="w-full h-full absolute inset-0 z-[10]"
          >
            <RetryImage
              quality={100}
              src={posterSrc}
              placeholder={posterBlur ? 'blur' : 'empty'}
              blurDataURL={posterBlur ? `data:image/png;base64,${posterBlur}` : undefined}
              alt={title}
              loading="eager"
              priority
              fill
              className={classNames(
                "rounded-t-lg object-cover",
                playbackState.afterVideo ? 'filter brightness-50' : ''
              )}
              onLoad={handleImageLoad}
              onError={handleLayerError('poster')}
            />
          </motion.div>
        )}

        {/* Backdrop => z-[20] */}
        {shouldShowBackdrop && (
          <motion.div
            key="backdrop"
            initial={{ opacity: 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 4.8 }}
            className="w-full h-full absolute inset-0 z-[20]"
          >
            <RetryImage
              quality={100}
              src={backdropSrc}
              placeholder={backdropBlur ? 'blur' : 'empty'}
              blurDataURL={backdropBlur ? `data:image/png;base64,${backdropBlur}` : undefined}
              alt={title}
              loading="eager"
              priority
              fill
              className={classNames(
                "rounded-t-lg object-cover",
                playbackState.afterVideo || (!isLoading && !videoURL) ? 'filter brightness-50' : ''
              )}
              whenFailed={backdropWhenFailed}
              onLoad={handleImageLoad}
              onError={handleLayerError('backdrop')}
            />
          </motion.div>
        )}

        {/* Thumbnail => z-[30] */}
        {shouldShowThumbnail && (
          <motion.div
            key="thumbnail"
            initial={{ opacity: shouldShowBackdrop ? 0 : 1 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: shouldShowBackdrop ? 0.3 : 4.8 }}
            className="w-full h-full absolute inset-0 z-[30]"
          >
            <RetryImage
              quality={100}
              src={thumbnailSrc}
              placeholder={thumbnailBlur ? 'blur' : 'empty'}
              blurDataURL={thumbnailBlur ? `data:image/png;base64,${thumbnailBlur}` : undefined}
              alt={title}
              loading="eager"
              priority
              fill
              className={classNames(
                "rounded-t-lg object-cover",
                playbackState.afterVideo ? 'filter brightness-50' : ''
              )}
              whenFailed={thumbnailWhenFailed}
              onLoad={() => {
                dispatch({ type: 'SET_THUMBNAIL_LOADED' })
                handleImageLoad()
              }}
              onError={handleLayerError('thumbnail')}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )

  return viewTransitionName ? (
    <ViewTransition name={viewTransitionName}>{hero}</ViewTransition>
  ) : (
    hero
  )
}

export default MediaHero