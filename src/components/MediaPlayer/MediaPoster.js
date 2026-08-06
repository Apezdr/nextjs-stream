'use client'

import { Player } from './videojs'
import { classNames } from '@src/utils'
import _MediaPoster from '@components/MediaPoster'

export default function MediaPoster({ poster, title }) {
  const canPlay = Player.usePlayer((s) => s.canPlay)
  const isPlaying = Player.usePlayer((s) => s.started && !s.paused)
  return poster ? (
    <_MediaPoster
      media={{ posterURL: poster, title }}
      contClassName={'absolute top-0 left-0 w-full h-full pointer-events-none'}
      className={classNames(
        `z-20 transition-opacity delay-400 duration-1000 w-auto h-full max-h-[800px] top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 rounded-lg`,
        canPlay || isPlaying ? 'opacity-0' : 'opacity-100'
      )}
    />
  ) : null
}
