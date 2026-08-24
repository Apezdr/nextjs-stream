'use client'

import './player.css'

import { useCallback, useLayoutEffect, useMemo, useState } from 'react'
import { Player, GoogleCast } from './videojs'
import PlayerMedia, { castContentType } from './PlayerMedia'
import { VideoLayout } from './VideoLayout'
import MediaPoster from './MediaPoster'
import VolumeRegulator from './VolumeRegulator'
import ClipWindow from './ClipWindow'
import CastResumeGuard from './CastResumeGuard'
import AutoCaptionsManager from './AutoCaptionsManager'
import { AutoCaptionsProgressProvider } from './AutoCaptionsProgressContext'
import CaptionPreferenceManager from './CaptionPreferenceManager'
import WithPlaybackTracker from '../built-in/WithPlaybackTracker'
import { usePlaybackCoordinator } from '@src/contexts/PlaybackCoordinatorContext'
import usePlayerMediaElement from './usePlayerMediaElement'
import { useCastAdoption } from '@components/Cast/useCastSession'
import useActivityVisible from './useActivityVisible'
import useLocalSilence from './useLocalSilence'
import CastTransportBridge from './CastTransportBridge'

/**
 * Client root for the main watch-page player.
 *
 * The player is deliberately NOT kept alive while the page sits in Next's
 * segment cache. Navigating away parks the page in `<Activity mode="hidden">`
 * — DOM and state stay alive — which keeps a video playing behind the page
 * you are actually looking at, holds an hls.js engine open, and (because of
 * an upstream `useDestroy` bug in @videojs/react 10 beta, where a fired
 * deferred destroy never clears its pending handle) permanently skips the
 * framework's setup paths on re-show. That leaves the store detached from the
 * media element: a frozen seek bar, a frozen time display, and an uncropped
 * sprite sheet in the scrub preview until a manual reload.
 *
 * Unmounting the subtree while hidden sidesteps all of it — a fresh mount on
 * return re-runs every setup. Playback position is not lost: WithPlaybackTracker
 * persists it every second and seeks on canPlay. The page itself stays cached,
 * so the shell, scroll position and surrounding state are still instant.
 */
export default function MainVideoPlayer(props) {
  const visible = useActivityVisible()

  if (!visible) {
    // Hold the layout box so returning to the page doesn't jump.
    return (
      <div
        aria-hidden="true"
        className="player-container relative z-10 aspect-video max-h-screen w-full bg-black dark"
      />
    )
  }

  return <ActiveVideoPlayer {...props} />
}

/**
 * The live player. Mounted only while its page is on screen, so every mount is
 * a clean start for the framework's stores, media instances and thumbnails.
 */
function ActiveVideoPlayer({
  videoURL,
  poster,
  titleLabel,
  title,
  captions,
  chaptersURL,
  thumbnailsURL,
  chapterThumbnailURL,
  hasCaptions,
  hasChapters,
  goBack,
  mediaMetadata,
  logo,
  hdrVal,
  dimsVal,
  nextUpCard,
  clipStartTime,
  clipEndTime,
  start,
  savedPlaybackTime,
  mediaId,
  playbackMetadata,
  mediaKey,
  castReceiverId,
  castToken,
  isAdmin,
  adminProps,
}) {
  // Cache-bust nonces per auto-caption label; bumped by AutoCaptionsManager
  // after a generation job succeeds so the <track> src refetches.
  const [nonces, setNonces] = useState({})
  const handleNonce = useCallback((label, nonce) => {
    setNonces((prev) => ({ ...prev, [label]: nonce }))
  }, [])

  // Owns the media element: teardown on unmount, and suppression while a
  // hover preview is speaking for the page. See usePlayerMediaElement.
  const { activePlayer } = usePlaybackCoordinator()
  const videoRef = usePlayerMediaElement(activePlayer === 'thumbnail')

  // Returning to a watch page while the receiver is already playing this exact
  // title mounts a fresh, DISCONNECTED cast provider (its adoption path is
  // event-driven and never re-checks on mount), so autoPlay would start the
  // local element alongside the TV. Ask the SDK directly and stay silent.
  //
  // This is correct on the first render of the returning mount, not a beat
  // later: the SDK's RemotePlayerController binds to a live session in its
  // constructor, so the snapshot is already populated when we read it.
  const { adopted: castingThisTitle } = useCastAdoption(videoURL)

  // Backstop for a hard reload, where nothing can know we are casting until the
  // SDK finishes loading and autoplay may already have fired.
  useLocalSilence(videoRef, castingThisTitle)

  // Stop playback the instant the page is hidden — synchronously, before the
  // browser paints and before the unmount above lands. This is the cleanup
  // React and Next both prescribe for media inside an Activity boundary;
  // display:none does not stop a <video>.
  // What lets the receiver keep recording this title's position after the tab
  // is gone. Memoized deliberately: the media's `customData` setter compares by
  // identity and re-issues loadMedia() to the receiver when it changes, so an
  // inline object literal would restart playback on the TV on every render.
  const castCustomData = useMemo(() => (castToken ? { castToken } : null), [castToken])

  useLayoutEffect(() => {
    const video = videoRef.current
    return () => {
      try {
        video?.pause()
      } catch {
        /* already gone */
      }
    }
  }, [videoRef])

  return (
    <Player.Provider>
      <AutoCaptionsProgressProvider>
        <Player.Container className="player-container relative z-10 aspect-video max-h-screen w-full bg-black dark">
          <PlayerMedia
            videoURL={videoURL}
            chaptersURL={chaptersURL}
            thumbnailsURL={thumbnailsURL}
            captions={captions}
            nonces={nonces}
            videoRef={videoRef}
            suppressAutoplay={castingThisTitle}
          />
          {/* contentType is explicit: the sender only infers one for HLS, so a
              progressive file would otherwise reach the receiver with an empty
              MIME type and have to be sniffed. */}
          <GoogleCast
            receiver={castReceiverId || undefined}
            contentType={castContentType(videoURL)}
            customData={castCustomData}
          />
          {/* AFTER <GoogleCast>: the framework's component is consulted first
              for media ownership, so a genuinely connected provider always wins
              and this only takes over a session it did not start. */}
          <CastTransportBridge videoURL={videoURL} />
          <VolumeRegulator />
          <CastResumeGuard />
          {videoURL ? (
            <WithPlaybackTracker
              videoURL={videoURL}
              mediaId={mediaId}
              start={start}
              savedPlaybackTime={savedPlaybackTime}
              mediaMetadata={playbackMetadata}
            />
          ) : null}
          {clipStartTime || clipEndTime ? (
            <ClipWindow clipStartTime={clipStartTime} clipEndTime={clipEndTime} />
          ) : null}
          {captions ? <AutoCaptionsManager captions={captions} onNonce={handleNonce} /> : null}
          {captions ? <CaptionPreferenceManager captions={captions} mediaKey={mediaKey} /> : null}
          {/* {poster ? <MediaPoster poster={poster} title={title} /> : null} */}
          <VideoLayout
            hasThumbnails={Boolean(thumbnailsURL)}
            hasCaptions={hasCaptions}
            hasChapters={hasChapters}
            goBack={goBack}
            titleLabel={titleLabel}
            mediaMetadata={mediaMetadata}
            logo={logo}
            videoURL={videoURL}
            captions={captions}
            nextUpCard={nextUpCard}
            chapterThumbnailURL={chapterThumbnailURL}
            hdrVal={hdrVal}
            dimsVal={dimsVal}
            isAdmin={isAdmin}
            adminProps={adminProps}
          />
        </Player.Container>
      </AutoCaptionsProgressProvider>
    </Player.Provider>
  )
}
