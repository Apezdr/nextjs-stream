'use client'

import { useState } from 'react'

const MINUTE = 60_000

const PRESETS = [
  { id: 'all', label: 'Since the processor started' },
  { id: '15m', label: 'Last 15 minutes', span: 15 * MINUTE },
  { id: '1h', label: 'Last hour', span: 60 * MINUTE },
  { id: '6h', label: 'Last 6 hours', span: 360 * MINUTE },
  { id: 'today', label: 'Today' },
]

export const ALL_TIME = Object.freeze({ preset: 'all', from: null, to: null })

/** A preset's range as of `now`. Relative ones stay open-ended, so the live view keeps going. */
export function rangeFor(preset, now = Date.now()) {
  if (preset === 'today') {
    const midnight = new Date(now)
    midnight.setHours(0, 0, 0, 0)
    return { preset, from: midnight.toISOString(), to: null }
  }
  const relative = PRESETS.find((option) => option.id === preset && option.span)
  return relative ? { preset, from: new Date(now - relative.span).toISOString(), to: null } : ALL_TIME
}

export const isRelative = (range) => PRESETS.some((option) => option.id === range.preset && option.span)

const shortTime = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function describeRange(range) {
  const preset = PRESETS.find((option) => option.id === range.preset)
  if (preset) return preset.label
  const from = range.from ? shortTime.format(new Date(range.from)) : 'the start'
  const to = range.to ? shortTime.format(new Date(range.to)) : 'now'
  return `${from} – ${to}`
}

const pad = (number) => String(number).padStart(2, '0')

/** An ISO time as a datetime-local value (local time, to the minute). */
function toInputValue(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// A datetime-local value has no zone, and Date reads it as local time.
const fromInputValue = (value) => (value ? new Date(value).toISOString() : null)

const fieldClass =
  'block w-full rounded-md border-0 py-1 px-2 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-indigo-600'

/**
 * The time range: presets, or a custom from–to applied with a button (an
 * empty "to" means now, and keeps the live view going).
 */
export default function TimeRangePicker({ id, range, span, onChange, selectClass }) {
  const [draft, setDraft] = useState(null) // { from, to } while a custom range is being edited
  const editing = draft !== null

  function handleSelect(event) {
    const preset = event.target.value
    if (preset === 'custom') {
      setDraft({ from: toInputValue(range.from ?? span?.from), to: toInputValue(range.to) })
      return
    }
    setDraft(null)
    onChange(rangeFor(preset))
  }

  const from = editing ? fromInputValue(draft.from) : null
  const to = editing ? fromInputValue(draft.to) : null
  const invalid = Boolean(from && to && from > to)

  function apply(event) {
    event.preventDefault()
    if (invalid) return
    onChange({ preset: 'custom', from, to })
    setDraft(null)
  }

  return (
    <div>
      <select id={id} value={editing ? 'custom' : range.preset} onChange={handleSelect} className={selectClass}>
        {PRESETS.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
        <option value="custom">{range.preset === 'custom' && !editing ? describeRange(range) : 'Custom range…'}</option>
      </select>

      {editing && (
        <form onSubmit={apply} className="mt-2 space-y-2 rounded-md bg-gray-50 p-2 ring-1 ring-inset ring-gray-200">
          <label className="block text-xs text-gray-600">
            From
            <input
              type="datetime-local"
              value={draft.from}
              onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))}
              className={fieldClass}
            />
          </label>
          <label className="block text-xs text-gray-600">
            To <span className="text-gray-400">(empty = now)</span>
            <input
              type="datetime-local"
              value={draft.to}
              onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))}
              className={fieldClass}
            />
          </label>
          {invalid && <p className="text-xs text-red-600">“From” is after “To”.</p>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDraft(null)} className="rounded px-2 py-1 text-xs text-gray-600 hover:bg-gray-100">
              Cancel
            </button>
            <button
              type="submit"
              disabled={invalid}
              className="rounded bg-indigo-600 px-2 py-1 text-xs font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
