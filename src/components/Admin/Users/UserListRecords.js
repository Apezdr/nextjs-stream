'use client'

import {
  CheckIcon,
  XMarkIcon,
  ShieldCheckIcon,
  ShieldExclamationIcon,
  EyeIcon,
} from '@heroicons/react/24/outline'
import { toast } from 'react-toastify'
import { updateUserApprovedFlag } from '@src/utils/actions/admin_users'
import { canViewAs } from '@src/lib/roles/rules'
import { startViewAs } from '@components/ViewAs/viewAsClient'
import { memo, useMemo, useState } from 'react'
import UserRolesPicker from './UserRolesPicker'

function cn(...classes) {
  return classes.filter(Boolean).join(' ')
}

function StatusPill({ approved }) {
  const isApproved = approved === 'true'

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset',
        isApproved
          ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-400/20'
          : 'bg-amber-500/10 text-amber-300 ring-amber-400/20'
      )}
    >
      {isApproved ? (
        <CheckIcon className="h-3.5 w-3.5" />
      ) : (
        <XMarkIcon className="h-3.5 w-3.5" />
      )}
      {isApproved ? 'Approved' : 'Pending'}
    </span>
  )
}

// Limited: the user holds a role with a library scope (give or take it in Roles)
function AccessPill({ limited }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset',
        limited
          ? 'bg-rose-500/10 text-rose-300 ring-rose-400/20'
          : 'bg-sky-500/10 text-sky-300 ring-sky-400/20'
      )}
    >
      {limited ? (
        <ShieldExclamationIcon className="h-3.5 w-3.5" />
      ) : (
        <ShieldCheckIcon className="h-3.5 w-3.5" />
      )}
      {limited ? 'Limited library' : 'Full library'}
    </span>
  )
}

function AvatarCell({ name, imageUrl }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-lg shadow-black/20">
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={name || 'User avatar'}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-base font-semibold text-slate-300">
            {(name || '?').slice(0, 1).toUpperCase()}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-white">{name || 'Unknown User'}</p>
      </div>
    </div>
  )
}

function ActionButton({ children, onClick, variant = 'default', disabled = false, primary = false, title }) {
  const styles = {
    default:
      'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10 hover:border-white/20',
    success: primary
      ? 'border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 shadow-lg shadow-emerald-500/10'
      : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300/80 hover:bg-emerald-500/15',
    danger: primary
      ? 'border-rose-500/40 bg-rose-500/20 text-rose-200 hover:bg-rose-500/30 shadow-lg shadow-rose-500/10'
      : 'border-rose-500/20 bg-rose-500/10 text-rose-300/80 hover:bg-rose-500/15',
    warning:
      'border-amber-500/20 bg-amber-500/10 text-amber-300/80 hover:bg-amber-500/15',
    view:
      'border-sky-500/25 bg-sky-500/10 text-sky-200 hover:bg-sky-500/20 hover:border-sky-400/40',
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant]
      )}
    >
      {children}
    </button>
  )
}

function UserListRecords({
  title,
  subtitle,
  data,
  updateProcessedData,
  roleOptions = [],
  viewerId,
}) {
  const [loadingStates, setLoadingStates] = useState(data ? data.map(() => false) : [])

  const rows = useMemo(() => data || [], [data])
  const limitingRoleIds = useMemo(
    () => new Set(roleOptions.filter((role) => role.limitsLibrary).map((role) => role.id)),
    [roleOptions]
  )

  const setRowLoading = (index, isLoading) => {
    setLoadingStates((prev) => prev.map((loading, i) => (i === index ? isLoading : loading)))
  }

  const handleApproveClick = async (index, userID, approved) => {
    setRowLoading(index, true)
    try {
      await updateUserApprovedFlag({ userID, approved })
      await updateProcessedData()
    } finally {
      setRowLoading(index, false)
    }
  }

  // View as: the app as this user sees it, read-only, until Stop. On success
  // the page leaves (a full navigation), so the row stays busy
  const handleViewAsClick = async (index, user) => {
    setRowLoading(index, true)
    const result = await startViewAs(user.id)
    if (result.ok) return
    toast.error(`Couldn’t view as ${user.name || user.email}: ${result.error}`)
    setRowLoading(index, false)
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-slate-950/70 shadow-2xl shadow-blue-500/5 backdrop-blur-xl">
      <div className="flex flex-col gap-4 border-b border-white/10 px-6 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <p className="mt-1 text-sm text-slate-300">{subtitle}</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="sticky top-0 z-10 bg-slate-900/98 backdrop-blur-md">
            <tr className="border-b border-white/20">
              <th className="px-6 py-5 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
                User
              </th>
              <th className="px-6 py-5 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
                Email
              </th>
              <th className="px-6 py-5 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
                Access
              </th>
              <th className="px-6 py-5 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
                Approval
              </th>
              <th className="px-6 py-5 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
                Roles
              </th>
              <th className="px-6 py-5 text-right text-[10px] font-bold uppercase tracking-[0.18em] text-slate-300">
                Actions
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-white/10">
            {rows.map((item, index) => {
              const isLoading = loadingStates[index]
              const isApproved = item.approved === 'true'
              const isPending = item.approved !== 'true'

              return (
                <tr
                  key={item.id}
                  className="transition hover:bg-white/[0.04]"
                >
                  <td className="px-6 py-5">
                    <AvatarCell name={item.name} imageUrl={item.imageUrl} />
                  </td>

                  <td className="max-w-[280px] px-6 py-5">
                    <div className="truncate text-sm font-medium text-slate-200" title={item.email}>
                      {item.email}
                    </div>
                  </td>

                  <td className="px-6 py-5">
                    <AccessPill limited={(item.roles ?? []).some((id) => limitingRoleIds.has(id))} />
                  </td>

                  <td className="px-6 py-5">
                    <StatusPill approved={item.approved} />
                  </td>

                  <td className="px-6 py-5">
                    <UserRolesPicker
                      userId={item.id}
                      userName={item.name || item.email}
                      value={item.roles ?? []}
                      roleOptions={roleOptions}
                    />
                  </td>

                  <td className="px-6 py-5">
                    <div className="flex flex-wrap justify-end gap-2">
                      {canViewAs(viewerId, item) && (
                        <ActionButton
                          variant="view"
                          disabled={isLoading}
                          title={`See the app as ${item.name || item.email} sees it, read-only`}
                          onClick={() => handleViewAsClick(index, item)}
                        >
                          <EyeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                          View as
                        </ActionButton>
                      )}

                      {isPending && (
                        <ActionButton
                          variant="success"
                          primary={true}
                          disabled={isLoading}
                          onClick={() => handleApproveClick(index, item.id, true)}
                        >
                          Approve
                        </ActionButton>
                      )}

                      {isPending && (
                        <ActionButton
                          variant="danger"
                          disabled={isLoading}
                          onClick={() => handleApproveClick(index, item.id, false)}
                        >
                          Reject
                        </ActionButton>
                      )}

                      {isApproved && (
                        <ActionButton
                          variant="danger"
                          primary={false}
                          disabled={isLoading}
                          onClick={() => handleApproveClick(index, item.id, false)}
                        >
                          Revoke
                        </ActionButton>
                      )}

                      {isLoading && (
                        <span className="self-center text-xs text-slate-400">Updating...</span>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default memo(UserListRecords)
