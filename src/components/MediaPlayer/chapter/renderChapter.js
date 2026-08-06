'use client'

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
          className="h-[52px] w-[92px] shrink-0 rounded-sm border border-white/20 object-cover"
          src={`${chapterThumbnailURL}${convertTimeFormat(startTimeText)}`}
          alt="Chapter Thumbnail"
          width={160}
          height={90}
          unoptimized
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
