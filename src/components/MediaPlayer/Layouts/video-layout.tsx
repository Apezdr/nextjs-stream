'use client'

import captionStyles from './captions.module.css'
import styles from './video-layout.module.css'

import { Captions, Controls, Gesture } from '@vidstack/react'

import * as Buttons from '../buttons'
import * as Menus from '../menus'
import * as Sliders from '../sliders'
import { TimeGroup } from '../time-group'
import { Title, VideoMetadata } from '../title'
import { buildURL } from 'src/utils'
import NextUpCard from '../NextUpCard'

export interface VideoLayoutProps {
  thumbnails?: string
  hasCaptions?: boolean
  hasChapters?: boolean
  goBack?: string
  mediaMetadata?: {
    mediaTitle: string
    title: string
    released: string
    overview: string
    episode_number?: number
    season_number?: number
    hasNextEpisode?: boolean
    nextEpisodeThumbnail?: string
    nextEpisodeTitle?: string
    nextEpisodeNumber?: number
    mediaLength: number
  }
  logo?: string
  captions?: object
  videoURL?: string
  nextUpCard?: {
    mediaTitle: string
    season_number: number
    nextEpisodeNumber: number
    nextEpisodeThumbnail: string
    nextEpisodeTitle: string
    hasNextEpisode: boolean
    mediaLength: number
  }
}

export function VideoLayout({
  thumbnails,
  hasCaptions,
  hasChapters,
  goBack,
  mediaMetadata,
  logo,
  videoURL,
  captions,
  nextUpCard,
}: VideoLayoutProps) {
  return (
    <>
      <Gestures />
      <Captions
        className={`${captionStyles.captions} media-preview:opacity-0 media-controls:bottom-[85px] media-captions:opacity-100 absolute inset-0 bottom-2 z-10 select-none break-words opacity-0 transition-[opacity,bottom] duration-300`}
      />
      <Controls.Root
        className={`${styles.controls} data-[visible]:opacity-100 absolute inset-0 z-10 flex h-full w-full flex-col bg-gradient-to-t from-black/10 to-transparent opacity-0 transition-opacity pointer-events-none`}
      >
        {/* Top Bar */}
        <Controls.Group className="flex w-full items-center px-2 pointer-events-auto">
          <Buttons.GoBack goBack={goBack} tooltipPlacement="bottom start" />
        </Controls.Group>
        {/* End Top Bar */}
        <div className="flex-1" />
        {mediaMetadata && (
          <Controls.Group className="flex flex-col justify-end !h-auto !bottom-32 sm:!bottom-[60%] max-w-sm sm:max-w-lg xl:max-w-3xl !pointer-events-none">
            <VideoMetadata mediaMetadata={mediaMetadata} logo={logo} />
          </Controls.Group>
        )}
        <div className="flex-1" />
        <Controls.Group className="flex w-full items-center px-2">
          {nextUpCard && (
            <div className="relative -bottom-4 left-full">
              <NextUpCard
                mediaTitle={nextUpCard?.mediaTitle}
                season_number={nextUpCard?.season_number}
                nextEpisodeNumber={nextUpCard?.nextEpisodeNumber}
                nextEpisodeThumbnail={nextUpCard?.nextEpisodeThumbnail}
                nextEpisodeTitle={nextUpCard?.nextEpisodeTitle}
                hasNextEpisode={nextUpCard?.hasNextEpisode}
                mediaLength={nextUpCard?.mediaLength}
              />
            </div>
          )}
          <Sliders.Time thumbnails={buildURL(thumbnails)} />
          <TimeGroup />
        </Controls.Group>
        <Controls.Group className="-mt-0.5 flex w-full items-center px-2 pb-2">
          <Buttons.Play tooltipPlacement="top" />
          <Buttons.SeekBackward tooltipPlacement="top start" />
          <Buttons.SeekForward tooltipPlacement="top" />
          <Buttons.Mute tooltipPlacement="top" />
          <Sliders.Volume />
          <div className="flex-1" />
          <Title />
          <div className="flex-1" />
          {hasCaptions && <Buttons.Caption tooltipPlacement="top" />}
          {hasChapters && (
            <Menus.Chapters
              placement="top end"
              tooltipPlacement="top"
              thumbnailURL={buildURL(thumbnails)}
            />
          )}
          {hasCaptions && <Menus.Settings placement="top end" tooltipPlacement="top" />}
          <Buttons.PIP tooltipPlacement="top" />
          <Buttons.Chromecast tooltipPlacement="top" videoURL={videoURL} captions={captions} />
          <Buttons.AirPlay tooltipPlacement="top" />
          <Buttons.Fullscreen tooltipPlacement="top end" />
        </Controls.Group>
      </Controls.Root>
    </>
  )
}

function Gestures() {
  return (
    <>
      <Gesture
        className="absolute inset-0 z-0 block h-full w-full"
        event="pointerup"
        action="toggle:paused"
      />
      <Gesture
        className="absolute inset-0 z-0 block h-full w-full"
        event="dblpointerup"
        action="toggle:fullscreen"
      />
      <Gesture
        className="absolute left-0 top-0 z-10 block h-full w-1/5"
        event="dblpointerup"
        action="seek:-10"
      />
      <Gesture
        className="absolute right-0 top-0 z-10 block h-full w-1/5"
        event="dblpointerup"
        action="seek:10"
      />
    </>
  )
}
