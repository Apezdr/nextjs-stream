'use client'

import { useState } from 'react'
import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, MinusIcon } from '@heroicons/react/20/solid'
import {
  ALL_SOURCES,
  areaState,
  describeSelection,
  groupSources,
  isShown,
  onlyArea,
  onlyCategory,
  setAreaShown,
  setCategoryShown,
} from './logSources'

function TriStateBox({ state, label, onToggle }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'all' ? 'true' : state === 'some' ? 'mixed' : 'false'}
      aria-label={label}
      onClick={onToggle}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        state === 'none' ? 'border-gray-300 bg-white' : 'border-indigo-600 bg-indigo-600 text-white'
      }`}
    >
      {state === 'all' && <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />}
      {state === 'some' && <MinusIcon className="h-3.5 w-3.5" aria-hidden="true" />}
    </button>
  )
}

function OnlyButton({ label, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Show only ${label}`}
      className="rounded px-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50 focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
    >
      Only
    </button>
  )
}

/**
 * The Sources filter: the areas that logged in the time range, each with its
 * categories and line counts. Unchecking hides an area or a category,
 * "Only" isolates one.
 */
export default function SourcesPicker({ selection, areas, facetCategories, onChange }) {
  const [expanded, setExpanded] = useState(() => new Set())
  const groups = groupSources(areas, facetCategories).filter(
    (area) => area.count > 0 || selection.tokens.includes(`area:${area.id}`)
  )

  const toggleExpanded = (id) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Popover className="relative">
      <PopoverButton className="flex w-full items-center justify-between gap-2 rounded-md bg-white py-1.5 pl-3 pr-2 text-left text-sm text-gray-900 ring-1 ring-inset ring-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-600">
        <span className="truncate">{describeSelection(selection, areas)}</span>
        <ChevronDownIcon className="h-5 w-5 shrink-0 text-gray-400" aria-hidden="true" />
      </PopoverButton>

      <PopoverPanel
        anchor="bottom start"
        className="z-20 max-h-[26rem] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto [--anchor-gap:4px] rounded-md bg-white py-2 text-sm shadow-lg ring-1 ring-black/10 focus:outline-none"
      >
        <div className="flex items-center justify-between px-3 pb-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-500">Lines in this range</span>
          <button
            type="button"
            onClick={() => onChange(ALL_SOURCES)}
            disabled={selection.tokens.length === 0}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:text-gray-300"
          >
            Show all
          </button>
        </div>

        {groups.length === 0 && <p className="px-3 py-2 text-gray-500">Nothing logged in this range.</p>}

        <ul>
          {groups.map((area) => {
            const open = expanded.has(area.id)
            const state = areaState(selection, area)
            return (
              <li key={area.id}>
                <div className="group flex items-center gap-2 px-2 py-1 hover:bg-gray-50">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(area.id)}
                    disabled={area.categories.length === 0}
                    aria-expanded={open}
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${area.label}`}
                    className="rounded text-gray-400 hover:text-gray-700 disabled:invisible"
                  >
                    <ChevronRightIcon className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden="true" />
                  </button>
                  <TriStateBox
                    state={state}
                    label={area.label}
                    onToggle={() => onChange(setAreaShown(selection, area, state !== 'all'))}
                  />
                  <span className="min-w-0 flex-1 font-medium text-gray-900">{area.label}</span>
                  <OnlyButton label={area.label} onClick={() => onChange(onlyArea(area))} />
                  <span className="w-16 text-right tabular-nums text-gray-500">{area.count.toLocaleString()}</span>
                </div>
                {open && (
                  <ul>
                    {area.categories.map((category) => {
                      const shown = isShown(selection, category.name, area.id)
                      return (
                        <li key={category.name} className="group flex items-center gap-2 py-1 pl-10 pr-2 hover:bg-gray-50">
                          <TriStateBox
                            state={shown ? 'all' : 'none'}
                            label={category.name}
                            onToggle={() => onChange(setCategoryShown(selection, area, category.name, !shown))}
                          />
                          <span className="min-w-0 flex-1 break-all font-mono text-xs text-gray-700">{category.name}</span>
                          <OnlyButton label={category.name} onClick={() => onChange(onlyCategory(category.name))} />
                          <span className="w-16 text-right tabular-nums text-gray-500">{category.count.toLocaleString()}</span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
        <p className="border-t border-gray-100 px-3 pt-2 text-xs text-gray-500">
          Counts follow the time range and level, not the search.
        </p>
      </PopoverPanel>
    </Popover>
  )
}
