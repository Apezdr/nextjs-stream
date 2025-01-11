'use client'

import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { buildURL, classNames, fetcher, getFullImageUrl } from '@src/utils'
import dynamic from 'next/dynamic'
import useSWR, { preload } from 'swr'
import RetryImage from '@components/RetryImage'

// Import the CardVideoPlayer with z-[40]
const CardVideoPlayer = dynamic(() => import('@src/components/MediaScroll/CardVideoPlayer'), {
  ssr: false,
})

const PopupCard = ({
  imageDimensions,
  imagePosition,
  title,
  seasonNumber = null,
  episodeNumber = null,
  date,
  link,
  type,
  logo,
  mediaId,
  posterURL,
  posterBlurhash,
  backdrop,
  backdropBlurhash,
  handleCollapse,
  handlePortalMouseEnter,
  handlePortalMouseLeave,
  isTouchDevice,
}) => {
  const apiEndpoint = buildURL(
    type === 'tv'
      ? `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&season=${seasonNumber}&episode=${episodeNumber}&card=true`
      : `/api/authenticated/media?mediaId=${mediaId}&mediaType=${type}&card=true`
  )

  const { data, error, isLoading } = useSWR(apiEndpoint, fetcher, {
    suspense: true,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
    dedupingInterval: 15000, // Adjust as needed
    errorRetryInteral: 2000,
    errorRetryCount: 20,
  })

  // If either clipVideoURL OR trailer_url is missing, hasVideo = false
  const hasVideo = !data?.clipVideoURL || !data?.trailer_url
  const videoURL = data?.clipVideoURL || data?.trailer_url
  const hdr = data?.hdr || false

  const [imageLoaded, setImageLoaded] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [playingVideo, setPlayingVideo] = useState(false)
  const [hideVideo, setHideVideo] = useState(hasVideo)
  const [afterVideo, setAfterVideo] = useState(false)
  const [shouldPlay, setShouldPlay] = useState(false)

  // Track thumbnail loading
  const [isThumbnailLoaded, setIsThumbnailLoaded] = useState(false)

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
  }, [videoURL, data?.thumbnail, hasVideo])

  // 3.2-second delay after the image loads before allowing the video to start
  const handleImageLoad = useCallback(() => {
    const timeout = setTimeout(() => {
      setImageLoaded(true)
    }, 3200)
    return () => clearTimeout(timeout)
  }, [])

  // Whenever these states change, recalc shouldPlay
  useEffect(() => {
    setShouldPlay((!hideVideo || !afterVideo) && imageLoaded && videoReady)
  }, [hideVideo, afterVideo, imageLoaded, videoReady])

  // Calculate the width for the popup
  const calculateWidth = () => {
    if (backdrop && isThumbnailLoaded) {
      return data?.backdropWidth ? `w-[${data.backdropWidth}px]` : `w-[${imageDimensions.width}]`
    }
    return imagePosition.expandedWidth
      ? `!w-[${imagePosition.expandedWidth}]`
      : `w-[${imageDimensions.width}]`
  }

  return (
    <div
      className={classNames(
        'absolute z-50 pointer-events-none transition-all duration-300 ease-in-out',
        'min-w-52',
        calculateWidth()
      )}
      style={{
        top: imagePosition.top,
        left: imagePosition.left,
        height: imagePosition.height ?? imageDimensions.height,
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
        className="bg-white rounded-lg shadow-xl overflow-hidden relative transition-transform duration-300 ease-in-out pointer-events-auto"
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
          {data?.logo && (
            <RetryImage
              quality={25}
              fill
              loading="eager"
              priority
              src={data.logo}
              alt={`${title} Logo`}
              className={classNames(
                //absolute max-w-[70%] mr-auto !w-auto max-h-14 inset-0 object-contain select-none z-[50]
                "absolute !w-auto transform max-w-[185px] inset-0 object-contain select-none z-[50]",
                "transition-all duration-[1.4s] ease-in-out opacity-100",
                // Dim it if the video is playing
                shouldPlay ? 'opacity-45 hover:opacity-100' : '',
                // Center it if the video is not playing
                shouldPlay ? '!top-4 !left-8 max-h-5' : '!top-[67%] !left-1/2 max-h-14 -translate-x-1/2'           
              )}
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
            {!shouldPlay && !data?.thumbnail && !backdrop && (
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
                  src={data?.posterURL}
                  placeholder={posterBlurhash ? 'blur' : 'empty'}
                  blurDataURL={
                    posterBlurhash ? `data:image/png;base64,${posterBlurhash}` : undefined
                  }
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
            {!shouldPlay && backdrop && !isThumbnailLoaded && (
              <motion.div
                key="backdrop"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full h-full absolute inset-0 z-[20]"
              >
                <RetryImage
                  quality={100}
                  src={backdrop}
                  placeholder={backdropBlurhash ? 'blur' : 'empty'}
                  blurDataURL={
                    backdropBlurhash ? `data:image/png;base64,${backdropBlurhash}` : undefined
                  }
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
            {!shouldPlay && data?.thumbnail && (
              <motion.div
                key="thumbnail"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full h-full absolute inset-0 z-[30]"
              >
                <RetryImage
                  quality={100}
                  src={data?.thumbnail}
                  placeholder={data?.thumbnailBlurhash ? 'blur' : 'empty'}
                  blurDataURL={
                    data?.thumbnailBlurhash
                      ? `data:image/png;base64,${data?.thumbnailBlurhash}`
                      : undefined
                  }
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
          <div className="flex flex-row justify-between">
            <h2 className="text-2xl text-gray-900 font-bold mb-2">{data?.title ?? title}</h2>
            <h2 className="text-2xl text-gray-700 font-bold mb-2">
              {data?.seasonNumber ? `S${data?.seasonNumber}` : ''}
              {data?.episodeNumber ? `E${data?.episodeNumber}` : ''}
              {data?.seasonNumber || data?.episodeNumber ? ' ' : ''}
            </h2>
          </div>
          {date && <p className="text-sm text-gray-600">Last Watched: {date}</p>}
          <p className="text-gray-500 mb-2">
            {isLoading ? '' : data?.description ?? 'No description available.'}
          </p>

          {link && (
            <Link
              href={`/list/${type}/${link}`}
              className={classNames(
                'relative inline-flex items-center gap-2',
                'opacity-80 hover:opacity-100 bg-slate-500 hover:bg-slate-600 text-white font-bold rounded-md px-4 py-2 mt-4'
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
              <span>Watch Now {hdr ? `in HDR10+` : null}</span>
            </Link>
          )}
        </div>
        {data?.cast && Object.keys(data.cast).length > 0 && (
          <div className="p-4 relative">
            <h2 className="text-2xl text-gray-900 font-bold mb-4">Starring:</h2>
            
            {/* Cast Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-5 gap-4 max-h-[31rem] overflow-y-auto p-4 pb-32">
              {Object.values(data.cast).map((actor) => (
                <Link
                  key={actor?.id}
                  href={actor.id ? `https://www.themoviedb.org/person/${actor.id}` : '#'}
                  target="_blank"
                  className="flex flex-col items-center w-24 transition-transform duration-200 transform hover:scale-105 hover:shadow-lg"
                >
                  <div className="w-20 h-20 relative rounded-full overflow-hidden bg-gray-200">
                    {actor.profile_path ? (
                      <RetryImage
                        src={getFullImageUrl(actor.profile_path)}
                        alt={actor.name}
                        layout="fill"
                        objectFit="cover"
                        className="rounded-full"
                        quality={40}
                        //placeholder="blur"
                        //blurDataURL={actor.profileBlurhash || ''}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-500 select-none pointer-events-none">
                        N/A
                      </div>
                    )}
                  </div>
                  <p className="mt-2 text-center text-sm font-medium text-gray-700">
                    {actor.name}
                  </p>
                  {actor.character && (
                    <p className="text-center text-xs text-gray-500">as {actor.character}</p>
                  )}
                </Link>
              ))}
            </div>
            
            {/* Gradient Overlay */}
            {Object.values(data.cast).length > 16 && (
              <div className="absolute bottom-0 left-0 w-full h-32 bg-gradient-to-t from-white to-transparent pointer-events-none"></div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

export default memo(PopupCard)
