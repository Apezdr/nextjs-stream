import {
  Title as MediaTitle,
  useMediaPlayer,
  useMediaState,
  ChapterTitle as MediaChapterTitle,
  useChapterTitle,
} from '@vidstack/react'
import { classNames } from '@src/utils'
import Image from 'next/image'

import GeneralAudiencesBadge from '@src/components/MediaPlayer/Ratings/general_audiences_badge.svg'
import ParentalGuidanceBadge from '@src/components/MediaPlayer/Ratings/parental_guidance_badge.svg'
import ParensStronglyCautionedBadge from '@src/components/MediaPlayer/Ratings/parens_strongly_cautioned_badge.svg'
import RestrictedBadge from '@src/components/MediaPlayer/Ratings/restricted_badge.svg'
import No17AndUnderBadge from '@src/components/MediaPlayer/Ratings/no_17_and_under_badge.svg'

export function Title() {
  const isPaused = useMediaState('paused')
  return (
    <span
      className={classNames(
        'z-20 sm:relative inline-block flex-1 overflow-hidden text-ellipsis whitespace-nowrap px-2 text-sm font-medium text-white/70 text-center'
      )}
    >
      <div
        className={classNames(
          'flex flex-col items-center justify-normal sm:min-h-0 sm:px-0 sm:pb-0 sm:bg-inherit sm:relative sm:bottom-0 sm:translate-x-0 sm:left-0',
          'bg-opacity-80 sm:transition-all transition-colors duration-1000 absolute left-1/2 -translate-x-1/2 -bottom-[3.4rem] bg-black rounded-b-lg px-4 pb-2 min-h-14 justify-center',
          isPaused ? 'bg-black delay-1000' : 'bg-transparent delay-200'
        )}
      >
        <MediaTitle />
        <MediaChapterTitle />
      </div>
    </span>
  )
}

export function VideoMetadata({ mediaMetadata = {}, logo }) {
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
      {mediaMetadata?.rating && (
        <span
          className={classNames(
            `font-sans hidden sm:block max-w-sm xl:max-w-lg text-xl text-gray-300 media-rating`,
            isPaused ? '' : 'playing'
          )}
        >
          {(() => {
            switch (mediaMetadata.rating) {
              case 'G':
                return (
                  <Image src={GeneralAudiencesBadge} alt="Rated G" className="max-h-20 w-auto" />
                )
              case 'PG':
                return (
                  <Image src={ParentalGuidanceBadge} alt="Rated PG" className="max-h-20 w-auto" />
                )
              case 'PG-13':
                return (
                  <Image
                    src={ParensStronglyCautionedBadge}
                    alt="Rated PG-13"
                    className="max-h-20 w-auto"
                  />
                )
              case 'R':
                return <Image src={RestrictedBadge} alt="Rated R" className="max-h-20 w-auto" />
              case 'NC-17':
                return (
                  <Image src={No17AndUnderBadge} alt="Rated NC-17" className="max-h-20 w-auto" />
                )
              default:
                return `Rated ${mediaMetadata.rating}`
            }
          })()}
        </span>
      )}
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
              {mediaMetadata?.mediaTitle ? (
                decodeURIComponent(mediaMetadata.mediaTitle)
              ) : mediaMetadata?.title ? (
                mediaMetadata.title
              ) : (
                <MediaTitle />
              )}
            </h5>
          )}
          {mediaMetadata?.season_number ? ` - S${mediaMetadata?.season_number}:` : ''}
          {mediaMetadata?.episode_number ? `E${mediaMetadata?.episode_number}` : ''}
        </div>
        <p
          className={classNames(
            `font-sans hidden sm:block max-w-sm xl:max-w-lg ml-4 mt-1 text-xs text-gray-400 media-released`,
            isPaused ? '' : 'playing'
          )}
        >
          <span className="font-bold">Released: </span>
          {mediaMetadata?.released}
        </p>
        {mediaMetadata?.overview && (
          <p
            className={classNames(
              `font-sans hidden sm:block max-w-sm xl:max-w-lg ml-4 mt-0 text-xs text-gray-300 media-description mb-4`,
              isPaused ? '' : 'playing'
            )}
          >
            {mediaMetadata?.overview}
          </p>
        )}
      </div>
    </>
  )
}
