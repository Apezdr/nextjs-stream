'use client'
import { Menu, Thumbnail } from '@vidstack/react'
import { useCallback } from 'react'

const RenderChapter = ({
  cue,
  label,
  value,
  startTimeText,
  durationText,
  select,
  setProgressVar,
  thumbnailURL,
}) => {
  const handleSelect = useCallback(() => {
    select(value)
  }, [select, value])

  return (
    <Menu.Radio
      className="vds-chapter-radio vds-radio"
      value={value}
      key={value}
      onSelect={handleSelect}
      ref={setProgressVar}
    >
      <Thumbnail.Root className="vds-thumbnail" src={thumbnailURL} time={parseInt(cue.startTime)}>
        <Thumbnail.Img aria-hidden="false" />
      </Thumbnail.Root>
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
    </Menu.Radio>
  )
}

export default RenderChapter
