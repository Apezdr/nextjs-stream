'use client'

import { useState } from 'react'
import { Player, Controls, Gesture, Hotkey, BufferingIndicator, SpinnerIcon } from './videojs'

import * as Buttons from './buttons'
import SubtitleEditorButton from './buttons/SubtitleEditorButton'
import * as Menus from './menus'
import * as Sliders from './sliders'
import { TimeGroup } from './time-group'
import { Title, VideoMetadata } from './title'
import NextUpCard from './NextUpCard'

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
  const store = Player.usePlayer()
  const media = Player.useMedia()
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
      <BufferingIndicator className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity duration-200 data-[buffering]:opacity-100">
        <SpinnerIcon className="h-16 w-16 animate-spin text-white/90" />
      </BufferingIndicator>
      <Controls.Root className="absolute inset-0 z-10 flex h-full w-full flex-col bg-gradient-to-t from-black/10 to-transparent opacity-0 transition-opacity pointer-events-none data-[visible]:opacity-100">
        {/* Top Bar */}
        <Controls.Group className="pointer-events-auto relative left-1 top-4 flex h-12 w-16 items-center px-2">
          <Buttons.GoBack goBack={goBack} />
        </Controls.Group>
        {/* End Top Bar */}
        <div className="flex-1" />
        <Controls.Group className="flex !h-auto max-w-sm flex-col justify-end !pointer-events-none sm:max-w-lg xl:max-w-3xl">
          <VideoMetadata dims={dimsVal} hdr={hdrVal} mediaMetadata={mediaMetadata} logo={logo} />
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
