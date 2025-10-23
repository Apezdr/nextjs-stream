'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { buildURL, classNames, fetcher, getFullImageUrl } from '@src/utils'
import dynamic from 'next/dynamic'
import useSWR, { preload } from 'swr'
import RetryImage from '@components/RetryImage'
import Loading from '@src/app/loading'
import VirtualizedCastGrid from './VirtualizedCastGrid'
import WatchlistButton from '@components/WatchlistButton'
import { InformationCircleIcon } from '@heroicons/react/20/solid'

// Import the CardVideoPlayer with z-[40]
const CardVideoPlayer = dynamic(() => import('@src/components/MediaScroll/CardVideoPlayer'), {
  ssr: false,
})

const PopupCard = ({
  imageDimensions,
  imagePosition,
  title,
  showTitleFormatted, // Used for TV Episode titles
  seasonNumber = null,
  episodeNumber = null,
  // Date fields (old and new)
  date,
  lastWatchedDate,
  addedDate,
  releaseDate,
  link,
  type,
  logo,
  mediaId,
  showId,
  showTmdbId,
  posterURL,
  posterBlurhash,
  backdrop,
  backdropBlurhash,
  handleCollapse,
  handlePortalMouseEnter,
  handlePortalMouseLeave,
  isTouchDevice,
  // Availability flags for TMDB-only items
  isAvailable,
  comingSoon,
  comingSoonDate,
  metadata,
  // Shared date info from Card
  dateInfo,
}) => {
  // Use consistent on-demand pattern for both library and TMDB items
  const apiEndpoint = isAvailable !== false
    ? buildURL(
        type === 'tv'
          ? `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&season=${seasonNumber}&episode=${episodeNumber}&card=true`
          : `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&card=true`
      )
    : buildURL(`/api/authenticated/tmdb/comprehensive/${type}?tmdb_id=${metadata?.id}&blurhash=true`)

  const { data, error, isLoading } = useSWR(apiEndpoint, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 15000,
    errorRetryInterval: 2000,
    errorRetryCount: 20,
  })

  // If either clipVideoURL OR trailer_url exists, hasVideo = true
  const hasVideo = !!data?.clipVideoURL || !!data?.trailer_url
  const videoURL = data?.clipVideoURL || data?.trailer_url
  const isTrailer = !data?.clipVideoURL && data?.trailer_url
  const hdr = data?.hdr || false

  const [imageLoaded, setImageLoaded] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [playingVideo, setPlayingVideo] = useState(false)
  const [hideVideo, setHideVideo] = useState(hasVideo)
  const [afterVideo, setAfterVideo] = useState(false)
  const [shouldPlay, setShouldPlay] = useState(false)
  const [logoLoaded, setLogoLoaded] = useState(false)

  // Track thumbnail loading
  const [isThumbnailLoaded, setIsThumbnailLoaded] = useState(false)
  const [showBackdrop, setShowBackdrop] = useState(false)
  const [delayBackdropHide, setDelayBackdropHide] = useState(false)

  const portalRef = useRef(null)

  const stopPropagation = useCallback((e) => {
    e.stopPropagation()
  }, [])

  const handlePortalKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        handleCollapse()
      }
    },
    [handleCollapse]
  )

  const onVideoReady = useCallback((player) => {
    const timeout = setTimeout(() => {
      setVideoReady(true)
    }, 200)
    return () => clearTimeout(timeout)
  }, [])

  useEffect(() => {
    // Reset states each time data or the video URL changes
    setVideoReady(false)
    setAfterVideo(false)
    setHideVideo(hasVideo)
    setIsThumbnailLoaded(false)
    setShowBackdrop(false)
    setDelayBackdropHide(false)
  }, [videoURL, data?.thumbnail, hasVideo])

  // Simple delay to prevent backdrop flash for episodes with thumbnails
  useEffect(() => {
    if (data?.thumbnail) {
      // Small delay for episodes to give thumbnails time to load
      const timer = setTimeout(() => {
        setShowBackdrop(true)
      }, 100)
      return () => clearTimeout(timer)
    } else {
      // No delay for movies/shows without thumbnails
      setShowBackdrop(true)
    }
  }, [data?.thumbnail])

  // Delay backdrop hide when video starts playing
  useEffect(() => {
    if (shouldPlay && playingVideo) {
      setDelayBackdropHide(true)
      const timer = setTimeout(() => {
        setDelayBackdropHide(false)
      }, 800)
      return () => clearTimeout(timer)
    } else {
      setDelayBackdropHide(false)
    }
  }, [shouldPlay, playingVideo])

  // 3.2-second delay after the image loads before allowing the video to start
  const handleImageLoad = useCallback(() => {
    const timeout = setTimeout(() => {
      setImageLoaded(true)
    }, 3200)
    return () => clearTimeout(timeout)
  }, [])
  
  // Handle logo image loading
  const handleLogoLoad = useCallback(() => {
    setLogoLoaded(true)
  }, [])

  // Whenever these states change, recalc shouldPlay
  useEffect(() => {
    setShouldPlay((!hideVideo || !afterVideo) && imageLoaded && videoReady)
  }, [hideVideo, afterVideo, imageLoaded, videoReady])

  // Calculate the width for the popup - use 16:9 dimensions from Card component
  const calculateWidth = () => {
    // Always use the expandedWidth calculated by Card component (16:9 aspect ratio)
    return imagePosition.expandedWidth ? `!w-[${imagePosition.expandedWidth}px]` : `w-[300px]`
  }

  // Use the shared dateInfo from Card component
  const displayDate = dateInfo;
  
  // For release status banner, use dateInfo if it's a release status
  const releaseStatus = dateInfo?.isReleaseStatus ? dateInfo : null;

  // Precompute image sources and blurhashes to avoid repetition
  const logoSrc = data?.logo || data?.logo_path || metadata?.logo_path;
  const posterSrc = data?.posterURL || posterURL;
  const posterBlur = data?.posterBlurhash || posterBlurhash;
  const backdropSrc = backdrop ?? data?.backdrop ?? (data?.backdrop_path ? getFullImageUrl(data?.backdrop_path, 'w500') : null);
  const backdropBlur = backdropBlurhash ?? data?.backdropBlurhash;
  const thumbnailSrc = data?.thumbnail;
  const thumbnailBlur = data?.blurhash?.thumbnail || data?.thumbnailBlurhash;
  
  // Compute what images should be displayed
  const hasLogo = !!logoSrc;
  const hasBackdrop = !!backdropSrc;
  const hasPoster = !!posterSrc;
  const hasThumbnail = !!thumbnailSrc;
  
  // Determine visibility for each layer
  const shouldShowPoster = !shouldPlay && !hasBackdrop && !hasThumbnail && hasPoster;
  const shouldShowBackdrop = (!shouldPlay || delayBackdropHide) &&
                             hasBackdrop &&
                             (hasThumbnail ? (!isThumbnailLoaded && showBackdrop) : true);
  const shouldShowThumbnail = !shouldPlay && hasThumbnail;

  return (
    <div
      className={classNames(
        'absolute z-10 pointer-events-none transition-all duration-300 ease-in-out',
        'min-w-52',
        calculateWidth()
      )}
      style={{
        top: imagePosition.top,
        left: imagePosition.left,
        height: imagePosition.height,
        opacity: 1,
      }}
      onClick={handleCollapse}
      onMouseEnter={handlePortalMouseEnter}
      onMouseLeave={handlePortalMouseLeave}
      onKeyDown={handlePortalKeyDown}
      aria-label="Close expanded view"
      aria-hidden="true"
    >
      <div
        className={classNames(
          "bg-white rounded-lg shadow-xl overflow-hidden relative transition-transform duration-300 ease-in-out pointer-events-auto"
        )}
        style={{
          width: `${imagePosition.expandedWidth}px`,
          transform: 'scale(1)',
        }}
        onClick={stopPropagation}
        ref={portalRef}
        tabIndex={0}
      >
        {/* Close Button - put it on top at z-[60] */}
        <button
          className="absolute top-2 right-2 text-gray-800 bg-white rounded-full px-2 py-1 hover:bg-gray-100 focus:outline-none z-[60]"
          onClick={handleCollapse}
          aria-label="Close"
        >
          &times;
        </button>
        <div
          className="relative overflow-hidden"
          style={{
            height: imagePosition.height,
            width: imagePosition.expandedWidth,
          }}
        >
          {/* Logo if present (z-[50]) */}
          {hasLogo && (
            <RetryImage
              quality={25}
              fill
              loading="eager"
              priority
              src={logoSrc}
              alt={`${title} Logo`}
              className={classNames(
                //absolute max-w-[70%] mr-auto !w-auto max-h-14 inset-0 object-contain select-none z-[50]
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
              playingVideo={playingVideo}
              onPlaying={() => setPlayingVideo(true)}
              onVideoEnd={(player) => {
                setPlayingVideo(false)
                setVideoReady(false)
                setHideVideo(true)
                setAfterVideo(true)
              }}
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
                transition={{ duration: 0.4 }}
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
                  className={classNames("rounded-t-lg object-cover", afterVideo ? 'filter brightness-50' : '')}
                  onLoad={handleImageLoad}
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
                  className={classNames("rounded-t-lg object-cover", afterVideo || !isLoading && !videoURL ? 'filter brightness-50' : '')}
                  onLoad={handleImageLoad}
                />
              </motion.div>
            )}

            {/* Thumbnail => z-[30] */}
            {shouldShowThumbnail && (
              <motion.div
                key="thumbnail"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
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
                  className={classNames("rounded-t-lg object-cover", afterVideo ? 'filter brightness-50' : '')}
                  onLoad={() => {
                    setIsThumbnailLoaded(true)
                    handleImageLoad()
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Info Section (just below the media in the DOM, but no special z-index needed) */}
        <div className="p-4">
          {/* Breadcrumb Navigation for TV Shows */}
          {type === 'tv' && title && (
            <div className="flex items-center text-sm text-gray-600 mb-2 flex-wrap">
              <Link
                href={`/list/${type}/${encodeURIComponent(title)}`}
                className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
              >
                {title}
              </Link>
              
              {seasonNumber && (
                <>
                  <span className="mx-1.5">/</span>
                  <Link
                    href={`/list/${type}/${encodeURIComponent(title)}/${seasonNumber}`}
                    className="text-blue-600 hover:text-blue-800 hover:underline font-medium"
                  >
                    Season {seasonNumber}
                  </Link>
                </>
              )}
              
              {episodeNumber && (
                <>
                  <span className="mx-1.5">/</span>
                  <span className="text-gray-700 font-medium">
                    Episode {episodeNumber}
                  </span>
                </>
              )}
              
              {(hasVideo || videoURL) && (seasonNumber || episodeNumber)? (
              <>
                <span className="relative ml-auto text-xs bg-yellow-400 text-black font-bold px-2 py-1 rounded-bl-md z-[50]">
                  {isTrailer ? "TRAILER" : "CLIP"}
                  {/* Show Youtube button if trailer */}
                  {isTrailer && (
                    <Link href={data?.trailer_url} target='_blank' className="text-red-600 hover:text-red-800 text-xs font-bold ml-2 pl-2 border-l border-gray-800">
                      YouTube
                    </Link>
                  )}
                </span>
              </>
            ) : null}
            </div>
          )}
          <div className="flex flex-row relative">
            {/* overflow: hidden;
              width: 100%;
              border-right: 1px solid #dfdfdf96;
              margin-right: 16px; */}
            {(hasVideo || videoURL) && (!seasonNumber || !episodeNumber) ? (
              <>
                <span className="absolute top-0 right-0 text-xs bg-yellow-400 text-black font-bold px-2 py-1 rounded-bl-md z-[50]">
                  {isTrailer ? "TRAILER" : "CLIP"}
                  {/* Show Youtube button if trailer */}
                  {isTrailer && (
                    <Link href={data?.trailer_url} target='_blank' className="text-red-600 hover:text-red-800 text-xs font-bold ml-2 pl-2 border-l border-gray-800">
                      YouTube
                    </Link>
                  )}
                </span>
              </>
            ) : null}
            <h2 className={classNames(
              "text-2xl text-gray-900 font-bold mb-2 w-[88%] overflow-hidden",
              "w-full mr-4",
              data?.seasonNumber || data?.episodeNumber ? "border-r-[1px] border-r-[#dfdfdf96]" : ""
            )}>{data?.title ?? showTitleFormatted ?? title}</h2>
            {(data?.seasonNumber || data?.episodeNumber) && (
              <motion.h2 className={classNames(
                "relative self-center text-2xl text-gray-700 font-bold mb-2"
                )}
                key="season-episode"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4 }}
              >
                {data?.seasonNumber ? `S${data?.seasonNumber}` : ''}
                {data?.episodeNumber ? `E${data?.episodeNumber}` : ''}
                {data?.seasonNumber || data?.episodeNumber ? ' ' : ''}
              </motion.h2>
            )}
          </div>
          {displayDate && (
            <div className="flex items-center mb-1 gap-1">
              <span className={classNames("text-sm font-medium", displayDate.popupColor)}>
                {displayDate.label}:
              </span>
              <span className="text-sm text-gray-800 font-medium">{displayDate.value}</span>
            </div>
          )}
          
          {/* Release Status Banner for unavailable content */}
          {releaseStatus && (
            <div className={classNames(
              'inline-flex items-center px-3 py-1 rounded-full text-sm font-medium border mb-3',
              releaseStatus.bgColor,
              releaseStatus.textColor,
              releaseStatus.borderColor
            )}>
              {releaseStatus.isUnreleased ? (
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              )}
              {releaseStatus.label}
            </div>
          )}
          
          <div className="text-gray-500 mb-2">
            {isLoading ? <Loading fullscreenClasses={false} /> : data?.overview ?? data?.description ?? 'No description available.'}
          </div>

          <div className="flex flex-row gap-2">
            {/* Watch Now and View Details buttons - only for internal content with link */}
            {link && (
              <>
                {(type === 'tv' && seasonNumber && episodeNumber || type === 'movie') && (
                  <Link
                    href={`/list/${type}/${link}/play`}
                    className={classNames(
                      'relative inline-flex items-center gap-2 opacity-80 hover:opacity-100 bg-slate-500 hover:bg-slate-600 text-white font-bold rounded-md px-4 py-2 mt-4'
                    )}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-5 h-5"
                    >
                      <path
                        fillRule="evenodd"
                        d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>Watch Now {hdr ? `in ${hdr}` : null}</span>
                  </Link>
                )}
                <Link
                  href={`/list/${type}/${link}`}
                  className="h-12 mt-4 flex flex-row items-center self-center px-6 py-2 text-white bg-blue-600 rounded-full hover:bg-blue-700 transition"
                >
                  <InformationCircleIcon className="size-6 mr-0 sm:mr-2" />
                  <span className="hidden sm:inline">
                    View Details
                  </span>
                </Link>
              </>
            )}
            
            {/* Add WatchlistButton for both internal and TMDB-only content */}
            {(type === 'movie' || type === 'tv') && (mediaId || showId || showTmdbId || metadata?.id) && (
              <WatchlistButton
                mediaId={showId ?? mediaId}
                tmdbId={showTmdbId ?? data?.metadata?.id ?? metadata?.id}
                mediaType={type}
                title={episodeNumber ? title : (data?.title ?? title)}
                posterURL={data?.poster_path ? getFullImageUrl(data?.poster_path, 'w500') : data?.posterURL}
                className="h-12 mt-4 px-4 py-2 rounded-full"
              />
            )}
          </div>
        </div>
        {data?.cast && Object.keys(data.cast).length > 0 && (
          <div className="p-4 relative h-[31rem]"> {/* Ensure a fixed height for virtualization */}
            <h2 className="text-2xl text-gray-900 font-bold mb-4">Starring:</h2>

            {/* Virtualized Cast Grid */}
            <VirtualizedCastGrid cast={data.cast} />

            {/* Gradient Overlay */}
            {(Array.isArray(data.cast) ? data.cast : Object.values(data.cast)).length > 16 && (
              <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default PopupCard
