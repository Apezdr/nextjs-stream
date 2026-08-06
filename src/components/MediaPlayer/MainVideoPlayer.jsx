'use client'

import './player.css'

import { useCallback, useState } from 'react'
import { Player, GoogleCast } from './videojs'
import PlayerMedia from './PlayerMedia'
import { VideoLayout } from './VideoLayout'
import MediaPoster from './MediaPoster'
import VolumeRegulator from './VolumeRegulator'
import ClipWindow from './ClipWindow'
import AutoCaptionsManager from './AutoCaptionsManager'
import { AutoCaptionsProgressProvider } from './AutoCaptionsProgressContext'
import CaptionPreferenceManager from './CaptionPreferenceManager'
import WithPlaybackTracker from '../built-in/WithPlaybackTracker'
import WithPlaybackCoordinator from '@components/built-in/WithPlaybackCoordinator'

/**
 * Client root for the main watch-page player, assembled from @videojs/react
 * primitives (via the ./videojs barrel). MediaPlayer.js (RSC) computes every
 * URL and metadata field server-side and hands over a serializable props bag.
 */
export default function MainVideoPlayer({
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
  isAdmin,
  adminProps,
}) {
  // Cache-bust nonces per auto-caption label; bumped by AutoCaptionsManager
  // after a generation job succeeds so the <track> src refetches.
  const [nonces, setNonces] = useState({})
  const handleNonce = useCallback((label, nonce) => {
    setNonces((prev) => ({ ...prev, [label]: nonce }))
  }, [])

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
          />
          <GoogleCast receiver={castReceiverId || undefined} />
          <VolumeRegulator />
          {videoURL ? (
            <WithPlaybackTracker
              videoURL={videoURL}
              mediaId={mediaId}
              start={start}
              savedPlaybackTime={savedPlaybackTime}
              mediaMetadata={playbackMetadata}
            />
          ) : null}
          <WithPlaybackCoordinator />
          {clipStartTime || clipEndTime ? (
            <ClipWindow clipStartTime={clipStartTime} clipEndTime={clipEndTime} />
          ) : null}
          {captions ? <AutoCaptionsManager captions={captions} onNonce={handleNonce} /> : null}
          {captions ? <CaptionPreferenceManager captions={captions} mediaKey={mediaKey} /> : null}
          {poster ? <MediaPoster poster={poster} title={title} /> : null}
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
