'use client'

import { Player, TimeSlider, VolumeSlider, Slider } from './videojs'

// The framework writes slider CSS vars as ready-made percentage strings
// (e.g. --media-slider-fill: "45.000%"), so they're used directly.
const thumbClass =
  'absolute left-[var(--media-slider-fill)] top-1/2 z-20 h-[15px] w-[15px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#cacaca] bg-white opacity-0 ring-white/40 transition-opacity group-data-[interactive]:opacity-100 group-data-[dragging]:ring-4 will-change-[left]'

export function Volume() {
  return (
    <VolumeSlider.Root className="volume-slider group relative mx-[7.5px] inline-flex h-10 w-full max-w-[80px] cursor-pointer touch-none select-none items-center outline-none">
      <VolumeSlider.Track className="relative z-0 h-[5px] w-full rounded-sm bg-white/30">
        <VolumeSlider.Fill className="absolute h-full w-[var(--media-slider-fill)] rounded-sm bg-blue-300 will-change-[width]" />
      </VolumeSlider.Track>
      <VolumeSlider.Preview className="pointer-events-none flex flex-col items-center opacity-0 transition-opacity duration-200 group-data-[interactive]:opacity-100">
        <VolumeSlider.Value className="rounded-sm bg-black px-2 py-px text-[13px] font-medium" />
      </VolumeSlider.Preview>
      <VolumeSlider.Thumb className={thumbClass} />
    </VolumeSlider.Root>
  )
}

/**
 * Thin divider ticks at chapter boundaries. The framework's TimeSlider has no
 * chapter segmentation (unlike vidstack), so boundaries are painted as an
 * overlay derived from the chapters text track.
 */
function ChapterTicks() {
  const cues = Player.usePlayer((s) => s.chaptersCues)
  const duration = Player.usePlayer((s) => s.duration)
  if (!cues?.length || !duration) return null
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {cues.slice(1).map((cue) => (
        <div
          key={cue.startTime}
          className="absolute top-1/2 h-[5px] w-[2.5px] -translate-y-1/2 bg-black/60"
          style={{ left: `${(cue.startTime / duration) * 100}%` }}
        />
      ))}
    </div>
  )
}

/** Chapter title for the pointed-at position, rendered via the slider's own pointer value. */
function ChapterPointerTitle() {
  const cues = Player.usePlayer((s) => s.chaptersCues)
  if (!cues?.length) return null
  return (
    <TimeSlider.Value
      type="pointer"
      format={(seconds) =>
        cues.find((cue) => seconds >= cue.startTime && seconds < cue.endTime)?.text ?? ''
      }
      className="mt-2 text-sm"
    />
  )
}

export function Time({ hasThumbnails }) {
  return (
    <TimeSlider.Root className="time-slider group relative mx-[7.5px] inline-flex h-10 w-full cursor-pointer touch-none select-none items-center outline-none">
      <TimeSlider.Track className="relative z-0 h-[5px] w-full overflow-hidden rounded-sm bg-white/30">
        <TimeSlider.Buffer className="absolute h-full w-[var(--media-slider-buffer)] rounded-sm bg-white/50 will-change-[width]" />
        <TimeSlider.Fill className="absolute z-10 h-full w-[var(--media-slider-fill)] rounded-sm bg-red-500 will-change-[width]" />
      </TimeSlider.Track>
      <ChapterTicks />
      <TimeSlider.Thumb className={thumbClass} />
      <TimeSlider.Preview
        overflow="clamp"
        className="pointer-events-none flex flex-col items-center opacity-0 transition-opacity duration-200 group-data-[pointing]:opacity-100"
      >
        {hasThumbnails ? (
          // Reads the sprite VTT from the media's kind="metadata" label="thumbnails"
          // track automatically (parses #xywh media fragments).
          <Slider.Thumbnail className="block max-h-[160px] min-h-[80px] min-w-[120px] max-w-[180px] overflow-hidden border border-white bg-black" />
        ) : null}
        <ChapterPointerTitle />
        <TimeSlider.Value type="pointer" className="text-[13px]" />
      </TimeSlider.Preview>
    </TimeSlider.Root>
  )
}
