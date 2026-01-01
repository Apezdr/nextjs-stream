'use client'

import SubtitleEditorLayout from './Layout/SubtitleEditorLayout'

export default function SubtitleEditor({
  isOpen,
  onClose,
  videoRef,
  subtitleUrl,
  onSave,
  currentTime,
  duration,
  videoURL,
  initialTime = 0,
  availableSubtitles = {},
  selectedSubtitleLanguage = '',
  mediaType = '',
  mediaTitle = '',
  seasonNumber = null,
  episodeNumber = null
}) {
  if (!isOpen) return null;
  
  return (
    <SubtitleEditorLayout
      isOpen={isOpen}
      onClose={onClose}
      videoRef={videoRef}
      subtitleUrl={subtitleUrl}
      onSave={onSave}
      currentTime={currentTime}
      duration={duration}
      videoURL={videoURL}
      initialTime={initialTime}
      availableSubtitles={availableSubtitles}
      selectedSubtitleLanguage={selectedSubtitleLanguage}
      mediaType={mediaType}
      mediaTitle={mediaTitle}
      seasonNumber={seasonNumber}
      episodeNumber={episodeNumber}
    />
  );
}
