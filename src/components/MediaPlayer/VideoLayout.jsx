'use client'

import { useCallback, useRef, useState } from 'react'
import { Player, Controls, Gesture, Hotkey } from './videojs'

import * as Buttons from './buttons'
import SubtitleEditorButton from './buttons/SubtitleEditorButton'
import * as Menus from './menus'
import * as Sliders from './sliders'
import { TimeGroup } from './time-group'
import { Title, VideoMetadata } from './title'
import NextUpCard from './NextUpCard'
import CastingOverlay from './CastingOverlay'
import useIsCasting from './useIsCasting'
import useDecodeHealth from './useDecodeHealth'
import { DecodeHealthModal } from './DecodeHealthNotice'
import usePlaybackDiagnostics from './usePlaybackDiagnostics'
import PlaybackStatusOverlay from './PlaybackStatusOverlay'

/**
 * Declarative pointer gestures: tap toggles pause, center double-tap toggles
 * fullscreen, edge double-taps seek ±10s. (The framework's regions are
 * thirds; the old vidstack zones were fifths — accepted difference.)
 */
function Gestures() {
  return (
    <>
      <Gesture type="tap" action="togglePaused" />
      <Gesture type="doubletap" region="center" action="toggleFullscreen" />
      <Gesture type="doubletap" region="left" action="seekStep" value={-10} />
      <Gesture type="doubletap" region="right" action="seekStep" value={10} />
    </>
  )
}

/**
 * Keyboard shortcuts. Vidstack shipped these for free; the framework makes
 * them declarative instead.
 */
function Hotkeys() {
  return (
    <>
      <Hotkey keys="Space" action="togglePaused" />
      <Hotkey keys="k" action="togglePaused" />
      <Hotkey keys="ArrowLeft" action="seekStep" value={-10} />
      <Hotkey keys="ArrowRight" action="seekStep" value={10} />
      <Hotkey keys="ArrowUp" action="volumeStep" value={0.1} />
      <Hotkey keys="ArrowDown" action="volumeStep" value={-0.1} />
      <Hotkey keys="m" action="toggleMuted" />
      <Hotkey keys="f" action="toggleFullscreen" />
      <Hotkey keys="c" action="toggleSubtitles" />
    </>
  )
}

export function VideoLayout({
  hasThumbnails,
  hasCaptions,
  hasChapters,
  goBack,
  titleLabel,
  mediaMetadata,
  logo,
  videoURL,
  captions,
  nextUpCard,
  chapterThumbnailURL,
  hdrVal,
  dimsVal,
  isAdmin,
  adminProps,
}) {
  const [isSubtitleEditorOpen, setIsSubtitleEditorOpen] = useState(false)
  const { isCasting } = useIsCasting(videoURL)
  const store = Player.usePlayer()
  const media = Player.useMedia()

  // Whether this browser is quietly playing a lesser version of the title.
  const { verdict: decodeHealth, dismissedTier, dismiss: dismissDecodeHealth } = useDecodeHealth(
    videoURL,
    isCasting
  )
  // Records element / host / store readings side by side whenever the
  // buffering indicator shows, plus the non-fatal hls.js traffic the framework
  // discards. Read-only; see usePlaybackDiagnostics for the questions it
  // exists to answer and how to read the log.
  const spinnerRef = useRef(null)
  usePlaybackDiagnostics({ store, media, videoURL, spinnerRef, isCasting })
  // Reopening from the chip, after the modal has already been dismissed.
  const [decodeNoticeReopened, setDecodeNoticeReopened] = useState(false)
  // Derived, not an effect: dismissing writes the session flag AND advances
  // dismissedTier, which closes the auto-open branch on the next render.
  const decodeNoticeOpen =
    Boolean(decodeHealth) && (decodeNoticeReopened || dismissedTier !== decodeHealth.tier)
  // Stable identity: the modal keys its native keydown listener on this, and a
  // new function every render would rebind it on every store tick.
  const closeDecodeNotice = useCallback(() => {
    setDecodeNoticeReopened(false)
    dismissDecodeHealth()
  }, [dismissDecodeHealth])
  const captionsSnapshot = Player.usePlayer((s) => ({
    textTrackList: s.textTrackList,
  }))

  // The showing caption track's label, resolved from the store's track list.
  const showingLabel =
    captionsSnapshot.textTrackList?.find(
      (t) => (t.kind === 'subtitles' || t.kind === 'captions') && t.mode === 'showing'
    )?.label ?? null

  const editorLanguage =
    showingLabel && captions?.[showingLabel] ? showingLabel : Object.keys(captions ?? {})[0] ?? ''
  const editorSubtitleUrl = captions?.[editorLanguage]?.url || ''

  return (
    <>
      <Gestures />
      <Hotkeys />
      <CastingOverlay titleLabel={titleLabel} videoURL={videoURL} />
      {/* One status surface for cold start, deferred play, mid-stream
          buffering and errors, read off the element — the framework's
          <BufferingIndicator> (store.waiting && !paused) was silent for the
          first two, which on a just-in-time origin is where the wait actually
          is. Hidden while casting: the casting banner shares this centre and
          the television draws its own spinner. */}
      <PlaybackStatusOverlay ref={spinnerRef} videoURL={videoURL} hidden={isCasting} />
      <Controls.Root className="player-controls absolute inset-0 z-10 flex h-full w-full flex-col bg-gradient-to-t from-black/10 to-transparent opacity-0 transition-opacity pointer-events-none data-[visible]:opacity-100">
        {/* Bottom gradient shown only while hovering the seek bar (rises to
            ~mid-thumbnail height); toggled via :has() in player.css. */}
        <div className="seek-hover-gradient pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 transition-opacity duration-300" />
        {/* Top Bar */}
        <Controls.Group className="pointer-events-auto relative left-1 top-4 flex h-12 w-16 items-center px-2">
          <Buttons.GoBack goBack={goBack} />
        </Controls.Group>
        {/* End Top Bar */}
        <div className="flex-1" />
        {/* `group` so the decode chip can take the pointer only while the
            controls are up — Controls.Root carries data-interactive and the tap
            gesture bails on closest('[data-interactive]'), so a permanently
            clickable badge would kill tap-to-pause in the top-right corner even
            at opacity 0. ControlsGroup receives the same state attrs as the
            root, so data-visible is stamped here too. */}
        <Controls.Group className="group flex !h-auto max-w-sm flex-col justify-end !pointer-events-none sm:max-w-lg xl:max-w-3xl">
          <VideoMetadata
            dims={dimsVal}
            hdr={hdrVal}
            mediaMetadata={mediaMetadata}
            logo={logo}
            decodeHealth={decodeHealth}
            onOpenDecodeHealth={() => setDecodeNoticeReopened(true)}
          />
        </Controls.Group>
        <div className="flex-1" />
        <Controls.Group className="pointer-events-auto flex w-full items-center px-2">
          {nextUpCard && nextUpCard?.hasNextEpisode && (
            <div className="relative -bottom-4 left-full">
              <NextUpCard
                mediaTitle={nextUpCard?.mediaTitle}
                season_number={nextUpCard?.season_number}
                nextEpisodeNumber={nextUpCard?.nextEpisodeNumber}
                nextEpisodeThumbnail={nextUpCard?.nextEpisodeThumbnail}
                nextEpisodeThumbnailBlurhash={nextUpCard?.nextEpisodeThumbnailBlurhash}
                nextEpisodeTitle={nextUpCard?.nextEpisodeTitle}
                hasNextEpisode={nextUpCard?.hasNextEpisode}
                mediaLength={nextUpCard?.mediaLength}
              />
            </div>
          )}
          <Sliders.Time hasThumbnails={hasThumbnails} />
          <TimeGroup />
        </Controls.Group>
        <Controls.Group className="pointer-events-auto -mt-0.5 relative flex w-full items-center px-2 pb-2">
          <Buttons.Play />
          <Buttons.SeekBackward align="start" />
          <Buttons.SeekForward />
          <Buttons.Mute />
          <Sliders.Volume />
          <Title titleLabel={titleLabel} />
          {isAdmin && adminProps && (
            <SubtitleEditorButton onEditSubtitles={() => setIsSubtitleEditorOpen(true)} />
          )}
          {hasChapters && <Menus.Chapters chapterThumbnailURL={chapterThumbnailURL} />}
          <Menus.Settings hasCaptions={hasCaptions} />
          <Buttons.PIP />
          <Buttons.Chromecast />
          <Buttons.AirPlay />
          <Buttons.Fullscreen align="end" />
        </Controls.Group>
      </Controls.Root>

      {/* Sibling of Controls.Root, not a child: inside it the modal would
          inherit both pointer-events-none and the data-[visible] fade, so it
          would dissolve after two seconds of stillness — the exact behaviour a
          read-and-dismiss dialog must not have. Inside Player.Container though,
          because fullscreen is requested on the container and anything outside
          it disappears the moment the viewer goes fullscreen. */}
      <DecodeHealthModal
        verdict={decodeHealth}
        open={decodeNoticeOpen}
        delayMs={decodeNoticeReopened ? 0 : 2500}
        onClose={closeDecodeNotice}
      />

      {/* Subtitle Editor - Only rendered for admin users */}
      {isAdmin && adminProps && isSubtitleEditorOpen && captions && (
        <adminProps.SubtitleEditor
          isOpen={isSubtitleEditorOpen}
          onClose={() => setIsSubtitleEditorOpen(false)}
          // Ref-like wrapper around the real media element — the editor layout
          // reads videoRef.current (the old vidstack player.el contract was a
          // bare element, which silently broke those paths).
          videoRef={{ current: media }}
          videoURL={videoURL}
          initialTime={(store.target ? store.currentTime : 0) || 0}
          subtitleUrl={editorSubtitleUrl}
          availableSubtitles={captions}
          selectedSubtitleLanguage={editorLanguage}
          mediaType={adminProps.mediaType}
          mediaTitle={adminProps.mediaTitle}
          seasonNumber={adminProps.season_number}
          episodeNumber={adminProps.episode_number}
          onSave={async (content, language) => {
            try {
              // The editor reports which language its content belongs to; the
              // player's showing track can be a different one, so the save
              // target must never be derived from player state
              const captionEntry = language ? captions?.[language] : undefined
              if (!captionEntry) {
                alert(`Cannot save: no subtitle track found for "${language || 'unknown language'}".`)
                return
              }

              const response = await fetch('/api/authenticated/admin/subtitles/save', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  subtitleContent: content,
                  mediaType: adminProps.mediaType,
                  // originalTitle is the filesystem key on the file server;
                  // mediaTitle (route slug) only as last-resort fallback
                  mediaTitle: adminProps.originalTitle || adminProps.mediaTitle,
                  language,
                  season: adminProps.season_number?.toString(),
                  episode: adminProps.episode_number?.toString(),
                  sourceServerId: captionEntry.sourceServerId || '',
                }),
              })

              if (response.ok) {
                alert(
                  'Subtitles saved successfully! You may need to reload the page to see the changes.'
                )
              } else {
                alert('Failed to save subtitles.')
              }
            } catch (error) {
              console.error('Error saving subtitles:', error)
              alert('An error occurred while saving subtitles.')
            }
          }}
          currentTime={(store.target ? store.currentTime : 0) || 0}
          duration={(store.target ? store.duration : 0) || 0}
        />
      )}
    </>
  )
}
