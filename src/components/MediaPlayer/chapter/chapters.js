'use client'

import { useCallback, useRef, useSyncExternalStore } from 'react'
import { Player, Menu } from './../videojs'
import Loading from '@src/app/loading'
import RenderChapter from './renderChapter'
import { classNames } from '@src/utils'
import { staggerClass } from '../drawer'

function formatTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(h > 0 ? 2 : 1, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

// HTMLTrackElement.readyState once its file failed to load.
const TRACK_ERROR = 3

/**
 * Whether the chapters <track> has failed to load. The Chapters button shows
 * whenever the title has a chapter URL, and PlayerMedia retries a failed load
 * a few times, so without this a missing file (a 404) left the drawer spinning
 * forever. `error` and `load` don't bubble from a <track>, but a capture
 * listener on the media element still sees them, including each retry's.
 */
function useChapterTrackFailed() {
  const media = Player.useMedia()
  const subscribe = useCallback(
    (onChange) => {
      if (!media?.addEventListener) return () => {}
      media.addEventListener('error', onChange, true)
      media.addEventListener('load', onChange, true)
      return () => {
        media.removeEventListener('error', onChange, true)
        media.removeEventListener('load', onChange, true)
      }
    },
    [media]
  )
  return useSyncExternalStore(
    subscribe,
    () => media?.querySelector?.('track[kind="chapters"]')?.readyState === TRACK_ERROR,
    () => false
  )
}

/**
 * The chapter list, as a radio group whose checked value is the chapter now
 * playing: that is its meaning for assistive tech, and the menu focuses the
 * playing chapter when the drawer opens, as it focuses the selected option on
 * a settings page. Picking another chapter seeks through the group's value
 * change (mouse and keyboard alike); picking the playing one, which is no
 * change, restarts it through its own click, as it always has.
 *
 * The menu focuses without scrolling, so the list is scrolled to the playing
 * chapter once per opening. It sets the list's own scrollTop rather than
 * calling scrollIntoView, which would also scroll the page behind the drawer
 * while it slides in.
 */
const ChaptersMenu = ({ chapterThumbnailURL }) => {
  const cues = Player.usePlayer((s) => s.chaptersCues)
  const currentTime = Player.usePlayer((s) => s.currentTime)
  const duration = Player.usePlayer((s) => s.duration)
  const store = Player.usePlayer()
  const failed = useChapterTrackFailed()
  // Once per opening: this component mounts with the drawer's page.
  const scrolled = useRef(false)
  const centerPlaying = (row) => {
    if (!row || scrolled.current) return
    const list = row.closest('.drawer-list')
    if (!list) return
    scrolled.current = true
    list.scrollTop = row.offsetTop - list.offsetTop - (list.clientHeight - row.offsetHeight) / 2
  }

  if (!(cues?.length > 0)) {
    if (failed) {
      return <p className="px-3 py-4 text-sm text-white/60">Chapters aren’t available for this title right now.</p>
    }
    return <Loading fullscreenClasses={''} />
  }

  // A chapter file's last cue can end where it starts (A Serious Man's does),
  // which would leave the last chapter never playing; it runs to the end.
  const endOf = (cue) => (cue.endTime > cue.startTime ? cue.endTime : duration || Infinity)
  const active = cues.find((cue) => currentTime >= cue.startTime && currentTime < endOf(cue))

  return (
    <Menu.RadioGroup
      aria-label="Chapters"
      className={classNames(staggerClass, 'flex flex-col gap-0.5')}
      value={active ? String(active.startTime) : ''}
      onValueChange={(next) => store.seek(Number(next))}
    >
      {cues.map((cue) => (
        <RenderChapter
          key={cue.startTime}
          value={String(cue.startTime)}
          label={cue.text}
          startTimeText={formatTime(cue.startTime)}
          durationText={Number.isFinite(endOf(cue)) ? formatTime(endOf(cue) - cue.startTime) : null}
          isActive={cue === active}
          progress={cue === active ? (currentTime - cue.startTime) / (endOf(cue) - cue.startTime) : 0}
          onRestart={cue === active ? () => store.seek(cue.startTime) : undefined}
          rowRef={cue === active ? centerPlaying : undefined}
          chapterThumbnailURL={chapterThumbnailURL}
        />
      ))}
    </Menu.RadioGroup>
  )
}

export default ChaptersMenu
