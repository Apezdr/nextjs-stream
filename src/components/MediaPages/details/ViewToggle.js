'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { ListBulletIcon, Squares2X2Icon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'

/** localStorage key the season page's list/grid choice lives under. */
export const VIEW_STORAGE_KEY = 'tv-episodes-view'
/** Fired on `window` after a write, so every hook in this tab re-reads. */
const CHANGE_EVENT = 'tv-episodes-view-change'
const VIEWS = ['list', 'grid']

// Module-level so useSyncExternalStore never re-subscribes on a render.
function subscribe(onChange) {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGE_EVENT, onChange)
  }
}

// The server, and the client while it hydrates, always see the fallback, so
// the first paint is identical on both; the stored choice applies on the
// render right after.
const SERVER_SNAPSHOTS = { list: () => 'list', grid: () => 'grid' }

// Where the choice lives for this tab when localStorage will not take it
// (private mode, quota).
const memory = new Map()

function readView(storageKey, fallback) {
  let stored = null
  try {
    stored = window.localStorage.getItem(storageKey)
  } catch {
    stored = null
  }
  if (stored === null) stored = memory.get(storageKey) ?? null
  return VIEWS.includes(stored) ? stored : fallback
}

/**
 * The remembered list/grid choice, as `[view, setView]`.
 *
 * Reads localStorage through useSyncExternalStore so nothing touches
 * storage during render: SSR and the hydrating client both render the
 * fallback, and the stored value takes over on the next render. Writes go
 * to localStorage (best effort) and notify every subscriber in the tab.
 *
 * @param {string} [storageKey]
 * @param {'list'|'grid'} [fallback]
 * @returns {['list'|'grid', (view: 'list'|'grid') => void]}
 */
export function useStoredView(storageKey = VIEW_STORAGE_KEY, fallback = 'list') {
  const getSnapshot = useCallback(() => readView(storageKey, fallback), [storageKey, fallback])
  const view = useSyncExternalStore(subscribe, getSnapshot, SERVER_SNAPSHOTS[fallback] || SERVER_SNAPSHOTS.list)

  const setView = useCallback(
    (next) => {
      const value = next === 'grid' ? 'grid' : 'list'
      memory.set(storageKey, value)
      try {
        window.localStorage.setItem(storageKey, value)
      } catch {
        // Private mode / quota: `memory` carries it for this tab.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT))
    },
    [storageKey]
  )

  return [view, setView]
}

const OPTIONS = [
  { id: 'list', label: 'List view', Icon: ListBulletIcon },
  { id: 'grid', label: 'Grid view', Icon: Squares2X2Icon },
]

/**
 * The two icon buttons that switch the episode list between rows and cards.
 *
 * @param {{ value: 'list'|'grid', onChange: (view: 'list'|'grid') => void }} props
 */
export default function ViewToggle({ value, onChange }) {
  return (
    <div role="group" aria-label="Episode layout" className="inline-flex rounded-md bg-white/5 p-0.5 ring-1 ring-white/10">
      {OPTIONS.map(({ id, label, Icon }) => {
        const active = value === id
        return (
          <button
            key={id}
            type="button"
            aria-label={label}
            aria-pressed={active}
            onClick={() => onChange(id)}
            className={classNames(
              'flex size-9 items-center justify-center rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300',
              active ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white'
            )}
          >
            <Icon className="size-5" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}
