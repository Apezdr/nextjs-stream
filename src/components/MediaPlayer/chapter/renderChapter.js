'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Menu } from './../videojs'
import { classNames } from '@src/utils'

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

const RenderChapter = ({
  label,
  startTimeText,
  durationText,
  isActive,
  onSelect,
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
    <Menu.Item
      onClick={onSelect}
      className={classNames(
        'flex w-full max-w-[91vw] cursor-pointer select-none items-center gap-3 rounded-sm p-2 outline-none ring-blue-400 hover:bg-white/10 focus-visible:ring-[3px] data-[highlighted]:bg-white/10',
        isActive ? 'bg-white/15' : ''
      )}
    >
      {chapterThumbnailURL && (
        <Image
          // Remounted on the switch so the failed load's state is not carried over.
          key={useSourceURL ? 'source' : 'optimized'}
          className="h-[52px] w-[92px] shrink-0 rounded-sm border border-white/20 object-cover"
          src={`${chapterThumbnailURL}${convertTimeFormat(startTimeText)}`}
          alt="Chapter Thumbnail"
          // The rendered box, so the optimizer is asked for 96 px (1x) and
          // 256 px (2x) rather than a size nothing displays.
          width={92}
          height={52}
          unoptimized={useSourceURL}
          onError={() => setUseSourceURL(true)}
        />
      )}
      <div className="flex min-w-0 flex-col text-left">
        <span className="truncate text-sm font-medium text-white">{label}</span>
        <span className="text-xs text-red-400">{startTimeText}</span>
        <span className="text-xs text-white/50">{durationText}</span>
      </div>
    </Menu.Item>
  )
}

export default RenderChapter
