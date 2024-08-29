'use client'
import { memo, Suspense } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import Loading from 'src/app/loading'
import { lazy } from 'react'
const BannerVideoPlayer = lazy(() => import('./BannerVideoPlayer'))

const BannerContent = ({
  currentMedia,
  showVideo,
  handleVideoEnd,
  currentMediaIndex,
  onImageLoad,
}) => {
  return (
    <>
      <AnimatePresence mode="wait">
        {!showVideo && (
          <motion.div
            key={`banner-${currentMediaIndex}`} // Updated key
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: 'easeInOut' }} // Adjusted transition
            className="absolute inset-0"
          >
            {currentMedia.backdropBlurhash ? (
              <Image
                src={currentMedia.backdrop}
                className="object-cover select-none pointer-events-none"
                alt="Banner Image"
                fill
                blurDataURL={`data:image/png;base64,${currentMedia.backdropBlurhash}`}
                placeholder="blur"
                quality={100}
                onLoad={onImageLoad}
              />
            ) : (
              <Image
                src={currentMedia.backdrop}
                className="object-cover select-none pointer-events-none"
                alt="Banner Image"
                fill
                quality={100}
                onLoad={onImageLoad}
              />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/50 to-transparent"></div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {currentMedia.metadata?.trailer_url && showVideo && (
          <motion.div
            key={`video-${currentMediaIndex}`} // Updated key
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: 'easeInOut' }} // Adjusted transition
            className="absolute inset-0 bg-black flex items-center justify-center"
          >
            <Suspense fallback={<Loading fullscreenClasses={false} />}>
              <AnimatePresence mode="wait">
                <BannerVideoPlayer
                  media={{ videoURL: currentMedia.metadata.trailer_url }}
                  onVideoEnd={handleVideoEnd}
                  currentMediaIndex={currentMediaIndex}
                />
              </AnimatePresence>
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/50 to-transparent"></div>
            </Suspense>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence mode="wait">
        {currentMedia.logo && (
          <motion.div
            key={`logo-${currentMediaIndex}`} // Updated key
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeInOut' } }} // Faster exit transition
            transition={{ duration: 1, ease: 'easeInOut', delay: 0.5 }} // Standard transition with delay for entry
            className="absolute left-1/4 top-1/2 transform -translate-y-1/2 text-center w-36 sm:w-64"
          >
            <Image
              src={currentMedia.logo}
              alt="Logo Image"
              width={300}
              height={300}
              className="object-contain select-none pointer-events-none"
              loading="eager"
            />
            <div className="flex gap-2 text-xs sm:text-sm">
              <Link
                href={`/list/movie/${encodeURIComponent(currentMedia.title)}`}
                className="mt-4 flex flex-row items-center self-center px-6 py-2 text-white bg-blue-600 rounded-full hover:bg-blue-700 transition"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                  className="size-6"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 0 1 0 1.972l-11.54 6.347a1.125 1.125 0 0 1-1.667-.986V5.653Z"
                  />
                </svg>
                Watch Now
              </Link>
              <Link
                href={currentMedia.metadata.trailer_url}
                target={'_blank'}
                className="mt-4 px-6 py-2 text-slate-200 hover:text-white bg-blue-700 rounded-full hover:bg-blue-800 transition flex items-center gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 28.57 20"
                  className="size-6 inline"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28.57 20">
                    <path
                      fill="red"
                      d="M27.973 3.123A3.578 3.578 0 0 0 25.447.597C23.22 0 14.285 0 14.285 0S5.35 0 3.123.597A3.578 3.578 0 0 0 .597 3.123C0 5.35 0 10 0 10s0 4.65.597 6.877a3.578 3.578 0 0 0 2.526 2.526C5.35 20 14.285 20 14.285 20s8.935 0 11.162-.597a3.578 3.578 0 0 0 2.526-2.526C28.57 14.65 28.57 10 28.57 10s-.002-4.65-.597-6.877Z"
                    />
                    <path fill="#fff" d="M11.425 14.285 18.848 10l-7.423-4.285v8.57Z" />
                  </svg>
                </svg>
                Trailer
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}

function areEqual(prevProps, nextProps) {
  return (
    prevProps.currentMedia.id === nextProps.currentMedia.id &&
    prevProps.showVideo === nextProps.showVideo &&
    prevProps.currentMediaIndex === nextProps.currentMediaIndex
  )
}

export default memo(BannerContent, areEqual)
