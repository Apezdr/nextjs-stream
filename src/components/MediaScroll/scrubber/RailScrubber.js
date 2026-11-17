'use client'

import { useEffect, useRef, useState } from 'react'
import { classNames } from '@src/utils'
import { adjacentMonthPosition, fractionAtPosition, monthNames, positionAtFraction } from './timeline'

// How far a finger moves sideways before the strip takes the drag. A finger
// that lands on the strip while scrolling the page moves down, not sideways,
// and must not jump the row.
const TOUCH_SLOP = 6

const LINE = '#4a5488'
const MUTED = 'text-[#949cc4]'

/**
 * The date strip under the Watch History row: one column per calendar month
 * from today (left) back to the first title (right), each as tall as that
 * month was busy, and a handle where the row is.
 *
 * It only reports: where the pointer is in the list while dragging (onScrub,
 * then onScrubEnd), a page step or a jump from the keyboard. The row decides
 * what to show and what to fetch.
 *
 * @param {object} props
 * @param {object} props.timeline - buildTimeline()
 * @param {number} props.first - List position of the row's first card
 * @param {number} [props.width] - Pixels, to line up with the cards; the full width without it
 */
export default function RailScrubber({
  timeline,
  first,
  width,
  page,
  pageCount,
  valueText,
  onScrubStart,
  onScrub,
  onScrubEnd,
  onStep,
  onJump,
}) {
  const plotRef = useRef(null)
  const touchRef = useRef(null) // a finger that is down and has not moved sideways yet
  const [drag, setDrag] = useState(null) // the place under the pointer while dragging, 0-1
  const [hover, setHover] = useState(null)
  const [plotWidth, setPlotWidth] = useState(0)

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return undefined
    const observer = new ResizeObserver(() => setPlotWidth(plot.clientWidth))
    observer.observe(plot)
    return () => observer.disconnect()
  }, [])

  const { months } = timeline
  const count = months.length
  const names = monthNames()
  const peak = Math.max(1, ...months.map((month) => month.count))
  const columnWidth = plotWidth / count
  const monthUnder = (fraction) => months[Math.min(count - 1, Math.floor(fraction * count))]

  const at = drag ?? fractionAtPosition(timeline, first)
  const under = monthUnder(at)
  const hovered = drag === null && hover !== null ? monthUnder(hover) : null
  const lit = drag !== null ? under : hovered
  const oldest = months[count - 1]

  const years = []
  for (const month of months) {
    const last = years[years.length - 1]
    if (last && last.year === month.year) last.months += 1
    else years.push({ year: month.year, months: 1 })
  }

  const fractionOf = (event) => {
    const box = plotRef.current.getBoundingClientRect()
    const fraction = (event.clientX - box.left) / box.width
    // A strip with no width yet has no places on it
    return Number.isFinite(fraction) ? Math.min(0.999999, Math.max(0, fraction)) : 0
  }
  const begin = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const fraction = fractionOf(event)
    setHover(null)
    setDrag(fraction)
    onScrubStart()
    onScrub(positionAtFraction(timeline, fraction))
  }
  const finish = (fraction) => {
    setDrag(null)
    onScrubEnd(positionAtFraction(timeline, fraction))
  }

  const handlePointerDown = (event) => {
    if (event.button > 0) return
    if (event.pointerType === 'touch') {
      touchRef.current = { x: event.clientX }
      return
    }
    begin(event)
  }
  const handlePointerMove = (event) => {
    if (drag !== null) {
      const fraction = fractionOf(event)
      setDrag(fraction)
      onScrub(positionAtFraction(timeline, fraction))
    } else if (touchRef.current) {
      if (Math.abs(event.clientX - touchRef.current.x) > TOUCH_SLOP) {
        touchRef.current = null
        begin(event)
      }
    } else if (event.pointerType !== 'touch') {
      setHover(fractionOf(event))
    }
  }
  const handlePointerUp = (event) => {
    if (drag !== null) {
      finish(fractionOf(event))
    } else if (touchRef.current) {
      // A tap: go where the finger landed
      touchRef.current = null
      const fraction = fractionOf(event)
      onScrubStart()
      onScrub(positionAtFraction(timeline, fraction))
      finish(fraction)
    }
  }
  const handlePointerCancel = () => {
    // The browser took the gesture (the page is scrolling): a finger that had
    // not started a drag changes nothing
    touchRef.current = null
    if (drag !== null) finish(drag)
  }

  const handleKeyDown = (event) => {
    const { key, shiftKey } = event
    if (key === 'ArrowRight' && !shiftKey) onStep(1)
    else if (key === 'ArrowLeft' && !shiftKey) onStep(-1)
    else if (key === 'ArrowRight' || key === 'PageDown') onJump(adjacentMonthPosition(timeline, first, true))
    else if (key === 'ArrowLeft' || key === 'PageUp') onJump(adjacentMonthPosition(timeline, first, false))
    else if (key === 'Home') onJump(0)
    else if (key === 'End') onJump(Math.max(0, timeline.total - 1))
    else return
    event.preventDefault()
  }

  const endLabel = classNames(
    'pointer-events-none absolute top-[46px] hidden whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide sm:block',
    MUTED
  )

  return (
    <div
      className={classNames('relative mt-3 select-none', width ? 'mx-auto' : 'mx-4')}
      style={width ? { width } : undefined}
      data-testid="watch-history-scrubber"
    >
      <span className={classNames(endLabel, 'right-full mr-3')}>Today</span>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Jump to a date in your watch history"
        aria-orientation="horizontal"
        aria-valuemin={1}
        aria-valuemax={pageCount}
        aria-valuenow={page + 1}
        aria-valuetext={valueText}
        className="group/strip relative cursor-pointer touch-pan-y rounded-md pt-[22px] outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-4 focus-visible:ring-offset-[#060916]"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => setHover(null)}
        onKeyDown={handleKeyDown}
      >
        {/* The gap under the bars is the lower half of the handle's knob, clear of the labels */}
        <div ref={plotRef} className="mb-2 flex h-10 border-b" style={{ borderColor: LINE }}>
          {months.map((month, index) => (
            <div
              key={month.key}
              className="flex min-w-0 flex-1 basis-0 items-end px-px"
              style={index > 0 && month.month === 11 ? { boxShadow: `inset 1px 0 0 ${LINE}` } : undefined}
            >
              <i
                className={classNames(
                  'block w-full rounded-t-sm transition-colors duration-150',
                  month === lit
                    ? 'bg-[#9db8ff]'
                    : drag !== null
                      ? 'bg-[#4a5ba6]'
                      : // Dim until the pointer or the keyboard is on the strip; a phone has neither
                        'bg-[#2c3768] group-hover/strip:bg-[#4a5ba6] group-focus-visible/strip:bg-[#4a5ba6] max-sm:bg-[#4a5ba6]'
                )}
                style={{ height: month.count > 0 ? `${Math.max(6, Math.round((month.count / peak) * 100))}%` : 0 }}
              />
            </div>
          ))}
        </div>

        {columnWidth >= 13 ? (
          <div className="flex" aria-hidden="true">
            {months.map((month) => (
              <span
                key={month.key}
                className={classNames('min-w-0 flex-1 basis-0 overflow-hidden whitespace-nowrap text-center text-[10px] leading-[15px]', MUTED)}
              >
                {columnWidth >= 30 ? names[month.month] : names[month.month].slice(0, 1)}
              </span>
            ))}
          </div>
        ) : null}

        <div className="flex" aria-hidden="true">
          {years.map((year, index) => (
            <span
              key={year.year}
              className="min-w-0 shrink basis-0 overflow-hidden whitespace-nowrap indent-[5px] text-xs font-semibold leading-[18px] tabular-nums text-white"
              style={{ flexGrow: year.months, boxShadow: index > 0 ? `inset 1px 0 0 ${LINE}` : undefined }}
            >
              {year.year}
            </span>
          ))}
        </div>

        {hovered ? (
          <div className="pointer-events-none absolute top-0 h-[62px] w-0" style={{ left: `${hover * 100}%` }} aria-hidden="true">
            <span className="absolute bottom-0 left-[-1px] top-5 w-0.5 rounded-sm bg-[#949cc4]" />
            <span
              className="absolute left-0 top-0 whitespace-nowrap rounded border bg-[#131a38] px-[7px] text-[11px] font-semibold leading-4 tabular-nums text-white"
              style={{ borderColor: LINE, transform: `translateX(${-hover * 100}%)` }}
            >
              {names[hovered.month]} {hovered.year} · {hovered.count} watched
            </span>
          </div>
        ) : null}

        <div className="pointer-events-none absolute top-0 h-[62px] w-0" style={{ left: `${at * 100}%` }} aria-hidden="true">
          <span className="absolute bottom-0 left-[-1px] top-5 w-0.5 rounded-sm bg-white" />
          <span className="absolute -bottom-1.5 -left-1.5 h-3 w-3 rounded-full bg-white ring-[3px] ring-[#060916] max-sm:-bottom-2 max-sm:-left-2 max-sm:h-4 max-sm:w-4" />
          <span
            className={classNames(
              'absolute left-0 top-0 whitespace-nowrap rounded bg-white px-[7px] text-[11px] font-semibold leading-[18px] tabular-nums text-[#060916] transition-opacity',
              hovered ? 'opacity-25' : ''
            )}
            style={{ transform: `translateX(${-at * 100}%)` }}
          >
            {names[under.month]} {under.year}
          </span>
        </div>
      </div>
      <span className={classNames(endLabel, 'left-full ml-3')}>
        {names[oldest.month]} {oldest.year}
      </span>
    </div>
  )
}
