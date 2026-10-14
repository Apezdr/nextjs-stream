'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { IdentificationIcon, PencilSquareIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { classNames } from '@src/utils'
import { deleteRoleAction, saveRoleAction } from '@src/utils/actions/roles'
import { CAPABILITY_EDITORS } from './capabilityEditors'

const inputClass =
  'block w-full rounded-xl border-0 bg-slate-950/60 px-3 py-2 text-sm text-white ring-1 ring-inset ring-white/15 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500'
const checkboxClass = 'h-4 w-4 rounded border-gray-600 bg-gray-800 text-indigo-500 focus:ring-indigo-500'
const primaryButton =
  'inline-flex items-center gap-1.5 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50'
const quietButton =
  'inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium text-slate-300 hover:bg-white/10 hover:text-white disabled:opacity-50'

const blankRole = () => ({ id: null, name: '', description: '', grants: {} })

function RoleEditor({ draft, setDraft, capabilities, editorData, saving, error, onSave, onCancel }) {
  const toggleCapability = (capability, on) =>
    setDraft((previous) => {
      const grants = { ...previous.grants }
      if (on) grants[capability.key] = grants[capability.key] ?? capability.empty
      else delete grants[capability.key]
      return { ...previous, grants }
    })

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
      className="space-y-5 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10"
    >
      <h2 className="text-lg font-semibold text-white">{draft.id ? `Edit “${draft.name}”` : 'New role'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-200">Name</span>
          <input
            value={draft.name}
            onChange={(event) => setDraft((previous) => ({ ...previous, name: event.target.value }))}
            maxLength={60}
            placeholder="e.g. HD requester"
            className={inputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-200">Description</span>
          <input
            value={draft.description}
            onChange={(event) => setDraft((previous) => ({ ...previous, description: event.target.value }))}
            maxLength={200}
            placeholder="Who it's for"
            className={inputClass}
          />
        </label>
      </div>

      <div className="space-y-3">
        <p className="text-sm font-medium text-slate-200">Capabilities</p>
        {capabilities.map((capability) => {
          const granted = capability.key in draft.grants
          const editor = CAPABILITY_EDITORS[capability.key]
          return (
            <div key={capability.key} className="rounded-xl bg-slate-950/40 p-4 ring-1 ring-white/10">
              <label className="flex cursor-pointer items-start gap-2">
                <input
                  type="checkbox"
                  checked={granted}
                  onChange={(event) => toggleCapability(capability, event.target.checked)}
                  className={classNames(checkboxClass, 'mt-0.5')}
                />
                <span>
                  <span className="text-sm font-medium text-white">{capability.label}</span>
                  <span className="block text-xs text-slate-400">{capability.description}</span>
                </span>
              </label>
              {granted && editor && (
                <div className="mt-4 border-t border-white/10 pt-4">
                  <editor.Editor
                    value={draft.grants[capability.key]}
                    data={editorData[capability.key]}
                    onChange={(settings) =>
                      setDraft((previous) => ({ ...previous, grants: { ...previous.grants, [capability.key]: settings } }))
                    }
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {error && (
        <p className="text-sm text-red-400" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={quietButton}>
          Cancel
        </button>
        <button type="submit" disabled={saving} className={primaryButton}>
          {saving ? 'Saving…' : 'Save role'}
        </button>
      </div>
    </form>
  )
}

/**
 * Roles: named sets of capabilities that let non-admin users do more,
 * without making them admins. A user can hold several, and their grants
 * combine. Each capability brings its own settings editor.
 */
export default function RolesAdmin({ roles: initialRoles, holders, capabilities, editorData }) {
  const router = useRouter()
  const [roles, setRoles] = useState(initialRoles)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const labels = Object.fromEntries(capabilities.map((capability) => [capability.key, capability.label]))

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await saveRoleAction(draft)
      if (!result.ok) {
        setError(result.error)
        return
      }
      setRoles((previous) =>
        [...previous.filter((role) => role.id !== result.role.id), result.role].sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        )
      )
      setDraft(null)
      toast.success(`Saved “${result.role.name}”.`)
      router.refresh()
    } catch {
      setError('Couldn’t save the role. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (role) => {
    if (!window.confirm(`Delete the role “${role.name}”?`)) return
    const result = await deleteRoleAction(role.id).catch(() => ({ ok: false, error: 'Couldn’t delete the role.' }))
    if (!result.ok) {
      toast.error(result.error)
      return
    }
    setRoles((previous) => previous.filter((other) => other.id !== role.id))
    toast.success(`Deleted “${role.name}”.`)
    router.refresh()
  }

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-xs font-medium uppercase tracking-[0.25em] text-blue-200/70">Admin</p>
          <h1 className="flex items-center gap-2 text-3xl font-semibold tracking-tight text-white">
            <IdentificationIcon className="h-8 w-8 text-indigo-300" aria-hidden="true" />
            Roles
          </h1>
          <p className="max-w-2xl text-sm text-slate-300/90">
            Let people do more without making them admins. Give roles to users on the Users page; someone with several
            roles gets everything each one allows. Admins can always do everything.
          </p>
        </div>
        {!draft && (
          <button type="button" onClick={() => setDraft(blankRole())} className={primaryButton}>
            <PlusIcon className="h-4 w-4" aria-hidden="true" />
            New role
          </button>
        )}
      </div>

      {draft && (
        <RoleEditor
          draft={draft}
          setDraft={setDraft}
          capabilities={capabilities}
          editorData={editorData}
          saving={saving}
          error={error}
          onSave={save}
          onCancel={() => {
            setDraft(null)
            setError(null)
          }}
        />
      )}

      {roles.length === 0 && !draft ? (
        <p className="rounded-2xl bg-white/[0.04] p-6 text-sm text-slate-300 ring-1 ring-white/10">
          No roles yet. A role could be “HD requester”: request movies and shows in HD profiles, searched
          automatically.
        </p>
      ) : (
        <ul className="space-y-3">
          {roles.map((role) => {
            const count = holders[role.id] ?? 0
            return (
              <li key={role.id} className="rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-white">{role.name}</h2>
                    {role.description && <p className="text-sm text-slate-300">{role.description}</p>}
                    <p className="mt-1 text-xs text-slate-400">
                      {count === 0 ? 'Nobody holds it yet' : `${count} user${count === 1 ? '' : 's'}`}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setDraft({ ...role, grants: { ...role.grants } })}
                      className={quietButton}
                      aria-label={`Edit ${role.name}`}
                    >
                      <PencilSquareIcon className="h-4 w-4" aria-hidden="true" />
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(role)}
                      className={quietButton}
                      aria-label={`Delete ${role.name}`}
                    >
                      <TrashIcon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <ul className="mt-3 space-y-1">
                  {Object.entries(role.grants).map(([key, settings]) => (
                    <li key={key} className="text-sm text-slate-200">
                      <span className="font-medium">{labels[key] ?? key}</span>
                      {CAPABILITY_EDITORS[key] && (
                        <span className="text-slate-400"> · {CAPABILITY_EDITORS[key].describe(settings, editorData[key])}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
