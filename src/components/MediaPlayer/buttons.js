import {
  CaptionButton,
  FullscreenButton,
  isTrackCaptionKind,
  MuteButton,
  PIPButton,
  PlayButton,
  Tooltip,
  useMediaState,
  SeekButton,
  GoogleCastButton,
  AirPlayButton,
} from '@vidstack/react'
import {
  ClosedCaptionsIcon,
  ClosedCaptionsOnIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  MuteIcon,
  PauseIcon,
  PictureInPictureExitIcon,
  PictureInPictureIcon,
  PlayIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  SeekForward10Icon,
  SeekBackward10Icon,
  ChromecastIcon,
  AirPlayIcon,
} from '@vidstack/react/icons'
import * as Sliders from '@components/MediaPlayer/sliders'
import Link from 'next/link'
import { Fragment } from 'react'
//import ChromecastButton from './ChromecastButton'

export const buttonClass =
  'group ring-media-focus relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md outline-none ring-inset hover:bg-white/20 data-[focus]:ring-4'

export const tooltipClass =
  'animate-out fade-out slide-out-to-bottom-2 data-[visible]:animate-in data-[visible]:fade-in data-[visible]:slide-in-from-bottom-4 z-10 rounded-sm bg-black/90 px-2 py-0.5 text-sm font-medium text-white parent-data-[open]:hidden'

export function Play({ tooltipPlacement }) {
  const isPaused = useMediaState('paused')
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <PlayButton className={buttonClass}>
          {isPaused ? <PlayIcon className="w-12 h-12" /> : <PauseIcon className="w-8 h-8" />}
        </PlayButton>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        {isPaused ? 'Play' : 'Pause'}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function Mute({ tooltipPlacement, toggleSliderOnUnmute = false }) {
  const volume = useMediaState('volume'),
    isMuted = useMediaState('muted')
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div className="flex flex-row">
          <MuteButton className={buttonClass}>
            {isMuted || volume == 0 ? (
              <MuteIcon className="w-8 h-8" />
            ) : volume < 0.5 ? (
              <VolumeLowIcon className="w-8 h-8" />
            ) : (
              <VolumeHighIcon className="w-8 h-8" />
            )}
          </MuteButton>
          {toggleSliderOnUnmute && !isMuted ? (
            <div className="min-w-24">
              <Sliders.Volume />
            </div>
          ) : null}
        </div>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        {isMuted ? 'Unmute' : 'Mute'}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function Caption({ tooltipPlacement }) {
  const track = useMediaState('textTrack'),
    isOn = track && isTrackCaptionKind(track)
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <CaptionButton className={buttonClass}>
          {isOn ? (
            <ClosedCaptionsOnIcon className="w-8 h-8" />
          ) : (
            <ClosedCaptionsIcon className="w-8 h-8" />
          )}
        </CaptionButton>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        {isOn ? 'Turn Closed-Captions Off' : 'Turn Closed-Captions On'}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function PIP({ tooltipPlacement }) {
  const isActive = useMediaState('pictureInPicture')
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <PIPButton className={buttonClass}>
          {isActive ? (
            <PictureInPictureExitIcon className="w-8 h-8" />
          ) : (
            <PictureInPictureIcon className="w-8 h-8" />
          )}
        </PIPButton>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        {isActive ? 'Exit PIP' : 'Enter PIP'}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function Fullscreen({ tooltipPlacement }) {
  const isActive = useMediaState('fullscreen')
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <FullscreenButton className={buttonClass}>
          {isActive ? (
            <FullscreenExitIcon className="w-8 h-8" />
          ) : (
            <FullscreenIcon className="w-8 h-8" />
          )}
        </FullscreenButton>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        {isActive ? 'Exit Fullscreen' : 'Enter Fullscreen'}
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function SeekForward({ tooltipPlacement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <SeekButton seconds={10} className={buttonClass}>
          <SeekForward10Icon className="w-8 h-8" />
        </SeekButton>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        Skip Forward 10 Seconds
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function SeekBackward({ tooltipPlacement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <SeekButton seconds={-10} className={buttonClass}>
          <SeekBackward10Icon className="w-8 h-8" />
        </SeekButton>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        Rewind 10 Seconds
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function GoBack({ goBack, tooltipPlacement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div>
          <Link
            href={goBack}
            className="absolute z-[1] top-6 left-8 p-2 text-white rounded-full hover:bg-gray-700 hover:bg-opacity-30"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
              className="w-12 h-12"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
          </Link>
        </div>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        Go Back to List
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function Chromecast({ tooltipPlacement, videoURL, captions }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <>
          {/* <ChromecastButton
            className="group ring-media-focus relative inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-md outline-none ring-inset hover:bg-white/20 data-[focus]:ring-4"
            videoURL={videoURL}
            captions={captions}
          /> */}
          <GoogleCastButton className="vds-button">
            <ChromecastIcon className="vds-icon" />
          </GoogleCastButton>
        </>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        Cast
      </Tooltip.Content>
    </Tooltip.Root>
  )
}

export function AirPlay({ tooltipPlacement }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <>
          <AirPlayButton className="vds-button">
            <AirPlayIcon className="vds-icon" />
          </AirPlayButton>
        </>
      </Tooltip.Trigger>
      <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
        AirPlay
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
