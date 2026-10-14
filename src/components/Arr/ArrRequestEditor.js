'use client'

import { useState } from 'react'
import { classNames } from '@src/utils'

const SERVICES = [
  { key: 'radarr', name: 'Radarr', titles: 'movies' },
  { key: 'sonarr', name: 'Sonarr', titles: 'shows' },
]

const modeOf = (profiles) => (profiles === 'all' ? 'all' : profiles.length > 0 ? 'some' : 'none')

function profileNames(profiles, choices) {
  if (profiles === 'all') return 'any profile'
  const known = choices?.profiles ?? []
  return profiles.map((id) => known.find((profile) => profile.id === id)?.name ?? `profile #${id}`).join(', ')
}

/** One line for a role's card: what this grant allows. */
export function describeArrRequest(value, data) {
  const parts = SERVICES.filter(({ key }) => value[key] === 'all' || value[key].length > 0).map(
    ({ key, name }) => `${name}: ${profileNames(value[key], data?.[key])}`
  )
  if (parts.length === 0) return 'No service yet'
  if (value.manual) parts.push('picks releases by hand')
  if (value.anyTitle) parts.push('any title')
  return parts.join(' · ')
}

const radioClass = 'h-4 w-4 border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500'
const checkboxClass = 'h-4 w-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500'

function ServiceProfiles({ service, profiles, choices, onChange }) {
  // "Only these" with nothing ticked yet is still "only these" on screen.
  const [mode, setMode] = useState(() => modeOf(profiles))
  const selected = Array.isArray(profiles) ? profiles : []
  const available = choices?.profiles ?? null

  const pickMode = (next) => {
    setMode(next)
    onChange(next === 'all' ? 'all' : next === 'none' ? [] : selected)
  }
  const toggle = (id) =>
    onChange(selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id].sort((a, b) => a - b))

  const option = (value, label) => (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
      <input
        type="radio"
        name={`arr-request-${service.key}`}
        checked={mode === value}
        onChange={() => pickMode(value)}
        disabled={value === 'some' && !available}
        className={radioClass}
      />
      {label}
    </label>
  )

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium text-slate-100">
        {service.name} <span className="font-normal text-slate-400">({service.titles})</span>
      </legend>
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {option('none', 'None')}
        {option('all', 'Any quality profile')}
        {option('some', 'Only these')}
      </div>
      {choices?.unavailable && <p className="text-xs text-amber-300">{choices.unavailable}</p>}
      {mode === 'some' && available && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {available.map((profile) => (
            <label key={profile.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
              <input
                type="checkbox"
                checked={selected.includes(profile.id)}
                onChange={() => toggle(profile.id)}
                className={checkboxClass}
              />
              {profile.name}
            </label>
          ))}
        </div>
      )}
    </fieldset>
  )
}

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className={classNames(checkboxClass, 'mt-0.5')}
      />
      <span>
        <span className="font-medium text-slate-100">{label}</span>
        <span className="block text-xs text-slate-400">{hint}</span>
      </span>
    </label>
  )
}

/**
 * The role editor's settings for arr.request: the quality profiles allowed
 * on each service, and the two extras. Automatic search comes with any
 * profile; folders, profile changes and rejected releases are arr.manage.
 * `data` is the live profile list per service (profileChoices.ts).
 */
export default function ArrRequestEditor({ value, onChange, data }) {
  return (
    <div className="space-y-4">
      {SERVICES.map((service) => (
        <ServiceProfiles
          key={service.key}
          service={service}
          profiles={value[service.key]}
          choices={data?.[service.key]}
          onChange={(profiles) => onChange({ ...value, [service.key]: profiles })}
        />
      ))}
      <Toggle
        checked={value.manual}
        onChange={(manual) => onChange({ ...value, manual })}
        label="Pick releases by hand"
        hint="Search the indexers and choose a release, as well as searching automatically."
      />
      <Toggle
        checked={value.anyTitle}
        onChange={(anyTitle) => onChange({ ...value, anyTitle })}
        label="Any title, not only their own"
        hint="Search and pick for any title Radarr or Sonarr has in an allowed profile, not only the ones they requested."
      />
    </div>
  )
}
