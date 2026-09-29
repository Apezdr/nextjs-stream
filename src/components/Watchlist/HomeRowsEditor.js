'use client'

import { useState } from 'react'
import { Field, Label, Switch } from '@headlessui/react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  EllipsisHorizontalIcon,
  MagnifyingGlassIcon,
  MinusCircleIcon,
  PlusIcon,
} from '@heroicons/react/24/outline'
import { classNames } from '@src/utils'
import {
  avatarColor,
  groupAvailable,
  initialsOf,
  itemCountLabel,
  MAX_ROW_TITLE_LENGTH,
  ownerLabel,
} from './homeRowsState'

/**
 * The home screen rows editor: the rows, in order, beside the playlists that
 * could be added. Phones show one of the two lists at a time, and each row's
 * controls behind its ⋯ button. Used for your own rows and, by admins, for
 * someone else's (`perspective="person"` with their name).
 *
 * State lives with the caller (homeRowsReducer), which loads and saves it.
 */
export default function HomeRowsEditor({ state, dispatch, perspective = 'self', personName = '' }) {
  const [query, setQuery] = useState('')
  const [expandOthers, setExpandOthers] = useState(false)
  const [phoneView, setPhoneView] = useState('rows') // phones: 'rows' | 'add'
  const [openRowId, setOpenRowId] = useState(null) // phones: the row showing its options
  const [drag, setDrag] = useState({ armed: null, moving: null, over: null }) // desktop drag-and-drop

  const firstName = personName.trim().split(/\s+/)[0] || 'them'
  const self = perspective === 'self'
  const groups = groupAvailable(state.available, { query, perspective, expandOthers })
  const rowCount = state.rows.length

  const endDrag = () => setDrag({ armed: null, moving: null, over: null })
  // Rows drag by their handle only: pressing it arms the row, so a drag that
  // starts in the title field selects text instead of moving the row
  const dragProps = (row) => ({
    draggable: drag.armed === row.id,
    onDragStart: (event) => {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', row.id)
      setDrag((current) => ({ ...current, moving: row.id }))
    },
    onDragOver: (event) => {
      if (!drag.moving || drag.moving === row.id) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      if (drag.over !== row.id) setDrag((current) => ({ ...current, over: row.id }))
    },
    onDrop: (event) => {
      event.preventDefault()
      if (drag.moving && drag.moving !== row.id) dispatch({ type: 'moveTo', playlistId: drag.moving, targetId: row.id })
      endDrag()
    },
    onDragEnd: endDrag,
  })

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-5">
      <section
        aria-labelledby="home-rows-current"
        className={classNames(
          // Phones scroll the whole column, so an open row pushes the rest down;
          // desktop keeps the heading in view and scrolls the list
          'min-h-0 flex-col gap-3 overflow-y-auto p-4 lg:col-span-3 lg:flex lg:overflow-hidden lg:border-r lg:border-gray-700 lg:py-5 lg:pl-7 lg:pr-6',
          phoneView === 'rows' ? 'flex' : 'hidden'
        )}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="home-rows-current" className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            {self ? 'On your home screen' : `On ${firstName}'s home screen`}
          </h3>
          <span className="text-sm text-gray-400">{rowCount === 1 ? '1 row' : `${rowCount} rows`}</span>
        </div>
        <p className="text-sm text-gray-400">
          Rows appear in this order, under Continue Watching.
          <span className="hidden lg:inline"> Drag a row by its handle, or use the arrows, to move it.</span>
        </p>

        {rowCount > 0 ? (
          <ol className="-mr-1 flex flex-col gap-2.5 pr-1 lg:min-h-0 lg:overflow-y-auto">
            {state.rows.map((row, index) => (
              <li
                key={row.id}
                {...dragProps(row)}
                className={classNames(
                  'rounded-lg border bg-gray-700 p-3 lg:pl-2',
                  drag.over === row.id ? 'border-indigo-400' : 'border-gray-600',
                  drag.moving === row.id && 'opacity-50'
                )}
              >
                <WideRow
                  row={row}
                  index={index}
                  isLast={index === rowCount - 1}
                  perspective={perspective}
                  dispatch={dispatch}
                  onArm={() => setDrag((current) => ({ ...current, armed: row.id }))}
                  onDisarm={() => setDrag((current) => (current.moving ? current : { ...current, armed: null }))}
                />
                <CompactRow
                  row={row}
                  index={index}
                  isLast={index === rowCount - 1}
                  perspective={perspective}
                  dispatch={dispatch}
                  open={openRowId === row.id}
                  onToggle={() => setOpenRowId((current) => (current === row.id ? null : row.id))}
                />
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-gray-600 px-6 py-10 text-center">
            <p className="font-medium text-white">No rows on {self ? 'your' : `${firstName}'s`} home screen</p>
            <p className="text-sm text-gray-300">
              <span className="hidden lg:inline">Add a playlist from the list on the right.</span>
              <span className="lg:hidden">Add a playlist to make the first row.</span>
            </p>
          </div>
        )}

        <button
          type="button"
          onClick={() => setPhoneView('add')}
          className="flex h-12 shrink-0 items-center justify-center gap-2 rounded-lg border border-dashed border-indigo-500 text-base font-medium text-indigo-200 lg:hidden"
        >
          <PlusIcon className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
          Add a row
        </button>
      </section>

      <section
        aria-labelledby="home-rows-add"
        className={classNames(
          'min-h-0 flex-col gap-3 bg-gray-900/40 p-4 lg:col-span-2 lg:flex lg:py-5 lg:pl-6 lg:pr-7',
          phoneView === 'add' ? 'flex' : 'hidden'
        )}
      >
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPhoneView('rows')}
            aria-label={self ? 'Back to your rows' : `Back to ${firstName}'s rows`}
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-md text-gray-300 lg:hidden"
          >
            <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
          </button>
          <h3 id="home-rows-add" className="text-xs font-semibold uppercase tracking-wider text-gray-300">
            {self ? 'Add a row' : `Add a row for ${firstName}`}
          </h3>
        </div>
        {!self && <p className="text-sm text-gray-400">Only playlists {firstName} can open are listed.</p>}
        <label className="relative block">
          <span className="sr-only">Search playlists or people</span>
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search playlists or people"
            className="h-10 w-full rounded-md border border-gray-600 bg-gray-800 pl-9 pr-3 text-base text-white placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:text-sm"
          />
        </label>

        <div className="-mr-1 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
          {groups.map((group) => (
            <section key={group.relation} aria-label={group.label}>
              <div className="flex items-baseline justify-between gap-2">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">{group.label}</h4>
                {group.relation === 'others' && (
                  <span className="text-xs text-gray-400">{self ? 'You see these as an admin' : `${firstName} sees these as an admin`}</span>
                )}
              </div>
              <ul className="mt-2 space-y-1.5">
                {group.items.map((playlist) => (
                  <li key={playlist.id} className="flex items-center gap-3 rounded-lg bg-gray-700/60 py-2.5 pl-3 pr-2.5">
                    <Avatar name={playlist.ownerName} colorKey={playlist.ownerId} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-white">{playlist.name}</p>
                      <p className="truncate text-xs text-gray-300">
                        {ownerLabel(playlist, perspective)} · {itemCountLabel(playlist.itemCount)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => dispatch({ type: 'add', playlistId: playlist.id })}
                      aria-label={`Add ${playlist.name} ${ownerLabel(playlist, perspective)}`}
                      className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-indigo-500 px-3 text-sm font-medium text-indigo-200 transition-colors hover:bg-indigo-500/10 lg:h-8"
                    >
                      <PlusIcon className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />
                      Add
                    </button>
                  </li>
                ))}
              </ul>
              {group.hiddenCount > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandOthers(true)}
                  className="mt-2 py-1 text-sm font-medium text-indigo-300 hover:text-indigo-200"
                >
                  Show {group.hiddenCount} more
                </button>
              )}
            </section>
          ))}
          {groups.length === 0 && (
            <p className="py-6 text-center text-sm text-gray-300">
              {query.trim()
                ? `No playlists match “${query.trim()}”.`
                : `Every playlist ${self ? 'you' : firstName} can open is already a row.`}
            </p>
          )}
        </div>
      </section>
    </div>
  )
}

// Desktop: every control in view, and a drag handle
function WideRow({ row, index, isLast, perspective, dispatch, onArm, onDisarm }) {
  const { playlist } = row
  const label = `${playlist.name} ${ownerLabel(playlist, perspective)}`
  return (
    <div className="hidden items-start gap-2.5 lg:flex">
      <span
        aria-hidden="true"
        onMouseDown={onArm}
        onMouseUp={onDisarm}
        className="mt-[27px] flex h-6 w-5 shrink-0 cursor-grab items-center justify-center text-gray-400 active:cursor-grabbing"
      >
        <GripIcon />
      </span>
      <Position index={index} className="mt-[25px]" />
      <div className="min-w-0 flex-1 space-y-2">
        <label className="block">
          <span className="text-xs text-gray-300">Row title</span>
          <TitleInput row={row} dispatch={dispatch} label={`Row title for ${label}`} />
        </label>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="flex min-w-0 items-center gap-2 text-sm text-gray-300">
            <Avatar name={playlist.ownerName} colorKey={playlist.ownerId} size="sm" />
            {/* Wraps rather than truncates: the owner is the point of this line */}
            <span className="min-w-0">
              {playlist.name} · {ownerLabel(playlist, perspective)} · {itemCountLabel(playlist.itemCount)}
            </span>
          </span>
          <LibrarySwitch checked={row.hideUnavailable} onChange={() => dispatch({ type: 'library', playlistId: row.id })} />
        </div>
      </div>
      <div className="mt-[22px] flex shrink-0 gap-1.5">
        <IconButton label={`Move ${label} up`} disabled={index === 0} onClick={() => dispatch({ type: 'move', playlistId: row.id, offset: -1 })}>
          <ArrowUpIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        </IconButton>
        <IconButton label={`Move ${label} down`} disabled={isLast} onClick={() => dispatch({ type: 'move', playlistId: row.id, offset: 1 })}>
          <ArrowDownIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        </IconButton>
        <IconButton label={`Remove ${label} from the home screen`} onClick={() => dispatch({ type: 'remove', playlistId: row.id })}>
          <MinusCircleIcon className="h-[18px] w-[18px]" aria-hidden="true" />
        </IconButton>
      </div>
    </div>
  )
}

// Phones: the title and owner, with the controls behind ⋯
function CompactRow({ row, index, isLast, perspective, dispatch, open, onToggle }) {
  const { playlist } = row
  const title = row.appTitle.trim() || playlist.name
  const label = `${playlist.name} ${ownerLabel(playlist, perspective)}`
  const meta = [row.appTitle.trim() ? playlist.name : null, ownerLabel(playlist, perspective), itemCountLabel(playlist.itemCount)]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="lg:hidden">
      <div className="flex items-center gap-2.5">
        <Position index={index} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium text-white">{title}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-gray-300">
            <span className="truncate">{meta}</span>
            {row.hideUnavailable && (
              <span className="shrink-0 rounded bg-indigo-900 px-1.5 py-px text-[11px] font-medium text-indigo-100">Library only</span>
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-label={`Options for ${title}`}
          className="-mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-200"
        >
          <EllipsisHorizontalIcon className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      {open && (
        <div className="mt-3 space-y-3 border-t border-gray-600 pt-3">
          <label className="block">
            <span className="text-xs text-gray-300">Row title</span>
            <TitleInput row={row} dispatch={dispatch} label={`Row title for ${label}`} />
          </label>
          <LibrarySwitch checked={row.hideUnavailable} onChange={() => dispatch({ type: 'library', playlistId: row.id })} />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => dispatch({ type: 'move', playlistId: row.id, offset: -1 })}
              className="flex h-11 items-center justify-center gap-2 rounded-md bg-gray-600 text-sm text-white disabled:opacity-40"
            >
              <ArrowUpIcon className="h-4 w-4" aria-hidden="true" />
              Move up
            </button>
            <button
              type="button"
              disabled={isLast}
              onClick={() => dispatch({ type: 'move', playlistId: row.id, offset: 1 })}
              className="flex h-11 items-center justify-center gap-2 rounded-md bg-gray-600 text-sm text-white disabled:opacity-40"
            >
              <ArrowDownIcon className="h-4 w-4" aria-hidden="true" />
              Move down
            </button>
          </div>
          <button
            type="button"
            onClick={() => dispatch({ type: 'remove', playlistId: row.id })}
            className="flex h-11 w-full items-center gap-3 rounded-md px-2 text-left text-base text-red-300"
          >
            <MinusCircleIcon className="h-5 w-5" aria-hidden="true" />
            Remove from the home screen
          </button>
        </div>
      )}
    </div>
  )
}

function TitleInput({ row, dispatch, label }) {
  return (
    <input
      type="text"
      value={row.appTitle}
      onChange={(event) => dispatch({ type: 'title', playlistId: row.id, value: event.target.value })}
      placeholder={row.playlist.name}
      maxLength={MAX_ROW_TITLE_LENGTH}
      aria-label={label}
      className="mt-1 h-10 w-full rounded-md border border-gray-600 bg-gray-800 px-2.5 text-base text-white placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 lg:h-9 lg:text-sm"
    />
  )
}

function LibrarySwitch({ checked, onChange }) {
  return (
    <Field className="flex items-center gap-2">
      <Switch
        checked={checked}
        onChange={onChange}
        className="group relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full bg-gray-500 transition-colors focus:outline-none data-[checked]:bg-indigo-600 data-[focus]:outline data-[focus]:outline-2 data-[focus]:outline-offset-2 data-[focus]:outline-indigo-400"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none ml-[3px] mt-[3px] inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform group-data-[checked]:translate-x-4"
        />
      </Switch>
      <Label className="cursor-pointer text-sm text-gray-300">Only what&apos;s in the library</Label>
    </Field>
  )
}

function IconButton({ label, onClick, disabled = false, children }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-9 w-9 items-center justify-center rounded-md border border-gray-600 text-gray-200 transition-colors hover:bg-gray-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function Position({ index, className = '' }) {
  return (
    <span
      aria-hidden="true"
      className={classNames('flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-800 text-xs font-semibold text-gray-200', className)}
    >
      {index + 1}
    </span>
  )
}

export function Avatar({ name, colorKey, size = 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={classNames(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        avatarColor(colorKey || name),
        size === 'sm' ? 'h-5 w-5 text-[10px]' : 'h-8 w-8 text-xs'
      )}
    >
      {initialsOf(name)}
    </span>
  )
}

function GripIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}
