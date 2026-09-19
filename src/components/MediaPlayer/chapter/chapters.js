'use client'

import { Player } from './../videojs'
import Loading from '@src/app/loading'
import RenderChapter from './renderChapter'

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

const ChaptersMenu = ({ chapterThumbnailURL }) => {
  const cues = Player.usePlayer((s) => s.chaptersCues)
  const currentTime = Player.usePlayer((s) => s.currentTime)
  const store = Player.usePlayer()

  return (
    <div className="w-full">
      <span className="my-3 block w-full text-center text-gray-200">Chapters</span>
      <div className="flex w-full flex-col gap-1" role="group">
        {cues?.length > 0 ? (
          cues.map((cue) => (
            <RenderChapter
              key={cue.startTime}
              label={cue.text}
              startTimeText={formatTime(cue.startTime)}
              durationText={formatTime(cue.endTime - cue.startTime)}
              isActive={currentTime >= cue.startTime && currentTime < cue.endTime}
              onSelect={() => store.seek(cue.startTime)}
              chapterThumbnailURL={chapterThumbnailURL}
            />
          ))
        ) : (
          <Loading fullscreenClasses={''} />
        )}
      </div>
    </div>
  )
}

export default ChaptersMenu
