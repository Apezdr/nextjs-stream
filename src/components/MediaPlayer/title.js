import {
  Title as MediaTitle,
  useMediaPlayer,
  useMediaState,
  ChapterTitle as MediaChapterTitle,
  useChapterTitle,
} from '@vidstack/react'
import { classNames, getResolutionLabel } from '@src/utils'
import Image from 'next/image'

import GeneralAudiencesBadge from '@src/components/MediaPlayer/Ratings/general_audiences_badge.svg'
import ParentalGuidanceBadge from '@src/components/MediaPlayer/Ratings/parental_guidance_badge.svg'
import ParensStronglyCautionedBadge from '@src/components/MediaPlayer/Ratings/parens_strongly_cautioned_badge.svg'
import RestrictedBadge from '@src/components/MediaPlayer/Ratings/restricted_badge.svg'
import No17AndUnderBadge from '@src/components/MediaPlayer/Ratings/no_17_and_under_badge.svg'
import RetryImage from '@components/RetryImage'

export function Title() {
  //const isPaused = useMediaState('paused')
  return (
    <span
      className={classNames(
        'z-20 w-h-full sm:w-auto absolute sm:relative inline-block flex-1 overflow-visible sm:overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium text-white/70 text-center',
        'left-1/2 sm:left-0 -translate-x-1/2 sm:translate-x-0 mt-[9%] sm:mt-0 p-0'
      )}
    >
      <div
        className={classNames(
          'flex flex-col items-center justify-normal sm:min-h-0 sm:px-0 sm:pb-0 sm:bg-inherit sm:relative sm:translate-x-0 sm:left-0',
          'bg-opacity-80 sm:transition-none transition-colors duration-1000 absolute left-1/2 -translate-x-1/2 rounded-b-lg px-4 pt-3 sm:pt-0 pb-2 sm:pb-0 min-h-14 justify-center',
          /* isPaused ? 'bg-black delay-1000' : 'bg-transparent delay-200', */
          'max-w-[98vw] w-[90vw] sm:w-auto sm:max-w-none'
        )}
      >
        <MediaTitle className="text-pretty" />
        <MediaChapterTitle className="text-pretty" />
      </div>
    </span>
  )
}

export function VideoMetadata({ dims = '', hdr = '', mediaMetadata = {}, logo }) {
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
                  <RetryImage src={GeneralAudiencesBadge} alt="Rated G" className="max-h-20 w-auto" />
                )
              case 'PG':
                return (
                  <RetryImage src={ParentalGuidanceBadge} alt="Rated PG" className="max-h-20 w-auto" />
                )
              case 'PG-13':
                return (
                  <RetryImage
                    src={ParensStronglyCautionedBadge}
                    alt="Rated PG-13"
                    className="max-h-20 w-auto"
                  />
                )
              case 'R':
                return <RetryImage src={RestrictedBadge} alt="Rated R" className="max-h-20 w-auto" />
              case 'NC-17':
                return (
                  <RetryImage src={No17AndUnderBadge} alt="Rated NC-17" className="max-h-20 w-auto" />
                )
              default:
                return `Rated ${mediaMetadata.rating}`
            }
          })()}
        </span>
      )}
      {(hdr || dims) && (
        <span
          className={classNames(
            `font-sans hidden sm:block max-w-sm xl:max-w-lg text-xl text-gray-300 media-HDR`,
            isPaused ? '' : 'playing'
          )}
        >
          {dims &&
            (() => {
              const { is4k, is1080p, is720p, is480p } = getResolutionLabel(dims)
              if (is4k) return '4K UHD'
              if (is1080p) return '1080p'
              if (is720p) return '720p'
              if (is480p) return '480p'
              return dims
            })()}
          {dims && hdr && ' | '}
          {hdr}
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
