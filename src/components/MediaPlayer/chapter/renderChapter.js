'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Menu } from './../videojs'
import { classNames } from '@src/utils'
import { Pill, rowClass } from '../drawer'

// The frame endpoint expects a zero-padded HH:MM:SS path segment.
function convertTimeFormat(startTimeText) {
  const parts = startTimeText.split(':')
  let hours, minutes, seconds

  if (parts.length === 3) {
    ;[hours, minutes, seconds] = parts
  } else if (parts.length === 2) {
    hours = '00'
    ;[minutes, seconds] = parts
  } else {
    return '00:00:00' // Invalid input
  }

  hours = hours.padStart(2, '0')
  minutes = minutes.padStart(2, '0')
  seconds = seconds.padStart(2, '0')

  return `${hours}:${minutes}:${seconds}`
}

/** One chapter row in the drawer: its frame, name, and start · duration. */
const RenderChapter = ({
  value,
  label,
  startTimeText,
  durationText,
  isActive,
  progress = 0,
  onRestart,
  rowRef,
  chapterThumbnailURL,
}) => {
  // The frame goes through the image optimizer like every other image
  // (/_next/image → imgproxy when configured). The optimizer only waits a few
  // seconds for its source, and a frame nobody has asked for before is cut
  // from the video on request, which took 2–3.5 s for a single frame in
  // production and takes longer when a menu of them is opened at once. So a
  // failed optimizer request falls back to the frame's own URL, which waits
  // for as long as the cut takes.
  const [useSourceURL, setUseSourceURL] = useState(false)

  return (
    <Menu.RadioItem
      ref={rowRef}
      value={value}
      onClick={onRestart}
      className={classNames(rowClass, 'aria-[checked=true]:bg-white/[0.06]')}
    >
      {chapterThumbnailURL && (
        <span className="relative shrink-0 overflow-hidden rounded-lg border border-white/15">
          <Image
            // Remounted on the switch so the failed load's state is not carried over.
            key={useSourceURL ? 'source' : 'optimized'}
            className="block h-[52px] w-[92px] object-cover"
            src={`${chapterThumbnailURL}${convertTimeFormat(startTimeText)}`}
            alt="Chapter Thumbnail"
            // The rendered box, so the optimizer is asked for 96 px (1x) and
            // 256 px (2x) rather than a size nothing displays.
            width={92}
            height={52}
            unoptimized={useSourceURL}
            onError={() => setUseSourceURL(true)}
          />
          {/* How far into the playing chapter, along the frame's bottom edge. */}
          {isActive && (
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-black/50">
              <span
                className="block h-full bg-red-500"
                style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
              />
            </span>
          )}
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold leading-snug">
          <span className="truncate">{label}</span>
          {isActive && <Pill>Playing</Pill>}
        </span>
        <span className="text-[13px] tabular-nums text-white/60">
          {startTimeText}
          {durationText ? ` · ${durationText}` : null}
        </span>
      </span>
    </Menu.RadioItem>
  )
}

export default RenderChapter
