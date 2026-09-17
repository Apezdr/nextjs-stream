'use client'

import { useState } from 'react'
import { classNames } from '@src/utils'
import CastRail from './CastRail'

const validPeople = (cast) => (Array.isArray(cast) ? cast.filter((person) => person && person.name) : [])

/**
 * "Guest stars · 12 | Series cast · 12": a tab strip over two cast rails on
 * the episode page. Tabs with no one in them are dropped; one tab left is
 * just its rail with the usual heading; none is nothing.
 *
 * Arrow keys, Home and End move the selection (and focus) the way a tablist
 * should; focus moves by element id inside the handler, never through a
 * ref read during render.
 *
 * @param {{ tabs: Array<{ id: string, label: string, cast: Array<{ id?: number, name: string, character?: string, profile_path?: string|null }> }>, defaultTab?: string|null }} props
 */
export default function CastTabs({ tabs, defaultTab = null }) {
  const [selected, setSelected] = useState(defaultTab)
  const usable = (tabs || [])
    .filter((tab) => tab && tab.id && tab.label)
    .map((tab) => ({ ...tab, cast: validPeople(tab.cast) }))
    .filter((tab) => tab.cast.length > 0)

  if (usable.length === 0) return null
  if (usable.length === 1) return <CastRail cast={usable[0].cast} title={usable[0].label} bleed={false} />

  const active = usable.find((tab) => tab.id === selected) || usable[0]

  const onKeyDown = (event) => {
    const index = usable.findIndex((tab) => tab.id === active.id)
    let nextIndex
    switch (event.key) {
      case 'ArrowRight':
        nextIndex = (index + 1) % usable.length
        break
      case 'ArrowLeft':
        nextIndex = (index - 1 + usable.length) % usable.length
        break
      case 'Home':
        nextIndex = 0
        break
      case 'End':
        nextIndex = usable.length - 1
        break
      default:
        return
    }
    event.preventDefault()
    const next = usable[nextIndex]
    setSelected(next.id)
    document.getElementById(`tab-${next.id}`)?.focus()
  }

  return (
    <div>
      <div role="tablist" aria-label="Cast" className="mb-4 flex gap-6 border-b border-white/10" onKeyDown={onKeyDown}>
        {usable.map((tab) => {
          const isActive = tab.id === active.id
          return (
            <button
              key={tab.id}
              role="tab"
              type="button"
              id={`tab-${tab.id}`}
              aria-selected={isActive}
              aria-controls={`panel-${tab.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setSelected(tab.id)}
              className={classNames(
                'text-base font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300',
                isActive ? '-mb-px border-b-2 border-blue-400 pb-2 text-white' : 'pb-2 text-white/55 hover:text-white'
              )}
            >
              {tab.label} <span className="text-sm font-normal text-white/45">· {tab.cast.length}</span>
            </button>
          )
        })}
      </div>
      <div role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`}>
        <CastRail key={active.id} cast={active.cast} title={active.label} hideHeading bleed={false} />
      </div>
    </div>
  )
}
