'use client'

import {
  Player,
  Menu,
  useAudioTrackOptions,
  useCaptionsOptions,
  useQualityOptions,
  GearIcon,
  QualityIcon,
  SwitchesIcon,
  SpeechIcon,
  SpeedIcon,
  ChevronIcon,
} from './videojs'

import { buttonClass, ButtonTooltip } from './buttons'
import { classNames } from '@src/utils'
import { useAutoCaptionsProgress } from './AutoCaptionsProgressContext'
import useRenditionTraits, { useAudioDefaults } from './useRenditionTraits'
import { audioTrackKey } from './renditionTraits'
import {
  DrawerClose,
  DrawerTitle,
  Pill,
  drawerClass,
  listClass,
  pageClass,
  rowClass,
  staggerClass,
  useDrawer,
} from './drawer'
import {
  PLAYBACK_RATES,
  activeQualityName,
  captionRow,
  languageName,
  qualityRows,
  rateLabel,
  sortCaptionOptions,
} from './settingsModel'

/**
 * The settings drawer (drawer.js): category rows (Quality, Audio, Captions,
 * Speed) that drill into their options.
 *
 * Drill-in comes from the menu itself: a submenu's Content is portaled into the
 * popup after the root Content, and while it is open the root Content carries
 * data-child-open. Both pages share the drawer's one grid cell and push past
 * each other on the menu's transition attributes (see pushClass).
 */

// The drill-in push, on the same transition contract as the drawer. A submenu
// page (also a Content) gets data-starting-style / data-ending-style as it
// enters and leaves, and the root page carries data-child-open while one is
// open, so the root slides a quarter left and fades as the submenu slides in
// over it from the right edge, and Back runs it in reverse. The root turns
// invisible once covered (visibility flips at the end of the transition), so
// focus can never land on rows nobody can see.
const pushClass =
  'transition-[transform,opacity,visibility] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-[opacity,visibility]'
const rootPageClass = classNames(
  pageClass,
  pushClass,
  'relative data-[child-open]:invisible data-[child-open]:-translate-x-1/4 data-[child-open]:opacity-0 motion-reduce:data-[child-open]:translate-x-0'
)
// Opaque, so the page arriving covers the one it pushes out.
const subPageClass = classNames(
  pageClass,
  pushClass,
  'bg-neutral-950 data-[ending-style]:translate-x-full data-[starting-style]:translate-x-full',
  'motion-reduce:data-[ending-style]:translate-x-0 motion-reduce:data-[ending-style]:opacity-0 motion-reduce:data-[starting-style]:translate-x-0 motion-reduce:data-[starting-style]:opacity-0'
)
const groupClass = classNames(staggerClass, 'flex flex-col gap-0.5')

export function Settings({ tooltipSide = 'top', hasCaptions, isCasting }) {
  const { open, onOpenChange, onOpenChangeComplete, setPopup, style, scrim } = useDrawer()

  const audioOptions = useAudioTrackOptions()
  const qualityOptions = useQualityOptions()
  const canSetRate = Player.usePlayer((s) => typeof s.setPlaybackRate === 'function')

  // A row only when it is a choice: Quality options include the synthetic Auto
  // entry, so two real rungs means three options; audio needs two tracks. The
  // Cast receiver does not take our playback rate, so Speed hides while casting.
  const showQuality = (qualityOptions?.options?.length ?? 0) > 2
  const showAudio = (audioOptions?.options?.length ?? 0) > 1
  const showCaptions = Boolean(hasCaptions)
  const showSpeed = canSetRate && !isCasting

  if (!showQuality && !showAudio && !showCaptions && !showSpeed) return null

  return (
    <>
      {scrim}
      <Menu.Root side="top" align="end" open={open} onOpenChange={onOpenChange} onOpenChangeComplete={onOpenChangeComplete}>
        <ButtonTooltip label="Settings" side={tooltipSide}>
          <Menu.Trigger aria-label="Settings" className={classNames(buttonClass, 'group')}>
            <GearIcon className="h-8 w-8 transform transition-transform duration-200 ease-out group-data-[open]:rotate-90" />
          </Menu.Trigger>
        </ButtonTooltip>
        <Menu.Popup ref={setPopup} className={drawerClass} style={style}>
          <Menu.Content className={rootPageClass}>
            <DrawerTitle>Settings</DrawerTitle>
            <div className={classNames(listClass, staggerClass)}>
              {showQuality && <QualityPage />}
              {showAudio && <AudioPage />}
              {showCaptions && <CaptionsPage />}
              {showSpeed && <SpeedPage />}
            </div>
            <DrawerClose label="Close settings" />
          </Menu.Content>
        </Menu.Popup>
      </Menu.Root>
    </>
  )
}

/**
 * One category: its row on the root page and the page it drills into. The
 * back row is an ordinary item, since selecting an item closes its own menu,
 * which for a submenu returns to the root page. Picking an option and
 * ArrowLeft do the same; Escape closes the whole panel and refocuses the gear.
 */
function Category({ label, value, icon: Icon, children }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={rowClass}>
        <Icon className="h-6 w-6 shrink-0 text-white/80" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[15px] font-semibold leading-snug">{label}</span>
          <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-white/60">{value}</span>
        </span>
        <ChevronIcon className="h-5 w-5 shrink-0 text-white/50" />
      </Menu.Trigger>
      <Menu.Content className={subPageClass}>
        <Menu.Item className="mx-2 mb-1 mt-2 flex cursor-pointer select-none items-center gap-2 rounded-xl px-3 py-2.5 text-lg font-semibold outline-none ring-inset ring-blue-400 hover:bg-white/10 focus-visible:bg-white/10 focus-visible:ring-2">
          <ChevronIcon className="h-5 w-5 rotate-180" />
          <span>{label}</span>
        </Menu.Item>
        <div className={listClass}>{children}</div>
      </Menu.Content>
    </Menu.Root>
  )
}

function OptionRow({ value, title, pills, detail }) {
  return (
    <Menu.RadioItem value={value} className={classNames(rowClass, 'aria-[checked=true]:bg-white/[0.06]')}>
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 border-white/60 group-aria-[checked=true]:border-blue-400">
        <span className="hidden h-2 w-2 rounded-full bg-blue-400 group-aria-[checked=true]:block" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-semibold leading-snug">
          <span className="truncate">{title}</span>
          {pills}
        </span>
        {detail ? <span className="truncate text-[13px] text-white/60">{detail}</span> : null}
      </span>
    </Menu.RadioItem>
  )
}

function QualityPage() {
  const options = useQualityOptions()
  const renditions = Player.usePlayer((s) => s.videoRenditionList)
  const activeRendition = Player.usePlayer((s) => s.activeVideoRendition)
  const traits = useRenditionTraits()

  if (!options) return null
  const isAuto = options.value === 'auto'
  const active = activeQualityName(options.options, activeRendition, traits)
  const rows = qualityRows(options.options, renditions, traits)
  const selected = rows.find((row) => row.value === options.value)
  const value = isAuto
    ? `Auto${active ? ` (${active})` : ''}`
    : [selected?.title, selected?.range].filter(Boolean).join(' ')

  return (
    <Category label="Quality" value={value} icon={QualityIcon}>
      <Menu.RadioGroup className={groupClass} value={options.value} onValueChange={options.setValue}>
        <OptionRow
          value="auto"
          title="Auto"
          detail={`Adjusts to your connection${isAuto && active ? ` · now ${active}` : ''}`}
        />
        {rows.map((row) => (
          <OptionRow
            key={row.value}
            value={row.value}
            title={row.title}
            pills={row.range ? <Pill tone="hdr">{row.range}</Pill> : null}
            detail={row.detail}
          />
        ))}
      </Menu.RadioGroup>
    </Category>
  )
}

function AudioPage() {
  const options = useAudioTrackOptions()
  const tracks = Player.usePlayer((s) => s.audioTrackList)
  const defaults = useAudioDefaults()

  if (!options) return null
  const trackFor = (option) => tracks?.find((t) => t.id === option.value)
  const value = String(options.options.find((o) => o.value === options.value)?.label ?? '')

  return (
    <Category label="Audio" value={value} icon={SwitchesIcon}>
      <Menu.RadioGroup className={groupClass} value={options.value} onValueChange={options.setValue}>
        {options.options.map((option) => {
          const track = trackFor(option)
          const label = String(option.label)
          return (
            <OptionRow
              key={option.value}
              value={option.value}
              title={label}
              pills={track && defaults.has(audioTrackKey(track)) ? <Pill>Default</Pill> : null}
              detail={languageName(track?.language, label)}
            />
          )
        })}
      </Menu.RadioGroup>
    </Category>
  )
}

function CaptionsPage() {
  const options = useCaptionsOptions()
  const { progress } = useAutoCaptionsProgress()

  if (!options) return null
  const selected = options.options.find((o) => o.value === options.value)
  const selectedLabel = selected && selected.value !== 'off' ? String(selected.label) : null
  const selectedRow = selectedLabel ? captionRow(selectedLabel, progress[selectedLabel]) : null
  const value = selectedRow ? (
    <>
      <span className="truncate">{selectedRow.title}</span>
      {selectedRow.generating && <CaptionsSpinner />}
    </>
  ) : (
    'Off'
  )

  return (
    <Category label="Captions" value={value} icon={SpeechIcon}>
      <Menu.RadioGroup className={groupClass} value={options.value} onValueChange={options.setValue}>
        {sortCaptionOptions(options.options).map((option) => {
          if (option.value === 'off') return <OptionRow key="off" value="off" title="Off" />
          const row = captionRow(String(option.label), progress[String(option.label)])
          return <OptionRow key={option.value} value={option.value} title={row.title} detail={row.detail} />
        })}
      </Menu.RadioGroup>
    </Category>
  )
}

function SpeedPage() {
  const rate = Player.usePlayer((s) => s.playbackRate)
  const setPlaybackRate = Player.usePlayer((s) => s.setPlaybackRate)

  return (
    <Category label="Speed" value={rateLabel(rate)} icon={SpeedIcon}>
      <Menu.RadioGroup
        className={groupClass}
        value={String(rate)}
        onValueChange={(next) => setPlaybackRate(Number(next))}
      >
        {PLAYBACK_RATES.map((r) => (
          <OptionRow key={r} value={String(r)} title={rateLabel(r)} />
        ))}
      </Menu.RadioGroup>
    </Category>
  )
}

function CaptionsSpinner() {
  return (
    <svg
      className="h-3 w-3 shrink-0 animate-spin text-white/70"
      fill="none"
      viewBox="0 0 24 24"
      aria-label="Generating captions"
      role="status"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  )
}
