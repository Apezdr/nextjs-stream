'use client'

import { useState, useRef, useEffect, useCallback, memo } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { buildURL, classNames, fetcher } from '@src/utils'
import dynamic from 'next/dynamic'
import useSWR from 'swr'

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
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    dedupingInterval: 5000, // Adjust as needed
  })

  const hasVideo = !data?.clipVideoURL || !data?.trailer_url
  const videoURL = data?.clipVideoURL || data?.trailer_url

  const [imageLoaded, setImageLoaded] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [playingVideo, setPlayingVideo] = useState(false)
  const [hideVideo, setHideVideo] = useState(!data?.clipVideoURL || !data?.trailer_url)
  const [afterVideo, setAfterVideo] = useState(false)

  // New state to track thumbnail loading
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
    setVideoReady(false)
    setAfterVideo(false)
    setHideVideo(hasVideo)

    // Reset thumbnail loaded state when data changes
    setIsThumbnailLoaded(false)
  }, [videoURL, data?.thumbnail])

  const handleImageLoad = useCallback(() => {
    const timeout = setTimeout(() => {
      setImageLoaded(true)
    }, 3200) // 3.2 seconds delay before showing video
    return () => clearTimeout(timeout)
  }, [])

  const shouldPlay = (!hideVideo || !afterVideo) && imageLoaded && videoReady

  return (
    <div
      className={classNames(
        'absolute z-50 pointer-events-none transition-all duration-300 ease-in-out',
        `w-[${imageDimensions.width}]`,
        imagePosition.expandedWidth && `!w-[${imagePosition.expandedWidth}]`
      )}
      style={{
        top: imagePosition.top,
        left: imagePosition.left,
        //width: imagePosition.expandedWidth ?? imageDimensions.width,
        height: imagePosition.height ?? imageDimensions.height,
        opacity: 1,
      }}
      onClick={handleCollapse}
      onMouseEnter={handlePortalMouseEnter}
      onMouseLeave={handlePortalMouseLeave}
      role="button"
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
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
      >
        <button
          className="absolute top-2 right-2 text-gray-800 bg-white rounded-full px-2 py-1 hover:bg-gray-100 focus:outline-none z-10"
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
          {data?.logo && (
            <Image
              quality={25}
              fill
              src={data.logo}
              alt={`${title} Logo`}
              className="absolute z-20 !top-[67%] max-w-[70%] mx-auto max-h-14 inset-0 object-contain select-none"
              loading="lazy"
            />
          )}
          <AnimatePresence>
            {videoURL && !afterVideo ? (
              <motion.div
                key="video"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5 }}
                className={classNames(
                  "w-full h-full absolute inset-0 z-[2] select-none"
                )}
              >
                <CardVideoPlayer
                  height={imagePosition?.height}
                  width={imagePosition?.expandedWidth}
                  onVideoReady={onVideoReady}
                  playingVideo={playingVideo}
                  onPlaying={() => {
                    setPlayingVideo(true)
                  }}
                  onVideoEnd={(player) => {
                    player.pause()
                    setVideoReady(false)
                    setHideVideo(true)
                    setAfterVideo(true)
                    setPlayingVideo(false)
                  }}
                  videoURL={videoURL}
                  shouldPlay={shouldPlay}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {/* Render Backdrop if available and thumbnail is not loaded */}
            {!shouldPlay && backdrop && !isThumbnailLoaded && (
              <motion.div
                key="backdrop"
                initial={{ opacity: 1 }}
                animate={{ opacity: isThumbnailLoaded ? 0 : 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="w-full h-full absolute inset-0 z-[1]"
              >
                <Image
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
                  className="rounded-t-lg object-cover"
                  onLoad={handleImageLoad} // Corrected to directly call handleImageLoad
                />
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {/* Render Thumbnail if available */}
            {!shouldPlay && data?.thumbnail && (
              <motion.div
                key="thumbnail"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="w-full h-full absolute inset-0"
              >
                <Image
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
                  className="rounded-t-lg object-cover"
                  onLoad={() => {
                    setIsThumbnailLoaded(true)
                    handleImageLoad() // Ensure handleImageLoad is called after thumbnail is loaded
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence>
            {/* Render Poster if neither thumbnail nor backdrop is available and video is not ready */}
            {!shouldPlay && !data?.thumbnail && !backdrop && (
              <motion.div
                key="poster"
                initial={{ opacity: 1 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.5, delay: 0.5 }}
                className="w-full h-full absolute inset-0"
              >
                <Image
                  quality={100}
                  src={data?.posterURL}
                  placeholder={data?.posterBlurhash ? 'blur' : 'empty'}
                  blurDataURL={
                    posterBlurhash ? `data:image/png;base64,${data?.posterBlurhash}` : undefined
                  }
                  alt={title}
                  loading="eager"
                  priority
                  fill
                  className="rounded-t-lg object-cover"
                  onLoad={handleImageLoad} // Corrected to directly call handleImageLoad
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="p-4">
          <div className="flex flex-row justify-between">
            <h2 className="text-2xl text-gray-900 font-bold mb-2">{data?.title ?? title}</h2>
            <h2 className="text-2xl text-gray-700 font-bold mb-2">
              {data?.seasonNumber ? `S${data?.seasonNumber}` : ''}
              {data?.episodeNumber ? `E${data?.episodeNumber}` : ``}
              {data?.episodeNumber || data?.episodeNumber ? ' ' : ''}
            </h2>
          </div>
          {date && <p className="text-sm text-gray-600">Last Watched: {date}</p>}
          {/* Add more detailed information here */}
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
              <span>Watch Now</span>
            </Link>
          )}
        </div>
      </div>
    </div>
  )
}

export default memo(PopupCard)
