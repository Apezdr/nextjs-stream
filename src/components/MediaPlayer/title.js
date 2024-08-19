import {
  Title as MediaTitle,
  useMediaPlayer,
  useMediaState,
  ChapterTitle as MediaChapterTitle,
  useChapterTitle,
} from '@vidstack/react'
import { classNames } from 'src/utils'

export function Title() {
  //const chapterTitle = useChapterTitle()
  {
    /* <div className="flex flex-col items-center justify-center">
      <span className="z-20 relative inline-block flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-2 text-sm font-medium text-white/70">
        <MediaTitle />
      </span>
      {chapterTitle ? (
        <span className="z-20 relative inline-block flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-2 text-sm font-medium text-white/70">
          <MediaChapterTitle />
        </span>
      ) : null}
    </div> */
  }
  return (
    <span className="z-20 relative inline-block flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-2 text-sm font-medium text-white/70 text-center">
      <MediaTitle />
    </span>
  )
}

export function VideoMetadata({ mediaMetadata, logo }) {
  const isPaused = useMediaState('paused'),
    player = useMediaPlayer()
  return (
    <>
      <div
        className={classNames(
          'w-full h-full absolute top-0 left-0 z-0',
          'bg-opacity-80 transition-all duration-1000',
          isPaused ? 'bg-black delay-1000' : 'bg-transparent delay-200'
        )}
      ></div>
      <div
        className={classNames(
          `media-labels z-10 relative`,
          isPaused || player.currentTime <= 0 ? '' : 'playing'
        )}
      >
        <div className={classNames('media-title', isPaused ? '' : 'playing')}>
          {logo ? (
            <img src={logo} className={'w-32 md:w-52 sm:max-w-32 md:max-w-48 xl:max-w-xs inline'} />
          ) : (
            <h5 className={`font-sans max-w-sm xl:max-w-xl font-bold text-white ml-4`}>
              {mediaMetadata.mediaTitle
                ? decodeURIComponent(mediaMetadata.mediaTitle)
                : mediaMetadata.title}
            </h5>
          )}
          {mediaMetadata.season_number ? ` - S${mediaMetadata.season_number}:` : ''}
          {mediaMetadata.episode_number ? `E${mediaMetadata.episode_number}` : ''}
        </div>
        <p
          className={classNames(
            `font-sans hidden sm:block max-w-sm xl:max-w-lg ml-4 mt-1 text-xs text-gray-400 media-released`,
            isPaused ? '' : 'playing'
          )}
        >
          <span className="font-bold">Released: </span>
          {mediaMetadata.released}
        </p>
        {mediaMetadata.overview && (
          <p
            className={classNames(
              `font-sans hidden sm:block max-w-sm xl:max-w-lg ml-4 mt-0 text-xs text-gray-300 media-description mb-4`,
              isPaused ? '' : 'playing'
            )}
          >
            {mediaMetadata.overview}
          </p>
        )}
      </div>
    </>
  )
}
