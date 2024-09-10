import { AnimatePresence, motion } from 'framer-motion'
import { memo } from 'react'
import Loading from '@src/app/loading'
import { classNames } from '@src/utils'

const variants = {
  hidden: { opacity: 0 },
  enter: { opacity: 1 },
}

function RecentlyWatched({ recentlyWatched }) {
  return (
    <div>
      <div className="flex flex-row">
        <h1>Recently Watched</h1>
        <div className="bg-red-500 text-white flex flex-row justify-center rounded-md select-none p-1 ml-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            className="w-3.5 h-3.5"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
            />
          </svg>
          <span className="ml-1 text-xs">LIVE</span>
        </div>
      </div>
      <div
        className={classNames(
          'transition-all delay-[2s] duration-[2s]',
          recentlyWatched ? 'h-96 mb-12 overflow-auto' : 'h-52'
        )}
      >
        <AnimatePresence mode="wait">
          {recentlyWatched ? (
            <motion.div
              variants={variants}
              initial="hidden"
              exit="hidden"
              animate="enter"
              key={recentlyWatched.length}
              transition={{
                type: 'linear',
                delay: 2,
                duration: 2,
              }}
              className="flex flex-col gap-8 max-w-7xl"
            >
              <RecentlyWatchedInner recentlyWatched={recentlyWatched} />
            </motion.div>
          ) : (
            <motion.div
              variants={variants}
              initial="hidden"
              exit="hidden"
              animate="enter"
              key={'loading'}
              transition={{
                type: 'linear',
                delay: 0,
                duration: 2,
              }}
            >
              <Loading fullscreenClasses={false} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}

const UserMediaItem = memo(function UserMediaItem({ media }) {
  return (
    <div className="grid grid-cols-2 text-center border-b border-b-gray-200 last:border-b-0">
      <div className="flex flex-row gap-8">
        <div className="flex flex-col w-full self-center">
          <img
            src={media.user.image}
            alt={media.user.name}
            className="w-8 h-8 rounded-full self-center"
          />
          <span className="text-xs">{media.user.name}</span>
        </div>
      </div>
      <div className="grid grid-cols-2">
        {media.videos.map((video) => {
          const title = video?.title ? video.title : media.videoURL
          const videoKey =
            video?.type === 'tv'
              ? `${media.user.name}-${video.showTitle}-S${video.seasonNumber}E${video.episode.episodeNumber}`
              : `${media.user.name}-${title}`

          return video?.type ? (
            video.type === 'tv' ? (
              <div key={videoKey} className="flex flex-col">
                <img
                  src={video.episode.thumbnail}
                  alt={title}
                  className="w-36 h-24 rounded-md self-center"
                />
                <span>{video.showTitle}</span>
                <span>
                  S{video.seasonNumber}E{video.episode.episodeNumber} - {video.episode.title}
                </span>
                <span>
                  Watched{' '}
                  {(Math.abs((video.playbackTime * 1000) / video.episode.length) * 100).toFixed(2)}%
                </span>
                <span>{new Date(video.lastUpdated).toLocaleString()}</span>
              </div>
            ) : (
              <div key={videoKey} className="flex flex-col">
                <img
                  src={video.posterURL}
                  alt={title}
                  className="w-24 h-36 rounded-md self-center"
                />
                <span>{title}</span>
                <span>
                  Watched {(Math.abs((video.playbackTime * 1000) / video.length) * 100).toFixed(2)}%
                </span>
                <span>{new Date(video.lastUpdated).toLocaleString()}</span>
              </div>
            )
          ) : null
        })}
      </div>
    </div>
  )
}, areEqual)

function areEqual(prevProps, nextProps) {
  return (
    prevProps.media.mostRecentWatch === nextProps.media.mostRecentWatch &&
    prevProps.media.videos.length === nextProps.media.videos.length
  )
}

const RecentlyWatchedInner = memo(function RecentlyWatchedInner({ recentlyWatched }) {
  return recentlyWatched.map((media) => (
    <UserMediaItem
      key={`${media.user.name}-${media.user.email}-${media.mostRecentWatch}`}
      media={media}
    />
  ))
})

export default memo(RecentlyWatched)
