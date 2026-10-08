'use client'

import { Menu } from './videojs'

import { buttonClass, ButtonTooltip } from './buttons'
import ChaptersMenu from './chapter/chapters'
import { classNames } from '@src/utils'
import { DrawerClose, DrawerTitle, drawerClass, listClass, pageClass, useDrawer } from './drawer'

function ChaptersIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v1A1.5 1.5 0 0 1 18.5 8h-13A1.5 1.5 0 0 1 4 6.5v-1Zm0 6A1.5 1.5 0 0 1 5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 12.5v-1Zm1.5 4.5A1.5 1.5 0 0 0 4 17.5v1A1.5 1.5 0 0 0 5.5 20h7a1.5 1.5 0 0 0 1.5-1.5v-1a1.5 1.5 0 0 0-1.5-1.5h-7Z" />
    </svg>
  )
}

/** The Chapters drawer (drawer.js): one page, the chapter list. */
export function Chapters({ tooltipSide = 'top', chapterThumbnailURL }) {
  const { onOpenChange, setPopup, style } = useDrawer()

  return (
    <Menu.Root side="top" align="end" onOpenChange={onOpenChange}>
      <ButtonTooltip label="Chapters" side={tooltipSide}>
        <Menu.Trigger aria-label="Chapters" className={buttonClass}>
          <ChaptersIcon className="h-8 w-8" />
        </Menu.Trigger>
      </ButtonTooltip>
      <Menu.Popup ref={setPopup} className={drawerClass} style={style}>
        <Menu.Content className={classNames(pageClass, 'relative')}>
          <DrawerTitle>Chapters</DrawerTitle>
          <div className={listClass}>
            <ChaptersMenu chapterThumbnailURL={chapterThumbnailURL} />
          </div>
          <DrawerClose label="Close chapters" />
        </Menu.Content>
      </Menu.Popup>
    </Menu.Root>
  )
}
