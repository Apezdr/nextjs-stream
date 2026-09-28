'use client'

import { useEffect, useReducer, useState } from 'react'
import { ChevronLeftIcon, MagnifyingGlassIcon, PencilSquareIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'
import HomeRowsEditor, { Avatar } from './HomeRowsEditor'
import { EditorSkeleton } from './HomeRowsDialog'
import { homeRowsApi } from './homeRowsApi'
import { emptyEditorState, hasChanges, homeRowsReducer, rowsToSave } from './homeRowsState'

/**
 * Admin, by person: pick someone and change their home screen rows the way
 * they see them, offered only the playlists they can open.
 */
export default function HomeRowsByPerson({ onClose }) {
  const [people, setPeople] = useState([])
  const [peopleStatus, setPeopleStatus] = useState('loading')
  const [peopleAttempt, setPeopleAttempt] = useState(0)
  const [query, setQuery] = useState('')

  const [personId, setPersonId] = useState(null)
  const [state, dispatch] = useReducer(homeRowsReducer, emptyEditorState)
  const [editorStatus, setEditorStatus] = useState('idle') // 'idle' | 'loading' | 'ready' | 'error'
  const [editorAttempt, setEditorAttempt] = useState(0)
  const [saving, setSaving] = useState(false)

  // Loading states are set by whatever asks for a reload; a refresh after a
  // save keeps the current list in view
  useEffect(() => {
    let current = true
    homeRowsApi
      .people()
      .then((result) => {
        if (!current) return
        setPeople(result.people || [])
        setPeopleStatus('ready')
      })
      .catch((error) => {
        if (!current) return
        console.error('[HomeRowsByPerson] people failed to load:', error)
        setPeopleStatus('error')
      })
    return () => {
      current = false
    }
  }, [peopleAttempt])

  useEffect(() => {
    if (!personId) return
    let current = true
    homeRowsApi
      .load(personId)
      .then((data) => {
        if (!current) return
        dispatch({ type: 'load', data })
        setEditorStatus('ready')
      })
      .catch((error) => {
        if (!current) return
        console.error('[HomeRowsByPerson] rows failed to load:', error)
        setEditorStatus('error')
      })
    return () => {
      current = false
    }
  }, [personId, editorAttempt])

  const person = people.find((entry) => entry.userId === personId)
  const firstName = person?.name.trim().split(/\s+/)[0] || 'them'
  const changed = editorStatus === 'ready' && hasChanges(state)

  const choose = (userId) => {
    if (userId === personId) return
    if (changed && !window.confirm(`Discard your changes to ${person?.name}'s rows?`)) return
    if (userId) setEditorStatus('loading')
    setPersonId(userId)
  }

  const reloadEditor = () => {
    setEditorStatus('loading')
    setEditorAttempt((n) => n + 1)
  }

  const save = async () => {
    setSaving(true)
    try {
      await homeRowsApi.save(rowsToSave(state), personId)
      toast.success(`Saved ${person?.name}'s home screen rows`)
      dispatch({ type: 'saved' })
      setPeopleAttempt((n) => n + 1) // refresh their row count
    } catch (error) {
      toast.error(error.message || 'Their rows could not be saved')
    } finally {
      setSaving(false)
    }
  }

  const needle = query.trim().toLowerCase()
  const shownPeople = people.filter(
    (entry) => !needle || entry.name.toLowerCase().includes(needle) || entry.email.toLowerCase().includes(needle)
  )

  return (
    <>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside
          aria-label="People"
          className={classNames(
            'min-h-0 flex-col gap-3 border-gray-700 bg-gray-900/40 p-4 lg:flex lg:border-r lg:py-5 lg:pl-7 lg:pr-4',
            personId ? 'hidden' : 'flex'
          )}
        >
          <label className="relative block">
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
          {peopleStatus === 'loading' && <p className="p-4 text-sm text-gray-400">Loading people…</p>}
          {peopleStatus === 'error' && (
            <button
              type="button"
              onClick={() => {
                setPeopleStatus('loading')
                setPeopleAttempt((n) => n + 1)
              }}
              className="p-4 text-left text-sm text-indigo-300"
            >
              People couldn&apos;t be loaded. Try again
            </button>
          )}
          {peopleStatus === 'ready' && (
            <ul className="-mr-1 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
              {shownPeople.map((entry) => {
                const current = entry.userId === personId
                return (
                  <li key={entry.userId}>
                    <button
                      type="button"
                      onClick={() => choose(entry.userId)}
                      aria-current={current ? 'true' : undefined}
                      className={classNames(
                        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                        current ? 'bg-indigo-900' : 'hover:bg-gray-700/60'
                      )}
                    >
                      <Avatar name={entry.name} colorKey={entry.userId} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-white">{entry.name}</span>
                        <span className={classNames('block truncate text-xs', current ? 'text-indigo-100' : 'text-gray-400')}>
                          {entry.rowCount === 0 ? 'No rows' : entry.rowCount === 1 ? '1 row' : `${entry.rowCount} rows`}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
              {shownPeople.length === 0 && <li className="p-4 text-sm text-gray-300">Nobody matches.</li>}
            </ul>
          )}
        </aside>

        <div className={classNames('min-h-0 flex-col lg:flex', personId ? 'flex' : 'hidden')}>
          {!personId ? (
            <p className="m-auto p-8 text-center text-gray-300">Pick someone to see their home screen rows.</p>
          ) : (
            <>
              <div className="flex items-center gap-2 px-4 pt-4 lg:px-7 lg:pt-5">
                <button
                  type="button"
                  onClick={() => choose(null)}
                  aria-label="Back to everyone"
                  className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-gray-300 lg:hidden"
                >
                  <ChevronLeftIcon className="h-5 w-5" aria-hidden="true" />
                </button>
                <div role="note" className="flex flex-1 items-center gap-2.5 rounded-lg border border-slate-700 bg-slate-800 px-3.5 py-3">
                  <PencilSquareIcon className="h-5 w-5 shrink-0 text-indigo-300" aria-hidden="true" />
                  <p className="text-sm text-slate-200">
                    You&apos;re changing <strong className="text-white">{person?.name}&apos;s</strong> home screen. They&apos;ll see it
                    the next time they open the app.
                  </p>
                </div>
              </div>
              {editorStatus === 'loading' && <EditorSkeleton />}
              {editorStatus === 'error' && (
                <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
                  <p className="text-white">{person?.name}&apos;s rows couldn&apos;t be loaded.</p>
                  <button
                    type="button"
                    onClick={reloadEditor}
                    className="h-10 rounded-md bg-gray-600 px-4 text-sm font-medium text-white hover:bg-gray-500"
                  >
                    Try again
                  </button>
                </div>
              )}
              {editorStatus === 'ready' && (
                <HomeRowsEditor key={personId} state={state} dispatch={dispatch} perspective="person" personName={person?.name || ''} />
              )}
            </>
          )}
        </div>
      </div>

      <footer className="flex items-center justify-end gap-3 border-t border-gray-700 px-4 pb-[max(0.875rem,env(safe-area-inset-bottom))] pt-3.5 lg:px-7">
        {personId ? (
          <>
            <button
              type="button"
              onClick={reloadEditor}
              disabled={!changed || saving}
              className="h-10 rounded-md bg-gray-600 px-4 text-sm font-medium text-white hover:bg-gray-500 disabled:opacity-50"
            >
              Undo changes
            </button>
            <button
              type="button"
              onClick={save}
              disabled={!changed || saving}
              className="h-10 rounded-md bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
            >
              {saving ? 'Saving…' : `Save ${firstName}'s rows`}
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={onClose}
            className="h-10 rounded-md bg-indigo-600 px-5 text-sm font-semibold text-white hover:bg-indigo-500"
          >
            Done
          </button>
        )}
      </footer>
    </>
  )
}
