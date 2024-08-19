'use client'
import { memo, useEffect, useState } from 'react'
import { classNames, generateColors, getFullImageUrl } from '../utils'
import HD4kBanner from '../../public/4kBanner.png'
import Image from 'next/image'
import useWatchedWidth from './useWatchedWidth'
import { TotalRuntime } from './watched'
import { ArrowPathIcon } from '@heroicons/react/24/outline'

function _mediaPoster({
  media,
  movie,
  tv,
  className = 'max-w-full',
  alt = 'Poster',
  contClassName = 'max-w-sm mx-auto',
  size = { w: 600, h: 600 },
  quality = 100,
  hideGenres = false,
  imagePriority = false,
  loadingType = undefined,
}) {
  const [isClient, setIsClient] = useState(false)

  // Determine whether to use movie or TV show data
  const _media = movie || tv || media
  const watchedWidth = useWatchedWidth(_media.metadata, _media)

  useEffect(() => {
    setIsClient(true)
  }, [])

  // Determine the poster URL for movie or TV show
  const posterURL = _media.posterURL
    ? _media.posterURL
    : _media.season_poster
      ? _media.season_poster
      : _media.metadata?.poster_path
        ? getFullImageUrl(_media.metadata.poster_path)
        : '/sorry-image-not-available.jpg'

  const posterBlurhash = _media.posterBlurhash || _media.seasonPosterBlurhash || false

  let dims, is4k, is1080p
  if (_media.dimensions) {
    dims = _media?.dimensions?.split('x')
    is4k = parseInt(dims[0]) >= 3840 || parseInt(dims[1]) >= 2160
    is1080p = parseInt(dims[0]) >= 1920 || parseInt(dims[1]) >= 1080
  }

  return (
    <div
      className={classNames(contClassName, 'watched-border')}
      style={isClient ? { '--watched-width': `${watchedWidth.toFixed(2)}%` } : {}}
    >
      {watchedWidth > 90 && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex flex-col justify-center items-center z-[9]">
          <ArrowPathIcon className="text-white w-11 group-hover:animate-[spin_1s_ease-in-out_1]" />
          <span>Restart</span>
        </div>
      )}
      {_media.videoURL ? (
        <TotalRuntime
          length={_media.length ?? _media.metadata.runtime * 60000 ?? 0}
          metadata={_media.metadata}
          videoURL={_media.videoURL}
          classNames="absolute bottom-0 w-full text-center z-[11] text-[0.55rem]"
        />
      ) : null}
      {!hideGenres && _media.metadata?.genres && (
        <div className="bg-gray-900 text-center px-0.5 py-0.5 text-white transition-opacity duration-700 inset-0 text-xs opacity-75 group-hover:opacity-100 z-[11] relative">
          <div className="whitespace-nowrap">
            {_media.metadata.genres.map((genre) => {
              const { fontColor, backgroundColor } = generateColors(genre?.name)
              return (
                <span
                  key={genre.name}
                  className="text-xs font-medium me-2 px-2.5 rounded border border-gray-600"
                  style={{ backgroundColor: backgroundColor, color: fontColor }}
                >
                  {genre.name}
                </span>
              )
            })}
          </div>
        </div>
      )}
      {posterBlurhash ? (
        <Image
          src={posterURL}
          alt={alt ?? _media.title}
          quality={quality}
          width={size.w}
          height={size.h}
          loading={loadingType}
          placeholder="blur"
          blurDataURL={`data:image/png;base64,${posterBlurhash}`}
          className={classNames(className, 'object-cover group-hover:opacity-75')}
          priority={imagePriority}
        />
      ) : (
        <Image
          src={posterURL}
          alt={alt ?? _media.title}
          quality={quality}
          width={size.w}
          height={size.h}
          className={classNames(className, 'object-cover group-hover:opacity-75')}
          priority={imagePriority}
        />
      )}
      {_media.dimensions && (
        <div className="flex bg-gray-900 justify-center content-center flex-wrap pb-[23px] pt-3 text-white transition-opacity duration-700 inset-0 text-xs h-3.5 opacity-75 group-hover:opacity-100 z-10 relative">
          <div className="select-none bg-transparent text-gray-600 transition-opacity duration-700 text-xs h-4">
            {is4k ? (
              <Image
                src={HD4kBanner}
                className="h-4 w-auto"
                alt={'4k Banner'}
                loading="lazy"
                placeholder="blur"
              />
            ) : is1080p ? (
              <span className="text-yellow-500 font-bold">1080p</span>
            ) : (
              dims[0] + 'p'
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default memo(_mediaPoster)
