'use client'
import { Menu, useChapterOptions } from '@vidstack/react'
import { memo } from 'react'
import Loading from '@src/app/loading'
import RenderChapter from './renderChapter'

const ChaptersMenu = memo(({ thumbnailURL }) => {
  const options = useChapterOptions()

  return (
    <Menu.Root>
      <span className="w-full text-center text-gray-200 my-3">Chapters</span>
      <Menu.RadioGroup
        value={options.selectedValue}
        className="vds-chapters-radio-group vds-radio-group"
        data-thumbnails
      >
        {options.length > 0 ? (
          options.map((chapterProps) => (
            <RenderChapter key={chapterProps.value} {...chapterProps} thumbnailURL={thumbnailURL} />
          ))
        ) : (
          <Loading fullscreenClasses={''} />
        )}
      </Menu.RadioGroup>
    </Menu.Root>
  )
})

ChaptersMenu.displayName = 'ChaptersMenu'

export default ChaptersMenu
