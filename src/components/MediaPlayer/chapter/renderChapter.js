'use client'
import { RadioGroup } from '@vidstack/react'
import Image from 'next/image'
import { useCallback } from 'react'

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
  cue,
  label,
  value,
  startTimeText,
  durationText,
  select,
  setProgressVar,
  chapterThumbnailURL,
  chapterTitle,
}) => {
  const handleSelect = useCallback(() => {
    select(value)
  }, [select, value])

  return (
    <RadioGroup.Item
      className="vds-chapter-radio vds-radio max-w-[91vw]"
      value={value}
      key={value + chapterTitle}
      onSelect={handleSelect}
      ref={setProgressVar}
    >
      {chapterThumbnailURL && (
        <img
          className="vds-thumbnail"
          src={`${chapterThumbnailURL}${convertTimeFormat(startTimeText)}`}
          alt="Chapter Thumbnail"
        />
      )}
      <div className="vds-chapter-radio-content">
        <span className="vds-chapter-radio-label" data-part="label">
          {label}
        </span>
        <span className="vds-chapter-radio-start-time" data-part="start-time">
          {startTimeText}
        </span>
        <span className="vds-chapter-radio-duration" data-part="duration">
          {durationText}
        </span>
      </div>
    </RadioGroup.Item>
  )
}

export default RenderChapter
