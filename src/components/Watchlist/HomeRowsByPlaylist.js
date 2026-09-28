'use client'

import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { CheckIcon, ChevronUpIcon, InformationCircleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'
import { Avatar } from './HomeRowsEditor'
import { homeRowsApi } from './homeRowsApi'
import { itemCountLabel } from './homeRowsState'

const FILTERS = [
  { key: 'all', label: 'Everyone' },
  { key: 'showing', label: 'Showing it' },
  { key: 'notShowing', label: 'Not showing' },
  { key: 'noAccess', label: "Can't open it" },
]

const ROLE_LABELS = { owner: 'Owner', collaborator: 'Shared with them', admin: 'Admin' }

function stateOf(person) {
  if (!person.canOpen) return 'noAccess'
  return person.row ? 'showing' : 'notShowing'
}

function statusText(person) {
  if (!person.canOpen) return "Can't open this playlist"
  if (!person.row) return 'Not on their home screen'
  const where = person.row.position ? `Showing, row ${person.row.position}` : 'Showing'
  return person.row.appTitle ? `${where} · “${person.row.appTitle}”` : where
}

const STATUS_CLASSES = {
  showing: 'bg-indigo-900 text-indigo-100',
  notShowing: 'bg-gray-700 text-gray-300',
  noAccess: 'border border-amber-700 text-amber-300',
}

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`

/**
 * Admin, by playlist: pick a playlist, see where it stands on everyone's home
 * screen, and add it to or remove it from the people you select, or everyone.
 */
export default function HomeRowsByPlaylist({ playlists, onClose }) {
  const options = useMemo(
    () =>
      [...playlists].sort(
        (a, b) => a.name.localeCompare(b.name) || String(a.ownerName).localeCompare(String(b.ownerName))
      ),
    [playlists]
  )
  const selectId = useId()
  const [playlistId, setPlaylistId] = useState(null)
  const selectedPlaylistId = playlistId ?? options[0]?.id ?? null

  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [position, setPosition] = useState('top')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [confirmingRemoveAll, setConfirmingRemoveAll] = useState(false)

  // A new playlist or a retry shows the loading state; a reload after a change
  // keeps the list in view until the fresh one arrives
  useEffect(() => {
    if (!selectedPlaylistId) return
    let current = true
    homeRowsApi
      .playlistPeople(selectedPlaylistId)
      .then((result) => {
        if (!current) return
        setData(result)
        setStatus('ready')
      })
      .catch((error) => {
        if (!current) return
        console.error('[HomeRowsByPlaylist] load failed:', error)
        setStatus('error')
      })
    return () => {
      current = false
    }
  }, [selectedPlaylistId, attempt])

  const pickPlaylist = (id) => {
    setStatus('loading')
    setPlaylistId(id)
    setFilter('all')
    setSelected(new Set())
    setNotice('')
    setConfirmingRemoveAll(false)
  }

  const people = data?.people || []
  const counts = data?.counts || { all: 0, showing: 0, notShowing: 0, noAccess: 0 }
  const playlist = data?.playlist
  const isPrivate = playlist && playlist.privacy !== 'public'
  const filters = FILTERS.filter((entry) => entry.key !== 'noAccess' || counts.noAccess > 0)
  const activeFilter = filters.some((entry) => entry.key === filter) ? filter : 'all'

  const needle = query.trim().toLowerCase()
  const shown = people.filter(
    (person) =>
      (activeFilter === 'all' || stateOf(person) === activeFilter) &&
      (!needle || person.name.toLowerCase().includes(needle) || person.email.toLowerCase().includes(needle))
  )
  const selectable = shown.filter((person) => person.canOpen).map((person) => person.userId)
  const allShownSelected = selectable.length > 0 && selectable.every((id) => selected.has(id))
  const chosen = [...selected]

  const toggle = (userId) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })

  const change = useCallback(
    async (body, describe) => {
      setBusy(true)
      setConfirmingRemoveAll(false)
      try {
        const result = await homeRowsApi.change({ playlistId: selectedPlaylistId, ...body })
        setNotice(describe(result))
        setSelected(new Set())
        setAttempt((n) => n + 1) // reload where everyone stands
      } catch (error) {
        toast.error(error.message || 'That change could not be made')
      } finally {
        setBusy(false)
      }
    },
    [selectedPlaylistId]
  )

  const describeAdd = (result) => {
    const parts = [`Added ${playlist.name} to ${plural(result.added.length, 'home screen', 'home screens')} as the ${position === 'top' ? 'first' : 'last'} row.`]
    if (result.alreadyShowing) parts.push(`${plural(result.alreadyShowing, 'person', 'people')} already had it.`)
    if (result.skipped) parts.push(`${plural(result.skipped, 'person', 'people')} can't open it.`)
    return parts.join(' ')
  }
  const describeRemove = (result) => `Removed ${playlist.name} from ${plural(result.removed.length, 'home screen', 'home screens')}.`

  if (options.length === 0) {
    return <p className="flex-1 p-8 text-center text-gray-300">There are no playlists yet.</p>
  }

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 lg:px-7 lg:py-5">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
          {/* A label wrapping the select would read the chosen option as part of its name */}
          <div className="flex w-full flex-col gap-1.5 sm:w-auto">
            <label htmlFor={selectId} className="text-sm font-medium text-gray-300">
              Playlist
            </label>
            <select
              id={selectId}
              value={selectedPlaylistId || ''}
              onChange={(event) => pickPlaylist(event.target.value)}
              className="h-10 w-full rounded-md border border-gray-600 bg-gray-900 px-3 text-base text-white focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:w-[28rem] sm:text-sm"
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name} · {option.isOwner ? 'by you' : `by ${option.ownerName}`}
                </option>
              ))}
            </select>
          </div>
          {playlist && (
            <p className="flex items-center gap-2.5 pb-2 text-sm text-gray-300">
              <span
                className={classNames(
                  'rounded-full px-2.5 py-0.5 text-xs font-semibold',
                  isPrivate ? 'bg-gray-700 text-gray-200' : 'bg-blue-900 text-blue-100'
                )}
              >
                {isPrivate ? 'Private' : 'Public'}
              </span>
              <span>
                by {playlist.ownerName} · {itemCountLabel(playlist.itemCount)}
                {isPrivate
                  ? ` · shared with ${plural(playlist.collaboratorCount, 'person', 'people')}`
                  : ' · anyone can open it'}
              </span>
            </p>
          )}
        </div>

        {playlist && isPrivate && (
          <div role="note" className="flex items-start gap-2.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-3">
            <InformationCircleIcon className="mt-px h-5 w-5 shrink-0 text-indigo-300" aria-hidden="true" />
            <p className="text-sm leading-relaxed text-slate-200">
              {playlist.name} is private, so it can only be a row for the people who can open it: its owner, the people it&apos;s
              shared with, and admins. Share it or make it public to offer it to more people.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-baseline gap-2 text-sm text-gray-300">
            <span className="text-2xl font-bold text-white">{status === 'ready' ? counts.showing : '–'}</span>
            <span>
              {isPrivate
                ? `of the ${counts.all - counts.noAccess} people who can open ${playlist?.name ?? 'it'} have it on their home screen`
                : `of ${counts.all} people have ${playlist?.name ?? 'it'} on their home screen`}
            </span>
          </p>
          <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto">
            <div role="group" aria-label="Show people" className="flex flex-wrap gap-1 rounded-lg bg-gray-900 p-1">
              {filters.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  aria-pressed={activeFilter === entry.key}
                  onClick={() => {
                    setFilter(entry.key)
                    setSelected(new Set())
                  }}
                  className={classNames(
                    'h-9 rounded-md px-3 text-sm font-medium transition-colors',
                    activeFilter === entry.key ? 'bg-indigo-600 text-white' : 'text-gray-300 hover:text-white'
                  )}
                >
                  {entry.label} {counts[entry.key]}
                </button>
              ))}
            </div>
            <label className="relative block w-full sm:w-60">
              <span className="sr-only">Search people</span>
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search people"
                className="h-10 w-full rounded-md border border-gray-600 bg-gray-900 pl-9 pr-3 text-base text-white placeholder:text-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 sm:text-sm"
              />
            </label>
          </div>
        </div>

        <div className="flex min-h-[16rem] flex-1 flex-col overflow-hidden rounded-lg border border-gray-700 bg-gray-900">
          <div className="hidden grid-cols-[44px_minmax(0,1.4fr)_minmax(0,1.6fr)_120px] items-center border-b border-gray-700 py-2.5 pl-2 pr-4 text-xs font-semibold uppercase tracking-wide text-gray-400 sm:grid">
            <label className="flex h-6 items-center justify-center">
              <input
                type="checkbox"
                checked={allShownSelected}
                disabled={selectable.length === 0}
                onChange={() => setSelected(allShownSelected ? new Set() : new Set(selectable))}
                aria-label="Select everyone shown who can open this playlist"
                className="h-4 w-4 rounded border-gray-500 bg-gray-800 text-indigo-600 focus:ring-indigo-500"
              />
            </label>
            <span>Person</span>
            <span>Home screen</span>
            <span>Library only</span>
          </div>

          {status === 'loading' && <p className="p-8 text-center text-sm text-gray-400">Loading people…</p>}
          {status === 'error' && (
            <div className="flex flex-col items-center gap-3 p-8 text-center">
              <p className="text-sm text-gray-300">People couldn&apos;t be loaded.</p>
              <button
                type="button"
                onClick={() => {
                  setStatus('loading')
                  setAttempt((n) => n + 1)
                }}
                className="h-9 rounded-md bg-gray-700 px-3 text-sm text-white hover:bg-gray-600"
              >
                Try again
              </button>
            </div>
          )}
          {status === 'ready' && (
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {shown.map((person) => {
                const state = stateOf(person)
                return (
                  <li
                    key={person.userId}
                    className="grid grid-cols-[44px_minmax(0,1fr)] items-center gap-y-1 border-b border-gray-800 py-2 pl-2 pr-4 sm:grid-cols-[44px_minmax(0,1.4fr)_minmax(0,1.6fr)_120px]"
                  >
                    <label className="row-span-2 flex h-11 items-center justify-center sm:row-span-1">
                      <input
                        type="checkbox"
                        checked={selected.has(person.userId)}
                        disabled={!person.canOpen}
                        onChange={() => toggle(person.userId)}
                        aria-label={`Select ${person.name}`}
                        className="h-4 w-4 rounded border-gray-500 bg-gray-800 text-indigo-600 focus:ring-indigo-500 disabled:opacity-40"
                      />
                    </label>
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={person.name} colorKey={person.userId} />
                      <div className="min-w-0">
                        <p className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium text-white">{person.name}</span>
                          {person.role && (
                            <span className="shrink-0 rounded border border-gray-600 px-1.5 text-[11px] text-gray-300">
                              {ROLE_LABELS[person.role]}
                            </span>
                          )}
                        </p>
                        <p className="truncate text-xs text-gray-400">{person.email}</p>
                      </div>
                    </div>
                    <div className="col-start-2 min-w-0 sm:col-start-auto">
                      <span className={classNames('inline-block max-w-full truncate rounded-full px-2.5 py-0.5 align-middle text-sm', STATUS_CLASSES[state])}>
                        {statusText(person)}
                      </span>
                      {person.row?.hideUnavailable && (
                        <span className="ml-2 text-xs text-gray-400 sm:hidden">Library only</span>
                      )}
                    </div>
                    <span className="hidden text-sm text-gray-300 sm:block">
                      {person.row ? (person.row.hideUnavailable ? 'Yes' : 'No') : '—'}
                    </span>
                  </li>
                )
              })}
              {shown.length === 0 && (
                <li className="p-8 text-center text-sm text-gray-300">Nobody here matches.</li>
              )}
            </ul>
          )}

          {chosen.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-indigo-700 bg-indigo-950 px-4 py-3">
              <span className="text-sm font-semibold text-white">{chosen.length} selected</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => change({ action: 'add', userIds: chosen, position }, describeAdd)}
                className="h-9 rounded-md bg-indigo-600 px-3.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                Add to their home screens
              </button>
              <label className="flex items-center gap-2 text-sm text-indigo-100">
                <span>as the</span>
                <select
                  value={position}
                  onChange={(event) => setPosition(event.target.value)}
                  className="h-9 rounded-md border border-gray-600 bg-gray-900 px-2 text-sm text-white"
                >
                  <option value="top">first row</option>
                  <option value="bottom">last row</option>
                </select>
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() => change({ action: 'remove', userIds: chosen }, describeRemove)}
                className="h-9 rounded-md border border-indigo-500 px-3.5 text-sm font-medium text-indigo-100 hover:bg-indigo-500/10 disabled:opacity-50"
              >
                Remove from their home screens
              </button>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="h-9 px-2 text-sm font-medium text-indigo-200 hover:text-white sm:ml-auto"
              >
                Clear selection
              </button>
            </div>
          )}
        </div>

        {notice && (
          <p role="status" className="flex items-center gap-2 text-sm text-gray-300">
            <CheckIcon className="h-4 w-4 shrink-0 text-indigo-300" strokeWidth={2.5} aria-hidden="true" />
            {notice}
          </p>
        )}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-700 px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3.5 lg:px-7">
        {confirmingRemoveAll ? (
          <div role="alertdialog" aria-label="Confirm removing from every home screen" className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-white">
              Remove {playlist?.name} from {plural(counts.showing, 'home screen', 'home screens')}?
            </span>
            <button
              type="button"
              onClick={() => setConfirmingRemoveAll(false)}
              className="h-10 rounded-md bg-gray-600 px-3.5 text-sm font-medium text-white hover:bg-gray-500"
            >
              Keep them
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => change({ action: 'remove', everyone: true }, describeRemove)}
              className="h-10 rounded-md bg-red-700 px-3.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
            >
              Remove from all
            </button>
          </div>
        ) : (
          <Menu>
            <MenuButton
              disabled={busy || status !== 'ready'}
              className="flex h-10 items-center gap-1.5 rounded-md border border-gray-600 px-3 text-sm font-medium text-gray-200 hover:bg-gray-700 disabled:opacity-50"
            >
              Change for everyone
              <ChevronUpIcon className="h-4 w-4" aria-hidden="true" />
            </MenuButton>
            <MenuItems
              anchor="top start"
              className="z-50 w-80 rounded-lg border border-gray-600 bg-gray-900 p-1.5 shadow-xl [--anchor-gap:0.5rem] focus:outline-none"
            >
              <MenuItem>
                <button
                  type="button"
                  onClick={() => change({ action: 'add', everyone: true, position }, describeAdd)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2.5 text-left data-[focus]:bg-gray-800"
                >
                  <span className="text-sm font-medium text-white">Add to every home screen</span>
                  <span className="text-xs text-gray-400">
                    {isPrivate ? 'Everyone who can open it' : `All ${counts.all} people`}, as their {position === 'top' ? 'first' : 'last'} row
                  </span>
                </button>
              </MenuItem>
              <MenuItem disabled={counts.showing === 0}>
                <button
                  type="button"
                  onClick={() => setConfirmingRemoveAll(true)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2.5 text-left data-[disabled]:opacity-50 data-[focus]:bg-gray-800"
                >
                  <span className="text-sm font-medium text-red-300">Remove from every home screen</span>
                  <span className="text-xs text-gray-400">
                    Takes it off {plural(counts.showing, 'home screen', 'home screens')}, after you confirm
                  </span>
                </button>
              </MenuItem>
            </MenuItems>
          </Menu>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-10 rounded-md bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500"
        >
          Done
        </button>
      </footer>
    </>
  )
}
