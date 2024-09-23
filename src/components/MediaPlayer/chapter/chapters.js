'use client'
import { Menu, RadioGroup, useChapterOptions, useChapterTitle } from '@vidstack/react'
import { memo, useEffect } from 'react'
import Loading from '@src/app/loading'
import RenderChapter from './renderChapter'

const ChaptersMenu = ({ chapterThumbnailURL }) => {
  const options = useChapterOptions(),
    chapterTitle = useChapterTitle()

  return (
    <Menu.Root className="w-full">
      <span className="w-full text-center text-gray-200 my-3">Chapters</span>
      <Menu.RadioGroup
        value={options.selectedValue}
        className="vds-chapters-radio-group vds-radio-group"
        data-thumbnails
      >
        {/* <RadioGroup.Root key={thumbnailURL}> */}
        {options.length > 0 ? (
          options.map((chapterProps) => (
            <RenderChapter
              key={chapterProps.value}
              cue={chapterProps.cue}
              label={chapterProps.label}
              value={chapterProps.value}
              startTimeText={chapterProps.startTimeText}
              durationText={chapterProps.durationText}
              select={chapterProps.select}
              setProgressVar={chapterProps.setProgressVar}
              chapterTitle={chapterTitle}
              chapterThumbnailURL={chapterThumbnailURL}
            />
          ))
        ) : (
          <Loading fullscreenClasses={''} />
        )}
        {/* </RadioGroup.Root> */}
      </Menu.RadioGroup>
    </Menu.Root>
  )
}

export default ChaptersMenu
