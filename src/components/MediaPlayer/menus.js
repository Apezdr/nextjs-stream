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
  ChevronIcon,
} from './videojs'

import { buttonClass, ButtonTooltip } from './buttons'
import { classNames } from '@src/utils'
import { useAutoCaptionsProgress } from './AutoCaptionsProgressContext'
import ChaptersMenu from './chapter/chapters'

export const menuClass =
  'z-30 flex max-h-[60vh] min-w-[260px] flex-col overflow-y-auto overscroll-y-contain rounded-md border border-white/10 bg-black/95 p-2.5 font-sans text-[15px] font-medium text-white outline-none backdrop-blur-sm opacity-0 transition-opacity duration-150 data-[open]:opacity-100'

const submenuTriggerClass =
  'z-10 flex w-full cursor-pointer select-none items-center justify-start rounded-sm bg-black/60 p-2.5 outline-none ring-inset ring-blue-400 hover:bg-white/10 focus-visible:ring-[3px]'

const radioClass =
  'group relative flex w-full cursor-pointer select-none items-center justify-start rounded-sm p-2.5 outline-none ring-blue-400 hover:bg-white/10 focus-visible:ring-[3px] data-[highlighted]:bg-white/10'

export function Settings({ side = 'top', align = 'end', tooltipSide = 'top', hasCaptions }) {
  const audioOptions = useAudioTrackOptions()
  const qualityOptions = useQualityOptions()

  // Quality options include the synthetic Auto entry, so "more than one real
  // rendition" means more than two options total.
  const shouldShowSettingsButton =
    hasCaptions ||
    (audioOptions?.options?.length ?? 0) > 0 ||
    (qualityOptions?.options?.length ?? 0) > 2

  if (!shouldShowSettingsButton) return null

  return (
    <Menu.Root side={side} align={align}>
      <ButtonTooltip label="Settings" side={tooltipSide}>
        <Menu.Trigger className={classNames(buttonClass, 'group')}>
          <GearIcon className="h-8 w-8 transform transition-transform duration-200 ease-out group-data-[open]:rotate-90" />
        </Menu.Trigger>
      </ButtonTooltip>
      <Menu.Content className={menuClass}>
        <Menu.View>
          {hasCaptions && <CaptionSubmenu />}
          <AudioSubmenu />
          <QualitySubmenu />
        </Menu.View>
      </Menu.Content>
    </Menu.Root>
  )
}

function ChaptersIcon({ className }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v1A1.5 1.5 0 0 1 18.5 8h-13A1.5 1.5 0 0 1 4 6.5v-1Zm0 6A1.5 1.5 0 0 1 5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v1a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 12.5v-1Zm1.5 4.5A1.5 1.5 0 0 0 4 17.5v1A1.5 1.5 0 0 0 5.5 20h7a1.5 1.5 0 0 0 1.5-1.5v-1a1.5 1.5 0 0 0-1.5-1.5h-7Z" />
    </svg>
  )
}

export function Chapters({ side = 'top', align = 'end', tooltipSide = 'top', chapterThumbnailURL }) {
  return (
    <Menu.Root side={side} align={align}>
      <ButtonTooltip label="Chapters" side={tooltipSide}>
        <Menu.Trigger className={buttonClass}>
          <ChaptersIcon className="h-8 w-8" />
        </Menu.Trigger>
      </ButtonTooltip>
      <Menu.Content className={classNames(menuClass, 'max-w-[91vw]')}>
        <ChaptersMenu chapterThumbnailURL={chapterThumbnailURL} />
      </Menu.Content>
    </Menu.Root>
  )
}

const qualityLabelMap = {
  undefinedp: 'Loading',
  '240p': 'Low',
  '360p': 'Medium',
  '480p': 'High',
  '534p': '720p',
  '720p': 'HD',
  '800p': '1080p',
  '1080p': 'Full HD',
  '1440p': '2K',
  '1600p': '4K',
  '2160p': '4K',
}

function formatBitrate(bitrate) {
  if (!bitrate) return null
  const mbps = bitrate / 1_000_000
  return Number.isInteger(mbps) ? String(mbps) : mbps.toFixed(1)
}

function QualitySubmenu() {
  const options = useQualityOptions()
  const renditions = Player.usePlayer((s) => s.videoRenditionList)
  const activeRendition = Player.usePlayer((s) => s.activeVideoRendition)

  if (!options || options.options.length <= 1) return null

  const isAuto = options.value === 'auto'
  const currentText = activeRendition?.height ? `${activeRendition.height}p` : ''
  const hint = isAuto
    ? `(${qualityLabelMap[currentText] ?? currentText}${
        activeRendition?.bitrate ? `@${formatBitrate(activeRendition.bitrate)} Mbps` : ''
      })`
    : (qualityLabelMap[currentText] ?? currentText)

  // Bitrate badge lookup: match a rendition by its height label. JIT ladder
  // rung heights are distinct, so height is a reliable key here.
  const bitrateForLabel = (label) => {
    const height = parseInt(label, 10)
    if (Number.isNaN(height)) return null
    return formatBitrate(renditions?.find((r) => r.height === height)?.bitrate)
  }

  return (
    <Submenu label="Quality" hint={hint} hintPrefix={isAuto ? 'Auto ' : ''} icon={QualityIcon}>
      <Menu.RadioGroup
        className="flex w-full flex-col rounded-xl bg-gray-600"
        value={options.value}
        onValueChange={options.setValue}
      >
        {options.options.map((option) => {
          const label = String(option.label)
          const bitrate = option.value === 'auto' ? null : bitrateForLabel(label)
          return (
            <Radio value={option.value} key={option.value}>
              <span className="text-sm font-medium text-white">
                {qualityLabelMap[label] ?? label}
              </span>
              {bitrate && (
                <span className="absolute right-1 ml-auto inline-flex items-center overflow-hidden rounded-xl text-center font-mono shadow-lg">
                  <span className="bg-black/70 py-0.5 pl-2 pr-1 text-xs font-bold text-white drop-shadow-lg">
                    {bitrate}
                  </span>
                  <span className="bg-black/40 px-1 py-0.5 text-[10px] text-gray-300">Mbps</span>
                </span>
              )}
            </Radio>
          )
        })}
      </Menu.RadioGroup>
    </Submenu>
  )
}

function AudioSubmenu() {
  const options = useAudioTrackOptions()
  if (!options || options.options.length === 0) return null

  const hint = String(options.options.find((o) => o.value === options.value)?.label ?? '')

  return (
    <Submenu label="Audio" hint={hint} icon={SwitchesIcon}>
      <Menu.RadioGroup
        className="flex w-full flex-col rounded-xl bg-gray-600"
        value={options.value}
        onValueChange={options.setValue}
      >
        {options.options.map((option) => (
          <Radio value={option.value} key={option.value}>
            {String(option.label)}
          </Radio>
        ))}
      </Menu.RadioGroup>
    </Submenu>
  )
}

// Auto-generated caption rows carry the " - Auto Generated" suffix from the
// processor's caption-stubs convention. Match against the label rather than
// any track-level metadata since the menu option doesn't expose our flag.
const AUTO_LABEL_RE = / - Auto Generated$/i

function CaptionSubmenu() {
  const options = useCaptionsOptions()
  const { progress } = useAutoCaptionsProgress()

  if (!options) return null

  const selectedOption = options.options.find((o) => o.value === options.value)
  const selectedLabel =
    selectedOption && selectedOption.value !== 'off' ? String(selectedOption.label) : null
  const selectedProgress = selectedLabel ? progress[selectedLabel] : null
  const isSelectedGenerating = selectedProgress?.status === 'running'

  // Pin rows Off → auto-generated → human captions, stable within each group,
  // regardless of the underlying textTrackList order.
  const sortedOptions = [
    ...options.options.filter((o) => o.value === 'off'),
    ...options.options.filter((o) => o.value !== 'off' && AUTO_LABEL_RE.test(String(o.label))),
    ...options.options.filter((o) => o.value !== 'off' && !AUTO_LABEL_RE.test(String(o.label))),
  ]

  const hint = isSelectedGenerating ? (
    <span className="inline-flex items-center gap-1.5">
      <span className="truncate">{selectedLabel}</span>
      <CaptionsSpinner />
    </span>
  ) : (
    (selectedLabel ?? 'Off')
  )

  return (
    <Submenu label="Captions" hint={hint} icon={SpeechIcon}>
      <Menu.RadioGroup
        className="flex w-full flex-col rounded-xl bg-gray-600"
        value={options.value}
        onValueChange={options.setValue}
      >
        {sortedOptions.map((option) => {
          const label = String(option.label)
          const p = progress[label]
          const displayLabel =
            p?.status === 'running'
              ? typeof p.progressPct === 'number'
                ? `${label} — Generating… ${Math.round(p.progressPct * 100)}%`
                : `${label} — Generating…`
              : label
          return (
            <Radio value={option.value} key={option.value}>
              {displayLabel}
            </Radio>
          )
        })}
      </Menu.RadioGroup>
    </Submenu>
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

function Radio({ children, value, disabled }) {
  return (
    <Menu.RadioItem value={value} disabled={disabled} className={radioClass}>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-white/70">
        <span className="hidden h-2 w-2 rounded-full bg-blue-400 group-aria-[checked=true]:block" />
      </span>
      <span className="ml-2 flex">{children}</span>
    </Menu.RadioItem>
  )
}

function Submenu({ label, hint, hintPrefix = '', icon: Icon, disabled, children }) {
  return (
    <Menu.Root>
      <Menu.Trigger className={classNames(submenuTriggerClass, 'group')} disabled={disabled}>
        <Icon className="h-5 w-5" />
        <span className="ml-1.5">{label}</span>
        <span className="ml-auto flex items-center gap-1 text-sm text-white/50">
          {hintPrefix ? <span>{hintPrefix}</span> : null}
          {hint}
        </span>
        <ChevronIcon className="ml-0.5 h-[18px] w-[18px] -rotate-90 text-white/50" />
      </Menu.Trigger>
      <Menu.Content className="w-full outline-none">
        <Menu.Back className={classNames(submenuTriggerClass, 'mb-1.5')}>
          <ChevronIcon className="mr-1.5 h-[18px] w-[18px] rotate-90" />
          <span>{label}</span>
        </Menu.Back>
        {children}
      </Menu.Content>
    </Menu.Root>
  )
}
