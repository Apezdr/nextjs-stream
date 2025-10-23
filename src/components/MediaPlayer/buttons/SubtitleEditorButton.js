'use client'

import { forwardRef } from 'react'
import { Tooltip, useMediaState } from '@vidstack/react'
import { classNames } from '@src/utils'

export const SubtitleEditorButton = forwardRef(
  ({ className, tooltipPlacement = 'top', onEditSubtitles, ...props }, forwardedRef) => {
    // Check if subtitles are available
    const captionTrack = useMediaState('textTrack')
    const hasCaptions = !!captionTrack

    return (
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <button
            ref={forwardedRef}
            className={classNames(
              'group/subtitle-editor ring-media-focus relative overflow-hidden rounded-md focus:ring-4',
              className
            )}
            aria-label="Edit Subtitles"
            disabled={!hasCaptions}
            onClick={onEditSubtitles}
            type="button"
            {...props}
          >
            <SubtitleEditorButton.Icon />
          </button>
        </Tooltip.Trigger>
        <Tooltip.Content 
          className="animate-out fade-out slide-out-to-bottom-2 data-[opened]:animate-in data-[opened]:fade-in data-[opened]:slide-in-from-bottom-4 bg-black/90 text-white z-10 rounded-sm px-2 py-1 data-[opened]:data-[placement=top]:slide-in-from-bottom-2" 
          placement={tooltipPlacement}
        >
          <span className="block text-sm">Edit Subtitles</span>
        </Tooltip.Content>
      </Tooltip.Root>
    )
  }
)

SubtitleEditorButton.Icon = function SubtitleEditorButtonIcon({ className, ...props }) {
  return (
    <svg
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    className="size-6"
    viewBox="0 0 24 24"
    {...props}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"
    />
  </svg>
  )
}

SubtitleEditorButton.displayName = 'SubtitleEditorButton'

export default SubtitleEditorButton
