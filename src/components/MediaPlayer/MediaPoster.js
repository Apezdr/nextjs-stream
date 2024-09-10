'use client'

import { Poster, useMediaState } from '@vidstack/react'
import { classNames } from '@src/utils'

export default function MediaPoster({ poster, title }) {
  const canPlay = useMediaState('canPlay'),
    isPlaying = useMediaState('playing')
  return poster ? (
    <Poster
      className={classNames(
        `vds-poster z-20 transition-opacity delay-400 duration-1000 w-auto h-full max-h-[800px] top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2`,
        canPlay || isPlaying ? 'opacity-0' : ''
      )}
      src={poster}
      alt={`${title} poster`}
    />
  ) : null
}
