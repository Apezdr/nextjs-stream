'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react'
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid'
import { toast } from 'react-toastify'
import { setUserRolesAction } from '@src/utils/actions/roles'

/**
 * The roles a user holds. Several at once: they get everything each allows.
 * Saved as soon as it changes, and put back if the save is refused.
 */
export default function UserRolesPicker({ userId, userName, value, roleOptions }) {
  const [selected, setSelected] = useState(value)
  const [saving, setSaving] = useState(false)

  if (roleOptions.length === 0) {
    return (
      <Link href="/admin/roles" className="text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline">
        No roles yet
      </Link>
    )
  }

  const names = roleOptions.filter((role) => selected.includes(role.id)).map((role) => role.name)

  const change = async (next) => {
    const previous = selected
    setSelected(next)
    setSaving(true)
    try {
      const result = await setUserRolesAction({ userID: userId, roleIds: next })
      if (!result.ok) {
        setSelected(previous)
        toast.error(result.error)
      }
    } catch {
      setSelected(previous)
      toast.error(`Couldn’t change ${userName}’s roles.`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Listbox value={selected} onChange={change} multiple disabled={saving}>
      <ListboxButton
        aria-label={`Roles for ${userName}`}
        className="flex w-48 items-center justify-between gap-2 rounded-xl bg-slate-950/60 px-3 py-2 text-left text-xs text-slate-200 ring-1 ring-inset ring-white/15 hover:ring-white/30 disabled:opacity-60"
      >
        <span className="truncate">{names.length > 0 ? names.join(', ') : 'No roles'}</span>
        <ChevronUpDownIcon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
      </ListboxButton>
      <ListboxOptions
        anchor="bottom start"
        className="z-50 w-56 rounded-xl bg-slate-900 py-1 shadow-xl ring-1 ring-white/15 focus:outline-none [--anchor-gap:4px]"
      >
        {roleOptions.map((role) => (
          <ListboxOption
            key={role.id}
            value={role.id}
            className="group flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-slate-200 data-[focus]:bg-white/10"
          >
            <CheckIcon className="invisible h-4 w-4 text-indigo-300 group-data-[selected]:visible" aria-hidden="true" />
            <span className="truncate">{role.name}</span>
          </ListboxOption>
        ))}
      </ListboxOptions>
    </Listbox>
  )
}
