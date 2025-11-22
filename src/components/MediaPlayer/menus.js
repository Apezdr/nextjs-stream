import {
  Menu,
  Thumbnail,
  Tooltip,
  useAudioOptions,
  useCaptionOptions,
  useChapterOptions,
  useMediaRemote,
  useMediaState,
  useVideoQualityOptions,
} from '@vidstack/react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  ChaptersIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClosedCaptionsIcon,
  OdometerIcon,
  RadioButtonIcon,
  RadioButtonSelectedIcon,
  SettingsIcon,
  SettingsMenuIcon,
} from '@vidstack/react/icons'

import { buttonClass, tooltipClass } from './buttons'
import { classNames } from '@src/utils'
import styles from './Layouts/video-layout.module.css'
import Image from 'next/image'
import Loading from '@src/app/loading'
import ChaptersMenu from './chapter/chapters'

export const menuClass =
  'animate-out fade-out slide-out-to-bottom-2 data-[open]:animate-in data-[open]:fade-in data-[open]:slide-in-from-bottom-4 flex h-[var(--menu-height)] max-h-[60vh] min-w-[260px] flex-col overflow-y-auto overscroll-y-contain rounded-md border border-white/10 bg-black/95 p-2.5 font-sans text-[15px] font-medium outline-none backdrop-blur-sm transition-[height] duration-300 will-change-[height] data-[resizing]:overflow-hidden'

export const submenuClass =
  'hidden w-full flex-col items-start justify-center outline-none data-[keyboard]:mt-[3px] data-[open]:inline-block'

export function Settings({ placement, tooltipPlacement, hasCaptions }) {
  let shouldShowSettingsButton = false
  const audioOptions = useAudioOptions()
  const qualityOptions = useVideoQualityOptions({ sort: 'descending' })
  if (hasCaptions || audioOptions.length > 0 || qualityOptions.length > 1) {
    shouldShowSettingsButton = true
  }

  return (
    shouldShowSettingsButton &&
    <Menu.Root className="parent">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Menu.Button className={buttonClass}>
            <SettingsIcon className="h-8 w-8 transform transition-transform duration-200 ease-out group-data-[open]:rotate-90" />
          </Menu.Button>
        </Tooltip.Trigger>
        <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
          Settings
        </Tooltip.Content>
      </Tooltip.Root>
      <Menu.Content className={menuClass} placement={placement}>
        {hasCaptions && (
          <CaptionSubmenu />
        )}
        <AudioSubmenu />
        <QualitySubmenu />
      </Menu.Content>
    </Menu.Root>
  )
}

export function Chapters({ placement, tooltipPlacement, chapterThumbnailURL }) {
  return (
    <Menu.Root className="parent">
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Menu.Button className={buttonClass}>
            <ChaptersIcon className="h-8 w-8 transform transition-transform duration-200 ease-out" />
          </Menu.Button>
        </Tooltip.Trigger>
        <Tooltip.Content className={tooltipClass} placement={tooltipPlacement}>
          Chapters
        </Tooltip.Content>
      </Tooltip.Root>
      <Menu.Content
        className={`vds-chapters-menu-items vds-menu-items sm:translate-x-0 !-translate-x-1/2 !left-1/2 sm:left-0 max-h-[60vh] bottom-1`}
        //placement={placement}
      >
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

function QualitySubmenu() {
  const options = useVideoQualityOptions({ sort: 'descending' }),
    autoQuality = useMediaState('autoQuality'),
    remote = useMediaRemote(),
    currentQualityText = options.selectedQuality?.height ? `${options.selectedQuality.height}p` : '',
    hint = !autoQuality
      ? currentQualityText
      : `(${qualityLabelMap[currentQualityText] ?? currentQualityText}${
          options.selectedQuality?.bitrate
            ? `@${options.selectedQuality.bitrate / 1000000} Mbps`
            : ''
        })`

  return (
    <Menu.Root>
      <SubmenuButton
        label="Quality"
        hint={qualityLabelMap[hint] ?? hint}
        disabled={options.disabled}
        icon={OdometerIcon}
        className={styles.videoquality}
        autoQuality={autoQuality}
      />

      <Menu.Content className="aria-hidden:hidden">
        <Menu.RadioGroup
          className="w-full flex flex-col bg-gray-600 rounded-xl"
          value={options.selectedValue}
        >
          {options.map(({ label, bitrateText, value, select }) => (
            <Radio value={value} onSelect={select} key={value}>
              <span className="text-sm text-white font-medium">
                {qualityLabelMap[label] ?? label}
              </span>
              {bitrateText && (
                <div
                  className={classNames(
                    styles.splitbg,
                    'ml-auto text-[8px] absolute right-1 w-18 rounded-xl text-center shadow-lg'
                  )}
                >
                  <span
                    className={classNames(
                      styles.splitleft,
                      'text-xs pl-2 pr-1 pb-[18px] text-white drop-shadow-lg font-bold font-mono h-[15px]'
                    )}
                  >
                    {Number.isInteger(parseFloat(bitrateText?.split(' ')[0]))
                      ? parseInt(bitrateText.split(' ')[0], 10)
                      : bitrateText.split(' ')[0]}
                  </span>
                  <span className={classNames(styles.splitright, 'px-1 text-gray-300 h-[15px]')}>
                    {bitrateText?.split(' ')[1]}
                  </span>
                </div>
              )}
            </Radio>
          ))}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Root>
  )
}

function AudioSubmenu() {
  const options = useAudioOptions(),
    hint = options.selectedTrack?.label
  return (
    <Menu.Root>
      <SubmenuButton
        label="Audio"
        hint={hint}
        disabled={options.disabled}
        icon={SettingsMenuIcon}
        className={styles.audio}
      />
      <Menu.Content className="aria-hidden:hidden">
        <Menu.RadioGroup
          className="w-full flex flex-col bg-gray-600 rounded-xl"
          value={options.selectedValue}
        >
          {options.map(({ label, value, select }) => (
            <Radio value={value} onSelect={select} key={value}>
              {label}
            </Radio>
          ))}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Root>
  )
}

function CaptionSubmenu() {
  const options = useCaptionOptions()

  const hint = options.selectedTrack?.label ?? 'Off'
  return (
    <Menu.Root>
      <SubmenuButton
        label="Captions"
        hint={hint}
        //disabled={options.disabled}
        icon={ClosedCaptionsIcon}
        className={styles.captions}
      />
      <Menu.Content className={submenuClass}>
        <Menu.RadioGroup
          className="w-full flex flex-col bg-gray-600 rounded-xl"
          value={options.selectedValue}
        >
          {options.map(({ label, value, select }) => (
            <Radio value={value} onSelect={select} key={value}>
              {label}
            </Radio>
          )) || <Radio value={''} key={'empty'}></Radio>}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Root>
  )
}

function Radio({ children, ...props }) {
  return (
    <Menu.Radio
      className={classNames(
        styles.radio,
        'ring-media-focus group relative flex w-full cursor-pointer select-none items-center justify-start rounded-sm p-2.5 outline-none data-[hocus]:bg-white/10 data-[focus]:ring-[3px]'
      )}
      {...props}
    >
      <RadioButtonIcon className="h-4 w-4 text-white group-data-[checked]:hidden" />
      <RadioButtonSelectedIcon className="text-media-brand hidden h-4 w-4 group-data-[checked]:block" />
      <span className="ml-2 flex">{children}</span>
    </Menu.Radio>
  )
}

function SubmenuButton({ label, hint, icon: Icon, disabled, className = '', autoQuality = false }) {
  return (
    <Menu.Button
      className={classNames(
        className,
        'ring-media-focus parent left-0 z-10 flex w-full cursor-pointer select-none items-center justify-start rounded-sm bg-black/60 p-2.5 outline-none ring-inset data-[open]:sticky data-[open]:-top-2.5 data-[hocus]:bg-white/10 data-[focus]:ring-[3px] aria-disabled:hidden'
      )}
      disabled={disabled}
    >
      <ChevronLeftIcon className="parent-data-[open]:block -ml-0.5 mr-1.5 hidden h-[18px] w-[18px]" />
      <div className="contents parent-data-[open]:hidden">
        <Icon className="w-5 h-5" />
      </div>
      <span className="ml-1.5 parent-data-[open]:ml-0">{label}</span>
      <span className="ml-auto text-sm text-white/50">
        {autoQuality ? <span className="ml-auto text-sm text-white/50 block">Auto</span> : null}
        {hint}
      </span>
      <ChevronRightIcon className="parent-data-[open]:hidden ml-0.5 h-[18px] w-[18px] text-sm text-white/50" />
    </Menu.Button>
  )
}
