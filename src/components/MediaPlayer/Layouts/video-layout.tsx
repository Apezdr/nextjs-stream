'use client'

import { useState, type ComponentType } from 'react'
import captionStyles from './captions.module.css'
import styles from './video-layout.module.css'

import { Captions, Controls, Gesture, useMediaPlayer } from '@vidstack/react'

import * as Buttons from '../buttons'
import SubtitleEditorButton from '../buttons/SubtitleEditorButton'
import * as Menus from '../menus'
import * as Sliders from '../sliders'
import { TimeGroup } from '../time-group'
import { Title, VideoMetadata } from '../title'
import NextUpCard from '../NextUpCard'

export interface CaptionData {
  srcLang: string
  url: string
  lastModified?: string
  sourceServerId?: string
}

export interface AdminProps {
  SubtitleEditor: any;
  session: any;
  mediaType: string;
  mediaTitle: string;
  season_number?: number;
  episode_number?: number;
}

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
  captions?: Record<string, CaptionData>
  videoURL?: string
  nextUpCard?: {
    mediaTitle: string
    season_number: number
    nextEpisodeNumber: number
    nextEpisodeThumbnail: string
    nextEpisodeThumbnailBlurhash?: string
    nextEpisodeTitle: string
    hasNextEpisode: boolean
    mediaLength: number
  }
  chapterThumbnailURL?: string
  hdrVal?: string
  dimsVal?: string
  isAdmin?: boolean
  adminProps?: AdminProps | null
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
  chapterThumbnailURL,
  hdrVal,
  dimsVal,
  isAdmin,
  adminProps
}: VideoLayoutProps) {
  const [isSubtitleEditorOpen, setIsSubtitleEditorOpen] = useState(false)
  const player = useMediaPlayer()
  const SubtitleEditorButtonTyped = SubtitleEditorButton as unknown as ComponentType<{
    tooltipPlacement?: string;
    onEditSubtitles?: () => void;
  }>
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
        <Controls.Group className="flex items-center px-2 relative w-16 h-12 left-1 top-4">
          <Buttons.GoBack goBack={goBack} />
        </Controls.Group>
        {/* End Top Bar */}
        <div className="flex-1" />
        <Controls.Group className="flex flex-col justify-end !h-auto !bottom-32 sm:!bottom-[60%] max-w-sm sm:max-w-lg xl:max-w-3xl !pointer-events-none">
          <VideoMetadata dims={dimsVal} hdr={hdrVal} mediaMetadata={mediaMetadata} logo={logo} />
        </Controls.Group>
        <div className="flex-1" />
        <Controls.Group className="flex w-full items-center px-2">
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
          <Sliders.Time thumbnails={thumbnails} />
          <TimeGroup />
        </Controls.Group>
        <Controls.Group className="-mt-0.5 flex w-full items-center px-2 pb-2 relative">
          <Buttons.Play tooltipPlacement="top" />
          <Buttons.SeekBackward tooltipPlacement="top start" />
          <Buttons.SeekForward tooltipPlacement="top" />
          <Buttons.Mute tooltipPlacement="top" />
          <Sliders.Volume />
          {/* <div className="flex-1" /> */}
          <Title />
          {isAdmin && adminProps && (
            <SubtitleEditorButtonTyped 
              tooltipPlacement="top"
              onEditSubtitles={() => setIsSubtitleEditorOpen(true)}
            />
          )}
          {hasChapters && (
            <Menus.Chapters
              placement="top end"
              tooltipPlacement="top"
              chapterThumbnailURL={chapterThumbnailURL}
            />
          )}
          <Menus.Settings placement="top end" tooltipPlacement="top" hasCaptions={hasCaptions} />
          <Buttons.PIP tooltipPlacement="top" />
          <Buttons.Chromecast tooltipPlacement="top" videoURL={videoURL} captions={captions} />
          <Buttons.AirPlay tooltipPlacement="top" />
          <Buttons.Fullscreen tooltipPlacement="top end" />
        </Controls.Group>
      </Controls.Root>

      {/* Subtitle Editor - Only rendered for admin users */}
      {isAdmin && adminProps && isSubtitleEditorOpen && captions && (
        <adminProps.SubtitleEditor
          isOpen={isSubtitleEditorOpen}
          onClose={() => setIsSubtitleEditorOpen(false)}
          videoRef={player?.el}
          videoURL={videoURL} // Add videoURL to the editor for direct video access
          initialTime={player?.state.currentTime || 0} // Pass current playback position to sync preview
          subtitleUrl={(() => {
            if (!captions || Object.keys(captions).length === 0) return '';

            // Get the current subtitle track info and convert to array
            const textTracks = player?.textTracks;
            const tracksArray = textTracks ? Array.from(textTracks) : [];

            // Find the first enabled caption/subtitle track
            const activeTrack = tracksArray.find(track =>
              track &&
              (track.kind === 'subtitles' || track.kind === 'captions') &&
              track.mode === 'showing'
            );

            if (activeTrack && activeTrack.label && captions[activeTrack.label]) {
              return captions[activeTrack.label].url;
            }

            // Fallback to first available subtitle
            return Object.values(captions)[0]?.url || '';
          })()}
          availableSubtitles={captions}
          selectedSubtitleLanguage={(() => {
            if (!captions || Object.keys(captions).length === 0) return '';

            // Get the current subtitle track info and convert to array
            const textTracks = player?.textTracks;
            const tracksArray = textTracks ? Array.from(textTracks) : [];

            // Find the first enabled caption/subtitle track
            const activeTrack = tracksArray.find(track =>
              track &&
              (track.kind === 'subtitles' || track.kind === 'captions') &&
              track.mode === 'showing'
            );

            if (activeTrack && activeTrack.label && captions[activeTrack.label]) {
              return activeTrack.label;
            }

            // Fallback to first available subtitle language
            return Object.keys(captions)[0] || '';
          })()}
          mediaType={adminProps.mediaType}
          mediaTitle={adminProps.mediaTitle}
          seasonNumber={adminProps.season_number}
          episodeNumber={adminProps.episode_number}
          onSave={async (content) => {
            try {
              // Get the current subtitle track info and convert to array
              const textTracks = player?.textTracks;
              // Convert TextTrackList to array to use array methods
              const tracksArray = textTracks ? Array.from(textTracks) : [];
              
              // Find the first enabled caption/subtitle track
              const activeTrack = tracksArray.find(track => 
                track && 
                (track.kind === 'subtitles' || track.kind === 'captions') && 
                track.mode === 'showing'
              );
              
              if (!activeTrack) return;
              
              const language = activeTrack.label || '';
              
              // Extract media info from the URL structure
              if (!activeTrack.src) return;
              const url = new URL(activeTrack.src);
              const params = new URLSearchParams(url.search);
              const mediaTitle = params.get('name') || adminProps.mediaTitle;
              const mediaType = params.get('type') || adminProps.mediaType;
              const season = params.get('season') || adminProps.season_number?.toString();
              const episode = params.get('episode') || adminProps.episode_number?.toString();
              
              // Extract sourceServerId from captions data structure
              let sourceServerId = ''; 
              if (captions) {
                // Find the caption entry matching the current language
                const captionEntry = Object.entries(captions).find(
                  ([lang, data]) => lang === language
                );
                
                if (captionEntry && captionEntry[1]) {
                  // Extract the sourceServerId if it exists
                  sourceServerId = captionEntry[1].sourceServerId || '';
                  console.log(`Using sourceServerId: ${sourceServerId} for language: ${language}`);
                }
              }
              
              // Save the edited subtitles
              const response = await fetch('/api/authenticated/admin/subtitles/save', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  subtitleContent: content,
                  mediaType,
                  mediaTitle,
                  language,
                  season,
                  episode,
                  sourceServerId
                }),
              });
              
              if (response.ok) {
                // Reload the current subtitle track
                const trackSrc = activeTrack.src;
                if (!trackSrc) return;
                
                // Add a timestamp to force reload
                const refreshedSrc = `${trackSrc}${trackSrc.includes('?') ? '&' : '?'}_t=${Date.now()}`;
                
                // This would ideally update the track, but we might need to reload the page
                // to see the changes depending on how the player handles track updates
                alert('Subtitles saved successfully! You may need to reload the page to see the changes.');
              } else {
                alert('Failed to save subtitles.');
              }
            } catch (error) {
              console.error('Error saving subtitles:', error);
              alert('An error occurred while saving subtitles.');
            }
          }}
          currentTime={player?.state.currentTime || 0}
          duration={player?.state.duration || 0}
        />
      )}
    </>
  )
}

export function Gestures() {
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

export function GesturesNoFullscreen() {
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
