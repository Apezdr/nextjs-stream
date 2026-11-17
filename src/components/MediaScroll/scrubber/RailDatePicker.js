'use client'

import { useState } from 'react'
import { Popover, PopoverBackdrop, PopoverButton, PopoverPanel } from '@headlessui/react'
import { CalendarDaysIcon, ChevronDownIcon, ChevronLeftIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { monthNames, positionOfDaysAgo } from './timeline'

const QUICK = [
  ['Today', () => 0],
  ['A week ago', (timeline) => positionOfDaysAgo(timeline, 7)],
  ['A month ago', (timeline) => positionOfDaysAgo(timeline, 30)],
  ['A year ago', (timeline) => positionOfDaysAgo(timeline, 365)],
  ['First watch', (timeline) => Math.max(0, timeline.total - 1)],
]
const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

// More watched, brighter: the same blue as the strip's bars
const heat = (count, peak) => ({ backgroundColor: `rgba(94, 139, 255, ${(0.12 + 0.78 * (count / peak)).toFixed(2)})` })
const cell =
  'grid place-items-center rounded border border-transparent text-white tabular-nums hover:border-white focus:outline-none focus-visible:border-white'
const empty = 'grid place-items-center text-[#4a5488] tabular-nums'

/** Every month as a cell, a row per year; a month takes the row there and opens its days. */
function Months({ timeline, first, onPick, onQuick }) {
  const names = monthNames()
  const peak = Math.max(1, ...timeline.months.map((month) => month.count))
  const years = [...new Set(timeline.months.map((month) => month.year))]
  const current = timeline.months.find((month) => month.count > 0 && first >= month.start && first < month.start + month.count)

  return (
    <>
      <div className="flex gap-1.5 pb-1 max-sm:overflow-x-auto sm:flex-wrap">
        {QUICK.map(([label, position]) => (
          <button
            key={label}
            type="button"
            onClick={() => onQuick(position(timeline))}
            className="flex-none whitespace-nowrap rounded-full border border-[#262e55] px-2.5 py-1 text-xs hover:border-blue-400 focus:outline-none focus-visible:border-blue-400 max-sm:px-3 max-sm:py-2 max-sm:text-sm"
          >
            {label}
          </button>
        ))}
      </div>
      {years.map((year) => (
        <div key={year} className="grid grid-cols-6 items-center gap-1 sm:grid-cols-[2.6rem_repeat(12,minmax(0,1fr))]">
          <span className="col-span-6 text-xs font-semibold tabular-nums sm:col-span-1">{year}</span>
          {names.map((name, monthNumber) => {
            const index = timeline.months.findIndex((month) => month.year === year && month.month === monthNumber)
            const month = timeline.months[index]
            if (!month || month.count === 0) {
              return (
                <span key={name} className={classNames(empty, 'h-10 text-sm sm:aspect-square sm:h-auto sm:text-[10px]')}>
                  {name}
                </span>
              )
            }
            return (
              <button
                key={name}
                type="button"
                onClick={() => onPick(index)}
                title={`${month.count} watched`}
                aria-label={`${name} ${year}, ${month.count} watched`}
                style={heat(month.count, peak)}
                className={classNames(cell, 'h-10 text-sm sm:aspect-square sm:h-auto sm:text-[10px]', month === current ? 'border-white' : '')}
              >
                {name}
              </button>
            )
          })}
        </div>
      ))}
      <p className="text-[11px] text-[#949cc4]">Brighter months have more in them. Pick one to go there, then choose a day if you like.</p>
    </>
  )
}

/** One month as a calendar; a day takes the row to that day's first title. */
function Days({ month, onPick, onBack }) {
  const names = monthNames(undefined, 'long')
  const peak = Math.max(1, ...month.days.map((day) => day.count))
  const byDay = new Map(month.days.map((day) => [day.day, day]))
  const lead = new Date(month.year, month.month, 1).getDay()
  const length = new Date(month.year, month.month + 1, 0).getDate()

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center rounded py-1 pr-2 text-sm font-medium text-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <ChevronLeftIcon className="h-4 w-4" aria-hidden="true" />
          Months
        </button>
        <strong className="text-[15px]">
          {names[month.month]} {month.year}
        </strong>
        <span className="text-xs text-[#949cc4]">{month.count} watched</span>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((weekday, index) => (
          <span key={index} className="text-center text-[10px] text-[#949cc4]" aria-hidden="true">
            {weekday}
          </span>
        ))}
        {Array.from({ length: lead }, (_, index) => (
          <span key={`lead-${index}`} />
        ))}
        {Array.from({ length }, (_, index) => {
          const day = byDay.get(index + 1)
          if (!day) {
            return (
              <span key={index} className={classNames(empty, 'h-10 text-sm sm:h-8 sm:text-xs')}>
                {index + 1}
              </span>
            )
          }
          return (
            <button
              key={index}
              type="button"
              onClick={() => onPick(day)}
              title={`${day.count} watched`}
              aria-label={`${names[month.month]} ${day.day}, ${day.count} watched`}
              style={heat(day.count, peak)}
              className={classNames(cell, 'h-10 rounded-md text-sm sm:h-8 sm:text-xs')}
            >
              {index + 1}
            </button>
          )
        })}
      </div>
      <p className="text-[11px] text-[#949cc4]">Pick a day to go to it.</p>
    </>
  )
}

function Panel({ timeline, first, onJump, close }) {
  const [monthIndex, setMonthIndex] = useState(null)

  if (monthIndex !== null && timeline.months[monthIndex]) {
    return (
      <Days
        month={timeline.months[monthIndex]}
        onBack={() => setMonthIndex(null)}
        onPick={(day) => {
          onJump(day.start)
          close()
        }}
      />
    )
  }
  return (
    <Months
      timeline={timeline}
      first={first}
      onPick={(index) => {
        // The row goes to the month at once; the panel stays for its days
        onJump(timeline.months[index].start)
        setMonthIndex(index)
      }}
      onQuick={(position) => {
        onJump(position)
        close()
      }}
    />
  )
}

/**
 * The date beside the Watch History title. It says when the titles in view
 * were watched, and opens every month to pick from, then that month's days:
 * the exact way to a date, for a keyboard, a finger or a mouse. Under the
 * button on a wide screen, a sheet from the bottom on a phone.
 *
 * @param {object} props
 * @param {object} props.timeline - buildTimeline()
 * @param {number} props.first - List position of the row's first card
 * @param {string} props.label - The dates in view (describeRange)
 * @param {boolean} props.compact - A phone-width screen
 * @param {(position: number) => void} props.onJump
 */
export default function RailDatePicker({ timeline, first, label, compact, onJump }) {
  return (
    <Popover>
      <PopoverButton className="inline-flex items-center gap-1.5 rounded-full border border-[#262e55] bg-[#131a38] px-3 py-1 text-sm font-medium tabular-nums text-white hover:border-[#4a5488] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 max-sm:py-2">
        <CalendarDaysIcon className="h-4 w-4 flex-none" aria-hidden="true" />
        <span>{label}</span>
        <ChevronDownIcon className="h-4 w-4 flex-none" aria-hidden="true" />
      </PopoverButton>
      {compact ? <PopoverBackdrop className="fixed inset-0 z-40 bg-black/50" /> : null}
      <PopoverPanel
        portal
        anchor={compact ? undefined : { to: 'bottom start', gap: 8 }}
        aria-label="Jump to a date"
        className={classNames(
          'z-50 flex flex-col gap-2 border border-[#4a5488] bg-[#131a38] text-white shadow-2xl focus:outline-none',
          compact
            ? 'fixed inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-x-0 border-b-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3'
            : 'w-[29rem] rounded-xl p-3'
        )}
      >
        {({ close }) => <Panel timeline={timeline} first={first} onJump={onJump} close={close} />}
      </PopoverPanel>
    </Popover>
  )
}
