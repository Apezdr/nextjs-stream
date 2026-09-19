'use client'

/**
 * Beta-drift firewall: this is the ONLY module in the app allowed to import
 * from `@videojs/react` (pinned exact while v10 is in beta). All player code
 * imports primitives/hooks from here so an upstream API rename is absorbed in
 * this single file.
 */
import {
  createPlayer,
  playbackFeature,
  sourceFeature,
  timeFeature,
  volumeFeature,
  bufferFeature,
  errorFeature,
  streamTypeFeature,
  controlsFeature,
  fullscreenFeature,
  orientationLockFeature,
  pipFeature,
  qualityFeature,
  audioTrackFeature,
  textTrackFeature,
  remotePlaybackFeature,
} from '@videojs/react'

/**
 * The main watch-page player. One store per Provider instance; the feature
 * list is explicit so the store shape is deliberate (no playbackRateFeature —
 * the player has never had a speed menu).
 */
export const Player = createPlayer({
  displayName: 'MainVideoPlayer',
  features: [
    playbackFeature,
    sourceFeature,
    timeFeature,
    volumeFeature,
    bufferFeature,
    errorFeature,
    streamTypeFeature,
    controlsFeature,
    fullscreenFeature,
    orientationLockFeature,
    pipFeature,
    qualityFeature,
    audioTrackFeature,
    textTrackFeature,
    remotePlaybackFeature,
  ],
})

// UI primitives
export {
  Controls,
  Menu,
  Tooltip,
  TimeSlider,
  VolumeSlider,
  Slider,
  Time,
  PlayButton,
  MuteButton,
  SeekButton,
  FullscreenButton,
  PiPButton,
  CaptionsButton,
  CastButton,
  AirPlayButton,
  BufferingIndicator,
  Thumbnail,
  Gesture,
  Hotkey,
  // option hooks for menus
  useQualityOptions,
  useAudioTrackOptions,
  useCaptionsOptions,
  // store selectors (from @videojs/core/dom re-export)
  selectPlayback,
  selectSource,
  selectTime,
  selectVolume,
  selectControls,
  selectFullscreen,
  selectPiP,
  selectQuality,
  selectAudioTrack,
  selectTextTrack,
  selectRemotePlayback,
} from '@videojs/react'

// Media elements.
//
// Both are media HOSTS (HTMLVideoElementHost), which is a hard requirement for
// Google Cast: useMediaComponent ignores anything that isn't a host, so with a
// plain <Video> (a raw <video> element) the <GoogleCast> component silently
// no-ops and the cast button falls through to the browser's native Remote
// Playback API — Chrome's default receiver, without our receiver app,
// subtitles or metadata.
export { HlsJsVideo } from '@videojs/react/media/hlsjs-video'
export { NativeHlsVideo } from '@videojs/react/media/native-hls-video'
export { GoogleCast } from '@videojs/react/media/google-cast'

// Icons
export {
  PlayIcon,
  PauseIcon,
  VolumeHighIcon,
  VolumeLowIcon,
  VolumeOffIcon,
  CaptionsOnIcon,
  CaptionsOffIcon,
  FullscreenEnterIcon,
  FullscreenExitIcon,
  PipEnterIcon,
  PipExitIcon,
  CastEnterIcon,
  CastExitIcon,
  AirPlayEnterIcon,
  AirPlayExitIcon,
  GearIcon,
  QualityIcon,
  SpeechIcon,
  SwitchesIcon,
  ChevronIcon,
  CheckIcon,
  SeekIcon,
  SpinnerIcon,
} from '@videojs/react/icons'
