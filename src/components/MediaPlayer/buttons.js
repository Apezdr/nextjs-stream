'use client'

import { cloneElement } from 'react'
import Link from 'next/link'
import { classNames } from '@src/utils'
import {
  Player,
  Tooltip,
  PlayButton,
  MuteButton,
  PiPButton,
  FullscreenButton,
  SeekButton,
  CastButton,
  AirPlayButton,
  PlayIcon,
  PauseIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeOffIcon,
  PipEnterIcon,
  PipExitIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  CastEnterIcon,
  CastExitIcon,
  AirPlayEnterIcon,
  AirPlayExitIcon,
  SeekIcon,
} from './videojs'

export const buttonClass =
  'group relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md outline-none ring-inset ring-blue-400 hover:bg-white/20 focus-visible:ring-4'

export const tooltipClass =
  'z-10 rounded-sm bg-black/90 px-2 py-0.5 text-sm font-medium text-white opacity-0 transition-opacity duration-150 data-[open]:opacity-100'

/**
 * Wraps a single interactive element with a styled tooltip. The trigger's
 * accessibility/hover props are merged onto the child via cloneElement.
 */
export function ButtonTooltip({ label, side = 'top', align = 'center', children }) {
  return (
    <Tooltip.Root side={side} align={align} delay={300}>
      <Tooltip.Trigger
        render={(props) =>
          cloneElement(children, {
            ...props,
            className: classNames(props?.className, children.props?.className),
          })
        }
      />
      <Tooltip.Popup className={tooltipClass}>
        <Tooltip.Label>{label}</Tooltip.Label>
      </Tooltip.Popup>
    </Tooltip.Root>
  )
}

export function Play({ side = 'top', align = 'center' }) {
  const isPaused = Player.usePlayer((s) => s.paused)
  return (
    <ButtonTooltip label={isPaused ? 'Play' : 'Pause'} side={side} align={align}>
      <PlayButton className={buttonClass}>
        {isPaused ? <PlayIcon className="h-12 w-12" /> : <PauseIcon className="h-8 w-8" />}
      </PlayButton>
    </ButtonTooltip>
  )
}

export function Mute({ side = 'top', align = 'center' }) {
  const volume = Player.usePlayer((s) => s.volume)
  const isMuted = Player.usePlayer((s) => s.muted)
  return (
    <ButtonTooltip label={isMuted ? 'Unmute' : 'Mute'} side={side} align={align}>
      <MuteButton className={buttonClass}>
        {isMuted || volume === 0 ? (
          <VolumeOffIcon className="h-8 w-8" />
        ) : volume < 0.5 ? (
          <VolumeLowIcon className="h-8 w-8" />
        ) : (
          <VolumeHighIcon className="h-8 w-8" />
        )}
      </MuteButton>
    </ButtonTooltip>
  )
}

export function PIP({ side = 'top', align = 'center' }) {
  const isActive = Player.usePlayer((s) => s.pip)
  return (
    <ButtonTooltip label={isActive ? 'Exit PIP' : 'Enter PIP'} side={side} align={align}>
      <PiPButton className={buttonClass}>
        {isActive ? <PipExitIcon className="h-8 w-8" /> : <PipEnterIcon className="h-8 w-8" />}
      </PiPButton>
    </ButtonTooltip>
  )
}

export function Fullscreen({ side = 'top', align = 'center' }) {
  const isActive = Player.usePlayer((s) => s.fullscreen)
  return (
    <ButtonTooltip
      label={isActive ? 'Exit Fullscreen' : 'Enter Fullscreen'}
      side={side}
      align={align}
    >
      <FullscreenButton className={buttonClass}>
        {isActive ? (
          <FullscreenExitIcon className="h-8 w-8" />
        ) : (
          <FullscreenEnterIcon className="h-8 w-8" />
        )}
      </FullscreenButton>
    </ButtonTooltip>
  )
}

export function SeekForward({ side = 'top', align = 'center' }) {
  return (
    <ButtonTooltip label="Skip Forward 10 Seconds" side={side} align={align}>
      <SeekButton seconds={10} className={buttonClass}>
        <SeekIcon className="h-8 w-8" />
      </SeekButton>
    </ButtonTooltip>
  )
}

export function SeekBackward({ side = 'top', align = 'center' }) {
  return (
    <ButtonTooltip label="Rewind 10 Seconds" side={side} align={align}>
      <SeekButton seconds={-10} className={buttonClass}>
        <SeekIcon className="h-8 w-8 -scale-x-100" />
      </SeekButton>
    </ButtonTooltip>
  )
}

export function GoBack({ goBack }) {
  return (
    <Link
      href={goBack}
      className="z-[1] rounded-full p-2 text-white hover:bg-gray-700 hover:bg-opacity-30"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={1.5}
        stroke="currentColor"
        className="h-12 w-12"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
        />
      </svg>
    </Link>
  )
}

export function Chromecast({ side = 'top', align = 'center' }) {
  const remoteState = Player.usePlayer((s) => s.remotePlaybackState)
  return (
    <ButtonTooltip label="Cast" side={side} align={align}>
      <CastButton className={buttonClass}>
        {remoteState === 'connected' ? (
          <CastExitIcon className="h-8 w-8" />
        ) : (
          <CastEnterIcon className="h-8 w-8" />
        )}
      </CastButton>
    </ButtonTooltip>
  )
}

export function AirPlay({ side = 'top', align = 'center' }) {
  const remoteState = Player.usePlayer((s) => s.remotePlaybackState)
  return (
    <ButtonTooltip label="AirPlay" side={side} align={align}>
      <AirPlayButton className={buttonClass}>
        {remoteState === 'connected' ? (
          <AirPlayExitIcon className="h-8 w-8" />
        ) : (
          <AirPlayEnterIcon className="h-8 w-8" />
        )}
      </AirPlayButton>
    </ButtonTooltip>
  )
}
