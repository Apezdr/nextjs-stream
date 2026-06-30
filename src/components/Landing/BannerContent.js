'use client'
import { memo, Suspense, useMemo, ViewTransition } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Link from 'next/link'
import Loading, { LoadingDots } from '@src/app/loading'
import { getFullImageUrl } from '@src/utils'
import dynamic from 'next/dynamic'
import RetryImage from '@components/RetryImage'
import { InformationCircleIcon } from '@heroicons/react/20/solid'
import { HeartIcon, PlayCircleIcon } from '@heroicons/react/24/outline'
import WatchlistButton from '@components/WatchlistButton'
import { movieBackdropName, movieLogoName } from '@src/utils/viewTransitionNames'

const BannerVideoPlayer = dynamic(() => import('./BannerVideoPlayer'), {
  ssr: false,
})

// Layout-only Tailwind class bundle per backdrop focal-point value.
// `backdropFocal` (admin override) wins over `backdropFocalSuggested` (auto-detected from media-processor).
// Overlay gradients live in gradientForFocal() below as inline styles — Tailwind JIT was unreliable for the
// fine-grained percentage stops these need.
const FOCAL_VARIANTS = {
  right: {
    anchor: 'left-1/4 top-1/2 transform -translate-y-1/2',
    textAlign: 'text-left',
    rowJustify: '',
  },
  'right-center': {
    anchor: 'left-[18%] top-1/2 transform -translate-y-1/2',
    textAlign: 'text-left',
    rowJustify: '',
  },
  center: {
    anchor: 'left-1/2 -translate-x-1/2 bottom-[12%]',
    textAlign: 'text-center',
    rowJustify: 'justify-center',
  },
  'left-center': {
    anchor: 'right-[18%] top-1/2 transform -translate-y-1/2',
    textAlign: 'text-right',
    rowJustify: 'justify-end',
  },
  left: {
    anchor: 'right-1/4 top-1/2 transform -translate-y-1/2',
    textAlign: 'text-right',
    rowJustify: 'justify-end',
  },
}

const DEFAULT_VARIANT = {
  anchor: 'left-1/4 top-1/2 transform -translate-y-1/2',
  textAlign: 'text-left',
  rowJustify: '',
}

const resolveFocalVariant = (focal) =>
  focal && Object.prototype.hasOwnProperty.call(FOCAL_VARIANTS, focal) ? FOCAL_VARIANTS[focal] : DEFAULT_VARIANT

// Directional darkening tuned per focal token. Side variants run full-height as a wall of shadow on the
// text side, fading transparent before the subject. Center is purely vertical (letterbox feel).
// Tone is rgba(10,13,20) rather than pure black so the bottom of the hero blends into the page's bg-black.
const gradientForFocal = (focal) => {
  switch (focal) {
    case 'left':
      return 'linear-gradient(270deg, rgba(10,13,20,0.92) 0%, rgba(10,13,20,0.45) 35%, rgba(10,13,20,0) 60%)'
    case 'left-center':
      return 'linear-gradient(270deg, rgba(10,13,20,0.85) 0%, rgba(10,13,20,0.30) 28%, rgba(10,13,20,0) 50%)'
    case 'center':
      return 'linear-gradient(180deg, rgba(10,13,20,0) 50%, rgba(10,13,20,0.92) 100%)'
    case 'right-center':
      return 'linear-gradient(90deg, rgba(10,13,20,0.85) 0%, rgba(10,13,20,0.30) 28%, rgba(10,13,20,0) 50%)'
    case 'right':
    default:
      return 'linear-gradient(90deg, rgba(10,13,20,0.92) 0%, rgba(10,13,20,0.45) 35%, rgba(10,13,20,0) 60%)'
  }
}

// Slight top damping for the nav + seamless bleed from the hero bottom into the bg-black page chrome.
const VERTICAL_COMPANION =
  'linear-gradient(180deg, rgba(10,13,20,0.55) 0%, rgba(10,13,20,0) 18%, rgba(10,13,20,0) 70%, #0a0d14 100%)'

const BannerContent = ({
  mediaList,
  currentMediaIndex,
  showTrailer,
  muted,
  paused,
  onTrailerTime,
}) => {
  const currentMedia = useMemo(() => mediaList[currentMediaIndex], [mediaList, currentMediaIndex])
  const logo = currentMedia?.logo || getFullImageUrl(currentMedia?.metadata?.logo_path) || null
  const focal = currentMedia?.backdropFocal ?? currentMedia?.backdropFocalSuggested ?? null
  const variant = useMemo(() => resolveFocalVariant(focal), [focal])
  const focalGradient = useMemo(() => gradientForFocal(focal), [focal])

  return (
    <Suspense>
      {/* Still backdrop layer — crossfades on index change. Always mounted; the trailer fades in on top. */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`banner-${currentMediaIndex}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1, ease: 'easeInOut' }}
          className="absolute inset-0"
        >
          {currentMedia?.title && (currentMedia?.backdropBlurhash || currentMedia?.backdrop) ? (
            <ViewTransition name={movieBackdropName(currentMedia.title)}>
              <div className="absolute inset-0">
                {currentMedia?.backdropBlurhash ? (
                  <RetryImage
                    src={currentMedia?.backdrop}
                    className="object-cover select-none pointer-events-none"
                    alt="Banner Image"
                    fill
                    blurDataURL={`data:image/png;base64,${currentMedia.backdropBlurhash}`}
                    placeholder="blur"
                    quality={100}
                    priority
                  />
                ) : (
                  <RetryImage
                    src={currentMedia?.backdrop}
                    className="object-cover select-none pointer-events-none"
                    alt="Banner Image"
                    fill
                    quality={100}
                    priority
                  />
                )}
              </div>
            </ViewTransition>
          ) : null}
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ backgroundImage: focalGradient }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 pointer-events-none"
            style={{ backgroundImage: VERTICAL_COMPANION }}
          />
        </motion.div>
      </AnimatePresence>

      {/* Trailer layer — mounts when dwell crosses STILL_HANDOFF, unmounts when index advances. */}
      <AnimatePresence>
        {showTrailer && currentMedia?.metadata?.trailer_url ? (
          <motion.div
            key={`trailer-${currentMediaIndex}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.75, ease: 'easeInOut' }}
            className="absolute inset-0 bg-black flex items-center justify-center"
          >
            <Suspense fallback={<Loading fullscreenClasses={false} />}>
              <BannerVideoPlayer
                key={`video-player-${currentMediaIndex}`}
                media={{ videoURL: currentMedia.metadata.trailer_url }}
                currentMediaIndex={currentMediaIndex}
                muted={muted}
                paused={paused}
                onTimeUpdate={onTrailerTime}
              />
            </Suspense>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Logo and Buttons AnimatePresence */}
      <AnimatePresence>
        <motion.div
          key={`logo-${currentMediaIndex}`} // Logo/buttons keyed by media index
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.5, ease: 'easeInOut' } }}
          transition={{ duration: 1, ease: 'easeInOut', delay: 0.5 }}
          className={`max-h-full absolute ${variant.anchor} ${variant.textAlign} w-36 md:w-64`}
        >
          {logo ? (
            currentMedia?.title ? (
              <ViewTransition name={movieLogoName(currentMedia.title)}>
                <RetryImage
                  src={logo}
                  alt="Logo Image"
                  width={300}
                  height={300}
                  className="object-contain select-none pointer-events-none !h-auto max-h-[4.7rem] md:max-h-40 lg:max-h-44"
                  loading="eager"
                  priority
                />
              </ViewTransition>
            ) : (
              <RetryImage
                src={logo}
                alt="Logo Image"
                width={300}
                height={300}
                className="object-contain select-none pointer-events-none !h-auto max-h-[4.7rem] md:max-h-40 lg:max-h-44"
                loading="eager"
                priority
              />
            )
          ) : (
            <div className="font-serif font-bold text-3xl md:text-5xl lg:text-6xl leading-tight tracking-tight text-white">
              {currentMedia.title}
            </div>
          )}
          {currentMedia?.title ? (
            <div className={`flex flex-row md:flex-col gap-2 md:gap-0 ${variant.rowJustify}`}>
              <div className={`flex gap-2 text-xs sm:text-sm ${variant.rowJustify}`}>
                <Link
                  href={`/list/movie/${encodeURIComponent(currentMedia.title)}/play`}
                  className="h-12 mt-4 flex flex-row items-center self-center px-6 py-2 text-black bg-white rounded-full hover:bg-white/90 transition"
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
                  <span className="hidden sm:inline">Watch Now</span>
                </Link>
                {currentMedia?.metadata?.trailer_url ? (
                  <Link
                    href={currentMedia.metadata.trailer_url}
                    target={'_blank'}
                    className="h-12 mt-4 px-6 py-2 text-white bg-white/15 border border-white/30 rounded-full hover:bg-white/25 backdrop-blur-sm transition flex items-center gap-2"
                  >
                    <PlayCircleIcon className="size-6" />
                    <span className="hidden sm:inline">Trailer</span>
                  </Link>
                ) : null}

                {/* Watchlist Button - Icon only */}
                <Suspense
                  fallback={
                    <div className="h-12 mt-4 px-3 py-2 bg-white/10 rounded-full inline-flex items-center justify-center">
                      <HeartIcon className="w-5 h-5 text-white opacity-20" />
                      <div className='absolute'><LoadingDots dotClasses="h-[0.3rem] w-[0.3rem]" color="bg-gray-200" /></div>
                    </div>
                  }
                >
                  <WatchlistButton
                    mediaId={currentMedia.id}
                    tmdbId={currentMedia.metadata?.id}
                    mediaType="movie"
                    title={currentMedia.title}
                    variant="icon-only"
                    className="h-12 mt-4 px-3 py-2 text-white bg-white/10 hover:bg-white/20 rounded-full"
                    onStatusChange={(isInWatchlist, item) => {
                      console.log('Watchlist status changed:', {
                        isInWatchlist,
                        item,
                        media: currentMedia.title,
                      })
                    }}
                  />
                </Suspense>
              </div>
              <div>
                <Link
                  href={`/list/movie/${encodeURIComponent(currentMedia.title)}`}
                  className="h-12 mt-4 flex flex-row items-center self-center px-6 py-2 text-white bg-white/15 border border-white/30 rounded-full hover:bg-white/25 backdrop-blur-sm transition"
                  prefetch={true}
                >
                  <InformationCircleIcon className="size-6 mr-0 sm:mr-2" />
                  <span className="hidden sm:inline">View Details</span>
                </Link>
              </div>
            </div>
          ) : null}
        </motion.div>
      </AnimatePresence>
    </Suspense>
  )
}

function areEqual(prevProps, nextProps) {
  return (
    prevProps.mediaList === nextProps.mediaList &&
    prevProps.currentMediaIndex === nextProps.currentMediaIndex &&
    prevProps.showTrailer === nextProps.showTrailer &&
    prevProps.muted === nextProps.muted &&
    prevProps.paused === nextProps.paused &&
    prevProps.onTrailerTime === nextProps.onTrailerTime
  )
}

export default memo(BannerContent, areEqual)
