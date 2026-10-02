'use client'

/**
 * Upgrade firewall: this is the ONLY module in the app allowed to import from
 * `@videojs/react`. All player code imports primitives/hooks from here so an
 * upstream API change is absorbed in this single file.
 *
 * Pinned exact even though v10 is stable (semver since 10.0.0): the Cast
 * transport bridge registers through `usePlayerContext().registerExtension`,
 * which upstream marks @internal, and semver does not cover internals.
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
 * The main watch-page player: `{ Player, usePlayer, useMedia }`, so the
 * provider component is `<Player.Player>`. One store per provider instance;
 * the feature list is explicit so the store shape is deliberate (no
 * playbackRateFeature — the player has never had a speed menu).
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
  Container,
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

// @internal upstream ("not a stable authoring API"). Re-exported for exactly
// one caller, CastTransportBridge, whose `registerExtension` is the only way to
// put a media override in front of the store since 10.0.0. Keep it that way.
export { usePlayerContext } from '@videojs/react'

// Media elements (playback adapters). HlsJsVideo needs @videojs/hlsjs-video
// and GoogleCast needs @videojs/google-cast installed: both are optional peer
// dependencies of @videojs/react, and nothing else imports them directly.
// NativeHlsVideo plays direct files too (it just sets target.src); it predates
// 10.0.0's player-level Google Cast, which would also accept a plain <Video>.
export { HlsJsVideo } from '@videojs/react/media/hlsjs-video'
export { NativeHlsVideo } from '@videojs/react/media/native-hls-video'
export { GoogleCast } from '@videojs/react/extensions/google-cast'

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
