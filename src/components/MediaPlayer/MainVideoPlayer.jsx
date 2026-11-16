'use client'

import './player.css'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Player, Container, GoogleCast } from './videojs'
import PlayerMedia, { castContentType, isManifestSource } from './PlayerMedia'
import { VideoLayout } from './VideoLayout'
import MediaPoster from './MediaPoster'
import VolumeRegulator from './VolumeRegulator'
import ClipWindow from './ClipWindow'
import EngineStartPosition from './EngineStartPosition'
import CastResumeGuard from './CastResumeGuard'
import AutoCaptionsManager from './AutoCaptionsManager'
import { AutoCaptionsProgressProvider } from './AutoCaptionsProgressContext'
import CaptionPreferenceManager from './CaptionPreferenceManager'
import WithPlaybackTracker from '../built-in/WithPlaybackTracker'
import { usePlaybackCoordinator } from '@src/contexts/PlaybackCoordinatorContext'
import usePlayerMediaElement from './usePlayerMediaElement'
import { useCastAdoption } from '@components/Cast/useCastSession'
import useCastHintSuppression from '@components/Cast/useCastHintSuppression'
import { rememberCastPath } from '@components/Cast/castSdk'
import { usePathname } from 'next/navigation'
import useActivityVisible from './useActivityVisible'
import useLocalSilence from './useLocalSilence'
import CastTransportBridge from './CastTransportBridge'
import CastVolume from './CastVolume'
import usePlayWhenReady from './usePlayWhenReady'
import useResumePosition from './useResumePosition'
import { parseExplicitStart } from './resumePosition'
import { PlayerFrameSkeleton } from './PlayerPageSkeleton'

/**
 * Client root for the main watch-page player.
 *
 * The player is deliberately NOT kept alive while the page sits in Next's
 * segment cache. Navigating away parks the page in `<Activity mode="hidden">`
 * — DOM and state stay alive — which keeps a video playing behind the page
 * you are actually looking at, holds an hls.js engine open, and (because of
 * an upstream `useDestroy` bug in @videojs/react 10, still present in 10.0.0,
 * where a fired deferred destroy never clears its pending handle) permanently skips the
 * framework's setup paths on re-show. That leaves the store detached from the
 * media element: a frozen seek bar, a frozen time display, and an uncropped
 * sprite sheet in the scrub preview until a manual reload.
 *
 * Unmounting the subtree while hidden sidesteps all of it — a fresh mount on
 * return re-runs every setup. Playback position is not lost: WithPlaybackTracker
 * saves it to the server every second and seeks on canPlay. The page itself stays cached,
 * so the shell, scroll position and surrounding state are still instant.
 */
export default function MainVideoPlayer(props) {
  const visible = useActivityVisible()

  // Where this page's player last was. It outlives the player (which is
  // unmounted while the page is hidden) and nothing else: it is this page's
  // own state, as the position would be had the player stayed mounted. A
  // page shown again starts from it when the server gives no answer in time,
  // because the position the page was rendered with is by then as old as the
  // whole viewing. Never the first source: the server is asked first.
  const lastPositionRef = useRef(null)
  const rememberPosition = useCallback((seconds) => {
    lastPositionRef.current = Number.isFinite(seconds) ? seconds : null
  }, [])
  const lastKnownPosition = useCallback(() => lastPositionRef.current, [])

  if (!visible) {
    return <PlayerPlaceholder />
  }

  return <ActiveVideoPlayer {...props} onPosition={rememberPosition} getLastKnownPosition={lastKnownPosition} />
}

/** What stands where the player was while its page is hidden (display: none). */
function PlayerPlaceholder() {
  return (
    <div
      aria-hidden="true"
      className="player-container relative z-10 max-h-dvh w-full bg-transparent dark"
    />
  )
}

/**
 * Resolves where this mount starts before the engine exists. The player
 * subtree is not rendered until the position is known, because hls.js
 * consumes `startPosition` at load and the tracker seeks raw sources once —
 * neither can be corrected after the fact without the cold seek that held
 * Chrome at readyState 2 (hlsPlaybackConfig.js).
 */
function ActiveVideoPlayer(props) {
  const { videoURL, start, savedPlaybackTime, mediaId, playbackUserId, getLastKnownPosition } = props

  // Returning to a watch page while the receiver is already playing this exact
  // title mounts a fresh, DISCONNECTED cast provider (its adoption path is
  // event-driven and never re-checks on mount), so autoPlay would start the
  // local element alongside the TV. Ask the SDK directly and stay silent.
  //
  // This is correct on the first render of the returning mount, not a beat
  // later: the SDK's RemotePlayerController binds to a live session in its
  // constructor, so the snapshot is already populated when we read it.
  const { adopted: castingThisTitle } = useCastAdoption(videoURL)

  // A present `?start=` — including `?start=0` — is an explicit request that
  // outranks saved history. Zero means "restart", which is what the
  // next-episode card asks for and what a finished episode needs.
  const explicitStart = parseExplicitStart(start)

  // Every mount asks the server where to start (unless the link said, or a
  // receiver has the title): the first as well as a page shown again.
  const { ready, resumeAt } = useResumePosition({
    explicitStart,
    savedPlaybackTime,
    mediaId,
    videoURL,
    castingThisTitle,
    userId: playbackUserId,
    getLastKnownPosition,
  })

  // The player's box, black, while it asks: the frame the page's skeleton
  // showed, so nothing flashes between the two.
  if (!ready) return <PlayerFrameSkeleton />

  return (
    <ActivePlayerBody
      {...props}
      castingThisTitle={castingThisTitle}
      explicitStart={explicitStart}
      resumeAt={resumeAt}
    />
  )
}

/**
 * The live player. Mounted only while its page is on screen, so every mount is
 * a clean start for the framework's stores, media instances and thumbnails.
 */
function ActivePlayerBody({
  castingThisTitle,
  explicitStart,
  resumeAt,
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
  delivery,
  nextUpCard,
  clipStartTime,
  clipEndTime,
  savedPlaybackTime,
  mediaId,
  normalizedVideoId,
  playbackMetadata,
  mediaKey,
  castReceiverId,
  castToken,
  playbackUserId,
  onPosition,
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


  // THE cold-start fix: no caller may start playback below HAVE_FUTURE_DATA.
  // Chrome holds the media clock when play() lands on a cold element (seen on
  // hls.js AND on a progressive MKV), which is the stuck-spinner report and
  // the corrupted resume points. See usePlayWhenReady.
  usePlayWhenReady(videoRef)

  // Where playback begins was resolved by ActiveVideoPlayer before this body
  // mounted (a deep link, else the server's row, asked for on every mount).
  // For a manifest source it is handed to
  // hls.js as startPosition and the tracker is told the engine owns the
  // initial seek, so it never cold-seeks the element itself — that seek is
  // what left Chrome holding readyState 2 for 14-24 s (hlsPlaybackConfig.js).
  // For a raw file there is no engine to own it: the tracker seeks once at
  // HAVE_METADATA. While a receiver has the title the position belongs to
  // the television; resumeAt is null and both paths stand down.
  const engineOwnsResume = isManifestSource(videoURL) && Number.isFinite(resumeAt) && resumeAt > 0

  // On a hard reload the Cast SDK has not been fetched yet, so for the first
  // second nothing on the page CAN know this title is on a television — which
  // is how a refresh ended up flashing the video from the beginning. The
  // localStorage breadcrumb is the only thing readable synchronously at that
  // moment; it holds the element back until the SDK confirms or denies it.
  const castHintSilence = useCastHintSuppression(videoURL, castingThisTitle)
  // The third argument says the reason is only a guess: when the SDK has not yet
  // confirmed adoption, a wrong guess must be undone by playing. Once it HAS
  // confirmed, the session ending must leave the video paused.
  useLocalSilence(videoRef, castingThisTitle || castHintSilence, !castingThisTitle)

  // While this title is the one on the receiver, remember the route it is
  // playing from, so the casting indicator elsewhere in the app can offer a way
  // back. Recorded rather than derived: this page already knows its own URL,
  // and reversing a video URL into a route would need a server lookup.
  const pathname = usePathname()
  useEffect(() => {
    if (castingThisTitle && pathname) rememberCastPath(pathname)
  }, [castingThisTitle, pathname])

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
    <Player.Player>
      <AutoCaptionsProgressProvider>
        {/* Transparent, not black: while casting the video fades to nothing and
            the page backdrop shows through the translucent overlay instead of a
            flat black panel. This costs nothing during ordinary playback — the
            media element carries its own `background: #000` (player.css) and
            fills the container, so the letterbox bars stay black and only
            disappear when the picture itself fades out. */}
        <Container
          className="player-container relative z-10 max-h-dvh w-full bg-transparent dark"
          data-playback-source={delivery?.source}
          data-jit-skip-reason={delivery?.skipReason ?? undefined}
          data-jit-skip-detail={delivery?.skipDetail ? JSON.stringify(delivery.skipDetail) : undefined}
          data-resume-at={resumeAt ?? undefined}
          data-saved-playback-time={savedPlaybackTime ?? undefined}
        >
          <PlayerMedia
            videoURL={videoURL}
            chaptersURL={chaptersURL}
            thumbnailsURL={thumbnailsURL}
            captions={captions}
            nonces={nonces}
            videoRef={videoRef}
            suppressAutoplay={castingThisTitle}
            resumeAt={engineOwnsResume ? resumeAt : null}
          />
          {/* BEFORE <GoogleCast>: the first extension overriding a media member
              wins, so this owns `volume` while casting and paces what
              reaches the receiver; see CastVolume. */}
          <CastVolume videoURL={videoURL} />
          {/* contentType is explicit: the sender only infers one for HLS, so a
              progressive file would otherwise reach the receiver with an empty
              MIME type and have to be sniffed. */}
          <GoogleCast
            receiver={castReceiverId || undefined}
            contentType={castContentType(videoURL)}
            customData={castCustomData}
          />
          {/* AFTER <GoogleCast>: extensions register with the player in render
              order and the first one overriding a media member wins, so a
              genuinely connected provider always wins and this only takes over
              a session it did not start. */}
          <CastTransportBridge videoURL={videoURL} />
          <VolumeRegulator videoURL={videoURL} />
          <CastResumeGuard videoURL={videoURL} />
          {/* Owns where hls.js starts — the startPosition in source.engine.hlsJs
              alone is discarded by the framework's bare startLoad(); see
              EngineStartPosition. */}
          <EngineStartPosition resumeAt={engineOwnsResume ? resumeAt : null} videoURL={videoURL} />
          {videoURL ? (
            <WithPlaybackTracker
              videoURL={videoURL}
              mediaId={mediaId}
              normalizedVideoId={normalizedVideoId}
              resumeAt={resumeAt}
              engineOwnsResume={engineOwnsResume}
              clearStartParam={explicitStart !== null}
              mediaMetadata={playbackMetadata}
              castAdopted={castingThisTitle}
              userId={playbackUserId}
              onPosition={onPosition}
            />
          ) : null}
          {clipStartTime || clipEndTime ? (
            <ClipWindow
              clipStartTime={clipStartTime}
              clipEndTime={clipEndTime}
              castAdopted={castingThisTitle}
            />
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
        </Container>
      </AutoCaptionsProgressProvider>
    </Player.Player>
  )
}
