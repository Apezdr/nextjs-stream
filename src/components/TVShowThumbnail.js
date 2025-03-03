'use client'
import { useEffect, useState } from 'react'
import useWatchedWidth from './useWatchedWidth'
import Image from 'next/image'
import { TotalRuntime } from './watched'
import { ArrowPathIcon } from '@heroicons/react/20/solid'
import RetryImage from './RetryImage'

export default function TVShowThumbnail({ episode, metadata }) {
  const [isClient, setIsClient] = useState(false)
  const watchedWidth = useWatchedWidth(metadata, episode)

  const baseURL = 'https://image.tmdb.org/t/p/'
  const imageSize = 'w780'

  useEffect(() => {
    setIsClient(true)
  }, [])

  const stillURL = episode.thumbnail
    ? episode.thumbnail
    : metadata && metadata.still_path
      ? `${baseURL}${imageSize}${metadata.still_path}`
      : '/sorry-image-not-available.jpg'

  const blurDataURL = episode.thumbnailBlurhash || false
  const clipURL = episode?.clipURL || false

  return (
    <div
      className="watched-border"
      style={isClient ? { '--watched-width': `${watchedWidth.toFixed(2)}%` } : {}}
    >
      {watchedWidth > 90 && (
        <div className="absolute inset-0 bg-black bg-opacity-50 flex flex-col justify-center items-center z-[9]">
          <ArrowPathIcon className="text-white w-11 group-hover:animate-[spin_1s_ease-in-out_1]" />
          <span>Restart</span>
        </div>
      )}
      {episode.length && (
        <TotalRuntime
          length={episode.length ?? episode.metadata.runtime * 60000 ?? 0}
          metadata={episode.metadata}
          videoURL={episode.videoURL}
          classNames="absolute bottom-0 w-full text-center z-[10] text-[0.55rem]"
        />
      )}
      {blurDataURL ? (
        <RetryImage
          src={stillURL}
          width={390}
          height={217}
          alt={metadata ? metadata.name : 'Episode Image'}
          className="object-cover group-hover:opacity-75 max-w-sm rounded-t-lg max-h-[13.3rem]"
          loading="lazy"
          placeholder="blur"
          blurDataURL={`data:image/png;base64,${blurDataURL}`}
        />
      ) : (
        <RetryImage
          src={stillURL}
          width={390}
          height={217}
          alt={metadata ? metadata.name : 'Episode Image'}
          className="object-cover group-hover:opacity-75 max-w-sm rounded-t-lg max-h-[13.3rem]"
        />
      )}
    </div>
  )
}
